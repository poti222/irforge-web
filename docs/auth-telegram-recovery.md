# Operator procedure — restoring access after Telegram loss

Signing in requires a code delivered to the account's linked Telegram. When
someone loses that Telegram account — phone lost, account deleted, number
changed — they cannot sign in and **there is no self-service path**, by design.

That absence is deliberate. A signed-out user who could clear their own Telegram
link would hand an attacker holding a stolen password a way to remove the second
factor entirely. So recovery goes through a human, and the human must verify
identity before touching anything.

**A reset performed on an unverified request is an account takeover with extra
steps.** The audit log will show your name against it.

## Who can perform it

`super_admin` only. `admin` receives 403 on every endpoint involved.

## Before you reset anything — verify identity

Do **not** proceed on the strength of a Telegram message or an email that merely
claims to be the account owner. Both are trivially forged and neither is the
factor you are replacing.

Require **at least two** of the following, and prefer three for accounts with a
wallet balance or running bots:

1. **The account phone number**, read back to you by the requester — not sent to
   them. Compare against `users.phone`.
2. **The account email**, and a reply from that address in the same thread.
3. **A billing detail only the owner would hold**: the amount and date of a
   recent payment, or the last four digits of the card/account used.
4. **Bot ownership**: the @username of a bot on the account, plus something only
   its owner sees — a custom command name, for instance.

If the request arrives from a *new* Telegram account claiming to be the same
person, treat that as evidence of nothing. It is exactly what an attacker sends.

**When the answers do not line up, stop and escalate.** A delayed legitimate
customer is recoverable; a completed takeover is not.

## Performing the reset

1. Open `/admin/users`, find the account, open its detail screen.
2. In the **Telegram** card, use *Reset Telegram link*.
3. Type a reason that a stranger reading the audit log in six months would find
   sufficient. Include what you verified and how — e.g.
   `Verified phone +98… read back by caller + matching invoice #1032 on file;
   old Telegram account deleted per user.` "User asked" is not a reason.
4. Confirm. The account's `telegramId` and related fields are cleared, an
   `admin_audit_log` row is written with your user id, and the user is notified
   by email where one is on file.

## After the reset

Tell the requester to:

1. Sign in with phone + password as usual.
2. They will be routed to the **"your account needs Telegram connected"** screen.
3. Open the deep link (or scan the QR on desktop) and connect the new Telegram
   account.
4. Sign in again — the code now arrives at the new account.

Their bots, wallet and tickets are untouched throughout; only the linked
Telegram identity changed.

## If the password is also lost

Set a new one from the **Security** card on the same screen. That action revokes
every active session and notifies the account through the platform bot — which
is the point, and is not optional. Never send the new password over the same
channel you used to verify identity; read it out separately, and tell them to
change it immediately.

## What is never available

- **Reading a user's existing password.** Passwords are bcrypt hashes, a
  one-way transformation. No endpoint returns a password or a hash, and no UI
  displays one. If you have been asked to retrieve a password, the answer is to
  set a new one.
- **Acting as a user via impersonation.** Impersonation is read-only and
  capped at 30 minutes; purchases, deletions, password changes and wallet
  movements are blocked while it is active, and every request is tagged in the
  audit log with your real user id.
