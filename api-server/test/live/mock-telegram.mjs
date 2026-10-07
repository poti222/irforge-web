/**
 * test/live/mock-telegram.mjs — a tiny local mock of the Telegram Bot API for the live school-bot suites.
 * Run the api-server with TELEGRAM_API_BASE=http://localhost:<port> and every tgApi() call lands here.
 *
 *   import { startMock } from "./mock-telegram.mjs";
 *   const tg = await startMock(4010);
 *   tg.calls                      // every recorded call {token, method, body, files}
 *   tg.callsTo("sendMessage", {chat_id})
 *   tg.blocked.add("555")         // sendMessage to chat 555 -> 403 "bot was blocked by the user"
 *   tg.webhooks[token]            // last setWebhook body
 *   tg.reset()
 * Valid tokens: "<digits>:<anything>" (id = digits, username = "mock<id>_bot") unless tg.invalid has the token.
 */
import http from "node:http";

export async function startMock(port = 0) {
  const st = {
    calls: [], blocked: new Set(), invalid: new Set(), webhooks: {}, pending: {}, lastError: {},
    reset() { st.calls.length = 0; st.blocked.clear(); },
    callsTo(method, match = {}) {
      return st.calls.filter((c) => c.method === method && Object.entries(match).every(([k, v]) => String(c.body?.[k]) === String(v)));
    },
    lastText(chatId) { const c = st.callsTo("sendMessage", { chat_id: chatId }).concat(st.callsTo("editMessageText", { chat_id: chatId })).sort((a, b) => a.n - b.n); return c.at(-1)?.body?.text; },
    close: () => new Promise((r) => server.close(r)),
  };
  let n = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url ?? "");
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (!m) return send(404, { ok: false, error_code: 404, description: "Not Found" });
    const [, token, method] = m;
    let body = {}; const files = {};
    const ct = req.headers["content-type"] ?? "";
    try {
      if (ct.includes("multipart/form-data")) {
        const fd = await new Response(raw, { headers: { "content-type": ct } }).formData();
        for (const [k, v] of fd.entries()) {
          if (typeof v === "string") body[k] = v;
          else files[k] = Buffer.from(await v.arrayBuffer());
        }
      } else if (raw.length) body = JSON.parse(raw.toString("utf8"));
    } catch { return send(400, { ok: false, error_code: 400, description: "Bad Request: bad body" }); }
    st.calls.push({ n: ++n, token, method, body, files });
    const id = Number(token.split(":")[0]);
    if (!/^\d+:.+/.test(token) || st.invalid.has(token)) return send(401, { ok: false, error_code: 401, description: "Unauthorized" });
    switch (method) {
      case "getMe": return send(200, { ok: true, result: { id, is_bot: true, first_name: "Mock", username: `mock${id}_bot` } });
      case "setWebhook": st.webhooks[token] = body; return send(200, { ok: true, result: true, description: "Webhook was set" });
      case "deleteWebhook": delete st.webhooks[token]; return send(200, { ok: true, result: true });
      case "getWebhookInfo": {
        const w = st.webhooks[token];
        return send(200, { ok: true, result: { url: w?.url ?? "", has_custom_certificate: false, pending_update_count: st.pending[token] ?? 0, allowed_updates: w?.allowed_updates, ...(st.lastError[token] ?? {}) } });
      }
      case "getUserProfilePhotos": return send(200, { ok: true, result: { total_count: 0, photos: [] } });
      case "sendMessage": case "sendPhoto": case "editMessageText": case "deleteMessage": {
        if (st.blocked.has(String(body.chat_id))) return send(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
        if (method !== "deleteMessage" && body.text !== undefined && String(body.text).length > 4096) return send(400, { ok: false, error_code: 400, description: "Bad Request: message is too long" });
        return send(200, { ok: true, result: { message_id: n, chat: { id: body.chat_id }, text: body.text } });
      }
      default: return send(200, { ok: true, result: true });
    }
  });
  await new Promise((r) => server.listen(port, r));
  st.port = server.address().port;
  st.url = `http://localhost:${st.port}`;
  return st;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = await startMock(Number(process.env.PORT ?? 4010));
  console.log("mock telegram on", t.url);
}
