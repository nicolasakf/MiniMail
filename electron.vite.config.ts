import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import tailwindcss from "tailwindcss";
import type { Plugin } from "vite";

const alias = {
  "@shared": resolve("src/shared"),
};

/**
 * Adds a strict Content-Security-Policy to the built renderer only. The dev server
 * needs inline scripts for hot reload, so it is left unrestricted. `img-src https:`
 * is required because sandboxed email frames inherit this policy; each frame then
 * narrows it again with its own meta tag (remote images stay blocked until allowed).
 */
function productionCsp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self' about:",
  ].join("; ");
  return {
    name: "minimail-production-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  };
}

export default defineConfig(({ mode }) => ({
  main: {
    // Public installers must never inline a developer's local OAuth credentials.
    envPrefix: mode === "release" ? [] : undefined,
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  preload: {
    envPrefix: mode === "release" ? [] : undefined,
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  renderer: {
    envPrefix: mode === "release" ? [] : undefined,
    root: "src/renderer",
    plugins: [react(), productionCsp()],
    resolve: {
      alias: { ...alias, "@": resolve("src/renderer/src") },
    },
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: resolve("tailwind.config.ts") }),
          autoprefixer(),
        ],
      },
    },
  },
}));
