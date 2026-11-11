import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";

/**
 * Renderer-only dev server. Runs the UI in a plain browser with the demo mail
 * backend (no Electron), which is handy for visual iteration and screenshots.
 */
export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      "@": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: resolve("tailwind.config.ts") }),
        autoprefixer(),
      ],
    },
  },
});
