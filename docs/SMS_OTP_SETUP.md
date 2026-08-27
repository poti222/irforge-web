# SMS OTP (sms.ir) — production setup

IRFORGE_SMS_OTP_PROMPT Phase 6. Everything in phases 1–5 (the sender in
`api-server/src/lib/smsir.ts`, the `sms_otp_codes` table, rate limiting, the
`/auth/otp/sms/send` + `/auth/otp/sms/verify` routes, and the "پیامک" method
in `register.tsx`/`login.tsx`) is already written and works against a
**Sandbox** key with no panel setup at all. This doc covers the one-time,
human-only steps needed before real SMS can go out in production: getting an
approved OTP template in the sms.ir panel, and setting the resulting values
on Railway.

Nothing here can be scripted or done by Claude Code — sms.ir requires a
logged-in panel session and (for the template) a manual review by sms.ir's
own team.

## 1. What already works without any of this

With no sms.ir account at all, `sendOtpSms` returns
`{ success: false, error: "not_configured" }` and the send route responds
with a 502 ("ارسال پیامک ناموفق بود"). With **only** a Sandbox key set
(`SMSIR_API_KEY_DEV`), `/auth/otp/sms/send` and `/auth/otp/sms/verify` run
their full logic — rate limiting, DB row, hash, attempts — and sms.ir's API
returns a simulated success without sending a real text or charging
anything. That's enough for local dev and for QA to exercise the whole flow
(also see `AUTH_DEV_ECHO_CODES=true` in `.env.example`, which echoes the raw
code in the send response so a tester never has to receive a real SMS).

**You only need the steps below to make real SMS go out.**

## 2. Create an sms.ir account and get a Sandbox key (if you don't have one)

1. Sign up / log in at [sms.ir](https://sms.ir).
2. In the panel, find the API keys section (in Persian panels this is
   usually under **برنامه‌نویسان ← لیست کلیدهای API** / "Developers → API
   keys list" — sms.ir's own menu wording has changed before, so if that
   label doesn't match what you see, look for anything mentioning "کلید
   API" or "API Key").
3. A **Sandbox/تست** key is provided by default (or can be created there) —
   this is the one safe to hand to Claude Code / put in a shared `.env`,
   since it never sends real SMS or spends credit.

## 3. Define and get the OTP template (پترن) approved

`send/verify` (the endpoint `sendOtpSms` calls) **will not work at all**
without an approved pattern/template — this is the step people most often
miss.

1. In the panel, go to the template/pattern section — usually **الگوهای
   پیامکی** ("SMS Templates/Patterns") under the Verify/OTP product, not the
   general bulk-SMS templates.
2. Create a new template whose body contains exactly one variable. This
   codebase expects that variable to be named **`CODE`** (see `PARAM_NAME`
   in `api-server/src/lib/smsir.ts`) — for example:
   ```
   کد تایید شما: %CODE%
   ```
   (sms.ir's own placeholder syntax in the panel UI may render this
   differently — what matters is the variable's *name*, which must be
   `CODE`.) If you'd rather use a different variable name, that's fine, but
   you then need to change `PARAM_NAME` in `smsir.ts` to match — don't leave
   the two out of sync, or every send will fail with sms.ir rejecting the
   `parameters` field.
3. Submit the template for review. sms.ir has to manually approve
   OTP/Verify templates (this is what keeps this line eligible to bypass
   users' "block promotional SMS" setting) — approval isn't instant; budget
   at least a business day, more if the template body triggers a manual
   look (submit this early, don't leave it for deploy day).
4. Once approved, the panel shows a numeric **template ID**. That number is
   `SMSIR_TEMPLATE_ID`.

## 4. Create a Production key

1. Same API-keys section as step 2, but create a **Production/عملیاتی**
   key this time, not another Sandbox one — the panel usually labels this
   distinction explicitly when you create a key.
2. This key sends real SMS and spends real account credit the moment it's
   used — make sure the account has a balance loaded before flipping this
   on, or every send will fail with a `sms.ir reported failure` log entry
   (insufficient credit) even though the code path is otherwise correct.
3. Copy this key immediately; depending on panel version it may only be
   shown once.

## 5. Set the Railway variables

On the `api-server` service in Railway (Variables tab), set:

| Variable | Value | Notes |
|---|---|---|
| `SMSIR_API_KEY_PROD` | the Production key from step 4 | picked automatically because Railway's deploy runs with `NODE_ENV=production` — see `resolveApiKey()` in `smsir.ts` |
| `SMSIR_TEMPLATE_ID` | the numeric template ID from step 3 | same value regardless of environment — a template isn't Sandbox/Production-specific, only the key is |

Do **not** set `SMSIR_API_KEY_DEV` or the unscoped `SMSIR_API_KEY` on the
Railway production service — if either is set, it's only ever a fallback
(see `resolveApiKey()`), but there's no reason to have a Sandbox key sitting
on production at all. Keep Sandbox keys in local `.env` files only.

If `SMSIR_TEMPLATE_ID` or `SMSIR_API_KEY_PROD` is missing or unparseable at
request time, `sendOtpSms` fails closed with `not_configured` and logs a
warning — it does not crash the process or throw, so a misconfigured deploy
just means SMS OTP silently doesn't work (Telegram/email OTP are
unaffected) rather than the whole API going down. Check the Railway logs for
`sendOtpSms skipped: ...` after deploying if SMS sends aren't going through.

## 6. Verify end-to-end after deploy

1. Trigger a real send (register or login with "پیامک" as the method) from
   a real phone number you control.
2. Confirm the SMS actually arrives and the code matches what
   `/auth/otp/sms/verify` accepts.
3. Check the sms.ir panel's send log/report to confirm credit was deducted
   — a non-zero deduction there is the real signal you're on the Production
   key and not accidentally still on Sandbox.

## What you (a human) still need to do, beyond code and beyond "deploy"

None of the following can be done by Claude Code or by pushing code — they
require a logged-in sms.ir panel session and, for the template, sms.ir's own
manual approval:

1. **Create/log into the sms.ir account** that will own this project's
   OTP line.
2. **Write and submit the OTP template** for approval (§3) — do this well
   before you need production SMS working, since approval isn't instant.
3. **Load account credit** on sms.ir — Production sends fail (silently, from
   the end user's perspective — they just don't get a code) if the balance
   is empty.
4. **Generate the Production API key** (§4) and copy it somewhere safe —
   treat it like any other production secret, not a value to paste into
   chat, a shared doc, or a Sandbox-era `.env`.
5. **Set `SMSIR_API_KEY_PROD` and `SMSIR_TEMPLATE_ID`** on the Railway
   `api-server` service (§5) — this part is a couple of clicks in Railway's
   dashboard, not a deploy.
6. **Send yourself a real test code** after deploy (§6) and confirm the
   panel shows credit was actually spent — this is the only way to be sure
   you're not still silently running on a Sandbox key in production.
7. Optional but worth deciding on purpose: whether `AUTH_DEV_ECHO_CODES`
   is (and stays) unset/`false` on the production Railway service —
   it must never be `true` there, since that would echo real OTP codes back
   in the API response.
