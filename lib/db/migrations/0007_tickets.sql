-- =========================================================================
-- Migration: Z4 — سیستم تیکت پشتیبانی
-- اجرا کن: psql $DATABASE_URL -f این_فایل.sql
-- =========================================================================

CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL,
  sender_id   TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'user',
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
