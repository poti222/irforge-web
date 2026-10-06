/** آپلودِ تصویر — سرورِ واقعی: بایت‌به‌بایت، هدرها، رد کردنِ SVG/جعلی/بزرگ/بی‌توکن، rate limit. */
import zlib from "node:zlib";
import { call, newUser, newSchoolAdmin, BASE, done, check } from "./lib.mjs";
import { execFileSync } from "node:child_process";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, seed = 7) {
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let i = 0; i < raw.length; i++) raw[i] = (i * seed) & 255;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const up = (u, buf, type) => call("POST", "/uploads/images", { token: u?.token, raw: buf, headers: { "content-type": type } });

const u = await newUser("img");
const P = png(64, 64);
let r = await up(u, P, "image/png");
check("PNG upload 201 with url", r.status === 201 && /^\/api\/uploads\/images\/[0-9a-f-]{36}$/.test(r.json?.url), r.text);
const g = await call("GET", r.json.url.replace(/^\/api/, ""));
check("PNG fetched byte-identical", g.status === 200 && g.buf.equals(P));
check("headers: type/cache/nosniff/etag", g.headers.get("content-type") === "image/png" && g.headers.get("cache-control") === "public, max-age=31536000, immutable" && g.headers.get("x-content-type-options") === "nosniff" && !!g.headers.get("etag"), [...g.headers.entries()]);
const g304 = await call("GET", r.json.url.replace(/^\/api/, ""), { headers: { "if-none-match": g.headers.get("etag") } });
check("If-None-Match → 304", g304.status === 304);
r = await up(u, JPEG, "image/jpeg");
const gj = await call("GET", r.json.url.replace(/^\/api/, ""));
check("JPEG round-trips with image/jpeg", r.status === 201 && gj.buf.equals(JPEG) && gj.headers.get("content-type") === "image/jpeg");
const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([20, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(20)]);
check("GIF + WebP accepted", (await up(u, gif, "image/gif")).status === 201 && (await up(u, webp, "image/webp")).status === 201);
check("browser can load it without auth (public GET, no cookie)", (await fetch(BASE + r.json.url)).status === 200);

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
check("SVG sent as image/svg+xml → 415", (await up(u, svg, "image/svg+xml")).status === 415);
check("SVG renamed/declared as image/png → 415 (magic bytes)", (await up(u, svg, "image/png")).status === 415);
check("text declared as image/jpeg → 415", (await up(u, Buffer.from("hello world, not an image"), "image/jpeg")).status === 415);
check("HTML declared as image/gif → 415", (await up(u, Buffer.from("<html><script>1</script></html>"), "image/gif")).status === 415);
{ const x = await up(u, P, "application/json"); check("PNG declared as application/json is rejected (global JSON parser, nothing stored)", x.status >= 400 && !x.json?.url, x.status); }
check("empty body → 400", (await up(u, Buffer.alloc(0), "image/png")).status === 400);
const big = Buffer.concat([P, Buffer.alloc(2.6 * 1024 * 1024)]);
check("oversize (2.6MB) → 413", (await up(u, big, "image/png")).status === 413);
const ok = Buffer.concat([P, Buffer.alloc(2.4 * 1024 * 1024)]);
check("2.4MB accepted", (await up(u, ok, "image/png")).status === 201);
check("unauthenticated → 401", (await up(null, P, "image/png")).status === 401);
check("garbage token → 401", (await up({ token: "x" }, P, "image/png")).status === 401);
check("bad id → 404", (await call("GET", "/uploads/images/not-a-uuid")).status === 404 && (await call("GET", "/uploads/images/00000000-0000-4000-8000-000000000000")).status === 404);
{ const x = await call("POST", "/auth/register", { body: { name: "x".repeat(300000) } }); check("global 256kb JSON cap unchanged (still rejected, 4xx/5xx not 2xx)", x.status >= 400, x.status); }

const rl = await newUser("rl"); let last = 0, n = 0;
for (; n < 40; n++) { last = (await up(rl, P, "image/png")).status; if (last === 429) break; }
check("rate limit: 429 after 30 uploads", last === 429 && n === 30, { n, last });
check("another user unaffected", (await up(u, P, "image/png")).status === 201);
// school photo persists (PATCH used to ignore photoUrl entirely)
const ad = await newSchoolAdmin();
const pu = (await up(ad, P, "image/png")).json.url;
let pr = await call("PATCH", `/schools/${ad.schoolId}`, { token: ad.token, body: { photoUrl: pu } });
check("PATCH school photoUrl (uploaded) persisted", pr.status === 200 && pr.json.photoUrl === pu, pr.text);
check("/schools/me returns it", (await call("GET", "/schools/me", { token: ad.token })).json.school.photoUrl === pu);
pr = await call("PATCH", `/schools/${ad.schoolId}`, { token: ad.token, body: { photoUrl: "https://example.com/a.png" } });
check("pasted http(s) URL still accepted", pr.status === 200 && pr.json.photoUrl === "https://example.com/a.png");
check("javascript:/data: URLs rejected", (await call("PATCH", `/schools/${ad.schoolId}`, { token: ad.token, body: { photoUrl: "javascript:alert(1)" } })).status === 400 && (await call("PATCH", `/schools/${ad.schoolId}`, { token: ad.token, body: { photoUrl: "/api/uploads/images/../x" } })).status === 400);
pr = await call("PATCH", `/schools/${ad.schoolId}`, { token: ad.token, body: { photoUrl: "" } });
check("empty clears the photo", pr.status === 200 && pr.json.photoUrl === null);
await done();
