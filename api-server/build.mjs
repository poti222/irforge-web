import { build } from "esbuild";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

// Externalize all real npm deps (CJS-heavy ones like pg, express need to stay external)
const external = [
  ...Object.keys(pkg.dependencies || {}).filter(d => !d.startsWith("@workspace/")),
  ...Object.keys(pkg.devDependencies || {}).filter(d => !d.startsWith("@workspace/")),
  "pg-native",
];

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.cjs",
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  external,
  alias: {
    "@workspace/db": "../lib/db/src/index.ts",
    "@workspace/api-zod": "../lib/api-zod/src/index.ts",
  },
});

console.log("Build complete → dist/index.cjs");
