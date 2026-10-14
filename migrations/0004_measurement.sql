-- Additive measurement tables. Payment columns on orders are not altered.
-- A reservation is not delivery. purchase_acknowledged_at is the dedupe lock.
-- A stale reservation can be replaced so a failed browser send can be retried
-- with the same transaction_id. Historical orders are not backfilled: only a
-- checkout that writes measurement_eligible_at may be measured.

CREATE TABLE order_attribution (
  order_id TEXT PRIMARY KEY REFERENCES orders (id),
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  stored_at TEXT NOT NULL,
  measurement_eligible_at TEXT,
  purchase_reserved_at TEXT,
  purchase_attempted_at TEXT,
  purchase_acknowledged_at TEXT
);

CREATE TABLE inquiries (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  service TEXT,
  region TEXT,
  contact_name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  product_brief TEXT NOT NULL,
  details_json TEXT,
  conversion_reserved_at TEXT,
  conversion_attempted_at TEXT,
  conversion_acknowledged_at TEXT
);

CREATE TABLE inquiry_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL
);
