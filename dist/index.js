import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createTinyFishWebSearchProvider } from "./tinyfish-search.js";
import { createTinyFishWebFetchProvider } from "./tinyfish-fetch.js";

export default definePluginEntry({
  id: "tinyfish",
  name: "TinyFish Search",
  description: "TinyFish Search and Fetch providers for web_search and web_fetch (official APIs)",
  register(api) {
    api.registerWebSearchProvider(createTinyFishWebSearchProvider());
    api.registerWebFetchProvider(createTinyFishWebFetchProvider());
  },
});
