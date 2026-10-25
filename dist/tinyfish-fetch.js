import {
  resolveWebSearchProviderCredential,
} from "openclaw/plugin-sdk/provider-web-search";
import {
  markdownToText,
  truncateText,
  withTrustedWebToolsEndpoint,
} from "openclaw/plugin-sdk/provider-web-fetch";

const ENDPOINT = "https://api.fetch.tinyfish.ai";
const CREDENTIAL_PATH = "plugins.entries.tinyfish.config.webFetch.apiKey";
const FALLBACK_CREDENTIAL_PATH = "plugins.entries.tinyfish.config.webSearch.apiKey";
const DEFAULT_TIMEOUT_SECONDS = 45;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pluginConfig(ctx) {
  return ctx?.config?.plugins?.entries?.tinyfish?.config;
}

function resolveCredential(ctx) {
  const cfg = pluginConfig(ctx);
  return resolveWebSearchProviderCredential({
    // Prefer a dedicated webFetch key, otherwise reuse the webSearch key.
    credentialValue: cfg?.webFetch?.apiKey ?? cfg?.webSearch?.apiKey,
    envVars: ["TINYFISH_API_KEY"],
  });
}

function missingKeyPayload() {
  return {
    error: "missing_tinyfish_api_key",
    message:
      "web_fetch (tinyfish) needs a TinyFish API key. Store one at `plugins.entries.tinyfish.config.webFetch.apiKey` (or reuse `webSearch.apiKey`), or set TINYFISH_API_KEY in the Gateway environment. Get a key at https://agent.tinyfish.ai/api-keys.",
    docs: "https://docs.tinyfish.ai/fetch-api",
  };
}

function normalizeUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

async function runFetch(params) {
  const body = {
    urls: [params.url],
    format: "markdown",
    per_url_timeout_ms: params.perUrlTimeoutMs,
  };
  if (params.purpose) body.purpose = params.purpose;
  if (params.ttlSeconds !== undefined) body.ttl = params.ttlSeconds;

  return await withTrustedWebToolsEndpoint(
    {
      url: ENDPOINT,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": params.credential,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    },
    async ({ response }) => {
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `TinyFish Fetch failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        );
      }
      return await response.json();
    },
  );
}

function pickResult(data, requestedUrl) {
  const results = Array.isArray(data?.results) ? data.results : [];
  if (results.length > 0) return results[0];
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const first = errors[0];
  if (first) {
    const code = first.error ?? first.code ?? "fetch_failed";
    const detail = first.message ?? first.detail;
    throw new Error(`TinyFish Fetch could not fetch ${requestedUrl}: ${code}${detail ? ` (${detail})` : ""}`);
  }
  throw new Error(`TinyFish Fetch returned no result for ${requestedUrl}`);
}

async function executeFetch(args, context, ctx) {
  const credential = resolveCredential(ctx);
  if (!credential) return missingKeyPayload();

  const url = normalizeUrl(args?.url);
  if (!url) {
    return {
      error: "invalid_url",
      message: "web_fetch requires an absolute http(s) URL.",
    };
  }

  const extractMode = args?.extractMode === "text" ? "text" : "markdown";
  const fetchConfig = isRecord(ctx?.fetchConfig) ? ctx.fetchConfig : {};
  const timeoutSeconds =
    typeof fetchConfig.timeoutSeconds === "number" && fetchConfig.timeoutSeconds > 0
      ? fetchConfig.timeoutSeconds
      : DEFAULT_TIMEOUT_SECONDS;
  const maxChars =
    typeof args?.maxChars === "number" && Number.isFinite(args.maxChars) && args.maxChars >= 100
      ? Math.floor(args.maxChars)
      : undefined;

  const data = await runFetch({
    url,
    credential,
    purpose: typeof args?.purpose === "string" ? args.purpose.trim() || undefined : undefined,
    perUrlTimeoutMs: Math.min(110000, Math.max(1, Math.round(timeoutSeconds * 1000))),
    timeoutSeconds: timeoutSeconds + 5,
    signal: context?.signal,
  });

  const entry = pickResult(data, url);
  let text = typeof entry?.text === "string" ? entry.text : "";
  if (extractMode === "text") text = markdownToText(text);
  if (maxChars !== undefined) text = truncateText(text, maxChars).text;

  return {
    finalUrl: typeof entry?.final_url === "string" && entry.final_url ? entry.final_url : url,
    status: 200,
    contentType: extractMode === "text" ? "text/plain" : "text/markdown",
    title: typeof entry?.title === "string" ? entry.title : undefined,
    text,
    extractor: "tinyfish",
    fetchedAt: new Date().toISOString(),
  };
}

export function createTinyFishWebFetchProvider() {
  return {
    id: "tinyfish",
    label: "TinyFish Fetch",
    hint: "Render and extract page content through TinyFish Fetch (JS-heavy pages supported)",
    requiresCredential: true,
    credentialLabel: "TinyFish API key",
    envVars: ["TINYFISH_API_KEY"],
    placeholder: "tf_...",
    signupUrl: "https://agent.tinyfish.ai/api-keys",
    docsUrl: "https://docs.tinyfish.ai/fetch-api",
    autoDetectOrder: 55,
    credentialPath: CREDENTIAL_PATH,
    inactiveSecretPaths: [CREDENTIAL_PATH],
    getCredentialValue: (config) =>
      (isRecord(config) ? config?.tinyfish?.apiKey ?? config?.apiKey : undefined),
    setCredentialValue: (configTarget, value) => {
      const target = isRecord(configTarget) ? configTarget : {};
      const scoped = isRecord(target.tinyfish) ? target.tinyfish : (target.tinyfish = {});
      scoped.apiKey = value;
    },
    getConfiguredCredentialValue: (config) =>
      config?.plugins?.entries?.tinyfish?.config?.webFetch?.apiKey ??
      config?.plugins?.entries?.tinyfish?.config?.webSearch?.apiKey,
    getConfiguredCredentialFallback: (config) => ({
      path: FALLBACK_CREDENTIAL_PATH,
      value: config?.plugins?.entries?.tinyfish?.config?.webSearch?.apiKey,
    }),
    applySelectionConfig: (config) => {
      const next = { ...(config ?? {}) };
      const plugins = { ...(next.plugins ?? {}) };
      const entries = { ...(plugins.entries ?? {}) };
      const entry = { ...(entries.tinyfish ?? {}) };
      entry.enabled = true;
      entries.tinyfish = entry;
      plugins.entries = entries;
      next.plugins = plugins;
      return next;
    },
    createTool: (ctx) => ({
      description:
        "Fetch a single page through TinyFish Fetch and return extracted markdown or plain text. Handles JavaScript-heavy pages that plain HTML extraction cannot read.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string", description: "Absolute http(s) URL to fetch." },
          extractMode: {
            type: "string",
            enum: ["markdown", "text"],
            description: "Output format for the extracted content.",
          },
          maxChars: { type: "number", description: "Truncate the extracted text to this many characters." },
          purpose: {
            type: "string",
            description: "Short statement of why the page is being fetched; improves extraction.",
          },
        },
        required: ["url"],
      },
      execute: async (args, context) => executeFetch(args, context, ctx),
    }),
  };
}

export const __testing = { pickResult, resolveCredential, normalizeUrl };
