import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Separate config for the build-time render bundle, kept apart from
 * vite.config.ts so the client build stays exactly as it was.
 *
 * No tailwind plugin here: this bundle never emits CSS, it only produces the
 * markup that gets spliced into the client template (which already links the
 * real stylesheet).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
  },
  root: path.resolve(__dirname),
  ssr: {
    // raw-TS workspace package — must be bundled, Node can't import .ts
    noExternal: ["@workspace/api-client-react"],
  },
  build: {
    ssr: path.resolve(__dirname, "src/entry-ssg.tsx"),
    outDir: path.resolve(__dirname, "dist-ssg"),
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "entry-ssg.mjs" } },
  },
});
