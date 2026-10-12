-- Additive measurement tables. Payment columns on orders are not altered.
-- Click IDs are attribution tokens, not customer secrets.
-- Inquiry rows store the message for support. Analytics responses must not select those columns.

CREATE TABLE order_attribution (
  order_id TEXT PRIMARY KEY REFERENCES orders (id),
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  stored_at TEXT NOT NULL,
  purchase_conversion_claimed_at TEXT
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
  conversion_claimed_at TEXT
);

CREATE TABLE inquiry_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL
);
