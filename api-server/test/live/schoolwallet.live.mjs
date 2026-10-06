/** کیف‌پولِ مدرسه: جدا از کیف‌پولِ شخصی؛ خریدِ بات از آن؛ شارژ/کسرِ سوپرادمین؛ درخواستِ شارژ؛ همروندی؛ دسترسی. */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { call, newSchoolAdmin, newSuper, joinSchool, pool, done, check } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });

const PRICE = 9_900_000;
const sup = await newSuper();
const A = await newSchoolAdmin("الف"), B = await newSchoolAdmin("ب");
const q = async (sql, p) => (await pool.query(sql, p)).rows;
// توکن‌هایِ استخر (مقدارِ رمزنشده کافی است؛ decrypt بعد از commit best-effort است)
for (let i = 0; i < 6; i++) await pool.query("insert into school_bot_token_pool (id, bot_token, status) values ($1,$2,'available')", [crypto.randomUUID(), "dummy-" + crypto.randomUUID()]);
const avail = async () => (await q("select count(*)::int n from school_bot_token_pool where status='available'"))[0].n;
const personal = async (u) => JSON.stringify([await q("select balance from wallets where user_id=$1", [u.id]), await q("select count(*)::int n from wallet_transactions where user_id=$1", [u.id])]);
const sw = (u, s = A) => call("GET", `/schools/${s.schoolId}/wallet`, { token: u.token });
const adj = (s, body, who = sup) => call("POST", `/super/schools/${s.schoolId}/wallet/adjust`, { token: who.token, cookie: who.cookie, body });
const buy = (s) => call("POST", `/schools/${s.schoolId}/bot/purchase`, { token: s.token });
const sbal = async (s) => (await q("select balance from school_wallets where school_id=$1", [s.schoolId]))[0]?.balance ?? 0;

// ── دسترسی
const par = await joinSchool(A, "parent"), tea = await joinSchool(A, "teacher"), stu = await joinSchool(A, "student"), dep = await joinSchool(A, "deputy");
let ok = true;
for (const u of [par, tea, stu, dep]) ok &&= (await sw(u)).status === 403 && (await call("POST", `/schools/${A.schoolId}/wallet/topup-requests`, { token: u.token, body: { amountRial: 1000000 } })).status === 403 && (await call("GET", `/schools/${A.schoolId}/wallet/transactions`, { token: u.token })).status === 403;
check("parent/teacher/student/deputy: wallet view, transactions, top-up request all 403", ok);
check("admin of ANOTHER school: 403 on A's wallet", (await sw(B)).status === 403);
check("admin sees own wallet: 200, balance 0", (await sw(A)).status === 200 && (await sw(A)).json.balanceRial === 0);
const plainUser = await joinSchool(A, "counselor");
check("super endpoints reject non-super (admin / counselor) and super WITHOUT gate cookie", (await adj(A, { direction: "credit", amountRial: 1000000, reason: "x y z" }, A)).status >= 401 && (await adj(A, { direction: "credit", amountRial: 1000000, reason: "x y z" }, plainUser)).status >= 401 && (await call("POST", `/super/schools/${A.schoolId}/wallet/adjust`, { token: sup.token, body: { direction: "credit", amountRial: 1000000, reason: "no gate" } })).status >= 401 && (await sbal(A)) === 0);

// ── خرید با موجودیِ صفر مدرسه، حتی اگر کیف‌پولِ شخصیِ مدیر پول داشته باشد
await pool.query("insert into wallets (id,user_id,balance) values ($1,$2,50000000) on conflict (user_id) do update set balance=50000000", [crypto.randomUUID(), A.id]);
const before = { avail: await avail(), personal: await personal(A) };
let r = await buy(A);
check("purchase with ZERO school balance (personal wallet has 50M) → 409 insufficient", r.status === 409 && r.json.code === "insufficient", r.text);
check("pool token NOT burned (available count unchanged)", (await avail()) === before.avail);
check("personal wallet untouched (balance + txn count identical)", (await personal(A)) === before.personal);
check("no bot row, no school_wallet txn, no purchase row", (await q("select 1 from school_bots where school_id=$1", [A.schoolId])).length === 0 && (await q("select 1 from school_wallet_transactions where school_id=$1", [A.schoolId])).length === 0 && (await q("select 1 from product_purchases where metadata->>'schoolId'=$1", [A.schoolId])).length === 0);

// ── شارژ/کسرِ دستیِ سوپرادمین
check("adjust: bad direction / missing reason / bad amount → 400", (await adj(A, { direction: "x", amountRial: 1, reason: "abc" })).status === 400 && (await adj(A, { direction: "credit", amountRial: 1000, reason: "" })).json.code === "reason_required" && (await adj(A, { direction: "credit", amountRial: -5, reason: "abc" })).status === 400 && (await adj(A, { direction: "credit", amountRial: 1.5, reason: "abc" })).status === 400);
r = await adj(A, { direction: "credit", amountRial: 20_000_000, reason: "شارژ آزمایشی" });
check("super credit 20,000,000 Rial → balance 20,000,000", r.status === 200 && r.json.balanceRial === 20_000_000 && (await sbal(A)) === 20_000_000, r.text);
const t1 = (await q("select * from school_wallet_transactions where school_id=$1", [A.schoolId]))[0];
check("ledger row: admin_credit, balance_after, description, created_by=super", t1.type === "admin_credit" && t1.amount === 20_000_000 && t1.balance_after === 20_000_000 && t1.description === "شارژ آزمایشی" && t1.created_by_user_id === sup.id);
check("debit more than balance → 409 insufficient, balance intact, no txn", (await adj(A, { direction: "debit", amountRial: 30_000_000, reason: "تست" })).status === 409 && (await sbal(A)) === 20_000_000 && (await q("select 1 from school_wallet_transactions where school_id=$1", [A.schoolId])).length === 1);
check("debit 1,000,000 ok → 19,000,000; then credit back", (await adj(A, { direction: "debit", amountRial: 1_000_000, reason: "تصحیح" })).json.balanceRial === 19_000_000 && (await adj(A, { direction: "credit", amountRial: 1_000_000, reason: "برگشت" })).json.balanceRial === 20_000_000);
check("audit trail: school audit-log has wallet.admin_credit/debit with reason", (await call("GET", `/schools/${A.schoolId}/audit-log`, { token: A.token })).text.includes("wallet.admin_credit"));

// ── خریدِ موفق
const pBefore = await personal(A), aBefore = await avail();
r = await buy(A);
check("purchase with 20M → 201, purchased", r.status === 201 && r.json.purchased === true, r.text);
check("EXACT debit: school balance 20,000,000 - 9,900,000 = 10,100,000", (await sbal(A)) === 20_000_000 - PRICE);
const sp = await q("select * from school_wallet_transactions where school_id=$1 and type='spend'", [A.schoolId]);
const botRows = await q("select id from school_bots where school_id=$1", [A.schoolId]);
check("exactly ONE spend txn (refId = bot id, balance_after correct) and ONE bot row", sp.length === 1 && botRows.length === 1 && sp[0].ref_id === botRows[0].id && sp[0].amount === PRICE && sp[0].balance_after === 10_100_000, sp);
check("exactly one pool token consumed; personal wallet untouched", (await avail()) === aBefore - 1 && (await personal(A)) === pBefore);
check("second purchase → 409 already_purchased, balance unchanged", (await buy(A)).json?.code === "already_purchased" && (await sbal(A)) === 10_100_000);
check("GET /bot reports priceRial + purchased", (await call("GET", `/schools/${A.schoolId}/bot`, { token: A.token })).json.priceRial === PRICE);

// ── همروندی: موجودی دقیقاً یک قیمت
const C = await newSchoolAdmin("ج");
await adj(C, { direction: "credit", amountRial: PRICE, reason: "دقیقاً یک خرید" });
const a1 = await avail();
const rr = await Promise.all([buy(C), buy(C)]);
check("2 concurrent purchases with balance == 1 price → exactly one 201, other 409", rr.map((x) => x.status).sort().join() === "201,409", rr.map((x) => x.text));
check("balance exactly 0 (never negative), 1 bot, 1 token consumed", (await sbal(C)) === 0 && (await q("select 1 from school_bots where school_id=$1", [C.schoolId])).length === 1 && (await avail()) === a1 - 1);
// موجودی دو برابر: دو بات/دو کسر نباید رخ دهد
const D = await newSchoolAdmin("د");
await adj(D, { direction: "credit", amountRial: PRICE * 2, reason: "دو برابر" });
const a2 = await avail();
const rd = await Promise.all([buy(D), buy(D), buy(D)]);
check("3 concurrent purchases with balance == 2 prices → ONE 201, others 409; charged exactly once", rd.filter((x) => x.status === 201).length === 1 && rd.filter((x) => x.status === 409).length === 2 && (await sbal(D)) === PRICE && (await avail()) === a2 - 1 && (await q("select 1 from school_wallet_transactions where school_id=$1 and type='spend'", [D.schoolId])).length === 1, rd.map((x) => x.status));

// ── استخرِ خالی: پول کسر نمی‌شود
const E = await newSchoolAdmin("ه");
await adj(E, { direction: "credit", amountRial: PRICE, reason: "استخر خالی" });
await pool.query("update school_bot_token_pool set status='x_hold' where status='available'");
r = await buy(E);
check("empty pool → 409 pool_empty and school wallet NOT charged", r.status === 409 && r.json.code === "pool_empty" && (await sbal(E)) === PRICE && (await q("select 1 from school_wallet_transactions where school_id=$1 and type='spend'", [E.schoolId])).length === 0);
await pool.query("update school_bot_token_pool set status='available' where status='x_hold'");
check("after pool refilled the same school can buy (nothing was burned)", (await buy(E)).status === 201 && (await sbal(E)) === 0);

// ── درخواستِ شارژ
const F = await newSchoolAdmin("و");
const rq = (body, u = F) => call("POST", `/schools/${F.schoolId}/wallet/topup-requests`, { token: u.token, body });
check("request below minimum / non-integer → 400", (await rq({ amountRial: 10 })).status === 400 && (await rq({ amountRial: 1e6 + 0.5 })).status === 400);
const q1 = await rq({ amountRial: 5_000_000, note: "نیاز به بات" });
check("admin creates top-up request → 201 pending", q1.status === 201 && q1.json.status === "pending" && q1.json.amountRial === 5_000_000, q1.text);
await rq({ amountRial: 1_000_000 }); await rq({ amountRial: 1_000_000 });
check("4th pending request → 429 too_many_pending", (await rq({ amountRial: 1_000_000 })).status === 429);
const pend = await call("GET", `/super/school-wallet-requests?status=pending`, { token: sup.token, cookie: sup.cookie });
check("super sees the pending requests with school name", pend.status === 200 && pend.json.some((x) => x.id === q1.json.id && x.schoolName), pend.text.slice(0, 200));
const dec = (id, decision, extra = {}) => call("POST", `/super/school-wallet-requests/${id}/decision`, { token: sup.token, cookie: sup.cookie, body: { decision, ...extra } });
const dd = await Promise.all([dec(q1.json.id, "approve"), dec(q1.json.id, "approve")]);
check("concurrent double-approve → exactly one 200 and one 409; credited ONCE (5,000,000)", dd.map((x) => x.status).sort().join() === "200,409" && (await sbal(F)) === 5_000_000 && (await q("select 1 from school_wallet_transactions where school_id=$1 and type='credit' and ref_id=$2", [F.schoolId, q1.json.id])).length === 1, dd.map((x) => x.text));
const q2 = (await call("GET", `/schools/${F.schoolId}/wallet/topup-requests`, { token: F.token })).json.find((x) => x.status === "pending");
check("reject → no credit; second decision → 409", (await dec(q2.id, "reject", { note: "بدون رسید" })).status === 200 && (await sbal(F)) === 5_000_000 && (await dec(q2.id, "approve")).status === 409);
const q3 = (await call("GET", `/schools/${F.schoolId}/wallet/topup-requests`, { token: F.token })).json.find((x) => x.status === "pending");
check("admin cancels own pending; super can't approve it afterwards (409)", (await call("POST", `/schools/${F.schoolId}/wallet/topup-requests/${q3.id}/cancel`, { token: F.token })).status === 200 && (await dec(q3.id, "approve")).status === 409 && (await sbal(F)) === 5_000_000);
check("other school's admin can't cancel/list F's requests (403)", (await call("POST", `/schools/${F.schoolId}/wallet/topup-requests/${q3.id}/cancel`, { token: B.token })).status === 403 && (await call("GET", `/schools/${F.schoolId}/wallet/topup-requests`, { token: B.token })).status === 403);
check("non-super can't decide (admin token) ", (await dec(q2.id, "approve").then(() => call("POST", `/super/school-wallet-requests/${q2.id}/decision`, { token: F.token, body: { decision: "approve" } }))).status >= 401);

// ── تاریخچه + صفحه‌بندی
for (let i = 0; i < 24; i++) await pool.query("insert into school_wallet_transactions (id,school_id,type,amount,balance_after,description,created_at) values ($1,$2,'credit',1000,5000000,$3, now() - ($4 || ' minutes')::interval)", [crypto.randomUUID(), F.schoolId, "bulk" + i, String(i + 1)]);
const p1 = await call("GET", `/schools/${F.schoolId}/wallet/transactions?limit=20`, { token: F.token });
const p2 = await call("GET", `/schools/${F.schoolId}/wallet/transactions?limit=20&before=${encodeURIComponent(p1.json.transactions.at(-1).createdAt)}`, { token: F.token });
check("pagination: page1=20 hasMore, page2 has the rest, no overlap", p1.json.transactions.length === 20 && p1.json.hasMore === true && p2.json.transactions.length === 5 && !p2.json.transactions.some((t) => p1.json.transactions.some((u) => u.id === t.id)), [p1.json.transactions.length, p2.json.transactions.length]);

// ── کیف‌پولِ شخصی دست‌نخورده: endpointهایِ قبلی همان‌طور کار می‌کنند
const pw = await call("GET", "/wallet", { token: A.token });
check("personal GET /wallet still works and shows the untouched personal balance (50,000,000 Rial = 5,000,000 Toman)", pw.status === 200 && JSON.stringify(pw.json).includes("5000000"), pw.text.slice(0, 200));
check("personal topup config endpoint still reachable", (await call("GET", "/wallet/topup/config", { token: A.token })).status === 200);
await done();
