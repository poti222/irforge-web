/** Shared setup for school-bot live suites: mock Telegram + real API + real Postgres. */
import crypto from "node:crypto";
import { call, pool, newSuper, newSchoolAdmin, joinSchool } from "./lib.mjs";
import { startMock } from "./mock-telegram.mjs";

export const TG_PORT = Number(process.env.TG_PORT ?? 4010);
export { call, pool, newSuper, newSchoolAdmin, joinSchool };
export const q = async (sql, p) => (await pool.query(sql, p)).rows;
export const mock = await startMock(TG_PORT).catch(async () => { throw new Error("mock port busy; run with TG_PORT free or reuse"); });

let tokSeq = 0;
export const fakeToken = () => `${7000000 + Math.floor(Math.random() * 900000) * 10 + (++tokSeq % 10)}:AA${crypto.randomBytes(12).toString("hex")}`;

/** super adds a pool token through the REAL endpoint (getMe goes to the mock). */
export async function addPoolToken(sup, token = fakeToken()) {
  const r = await call("POST", "/school-bot-pool", { token: sup.token, cookie: sup.cookie, body: { botToken: token } });
  if (r.status !== 201) throw new Error("pool add " + r.text);
  return { token, poolId: r.json.id };
}
/** Fresh school, funded wallet, purchased bot. Returns {admin, token, botId, username}. */
export async function schoolWithBot(sup, name = "مدرسه بات") {
  const admin = await newSchoolAdmin(name);
  // make sure THIS purchase claims our token: drain others is impossible, so add one and accept FIFO-ish; tests read the token back from the bot row.
  const { token } = await addPoolToken(sup);
  await pool.query("insert into school_wallets (school_id,balance) values ($1,100000000) on conflict (school_id) do update set balance=100000000", [admin.schoolId]).catch(async () => {
    await pool.query("update school_wallets set balance=100000000 where school_id=$1", [admin.schoolId]);
  });
  const r = await call("POST", `/schools/${admin.schoolId}/bot/purchase`, { token: admin.token });
  if (r.status !== 201) throw new Error("purchase " + r.text);
  const [row] = await q("select b.id, b.telegram_username from school_bots b where b.school_id=$1", [admin.schoolId]);
  admin.botId = row.id; admin.botUsername = row.telegram_username;
  return admin;
}
/** POST a simulated Telegram update to the school's webhook with a given secret header. */
export async function sendUpdate(botId, update, secret) {
  const r = await fetch(`${process.env.BASE ?? "http://localhost:3111"}/api/schools/bot-webhook/${botId}`, {
    method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(update),
  });
  return r.status;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
