import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

import { novelFabricBridgePlugin } from "./src/web/bridge-plugin.js";

export default defineConfig({
  plugins: [vue(), novelFabricBridgePlugin()],
  server: {
    host: "127.0.0.1",
    port: 50021,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 50022,
    strictPort: true
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true
  }
});
