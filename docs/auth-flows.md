# Authentication flows

Two flows, both ending in a code delivered through the platform Telegram bot.

## Why registration is ordered the way it is

The obvious design — *user types their phone, a code arrives in Telegram* — **is
not possible with the Telegram Bot API**. A bot cannot look up a user by phone
number and cannot start a conversation; it may only message a `chat_id` it has
already seen. No endpoint maps a phone number to a Telegram account.

So the order is inverted: **link Telegram first, then deliver the code.** That
turns out to be better. Once the user is inside the bot, Telegram itself hands
over the phone through a `request_contact` button — a number **Telegram has
verified**, not one the user typed. No SMS cost, no typos, a genuinely
confirmed phone.

A third method, SMS OTP via sms.ir, works the same way end-to-end but is
routed through `/auth/otp/sms/send` + `/auth/otp/sms/verify` instead of the
Telegram bot (see `api-server/src/lib/smsir.ts` and
`api-server/src/lib/smsOtpRateLimit.ts`). It needs no panel setup at all in
development — a Sandbox key simulates success without sending real SMS or
spending credit. For what's needed to make it send real SMS in production
(an approved OTP template + a Production key on Railway), see
[`SMS_OTP_SETUP.md`](./SMS_OTP_SETUP.md).

## Registration

```
┌──────────┐   ┌──────────┐   ┌───────────────┐   ┌────────┐   ┌────────┐
│ 1 Method │──▶│ 2 Identity│──▶│ 3 Telegram   │──▶│ 4 Code │──▶│ 5 Pass │
│ phone /  │   │ first,   │   │ deep link →   │   │ 6 digit│   │ ×2     │
│ email✗   │   │ last,    │   │ share contact │   │ in web │   │ → user │
└──────────┘   │ email    │   │ → code sent   │   └────────┘   └────────┘
               └──────────┘   └───────────────┘
                     │                │                │            │
              pending_registrations   │                │            │
              step=identity      step=telegram_pending │            │
                                 then step=code_sent   │            │
                                              step=code_verified    │
                                                            users row created,
                                                            pending row deleted
```

Server-side only: **the client never sets `step`.** It sends `registrationId`
and reads the step back.

Two independent clocks on the pending row: the **code** expires in 5 minutes;
the **record** lives 7 days so abandoned signups stay visible to admins.

## Login — every time

```
┌────────────────┐        ┌──────────────────┐        ┌─────────┐
│ phone+password │───────▶│ login_challenges │───────▶│ session │
└────────────────┘        │ code → Telegram  │        └─────────┘
        │                 └──────────────────┘
        │ no telegramId
        ▼
┌────────────────────────┐
│ 409 telegram_required  │──▶ link screen (purpose="link") ──▶ retry login
└────────────────────────┘
```

Valid credentials alone **never** produce a session. There is no "remember this
device": a second factor that can be switched off is one checkbox away from not
existing for an attacker who already has the password.

Failures do not distinguish "no such phone" from "wrong password", in message
*or* timing — otherwise the endpoint becomes a tool for discovering which phone
numbers have accounts.

## Codes

One implementation, `api-server/src/lib/otp.ts`: `crypto.randomInt` (never
`Math.random`), sha256 at rest, `timingSafeEqual` on compare, 6 digits,
5-minute TTL, 5 attempts, 3 resends 60s apart. `forgot-password` uses it too.

**No code is ever logged or returned in an API response.** `AUTH_DEV_ECHO_CODES`
exists for local development, defaults off, and logs a loud warning at boot when
it is on. It must never be set in production.

## Rate limiting

State lives in `auth_rate_limits` in Postgres, **not** process memory — the app
runs on Railway and a restart or second instance must not reset a counter.

| Scope | Limit |
|---|---|
| per phone | 5 failed logins / 15 min → 15 min block |
| per IP | 20 auth requests / 15 min |
| per record or challenge | 5 code attempts, then it dies |
| resend | 3 per record, 60s apart |

## Recovery

Losing the linked Telegram account means losing the ability to sign in. There is
**no self-service path** — a signed-out user who could clear their own Telegram
link would give an attacker holding a stolen password a way to remove the second
factor entirely. Recovery is a super-admin action against a verified identity;
see `docs/auth-telegram-recovery.md`.
