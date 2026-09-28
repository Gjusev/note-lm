import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  // plain CSS tokens here — opt out of the repo-wide Tailwind postcss
  css: { postcss: {} },
  build: { outDir: "dist", target: "es2022", emptyOutDir: true },
  resolve: {
    // reuse the repo's shared libs (api types, TanStack Query)
    alias: { "@": path.resolve(__dirname, "../..") },
  },
  server: {
    port: 5180,
    proxy: { "/api": "http://127.0.0.1:3128" }, // browser dev against the Next server
  },
});
