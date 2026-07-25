// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const BACKEND = "http://localhost:8080";

export default defineConfig({
  /**
   * Everything the build emits is served under `/static/` — the one prefix the
   * homectl-auth-proxy sidecar passes through without a session
   * (`BYPASS_STATIC_AUTH`). That is what lets a logged-out client fetch an
   * updated service worker; behind a forward-auth proxy an auth-gated `sw.js`
   * pins installed clients to a stale build forever. `index.html` is served by
   * the backend at every other path and stays auth-gated.
   */
  base: "/static/",
  // The env overlays live at the repo root, shared with the backend.
  envDir: "..",
  plugins: [
    react(),
    VitePWA({
      // Hand-written worker: the generated one would add a navigation fallback,
      // which is the single most dangerous thing to do behind a forward-auth
      // sidecar (see docs/pwa.md).
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.ts",
      // Registration is manual so we can pin the scope to '/' while the script
      // itself lives under /static/.
      injectRegister: null,
      registerType: "prompt",
      manifestFilename: "manifest.webmanifest",
      injectManifest: {
        // Hashed assets only. index.html is deliberately NOT precached.
        globPatterns: ["**/*.{js,css,svg,png,woff2}"],
        globIgnores: ["**/sw.js", "**/node_modules/**"],
      },
      manifest: {
        id: "/",
        name: "Games",
        short_name: "Games",
        description: "A small collection of games",
        // start_url and scope are app-origin paths, not /static/ ones.
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#0b1a24",
        theme_color: "#0b1a24",
        icons: [
          {
            src: "/static/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/static/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/static/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      devOptions: {
        // No service worker in dev: it only adds cache confusion to a hot-reload
        // loop, and every pitfall it guards against is a production one.
        enabled: false,
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
    // A slim entry chunk is the point of the split; warn early if it creeps.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        /**
         * Give each game's chunk a predictable name.
         *
         * The split itself comes from the lazy `import()` in
         * `src/games/registry.ts` — Rollup emits a chunk per dynamic entry and,
         * left to its own devices, correctly keeps anything the shell also uses
         * (the API client, the router) in the shell chunk. Naming those dynamic
         * entries here is enough for `scripts/check-chunks.mjs` and the e2e test
         * to assert that opening one game never downloads another's code.
         *
         * Do NOT reach for `manualChunks` to do this: forcing the game's modules
         * into a named chunk turns that chunk into a magnet, and the shell ends
         * up statically importing it — exactly the thing we are splitting to
         * avoid.
         */
        chunkFileNames(chunk) {
          const game = /\/src\/games\/([^/]+)\//.exec(chunk.facadeModuleId ?? "");
          return game?.[1]
            ? `assets/game-${game[1]}-[hash].js`
            : "assets/[name]-[hash].js";
        },
        /**
         * React is the one exception: it is big, shared by every game, and
         * changes far less often than app code, so it earns its own long-lived
         * cache entry.
         */
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler|react-router)/.test(id)) {
            return "vendor-react";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in production, so proxy the backend's paths in dev too.
    proxy: {
      "/api": { target: BACKEND, changeOrigin: false },
      "/auth": { target: BACKEND, changeOrigin: false },
      "/health": { target: BACKEND, changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
