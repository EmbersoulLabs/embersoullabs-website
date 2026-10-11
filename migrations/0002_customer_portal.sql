-- Customer portal tables. Additive only. Does not alter payment authority.
-- Operational status lives in order_operations, separate from orders.state.
-- Keep this file LF-only. Remote D1 rejects CRLF inside BEGIN/END.

ALTER TABLE creative_briefs ADD COLUMN business_name TEXT;
ALTER TABLE creative_briefs ADD COLUMN objective TEXT;
ALTER TABLE creative_briefs ADD COLUMN audience TEXT;
ALTER TABLE creative_briefs ADD COLUMN visual_style TEXT;
ALTER TABLE creative_briefs ADD COLUMN asset_links TEXT;
ALTER TABLE creative_briefs ADD COLUMN special_instructions TEXT;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  verified_at TEXT NOT NULL
);

CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_auth_challenges_email ON auth_challenges (email_hash, created_at);

CREATE TABLE auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL
);

CREATE TABLE customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers (id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX idx_customer_sessions_customer ON customer_sessions (customer_id);

CREATE TABLE order_owners (
  order_id TEXT PRIMARY KEY REFERENCES orders (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  claimed_at TEXT NOT NULL,
  claim_method TEXT NOT NULL CHECK (claim_method = 'access_token')
);

CREATE INDEX idx_order_owners_customer ON order_owners (customer_id);

CREATE TABLE order_operations (
  order_id TEXT PRIMARY KEY REFERENCES orders (id),
  workflow_status TEXT NOT NULL CHECK (
    workflow_status IN ('PAID', 'BRIEF_RECEIVED', 'IN_PRODUCTION', 'REVIEW', 'DELIVERED')
  ),
  revision_allowance INTEGER NOT NULL DEFAULT 3 CHECK (revision_allowance = 3),
  revisions_used INTEGER NOT NULL DEFAULT 0 CHECK (revisions_used >= 0 AND revisions_used <= 72),
  video_slots INTEGER NOT NULL DEFAULT 1 CHECK (video_slots >= 1 AND video_slots <= 24),
  delivery_status TEXT NOT NULL DEFAULT 'unavailable' CHECK (delivery_status IN ('unavailable', 'ready')),
  delivery_object_key TEXT,
  delivered_at TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNC_PENDING' CHECK (
    sync_status IN ('SYNC_PENDING', 'delivered', 'failed')
  ),
  updated_at TEXT NOT NULL
);

CREATE TABLE order_timeline (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  status TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_order_timeline_order ON order_timeline (order_id, created_at);

CREATE TABLE revision_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  comment TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'revision'),
  status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'rejected', 'completed')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX idx_revision_requests_order ON revision_requests (order_id, status);

CREATE TABLE order_assets (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  customer_id TEXT NOT NULL REFERENCES customers (id),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_order_assets_order ON order_assets (order_id);

CREATE TABLE download_grants (
  token_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  object_key TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE embercore_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SYNC_PENDING' CHECK (status IN ('SYNC_PENDING', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX idx_embercore_outbox_pending ON embercore_outbox (status, next_attempt_at);

CREATE TABLE embercore_inbound (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE portal_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TRIGGER orders_financial_lock
BEFORE UPDATE OF amount_total, currency, lookup_key, price_id, checkout_session_id ON orders
FOR EACH ROW
WHEN NEW.amount_total != OLD.amount_total
  OR NEW.currency != OLD.currency
  OR NEW.lookup_key != OLD.lookup_key
  OR NEW.price_id != OLD.price_id
  OR NEW.checkout_session_id != OLD.checkout_session_id
BEGIN
  SELECT RAISE(ABORT, 'financial_fields_locked');
END;
