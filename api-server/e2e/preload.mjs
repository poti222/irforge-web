import fs from "fs";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = typeof url === "string" ? url : url.url;
  if (u.includes("api.sms.ir")) {
    fs.appendFileSync("/tmp/sms.log", String(init?.body ?? "") + "\n");
    return new Response(JSON.stringify({ status: 1, message: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};
