import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "web",
  base: "./",
  publicDir: false,
  resolve: {
    alias: [
      { find: /^three\/addons\/(.*)$/, replacement: path.resolve(__dirname, "web/vendor/addons/$1") },
      { find: /^three$/, replacement: path.resolve(__dirname, "web/vendor/three.module.js") },
    ],
  },
  server: {
    port: 8000,
    fs: {
      allow: [__dirname],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 2500,
  },
});
