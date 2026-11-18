CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  successes INTEGER NOT NULL DEFAULT 0 CHECK (successes >= 0),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
);

-- These short-lived HMACs make a network retry count once, including when
-- several tabs use the same invitation. They contain no recipient or IP.
CREATE TABLE IF NOT EXISTS unlock_receipts (
  digest TEXT PRIMARY KEY NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_expiry ON unlock_receipts(expires);
