# OpenClaw TinyFish Search

A first-party-style OpenClaw web-search provider for the official TinyFish Search API.
Built against the current OpenClaw plugin SDK (`2026.10.x`), not the older community contract.

## What it does

Registers the `tinyfish` provider for OpenClaw's `web_search` tool.

- Endpoint: `GET https://api.search.tinyfish.ai`
- Auth: `X-API-Key`
- Supports: `query`, `count`, `location` / `country`, `language`, `freshness` or `recency_minutes`, `after_date` / `before_date`, `include_domains` / `exclude_domains`, `domain_type` (`web` / `news` / `research_paper`), `purpose`, `page`, `pub_year_min` / `pub_year_max`
- Normalizes results to OpenClaw's `title` / `url` / `snippet` / `siteName` / `position` shape
- Caches results through the SDK's search cache helpers

Official API docs: <https://docs.tinyfish.ai/search-api/reference>

## Layout

```text
openclaw.plugin.json        manifest (provider id, config schema, env fallback)
package.json                package metadata + openclaw.extensions
dist/index.js               definePluginEntry + registerWebSearchProvider
dist/tinyfish-search.js     provider, request builder, result mapping, cache
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

Then configure the key and provider:

```bash
openclaw config set tools.web.search.enabled true --strict-json
openclaw config set tools.web.search.provider tinyfish
```

The key lives at `plugins.entries.tinyfish.config.webSearch.apiKey`. The plugin also falls back to `TINYFISH_API_KEY` in the Gateway environment.

## Reload after edits

Because the plugin is linked, edits under `dist/` apply after:

```bash
openclaw plugins reload tinyfish
```

## Notes

- `openclaw plugins validate` is for tool/feature plugins; a web-search provider entry is expected to fail that specific check. Use `openclaw plugins doctor` and `openclaw plugins inspect tinyfish --runtime --json` instead.
- The provider registry is resolved per session. A session that started before the plugin was enabled may still report no provider; open a new session or restart the Gateway.
- Free tier (per TinyFish docs): 12,000 search requests/day, default 30 requests/minute; 402 when the daily allowance is exhausted with no wallet balance.
