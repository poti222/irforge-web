-- Round 3 / Phase 2 — make e-mail identity case-insensitive.
--
-- Two write paths disagreed: the new registration flow lowercased the address,
-- the older POST /auth/register stored it exactly as typed. Postgres compares
-- text byte-for-byte, so `Ali@Gmail.com` and `ali@gmail.com` both passed the
-- UNIQUE constraint and became two accounts on one real mailbox.
--
-- Order matters here: detect collisions, then normalise, then let the database
-- enforce it. Creating the index first would fail on data we have not fixed yet;
-- normalising first without the check could silently violate the old constraint.

-- 1. Refuse to continue if two accounts differ only by case.
--
--    This deliberately aborts the migration instead of merging or deleting.
--    Which of two real accounts survives — and what happens to the bots, wallet
--    balance and tickets hanging off the loser — is a business decision with no
--    safe default, so it stops here and names the addresses involved.
DO $$
DECLARE
  collisions TEXT;
BEGIN
  SELECT string_agg(DISTINCT lower(email), ', ')
    INTO collisions
    FROM users
   GROUP BY lower(email)
  HAVING count(*) > 1;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot normalise user e-mails: % address(es) are held by more than one account, differing only in letter case. Resolve them by hand (decide which account survives and migrate its bots/wallet/tickets) before running this migration.',
      collisions
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

-- 2. Normalise what is already stored.
UPDATE users SET email = lower(email) WHERE email <> lower(email);

-- 3. Hand enforcement to the database.
--
--    The plain UNIQUE constraint is byte-comparison, so it cannot express this.
--    A functional unique index on lower(email) can, and it is also the index
--    `lower(email) = $1` lookups use — so the guarantee and the fast path are
--    the same object. Every call site remembering to lowercase is not a
--    guarantee; this is.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
