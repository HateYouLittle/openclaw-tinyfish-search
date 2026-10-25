# OpenClaw TinyFish Search & Fetch

First-party-style OpenClaw web-search and web-fetch providers for the official TinyFish APIs.
Built against the current OpenClaw plugin SDK (`2026.10.x`), not the older community contract.

## What it does

Registers the `tinyfish` provider for OpenClaw's `web_search` **and** `web_fetch` tools.

### Search (`web_search`)

- Endpoint: `GET https://api.search.tinyfish.ai`
- Auth: `X-API-Key`
- Supports: `query`, `count`, `location` / `country`, `language`, `freshness` or `recency_minutes`, `after_date` / `before_date`, `include_domains` / `exclude_domains`, `domain_type` (`web` / `news` / `research_paper`), `purpose`, `page`, `pub_year_min` / `pub_year_max`
- Normalizes results to OpenClaw's `title` / `url` / `snippet` / `siteName` / `position` shape
- Caches results through the SDK's search cache helpers

### Fetch (`web_fetch`)

- Endpoint: `POST https://api.fetch.tinyfish.ai`
- Auth: `X-API-Key`
- Renders JavaScript-heavy pages and returns clean extracted text (`markdown` or `text`)
- Runs as the `web_fetch` **fallback provider**: OpenClaw's built-in Readability extraction is tried first, and TinyFish Fetch is used when Readability fails, when `readability` is disabled, or on a transport/HTTP error
- Sandboxed `web_fetch` only accepts bundled or provenance-verified providers, so this third-party fetch provider is used from non-sandboxed `web_fetch` calls

Official API docs: <https://docs.tinyfish.ai/search-api/reference> · <https://docs.tinyfish.ai/fetch-api/reference>

## Layout

```text
openclaw.plugin.json        manifest (provider id, contracts, config schema, env fallback)
package.json                package metadata + openclaw.extensions
dist/index.js               definePluginEntry + registerWebSearchProvider + registerWebFetchProvider
dist/tinyfish-search.js     search provider, request builder, result mapping, cache
dist/tinyfish-fetch.js      fetch provider, request builder, result mapping
```

No build step: `dist/*.js` is plain ESM.

## Install

From ClawHub:

```bash
openclaw plugins install clawhub:@HateYouLittle/openclaw-tinyfish-search
openclaw plugins enable tinyfish
```

## Install (local development)

```bash
openclaw plugins install /Users/cracked/workspace/openclaw-tinyfish-search --link --force --accept-capabilities
openclaw plugins enable tinyfish
```

Then configure the key and providers:

```bash
openclaw config set tools.web.search.enabled true --strict-json
openclaw config set tools.web.search.provider tinyfish
openclaw config set tools.web.fetch.provider tinyfish
```

The key lives at `plugins.entries.tinyfish.config.webSearch.apiKey`. The fetch provider uses `plugins.entries.tinyfish.config.webFetch.apiKey` if set, otherwise falls back to the search key. The plugin also falls back to `TINYFISH_API_KEY` in the Gateway environment.

## Reload after edits

Because the plugin is linked, edits under `dist/` apply after:

```bash
openclaw plugins reload tinyfish
```

## Notes

- `openclaw plugins validate` is for tool/feature plugins; a web-search provider entry is expected to fail that specific check. Use `openclaw plugins doctor` and `openclaw plugins inspect tinyfish --runtime --json` instead.
- The provider registry is resolved per session. A session that started before the plugin was enabled may still report no provider; open a new session or restart the Gateway.
- Free tier (per TinyFish docs): 12,000 search requests/day, default 30 requests/minute; 402 when the daily allowance is exhausted with no wallet balance.
