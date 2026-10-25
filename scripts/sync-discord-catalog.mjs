// Copies the shared Discord catalog (single source of truth lives in the irforge-dis repo) into the API server.
// usage: node scripts/sync-discord-catalog.mjs ../irforge-dis/irforge_discord/catalog.json
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] ?? join(root, "../irforge-dis/irforge_discord/catalog.json"));
if (!existsSync(src)) { console.error(`catalog not found: ${src}`); process.exit(1); }
copyFileSync(src, join(root, "api-server/src/lib/discordCatalog.json"));
console.log(`catalog synced from ${src} → api-server/src/lib/discordCatalog.json`);
