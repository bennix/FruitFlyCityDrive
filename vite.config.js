import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
  build: { rollupOptions: { input: { landing: resolve(import.meta.dirname, "index.html"), simulation: resolve(import.meta.dirname, "simulation.html") } } },
});
