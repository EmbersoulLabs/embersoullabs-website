/**
 * Local website order lifecycle tests. No network and no Production calls.
 * Run: node scripts/order-lifecycle.check.mjs
 */
import { readFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import {
  EMBEROS_PRODUCTION,
  applyPaymentEvent,
  canTransition,
  completeCreativeBrief,
  createOrder,
  recoverUnappliedEvent,
  validateRetrievedSession,
} from "../functions/_shared/order-state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!isMainThread) {
  const db = openDatabase(workerData.dbPath, false);
  try {
    const result = await applyPaymentEvent(db, workerData.input);
    db.close();
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    parentPort.postMessage({ ok: false, message: error.message });
  }
} else {
  const failed = await run();
  if (failed) {
    console.error("\nFAILED:", failed);
    process.exit(1);
  }
  console.log("\nAll order lifecycle checks passed.");
  console.log("PRODUCTION_CONTACTED=NO");
  console.log("EMBEROS_CONNECTED=NO");
}

function openDatabase(dbPath, migrate) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  if (migrate) {
    db.exec(readFileSync(join(root, "migrations/0001_website_orders.sql"), "utf8"));
  }
  return db;
}

function freshDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "website-orders-"));
  const dbPath = join(dir, "orders.sqlite");
  return { dbPath, db: openDatabase(dbPath, true) };
}

function session(overrides = {}) {
  const price = {
    id: "price_1ShortMyLive001",
    lookup_key: "ai_short_ad_my",
    currency: "myr",
    unit_amount: 6900,
    livemode: true,
    active: true,
    type: "one_time",
    ...(overrides.price || {}),
  };
  return {
    id: "cs_live_ShortMySession001",
    livemode: true,
    mode: "payment",
    payment_status: "paid",
    currency: "myr",
    amount_total: 6900,
    metadata: {
      service: "short",
      region: "my",
      lookup_key: "ai_short_ad_my",
      package_version: "ai_ads_v1",
      ...(overrides.metadata || {}),
    },
    line_items: [{ quantity: overrides.quantity ?? 1, price }],
    ...strip(overrides, ["price", "metadata", "quantity"]),
  };
}

function strip(source, keys) {
  const copy = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}

async function seedOrder(db, overrides = {}) {
  await createOrder(db, {
    id: "ord_short_my",
    checkoutSessionId: "cs_live_ShortMySession001",
    paymentIntentId: null,
    service: "short",
    region: "my",
    lookupKey: "ai_short_ad_my",
    priceId: "price_1ShortMyLive001",
    currency: "myr",
    amountTotal: 6900,
    packageVersion: "ai_ads_v1",
    ...overrides,
  });
}

async function run() {
  let failed = 0;
  function assert(cond, msg) {
    if (!cond) {
      console.error("FAIL:", msg);
      failed++;
    } else {
      console.log("OK:", msg);
    }
  }

  assert(canTransition("PAID", "EXPIRED") === false, "PAID cannot become EXPIRED");
  assert(canTransition("PAID", "CANCELLED") === false, "PAID cannot become CANCELLED");
  assert(canTransition("PAID", "PENDING") === false, "PAID cannot become PENDING");
  assert(canTransition("CREATED", "PAID") === true, "CREATED can become PAID");

  {
    const { db } = freshDatabase();
    await seedOrder(db);
    const paid = await applyPaymentEvent(db, {
      eventId: "evt_paid",
      eventType: "checkout.session.completed",
      session: session(),
      now: "2026-10-11T00:00:00.000Z",
    });
    assert(paid.ok && paid.changed && paid.state === "PAID", "valid PAID transition");
    assert(paid.applyCount === 1, "PAID increments apply count once");
    assert(paid.emberos_production === EMBEROS_PRODUCTION, "PAID result keeps EmberOS disconnected");
    db.close();
  }

  {
    const { db } = freshDatabase();
    await seedOrder(db);
    const pending = await applyPaymentEvent(db, {
      eventId: "evt_unpaid",
      eventType: "checkout.session.completed",
      session: session({ payment_status: "unpaid" }),
    });
    assert(pending.ok && pending.state === "PENDING" && pending.state !== "PAID", "unpaid completion remains PENDING");
    db.close();
  }

  for (const [label, patch, code] of [
    ["wrong amount", { amount_total: 1 }, "wrong_amount"],
    ["wrong currency", { currency: "usd" }, "wrong_currency"],
    ["wrong Price", { price: { id: "price_1OtherLive0001" } }, "wrong_price"],
    ["wrong package version", { metadata: { package_version: "ai_ads_v0" } }, "wrong_package_version"],
  ]) {
    const { db } = freshDatabase();
    await seedOrder(db);
    const rejected = await applyPaymentEvent(db, {
      eventId: "evt_" + code,
      eventType: "checkout.session.completed",
      session: session(patch),
    });
    const state = db.prepare("SELECT state, apply_count FROM orders").get();
    assert(rejected.ok === false && rejected.code === code, label + " rejected");
    assert(state.state === "CREATED" && state.apply_count === 0, label + " does not move the order");
    db.close();
  }

  {
    const { db } = freshDatabase();
    await seedOrder(db);
    const input = {
      eventId: "evt_dup",
      eventType: "checkout.session.completed",
      session: session(),
    };
    const first = await applyPaymentEvent(db, input);
    const second = await applyPaymentEvent(db, input);
    const state = db.prepare("SELECT state, apply_count FROM orders").get();
    assert(first.changed && second.duplicate === true, "duplicate event ID is ignored");
    assert(state.state === "PAID" && state.apply_count === 1, "duplicate event does not apply twice");
    db.close();
  }

  {
    const { db, dbPath } = freshDatabase();
    await seedOrder(db);
    db.close();
    const input = {
      eventId: "evt_concurrent",
      eventType: "checkout.session.completed",
      session: session(),
      now: "2026-10-11T00:00:01.000Z",
    };
    const results = await Promise.all([
      runWorker(dbPath, input),
      runWorker(dbPath, input),
    ]);
    const check = openDatabase(dbPath, false);
    const state = check.prepare("SELECT state, apply_count, emberos_production FROM orders").get();
    const events = check.prepare("SELECT COUNT(*) AS c FROM payment_events").get();
    check.close();
    assert(results.filter((item) => item.ok).length === 2, "concurrent deliveries both return");
    assert(state.state === "PAID" && state.apply_count === 1, "concurrent deliveries apply PAID once");
    assert(events.c === 1, "concurrent deliveries store one event");
    assert(state.emberos_production === "not_connected", "concurrent path does not connect EmberOS");
  }

  {
    const { db } = freshDatabase();
    const claimed = await applyPaymentEvent(db, {
      eventId: "evt_interrupted",
      eventType: "checkout.session.completed",
      session: session(),
      now: "2026-10-11T00:00:02.000Z",
    });
    assert(claimed.code === "claimed_for_recovery", "claim can be stored before the order row");
    await seedOrder(db);
    const recovered = await recoverUnappliedEvent(db, "evt_interrupted", "2026-10-11T00:00:03.000Z");
    const again = await recoverUnappliedEvent(db, "evt_interrupted", "2026-10-11T00:00:04.000Z");
    const state = db.prepare("SELECT state, apply_count FROM orders").get();
    assert(recovered.changed && recovered.state === "PAID", "interrupted claim recovers to PAID");
    assert(again.changed === false && state.apply_count === 1, "recovery does not apply twice");
    db.close();
  }

  {
    const { db } = freshDatabase();
    await seedOrder(db);
    await applyPaymentEvent(db, {
      eventId: "evt_paid_before_expire",
      eventType: "checkout.session.completed",
      session: session(),
    });
    const late = await applyPaymentEvent(db, {
      eventId: "evt_expired_late",
      eventType: "checkout.session.expired",
      session: session({ payment_status: "paid", status: "complete" }),
    });
    const state = db.prepare("SELECT state FROM orders").get();
    assert(late.code === "illegal_transition" && state.state === "PAID", "expired after PAID does not regress");
    db.close();
  }

  {
    const { db } = freshDatabase();
    await seedOrder(db);
    await applyPaymentEvent(db, {
      eventId: "evt_paid_before_refund",
      eventType: "checkout.session.completed",
      session: session(),
    });
    const refund = await applyPaymentEvent(db, {
      eventId: "evt_refund",
      eventType: "charge.refunded",
      session: session({ payment_status: "paid" }),
    });
    assert(refund.changed && refund.state === "REFUNDED", "refund after PAID");
    db.close();
  }

  {
    const { db } = freshDatabase();
    await seedOrder(db);
    const rejected = await applyPaymentEvent(db, {
      eventId: "evt_nopay",
      eventType: "checkout.session.completed",
      session: session({ payment_status: "no_payment_required", amount_total: 0 }),
    });
    const state = db.prepare("SELECT state FROM orders").get();
    assert(
      rejected.ok === false && rejected.code === "no_payment_required" && state.state === "CREATED",
      "no-payment-required rejected"
    );
    db.close();
  }

  {
    const { db } = freshDatabase();
    await seedOrder(db);
    await applyPaymentEvent(db, {
      eventId: "evt_paid_for_brief",
      eventType: "checkout.session.completed",
      session: session(),
    });
    const ready = await completeCreativeBrief(db, {
      id: "brief_1",
      orderId: "ord_short_my",
      promotionText: "RM69 short ad",
      assetStatus: "partial",
      language: "en",
      contact: "buyer@example.com",
      now: "2026-10-11T00:00:05.000Z",
    });
    assert(ready.state === "READY_FOR_PRODUCTION" && ready.brief_status === "complete", "brief completes READY_FOR_PRODUCTION");
    let blocked = false;
    try {
      db.prepare("UPDATE orders SET emberos_production = 'connected' WHERE id = ?").run("ord_short_my");
    } catch {
      blocked = true;
    }
    const row = db.prepare("SELECT emberos_production FROM orders WHERE id = ?").get("ord_short_my");
    assert(blocked && row.emberos_production === "not_connected", "order row cannot connect EmberOS");
    const source = readFileSync(join(root, "functions/_shared/order-state.js"), "utf8");
    assert(!source.includes("fetch(") && !source.includes("emberos.app"), "order module has no EmberOS side effects");
    db.close();
  }

  {
    const order = {
      checkout_session_id: "cs_live_ShortMySession001",
      service: "short",
      region: "my",
      lookup_key: "ai_short_ad_my",
      package_version: "ai_ads_v1",
      currency: "myr",
      amount_total: 6900,
      price_id: "price_1ShortMyLive001",
    };
    assert(validateRetrievedSession(session({ livemode: false }), order).code === "not_livemode", "livemode required");
    assert(validateRetrievedSession(session({ quantity: 2 }), order).code === "wrong_quantity", "quantity required");
  }

  return failed;
}

function runWorker(dbPath, input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { dbPath, input },
    });
    let message;
    worker.on("message", (value) => {
      message = value;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error("worker exited " + code));
      else resolve(message);
    });
  });
}
