// Golden-case parity with irforge-dis/irforge_discord/blueprint.py (fixtures/discord_blueprint_cases.json is a byte-identical copy of irforge-dis/tests/fixtures/blueprint_cases.json).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateBlueprint, requiredIntents } from "../src/lib/discordBlueprint.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "fixtures/discord_blueprint_cases.json"), "utf8"));
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "id" && typeof v === "string" && /^[0-9a-f]{12,32}$/.test(v) ? "<id>" : v)));

for (const c of cases) {
  test(`discord blueprint golden: ${c.name}`, () => {
    const { blueprint, errors } = validateBlueprint(c.input);
    assert.deepEqual({ blueprint: strip(blueprint), errors, intents: requiredIntents(blueprint).sort() }, c.expected);
  });
}
