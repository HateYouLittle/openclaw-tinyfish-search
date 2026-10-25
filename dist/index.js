import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createTinyFishWebSearchProvider } from "./tinyfish-search.js";

export default definePluginEntry({
  id: "tinyfish",
  name: "TinyFish Search",
  description: "TinyFish Search provider for web_search (official Search API)",
  register(api) {
    api.registerWebSearchProvider(createTinyFishWebSearchProvider());
  },
});
