import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
process.env.EMOJI_PACKS_DIR = path.resolve(import.meta.dirname, "../assets/emoji-packs");
const { tgSetNameFor, loadManifest } = await import("../src/lib/emojiPacks.ts");

test("telegram set name ends with _by_<bot>, is lowercase and a-z0-9_ only", () => {
  assert.equal(tgSetNameFor("irforge_ticks", "IrForge_Bot"), "irforge_ticks_by_irforge_bot");
  assert.ok(tgSetNameFor("a".repeat(80), "bot").length <= 64);
  assert.ok(!/__/.test(tgSetNameFor("a__b", "x__y")));
});

test("manifest: every sticker file exists, names valid and unique per pack, one format per pack", () => {
  const dir = process.env.EMOJI_PACKS_DIR;
  const packs = loadManifest();
  assert.equal(packs.length, 6);
  const slugs = new Set();
  for (const p of packs) {
    assert.ok(!slugs.has(p.slug)); slugs.add(p.slug);
    assert.ok(p.stickers.length >= 1 && p.stickers.length <= 50, p.slug);
    assert.equal(new Set(p.stickers.map((s) => s.format)).size, 1, `${p.slug} mixes formats`);
    const names = new Set();
    for (const s of p.stickers) {
      assert.match(s.name, /^[a-z][a-z0-9_]{1,31}$/, `${p.slug}/${s.name}`);
      assert.ok(!names.has(s.name), `dup ${p.slug}/${s.name}`); names.add(s.name);
      const f = path.join(dir, p.slug, s.file);
      assert.ok(fs.existsSync(f), f);
      assert.ok(fs.statSync(f).size <= 256 * 1024, `${f} too big`);
      assert.ok(s.emoji && s.emoji.length > 0);
    }
  }
});
