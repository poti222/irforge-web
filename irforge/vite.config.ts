import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    // scripts/ssg.mjs reads this to find the hashed locale chunk for each
    // prerendered language and emit a <link rel="modulepreload"> for it.
    manifest: true,
    /**
     * Lighthouse flags "Missing source maps for large first-party JavaScript".
     * It is a real convenience — readable stack traces in production — but
     * publishing source maps publishes the TypeScript source with them,
     * including every internal comment in this repo (which document known bugs,
     * the sheet contract, and admin behaviour). That is a bigger cost than the
     * audit is worth by default.
     *
     * So: opt-in. Build with SOURCEMAPS=1 to satisfy the audit and get real
     * stack traces; leave it unset to ship without. If you turn it on, treat
     * src/ as public and move anything sensitive out of comments first.
     */
    sourcemap: process.env.SOURCEMAPS === "1",
    rollupOptions: {
      output: {
        /**
         * NOTE [perf]: without this, every third-party dependency reachable
         * from a statically-imported page landed in ONE index-*.js. That file
         * was 1.69 MB raw / ~500 kB gzipped, and its hash changed on every
         * single deploy — so returning visitors re-downloaded React, Radix and
         * framer-motion because one line of our own copy changed.
         *
         * Splitting by library does two things:
         *   1. the entry chunk shrinks to our own code, so first paint parses
         *      far less JS (mobile CPUs pay for parse/exec, not just bytes);
         *   2. these vendor chunks keep their hash across deploys, so repeat
         *      visits and route navigations hit cache instead of the network.
         *
         * Order matters: the first matching branch wins, so the narrow
         * react-dom/react test has to come before anything broader.
         */
        manualChunks(id) {
          // One chunk per language. These are big (120-180 kB of JSON each)
          // and a visitor needs at most two of them, so they must never be
          // merged into the entry — see src/locales/registry.ts.
          const locale = id.match(/[\\/]src[\\/]locales[\\/](en|fa|ar|tr|ru)\.json$/);
          if (locale) return `locale-${locale[1]}`;

          if (!id.includes("node_modules")) return;

          // react + react-dom + the scheduler they share. Every other chunk
          // depends on this one, so it must not pull anything else in.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }

          // framer-motion ships motion-dom/motion-utils alongside it; keeping
          // them together avoids a circular import between two vendor chunks.
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils|motion)[\\/]/.test(id)) {
            return "vendor-motion";
          }

          // recharts + its d3/lodash/decimal tail. Nothing on a prerendered
          // page imports these any more (see MiniAnalyticsChart), so this
          // chunk is only fetched on /dashboard, /admin and the bot workspace.
          if (
            /[\\/]node_modules[\\/](recharts|recharts-scale|react-smooth|d3-[a-z-]+|internmap|victory-vendor|decimal\.js-light|lodash)[\\/]/.test(
              id,
            )
          ) {
            return "vendor-charts";
          }

          // the Radix primitives behind components/ui/* — many small packages
          // that are always used together, so one chunk beats forty.
          if (/[\\/]node_modules[\\/](@radix-ui|@floating-ui|react-remove-scroll|aria-hidden|cmdk|vaul|sonner|input-otp|embla-carousel[a-z-]*)[\\/]/.test(id)) {
            return "vendor-ui";
          }

          if (/[\\/]node_modules[\\/](@tanstack|wouter|zod|react-hook-form|@hookform)[\\/]/.test(id)) {
            return "vendor-data";
          }

          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
});
