-- Website-only order ledger. Not an EmberOS database.
-- Claim and transition run inside the payment_events insert trigger.
-- Node sqlite 3.53.0 accepts INSERT ... ON CONFLICT DO NOTHING RETURNING.
-- It rejects INSERT inside a WITH clause, so that form is not used.

PRAGMA foreign_keys = ON;

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  checkout_session_id TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'CREATED',
      'PENDING',
      'PAID',
      'READY_FOR_PRODUCTION',
      'FAILED',
      'EXPIRED',
      'CANCELLED',
      'REFUNDED'
    )
  ),
  service TEXT NOT NULL,
  region TEXT NOT NULL,
  lookup_key TEXT NOT NULL,
  price_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_total INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  package_version TEXT NOT NULL,
  livemode INTEGER NOT NULL CHECK (livemode = 1),
  stripe_payment_status TEXT,
  brief_status TEXT NOT NULL DEFAULT 'missing' CHECK (brief_status IN ('missing', 'complete')),
  failure_reason TEXT,
  emberos_production TEXT NOT NULL DEFAULT 'not_connected' CHECK (emberos_production = 'not_connected'),
  apply_count INTEGER NOT NULL DEFAULT 0 CHECK (apply_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  ready_at TEXT
);

CREATE INDEX idx_orders_state ON orders (state);

CREATE TABLE payment_events (
  stripe_event_id TEXT PRIMARY KEY,
  checkout_session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  intended_state TEXT NOT NULL CHECK (
    intended_state IN (
      'PENDING',
      'PAID',
      'FAILED',
      'EXPIRED',
      'CANCELLED',
      'REFUNDED',
      'REJECTED'
    )
  ),
  stripe_payment_status TEXT,
  failure_reason TEXT,
  disposition TEXT NOT NULL DEFAULT 'pending' CHECK (
    disposition IN ('pending', 'applied', 'rejected')
  ),
  applied_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_payment_events_session ON payment_events (checkout_session_id);
CREATE INDEX idx_payment_events_pending ON payment_events (stripe_event_id)
  WHERE disposition = 'pending';

CREATE TABLE creative_briefs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders (id),
  promotion_text TEXT NOT NULL,
  asset_status TEXT NOT NULL,
  language TEXT NOT NULL,
  contact TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX idx_creative_briefs_order ON creative_briefs (order_id);

-- One insert is the concurrency lock. The trigger moves the order in that
-- same statement. A crash rolls both back. A claim stored before the order
-- row exists stays disposition=pending for recoverUnappliedEvent.
CREATE TRIGGER payment_events_apply
AFTER INSERT ON payment_events
FOR EACH ROW
WHEN NEW.applied_at IS NULL AND NEW.intended_state != 'REJECTED'
BEGIN
  UPDATE orders
  SET
    state = NEW.intended_state,
    stripe_payment_status = COALESCE(NEW.stripe_payment_status, stripe_payment_status),
    failure_reason = COALESCE(NEW.failure_reason, failure_reason),
    updated_at = NEW.created_at,
    paid_at = CASE
      WHEN NEW.intended_state = 'PAID' THEN COALESCE(paid_at, NEW.created_at)
      ELSE paid_at
    END,
    apply_count = apply_count + 1
  WHERE checkout_session_id = NEW.checkout_session_id
    AND (
      (NEW.intended_state = 'PENDING' AND state = 'CREATED')
      OR (NEW.intended_state = 'PAID' AND state IN ('CREATED', 'PENDING'))
      OR (NEW.intended_state = 'FAILED' AND state IN ('CREATED', 'PENDING'))
      OR (NEW.intended_state = 'EXPIRED' AND state IN ('CREATED', 'PENDING'))
      OR (NEW.intended_state = 'CANCELLED' AND state IN ('CREATED', 'PENDING'))
      OR (NEW.intended_state = 'REFUNDED' AND state IN ('PAID', 'READY_FOR_PRODUCTION'))
    );

  UPDATE payment_events
  SET disposition = 'applied', applied_at = NEW.created_at
  WHERE stripe_event_id = NEW.stripe_event_id
    AND disposition = 'pending'
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE checkout_session_id = NEW.checkout_session_id
        AND state = NEW.intended_state
    );

  UPDATE payment_events
  SET disposition = 'rejected', applied_at = NEW.created_at
  WHERE stripe_event_id = NEW.stripe_event_id
    AND disposition = 'pending'
    AND EXISTS (
      SELECT 1 FROM orders
      WHERE checkout_session_id = NEW.checkout_session_id
        AND state != NEW.intended_state
    );
END;

CREATE TRIGGER orders_state_guard
BEFORE UPDATE OF state ON orders
FOR EACH ROW
WHEN NOT (
  OLD.state = NEW.state
  OR (OLD.state = 'CREATED' AND NEW.state IN ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED'))
  OR (OLD.state = 'PENDING' AND NEW.state IN ('PAID', 'FAILED', 'EXPIRED', 'CANCELLED'))
  OR (OLD.state = 'PAID' AND NEW.state IN ('READY_FOR_PRODUCTION', 'REFUNDED'))
  OR (OLD.state = 'READY_FOR_PRODUCTION' AND NEW.state = 'REFUNDED')
)
BEGIN
  SELECT RAISE(ABORT, 'illegal_order_transition');
END;

CREATE TRIGGER orders_ready_requires_brief
BEFORE UPDATE OF state ON orders
FOR EACH ROW
WHEN NEW.state = 'READY_FOR_PRODUCTION' AND OLD.state != 'READY_FOR_PRODUCTION'
BEGIN
  SELECT RAISE(ABORT, 'brief_required')
  WHERE NOT EXISTS (
    SELECT 1 FROM creative_briefs WHERE order_id = NEW.id
  );
END;

CREATE TRIGGER creative_briefs_mark_ready
AFTER INSERT ON creative_briefs
FOR EACH ROW
BEGIN
  UPDATE orders
  SET
    state = 'READY_FOR_PRODUCTION',
    brief_status = 'complete',
    ready_at = NEW.completed_at,
    updated_at = NEW.completed_at,
    apply_count = apply_count + 1
  WHERE id = NEW.order_id
    AND state = 'PAID';

  SELECT RAISE(ABORT, 'brief_requires_paid_order')
  WHERE NOT EXISTS (
    SELECT 1 FROM orders
    WHERE id = NEW.order_id
      AND state = 'READY_FOR_PRODUCTION'
  );
END;
