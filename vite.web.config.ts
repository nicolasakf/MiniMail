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
  // Starts at 5173 and moves to the next free port when something (say, the Electron dev server) has it.
  server: { port: 5173, strictPort: false },
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
