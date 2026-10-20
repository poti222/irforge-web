import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: "/home/claude/m/web/irforge/src/$1" },
      { find: /^react$/, replacement: "/home/claude/w/irforge-web-main/node_modules/.pnpm/react@19.1.0/node_modules/react" },
      { find: /^react\/(.*)$/, replacement: "/home/claude/w/irforge-web-main/node_modules/.pnpm/react@19.1.0/node_modules/react/$1" },
      { find: /^react-dom$/, replacement: "/home/claude/w/irforge-web-main/node_modules/.pnpm/react-dom@19.1.0_react@19.1.0/node_modules/react-dom" },
      { find: /^react-dom\/(.*)$/, replacement: "/home/claude/w/irforge-web-main/node_modules/.pnpm/react-dom@19.1.0_react@19.1.0/node_modules/react-dom/$1" },
    ],
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { strict: false } },
  test: { environment: "jsdom", globals: true, include: ["*.test.jsx"] },
});
