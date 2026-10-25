import {
  createWebSearchProviderContractFields,
  resolveProviderWebSearchPluginConfig,
} from "openclaw/plugin-sdk/provider-web-search-contract";
import {
  buildSearchCacheKey,
  DEFAULT_SEARCH_COUNT,
  mergeScopedSearchConfig,
  readCachedSearchPayload,
  readNumberParam,
  readProviderEnvValue,
  readStringArrayParam,
  readStringParam,
  resolveSearchCacheTtlMs,
  resolveSearchCount,
  resolveWebSearchProviderCredential,
  resolveSearchTimeoutSeconds,
  resolveSiteName,
  throwWebSearchApiError,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const ENDPOINT = "https://api.search.tinyfish.ai";
const CREDENTIAL_PATH = "plugins.entries.tinyfish.config.webSearch.apiKey";
const FRESHNESS_MINUTES = { day: 1440, week: 10080, month: 43200, year: 525600 };

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveProviderConfig(searchConfig) {
  return isRecord(searchConfig?.tinyfish) ? searchConfig.tinyfish : undefined;
}

function resolveCredential(searchConfig) {
  return resolveWebSearchProviderCredential({
    credentialValue: resolveProviderConfig(searchConfig)?.apiKey,
    envVars: ["TINYFISH_API_KEY"],
  });
}

function missingKeyPayload() {
  return {
    error: "missing_tinyfish_api_key",
    message:
      "web_search (tinyfish) needs a TinyFish API key. Run `openclaw configure --section web` to store it, or set TINYFISH_API_KEY in the Gateway environment. Get a key at https://agent.tinyfish.ai/api-keys.",
    docs: "https://docs.tinyfish.ai/search-api",
  };
}

function normalizeOptionalString(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function normalizeDomains(value) {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length > 0 ? items.join(",") : undefined;
  }
  return normalizeOptionalString(value);
}

function clampPage(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(10, Math.floor(value)));
}

function mapResult(entry) {
  const title = entry?.title ?? "";
  const snippet = entry?.snippet ?? "";
  const url = entry?.url ?? "";
  return {
    title: title ? wrapWebContent(title, "web_search") : "",
    url,
    snippet: snippet ? wrapWebContent(snippet, "web_search") : "",
    siteName: entry?.site_name || resolveSiteName(url) || undefined,
    position: typeof entry?.position === "number" ? entry.position : undefined,
    ...(entry?.date ? { date: entry.date } : {}),
    ...(entry?.publisher ? { publisher: entry.publisher } : {}),
    ...(Array.isArray(entry?.authors) ? { authors: entry.authors } : {}),
    ...(entry?.venue ? { venue: entry.venue } : {}),
    ...(typeof entry?.year === "number" ? { year: entry.year } : {}),
    ...(typeof entry?.cited_by_count === "number" ? { citedByCount: entry.cited_by_count } : {}),
    ...(entry?.pdf_url ? { pdfUrl: entry.pdf_url } : {}),
  };
}

async function runSearch(params) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", params.query);
  if (params.purpose) url.searchParams.set("purpose", params.purpose);
  if (params.location) url.searchParams.set("location", params.location);
  if (params.language) url.searchParams.set("language", params.language);
  if (params.includeDomains) url.searchParams.set("include_domains", params.includeDomains);
  if (params.excludeDomains) url.searchParams.set("exclude_domains", params.excludeDomains);
  if (params.recencyMinutes !== undefined) {
    url.searchParams.set("recency_minutes", String(params.recencyMinutes));
  }
  if (params.afterDate) url.searchParams.set("after_date", params.afterDate);
  if (params.beforeDate) url.searchParams.set("before_date", params.beforeDate);
  if (params.domainType) url.searchParams.set("domain_type", params.domainType);
  if (params.pubYearMin !== undefined) url.searchParams.set("pub_year_min", String(params.pubYearMin));
  if (params.pubYearMax !== undefined) url.searchParams.set("pub_year_max", String(params.pubYearMax));
  if (params.page !== undefined) url.searchParams.set("page", String(params.page));

  return await withTrustedWebSearchEndpoint(
    {
      url: url.toString(),
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": params.credential,
        },
      },
    },
    async (response) => {
      if (!response.ok) {
        await throwWebSearchApiError(response, "TinyFish Search");
      }
      return await response.json();
    },
  );
}

async function executeSearchInner(args, searchConfig) {
  const credential = resolveCredential(searchConfig);
  if (!credential) return missingKeyPayload();

  const query = readStringParam(args, "query", { required: true });
  const count = readNumberParam(args, "count", { integer: true }) ?? searchConfig?.maxResults;
  const resolvedCount = resolveSearchCount(count, DEFAULT_SEARCH_COUNT);
  const location = normalizeOptionalString(
    readStringParam(args, "location") ?? readStringParam(args, "country"),
  );
  const language = normalizeOptionalString(readStringParam(args, "language"));
  const purpose = normalizeOptionalString(readStringParam(args, "purpose"));
  const domainType = normalizeOptionalString(readStringParam(args, "domain_type"));
  const includeDomains = normalizeDomains(
    readStringArrayParam(args, "domain_filter") ?? args?.include_domains,
  );
  const excludeDomains = normalizeDomains(
    readStringArrayParam(args, "exclude_domains") ?? args?.exclude_domains,
  );
  const freshness = normalizeOptionalString(readStringParam(args, "freshness"));
  const recencyMinutes =
    readNumberParam(args, "recency_minutes", { integer: true }) ??
    (freshness ? FRESHNESS_MINUTES[freshness.toLowerCase()] : undefined);
  const afterDate = normalizeOptionalString(
    readStringParam(args, "after_date") ?? readStringParam(args, "date_after"),
  );
  const beforeDate = normalizeOptionalString(
    readStringParam(args, "before_date") ?? readStringParam(args, "date_before"),
  );
  const page = clampPage(readNumberParam(args, "page", { integer: true }));
  const pubYearMin = readNumberParam(args, "pub_year_min", { integer: true });
  const pubYearMax = readNumberParam(args, "pub_year_max", { integer: true });

  if (recencyMinutes !== undefined && (afterDate || beforeDate)) {
    return {
      error: "invalid_tinyfish_filters",
      message:
        "TinyFish does not allow recency_minutes together with after_date/before_date. Use one or the other.",
      docs: "https://docs.tinyfish.ai/search-api/reference",
    };
  }

  const cacheKey = buildSearchCacheKey([
    "tinyfish",
    query,
    resolvedCount,
    location,
    language,
    includeDomains,
    excludeDomains,
    recencyMinutes,
    afterDate,
    beforeDate,
    domainType,
    purpose,
    page,
    pubYearMin,
    pubYearMax,
  ]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) return cached;

  const startedAt = Date.now();
  const data = await runSearch({
    query,
    credential,
    purpose,
    location,
    language,
    includeDomains,
    excludeDomains,
    recencyMinutes,
    afterDate,
    beforeDate,
    domainType,
    pubYearMin,
    pubYearMax,
    page,
    timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
  });

  const rawResults = Array.isArray(data?.results) ? data.results : [];
  const results = rawResults.slice(0, resolvedCount).map(mapResult);
  const payload = {
    kind: "results",
    provider: "tinyfish",
    query: data?.query ?? query,
    count: results.length,
    totalResults: typeof data?.total_results === "number" ? data.total_results : undefined,
    page: typeof data?.page === "number" ? data.page : page,
    tookMs: Date.now() - startedAt,
    results,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "tinyfish",
      wrapped: true,
    },
  };
  writeCachedSearchPayload(cacheKey, payload, resolveSearchCacheTtlMs(searchConfig));
  return payload;
}

async function executeSearch(args, searchConfig) {
  try {
    return await executeSearchInner(args, searchConfig);
  } catch (error) {
    console.error("[tinyfish] search failed", error?.stack ?? error);
    return {
      error: "tinyfish_search_failed",
      message: String(error?.message ?? error),
      docs: "https://docs.tinyfish.ai/search-api",
    };
  }
}

function createToolDefinition(searchConfig) {
  return {
    description:
      "Search the web with TinyFish. Returns ranked results with titles, URLs and snippets. Supports location/language, freshness or date filters, include/exclude domains, news and research-paper modes.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Search query." },
        count: { type: "number", minimum: 1, maximum: 10, description: "Results to return (1-10)." },
        country: { type: "string", description: "2-letter country code; maps to TinyFish location." },
        location: { type: "string", description: "TinyFish location/country code." },
        language: { type: "string", description: "Language code, e.g. en, zh." },
        freshness: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Relative freshness window.",
        },
        date_after: { type: "string", description: "Lower date bound (YYYY-MM-DD)." },
        date_before: { type: "string", description: "Upper date bound (YYYY-MM-DD)." },
        domain_filter: {
          type: "array",
          items: { type: "string" },
          description: "Only include these domains.",
        },
        exclude_domains: {
          type: "array",
          items: { type: "string" },
          description: "Exclude these domains.",
        },
        domain_type: {
          type: "string",
          enum: ["web", "news", "research_paper"],
          description: "Search category.",
        },
        purpose: {
          type: "string",
          description: "Short statement of why you are searching; improves ranking.",
        },
        page: { type: "number", minimum: 0, maximum: 10, description: "Result page, starting at 0." },
        pub_year_min: { type: "number", description: "Research-paper lower publication year." },
        pub_year_max: { type: "number", description: "Research-paper upper publication year." },
      },
      required: ["query"],
    },
    execute: async (args) => executeSearch(args, searchConfig),
  };
}

export function createTinyFishWebSearchProvider() {
  return {
    id: "tinyfish",
    label: "TinyFish Search",
    hint: "Structured results with location, language, freshness and domain filters",
    onboardingScopes: ["text-inference"],
    credentialLabel: "TinyFish API key",
    envVars: ["TINYFISH_API_KEY"],
    placeholder: "tf_...",
    signupUrl: "https://agent.tinyfish.ai/api-keys",
    docsUrl: "https://docs.tinyfish.ai/search-api",
    autoDetectOrder: 55,
    credentialPath: CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "tinyfish" },
      configuredCredential: { pluginId: "tinyfish" },
      selectionPluginId: "tinyfish",
    }),
    createTool: (ctx) =>
      createToolDefinition(
        mergeScopedSearchConfig(
          ctx.searchConfig,
          "tinyfish",
          resolveProviderWebSearchPluginConfig(ctx.config, "tinyfish"),
        ),
      ),
  };
}

export const __testing = { mapResult, resolveCredential };
