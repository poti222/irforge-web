/** شارژِ شخصی (کیف‌پولِ /wallet) سرتاسری: کانال → درخواست → پیامکِ بانک → تأییدِ خودکار → یک‌بار شارژ؛ و (اگر SCHOOL=1) همین چرخه برایِ کیف‌پولِ مدرسه. */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { call, newUser, newSchoolAdmin, newSuper, joinSchool, pool, done, check } from "./lib.mjs";
execFileSync("node", ["migrate.mjs"], { env: process.env, stdio: "ignore" });
const withSchool = process.env.SCHOOL === "1";

const sup = await newSuper();
const adm = (m, p, body) => call(m, `/admin/card-autoconfirm${p}`, { token: sup.token, cookie: sup.cookie, body });
// کانالِ پلتفرم (همان که سوپرادمین از پنل می‌سازد)
const ch = await adm("POST", "/platform-channels", { cardNumber: "6037997112345674", holderName: "تست", bankName: "بلو", minAmountToman: 10000, bankParser: "blubank" });
check("setup: platform channel created", ch.status === 201 && ch.json.smsSecret, ch.text);
const sms = (amountRial, extra = "") => call("POST", `/payments/sms/${ch.json.channel.id}`, { headers: { "X-Sms-Secret": ch.json.smsSecret, "content-type": "application/json" }, raw: JSON.stringify({ text: `بلو\nواریز پول\n علی عزیز، ${amountRial.toLocaleString("en-US")} ریال به حساب شما نشست.\n موجودی: 9,000,000 ریال${extra}`, sender: "BluBank" }) });
const completeProfile = (u) => pool.query("update users set name='علی رضایی', phone=$2, phone_verified=true, telegram_id=$3, telegram_username='x', gender='male', platform_username=$4 where id=$1", [u.id, "+98912" + String(Math.floor(1e6 + Math.random() * 8e6)), String(Math.floor(Math.random() * 1e12)), "u" + crypto.randomBytes(4).toString("hex")]);
const pbal = async (u) => Number((await pool.query("select balance from wallets where user_id=$1", [u.id])).rows[0]?.balance ?? 0);

// ── شارژِ شخصی
const u = await newUser("personal"); await completeProfile(u);
const cfg = await call("GET", "/wallet/topup/config", { token: u.token });
check("personal: config enabled with the channel", cfg.status === 200 && cfg.json.enabled === true, cfg.text);
const t1 = await call("POST", "/wallet/topup/request", { token: u.token, body: { amount: 100000 } });
check("personal: topup request 201 with unique final amount", t1.status === 201 && t1.json.finalAmount > 1_000_000 && t1.json.status === "pending", t1.text);
const before = await pbal(u);
const s1 = await sms(t1.json.finalAmount);
check("personal: bank SMS → matched", (s1.status === 201 || s1.status === 200) && s1.json?.matched === true, s1.text);
check("personal: wallet credited exactly 1,000,000 Rial (base, not suffix)", (await pbal(u)) - before === 1_000_000, [before, await pbal(u)]);
const s2 = await sms(t1.json.finalAmount);
check("personal: replay of same SMS does not double-credit", (await pbal(u)) - before === 1_000_000, s2.text);
check("personal: status polling = confirmed", (await call("GET", `/wallet/topup/${t1.json.id}/status`, { token: u.token })).json.status === "confirmed");
check("personal: ledger row deposit_card_auto", (await pool.query("select 1 from wallet_transactions where user_id=$1 and type='deposit_card_auto' and amount=1000000", [u.id])).rowCount === 1);

if (withSchool) {
  const A = await newSchoolAdmin("الف"), B = await newSchoolAdmin("ب");
  const par = await joinSchool(A, "parent"), tea = await joinSchool(A, "teacher"), stu = await joinSchool(A, "student");
  const sb = (id) => async () => Number((await pool.query("select balance from school_wallets where school_id=$1", [id])).rows[0]?.balance ?? 0);
  const sbalA = sb(A.schoolId);
  const base = `/schools/${A.schoolId}/wallet/topup`;
  check("school: non-admins 403 on topup config/request/status", (await Promise.all([par, tea, stu, B].map(async (x) => [(await call("GET", `${base}/config`, { token: x.token })).status, (await call("POST", `${base}/request`, { token: x.token, body: { amount: 100000 } })).status]))).flat().every((s) => s === 403));
  const c = await call("GET", `${base}/config`, { token: A.token });
  check("school: admin config shows the same platform channel", c.status === 200 && c.json.enabled === true && c.json.channels.length >= 1, c.text);
  const r1 = await call("POST", `${base}/request`, { token: A.token, body: { amount: 100000 } });
  check("school: request 201, unique final amount, pending", r1.status === 201 && r1.json.status === "pending" && r1.json.finalAmount > 1_000_000, r1.text);
  check("school: personal /wallet/topup list does NOT include the school request; personal status 404", (await call("GET", "/wallet/topup", { token: A.token })).json.items.every((x) => x.id !== r1.json.id) && (await call("GET", `/wallet/topup/${r1.json.id}/status`, { token: A.token })).status === 404);
  check("school: other school's admin can't read it (403 on A path, 404 on B path)", (await call("GET", `${base}/${r1.json.id}/status`, { token: B.token })).status === 403 && (await call("GET", `/schools/${B.schoolId}/wallet/topup/${r1.json.id}/status`, { token: B.token })).status === 404);
  const adminPersonalBefore = await pbal(A), schoolBefore = await sbalA();
  const ss1 = await sms(r1.json.finalAmount);
  check("school: bank SMS → matched", ss1.json?.matched === true, ss1.text);
  check("school: school wallet credited exactly 1,000,000 Rial; admin's PERSONAL wallet untouched", (await sbalA()) - schoolBefore === 1_000_000 && (await pbal(A)) === adminPersonalBefore, [schoolBefore, await sbalA(), adminPersonalBefore, await pbal(A)]);
  await sms(r1.json.finalAmount);
  check("school: replay SMS → no double credit", (await sbalA()) - schoolBefore === 1_000_000);
  const tx = (await pool.query("select * from school_wallet_transactions where school_id=$1 and type='credit' and ref_id=$2", [A.schoolId, r1.json.id])).rows;
  check("school: exactly one ledger row (credit, refId=request, balance_after)", tx.length === 1 && tx[0].amount === 1_000_000 && tx[0].balance_after === (await sbalA()), tx);
  check("school: status confirmed + shown in wallet summary/history", (await call("GET", `${base}/${r1.json.id}/status`, { token: A.token })).json.status === "confirmed" && (await call("GET", `${base}`, { token: A.token })).json.items.some((x) => x.id === r1.json.id));
  check("school: another school's wallet untouched", (await sb(B.schoolId)()) === 0);
  // یک درخواستِ شخصی و یک مدرسه‌ایِ هم‌زمان: هر پیامک فقط به صاحبِ مبلغِ خودش می‌خورد
  const pU = await newUser("p2"); await completeProfile(pU);
  const pr = await call("POST", "/wallet/topup/request", { token: pU.token, body: { amount: 200000 } });
  const sr = await call("POST", `${base}/request`, { token: A.token, body: { amount: 200000 } });
  check("same base amount personal+school → distinct final amounts (shared unique-suffix pool)", pr.json.finalAmount !== sr.json.finalAmount, [pr.json.finalAmount, sr.json.finalAmount]);
  const sb0 = await sbalA(), pb0 = await pbal(pU);
  await sms(sr.json.finalAmount);
  check("school SMS credits only the school wallet (personal user p2 unchanged)", (await sbalA()) - sb0 === 2_000_000 && (await pbal(pU)) === pb0);
  await sms(pr.json.finalAmount);
  check("personal SMS credits only the personal wallet (school unchanged)", (await pbal(pU)) - pb0 === 2_000_000 && (await sbalA()) - sb0 === 2_000_000);
  // لغو + محدودیتِ فعال
  const r3 = await call("POST", `${base}/request`, { token: A.token, body: { amount: 300000 } });
  check("school: cancel pending request", (await call("POST", `${base}/${r3.json.id}/cancel`, { token: A.token })).status === 200 && (await call("POST", `${base}/${r3.json.id}/cancel`, { token: B.token })).status === 403);
  check("school: invalid amount 400", (await call("POST", `${base}/request`, { token: A.token, body: { amount: 5 } })).status === 400);
  // مسیرِ فیش → تأییدِ دستیِ سوپرادمین (همان پنلِ کارت‌به‌کارت) → فقط کیف‌پولِ مدرسه
  const r4 = await call("POST", `${base}/request`, { token: A.token, body: { amount: 400000 } });
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  check("school: receipt upload → awaiting_review; other school/personal path can't upload", (await call("POST", `/wallet/topup/${r4.json.id}/receipt`, { token: A.token, body: { receiptUrl: png } })).status === 404 && (await call("POST", `${base}/${r4.json.id}/receipt`, { token: A.token, body: { receiptUrl: png } })).json.status === "awaiting_review");
  const sb4 = await sbalA(), pb4 = await pbal(A);
  const dec = await adm("POST", `/requests/${r4.json.id}/decide`, { decision: "approve" });
  check("admin panel manual approve credits the SCHOOL wallet once (not the personal one); 2nd approve no double credit", dec.status === 200 && (await sbalA()) - sb4 === 4_000_000 && (await pbal(A)) === pb4 && ((await adm("POST", `/requests/${r4.json.id}/decide`, { decision: "approve" })), (await sbalA()) - sb4 === 4_000_000), dec.text);
  check("admin panel lists the school request with purpose=school_wallet_topup", (await adm("GET", "/requests?scope=platform&limit=50")).json.requests.some((x) => x.id === r4.json.id && x.purpose === "school_wallet_topup"));
  // خریدِ بات از موجودیِ شارژشده
  for (let i = 0; i < 2; i++) await pool.query("insert into school_bot_token_pool (id, bot_token, status) values ($1,$2,'available')", [crypto.randomUUID(), "dummy-" + crypto.randomUUID()]);
  // موجودی ۳٬۰۰۰٬۰۰۰؛ قیمت ۹٬۹۰۰٬۰۰۰ → ابتدا کم است
  const buy0 = await call("POST", `/schools/${A.schoolId}/bot/purchase`, { token: A.token });
  check("bot purchase with 3,000,000 Rial (< price) → 409 insufficient", buy0.status === 409 && buy0.json.code === "insufficient", buy0.text);
  const big = await call("POST", `${base}/request`, { token: A.token, body: { amount: 1000000 } });
  await sms(big.json.finalAmount);
  const b = await sbalA();
  const buy1 = await call("POST", `/schools/${A.schoolId}/bot/purchase`, { token: A.token });
  check("after SMS-credited top-up, bot purchase succeeds and debits exactly the price", buy1.status === 201 && (await sbalA()) === b - 9_900_000, [buy1.text, b, await sbalA()]);
}
await done();
