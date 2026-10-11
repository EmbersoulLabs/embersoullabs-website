/**
 * Local checkout, webhook, status, and brief integration tests.
 * Stripe and Production are mocked. No network.
 * Run: node scripts/order-api.check.mjs
 */
import { readFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { persistCheckoutSession, recoverWebsiteCheckout } from "../functions/_shared/checkout-order.js";
import { sqliteAdapter } from "../functions/_shared/order-db.js";
import { readAuthorizedOrder, submitCreativeBrief } from "../functions/_shared/order-access.js";
import { applyVerifiedStripeEvent } from "../functions/_shared/webhook-order.js";
import { verifyStripeSignature } from "../functions/api/stripe-webhook.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failed = await run();
if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nAll order API checks passed.");
console.log("STRIPE_LIVE_CONTACTED=NO");
console.log("PRODUCTION_CONTACTED=NO");
console.log("EMBEROS_CONNECTED=NO");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "website-order-api-"));
  const db = new DatabaseSync(join(dir, "orders.sqlite"));
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(join(root, "migrations/0001_website_orders.sql"), "utf8"));
  return sqliteAdapter(db);
}

function price() {
  return { id: "price_1ShortMyLive001", currency: "myr", unit_amount: 6900 };
}

function env() {
  return {
    STRIPE_SECRET_KEY: "sk_test_local_only_not_used",
    STRIPE_WEBHOOK_SECRET: "local_webhook_secret_value",
  };
}

function paidSession(id = "cs_live_TestSession001") {
  return {
    id,
    livemode: true,
    payment_status: "paid",
    payment_intent: "pi_TestIntent001",
    currency: "myr",
    amount_total: 6900,
    metadata: {
      service: "short",
      region: "my",
      lookup_key: "ai_short_ad_my",
      package_version: "ai_ads_v1",
    },
    line_items: {
      data: [
        {
          quantity: 1,
          price: {
            id: "price_1ShortMyLive001",
            lookup_key: "ai_short_ad_my",
            currency: "myr",
            unit_amount: 6900,
            livemode: true,
            active: true,
            type: "one_time",
          },
        },
      ],
    },
  };
}

async function run() {
  try {
    const db = openDb();
    const calls = [];
    const stripe = async (secret, method, path, body, options = {}) => {
      calls.push({ method, path, key: options.idempotencyKey, body });
      assert(!String(secret).includes("sk_live_") && !String(secret).includes("rk_live_"), "test must not use a live key");
      return {
        status: 200,
        data: {
          id: "cs_live_TestSession001",
          url: "https://checkout.stripe.com/c/pay/cs_live_TestSession001",
        },
      };
    };
    const placed = await persistCheckoutSession({
      db,
      env: env(),
      origin: "https://embersoullabs.com",
      service: "short",
      region: "my",
      lookupKey: "ai_short_ad_my",
      price: price(),
      stripeRequest: stripe,
      orderId: "ord_test_short_my",
      accessToken: "token_test_access_value_0123456789",
      now: "2026-10-11T00:00:00.000Z",
    });
    assert(placed.status === 200 && placed.body.url, "checkout returns a URL after the order is stored");
    assert(!placed.body.url.includes("access_token"), "Stripe URL does not need to echo the token");
    const order = await db.get("SELECT state, access_token_hash, emberos_production FROM orders WHERE id = ?", ["ord_test_short_my"]);
    assert(order.state === "CREATED" && order.emberos_production === "not_connected", "checkout stores CREATED and stays disconnected");
    assert(order.access_token_hash && order.access_token_hash !== "token_test_access_value_0123456789", "raw access token is not stored");
    assert(calls[0].key === "website_order_ord_test_short_my", "Stripe idempotency key is the order id");
    assert(String(calls[0].body.success_url).includes("access_token="), "success URL carries the access token");
    assert(!String(calls[0].body["metadata[website_order_id]"]).includes("token_test"), "order metadata does not carry the access token");

    const status = await readAuthorizedOrder(db, "cs_live_TestSession001", "token_test_access_value_0123456789");
    const missing = await readAuthorizedOrder(db, "cs_live_TestSession001", "wrong-token");
    const unknown = await readAuthorizedOrder(db, "cs_live_DoesNotExist0001", "token_test_access_value_0123456789");
    assert(status.status === 200 && status.body.confirmed === false && status.body.state === "CREATED", "created order is not shown as paid");
    assert(missing.status === 404 && unknown.status === 404, "wrong token and unknown session are not found");
    assert(JSON.stringify(missing.body) === JSON.stringify(unknown.body), "authorization failure is not enumerable");

    const unpaidBrief = await submitCreativeBrief(db, {
      sessionId: "cs_live_TestSession001",
      accessToken: "token_test_access_value_0123456789",
      promotionText: "A product",
      language: "en",
      assetStatus: "photos ready",
      contact: "buyer@example.com",
      briefId: "brief_unpaid",
    });
    assert(unpaidBrief.status === 409 && unpaidBrief.body.code === "not_paid", "unpaid order cannot submit a brief");

    let retrieves = 0;
    const retrieve = async () => {
      retrieves += 1;
      return { ok: true, session: paidSession() };
    };
    const paid = await applyVerifiedStripeEvent({
      db,
      event: { id: "evt_paid", type: "checkout.session.completed", data: { object: { id: "cs_live_TestSession001" } } },
      retrieveSession: retrieve,
      now: "2026-10-11T00:00:01.000Z",
    });
    assert(paid.status === 200 && paid.body.code === "applied", "verified paid session marks PAID");
    const replay = await applyVerifiedStripeEvent({
      db,
      event: { id: "evt_paid", type: "checkout.session.completed", data: { object: { id: "cs_live_TestSession001" } } },
      retrieveSession: retrieve,
      now: "2026-10-11T00:00:02.000Z",
    });
    assert(replay.body.handled === "idempotent_skip" && replay.body.side_effects === "none", "replay does not apply twice");
    const afterPaid = await readAuthorizedOrder(db, "cs_live_TestSession001", "token_test_access_value_0123456789");
    assert(afterPaid.body.confirmed === true && afterPaid.body.state === "PAID", "status shows paid only from the ledger");

    const late = await applyVerifiedStripeEvent({
      db,
      event: { id: "evt_late_expired", type: "checkout.session.expired", data: { object: { id: "cs_live_TestSession001" } } },
      retrieveSession: async () => ({ ok: true, session: { ...paidSession(), payment_status: "unpaid" } }),
      now: "2026-10-11T00:00:03.000Z",
    });
    assert(late.body.code === "illegal_transition", "expired after PAID does not reverse the order");

    const refund = await applyVerifiedStripeEvent({
      db,
      event: { id: "evt_refund", type: "charge.refunded", data: { object: { payment_intent: "pi_TestIntent001" } } },
      retrieveSession: retrieve,
      now: "2026-10-11T00:00:04.000Z",
    });
    assert(refund.body.code === "applied", "refund after PAID is applied");
    const refunded = await readAuthorizedOrder(db, "cs_live_TestSession001", "token_test_access_value_0123456789");
    assert(refunded.body.state === "REFUNDED" && refunded.body.confirmed === false, "refunded order is not confirmed");
    const refundedBrief = await submitCreativeBrief(db, {
      sessionId: "cs_live_TestSession001",
      accessToken: "token_test_access_value_0123456789",
      promotionText: "A product",
      language: "en",
      assetStatus: "photos ready",
      contact: "buyer@example.com",
      briefId: "brief_refunded",
    });
    assert(refundedBrief.status === 409, "refunded order cannot submit a brief");

    const pendingDb = openDb();
    await persistCheckoutSession({
      db: pendingDb,
      env: env(),
      origin: "https://embersoullabs.com",
      service: "short",
      region: "my",
      lookupKey: "ai_short_ad_my",
      price: price(),
      stripeRequest: stripe,
      orderId: "ord_pending",
      accessToken: "token_pending_access_value_0123456789",
      now: "2026-10-11T00:00:05.000Z",
    });
    const pending = await applyVerifiedStripeEvent({
      db: pendingDb,
      event: { id: "evt_unpaid", type: "checkout.session.completed", data: { object: { id: "cs_live_TestSession001" } } },
      retrieveSession: async () => ({ ok: true, session: { ...paidSession(), payment_status: "unpaid" } }),
      now: "2026-10-11T00:00:06.000Z",
    });
    assert(pending.body.code === "applied", "unpaid completion is accepted as pending");
    const pendingStatus = await readAuthorizedOrder(pendingDb, "cs_live_TestSession001", "token_pending_access_value_0123456789");
    assert(pendingStatus.body.state === "PENDING" && pendingStatus.body.confirmed === false, "unpaid completion is not paid");
    const earlyDispute = await applyVerifiedStripeEvent({
      db: pendingDb,
      event: { id: "evt_early_dispute", type: "charge.dispute.created", data: { object: { payment_intent: "pi_TestIntent001" } } },
      retrieveSession: async () => ({ ok: true, session: { ...paidSession(), payment_status: "unpaid" } }),
      now: "2026-10-11T00:00:06.500Z",
    });
    assert(earlyDispute.body.code === "refund_not_applicable", "dispute before PAID does not refund");
    const afterDispute = await readAuthorizedOrder(pendingDb, "cs_live_TestSession001", "token_pending_access_value_0123456789");
    assert(afterDispute.body.state === "PENDING", "early dispute leaves the order pending");

    const mismatch = await applyVerifiedStripeEvent({
      db: pendingDb,
      event: { id: "evt_bad_amount", type: "checkout.session.async_payment_succeeded", data: { object: { id: "cs_live_TestSession001" } } },
      retrieveSession: async () => ({ ok: true, session: { ...paidSession(), amount_total: 1 } }),
      now: "2026-10-11T00:00:07.000Z",
    });
    assert(mismatch.status === 200 && mismatch.body.side_effects === "none", "catalog mismatch does not move the order");
    const stillPending = await readAuthorizedOrder(pendingDb, "cs_live_TestSession001", "token_pending_access_value_0123456789");
    assert(stillPending.body.state === "PENDING", "wrong amount leaves the order unpaid");

    const readyDb = openDb();
    await persistCheckoutSession({
      db: readyDb,
      env: env(),
      origin: "https://embersoullabs.com",
      service: "short",
      region: "my",
      lookupKey: "ai_short_ad_my",
      price: price(),
      stripeRequest: stripe,
      orderId: "ord_ready",
      accessToken: "token_ready_access_value_0123456789",
      now: "2026-10-11T00:00:08.000Z",
    });
    await applyVerifiedStripeEvent({
      db: readyDb,
      event: { id: "evt_ready_paid", type: "checkout.session.completed", data: { object: { id: "cs_live_TestSession001" } } },
      retrieveSession: retrieve,
      now: "2026-10-11T00:00:09.000Z",
    });
    const brief = await submitCreativeBrief(readyDb, {
      sessionId: "cs_live_TestSession001",
      accessToken: "token_ready_access_value_0123456789",
      promotionText: "Launch the short ad",
      language: "mix",
      assetStatus: "logo and photos",
      contact: "buyer@example.com",
      briefId: "brief_ready",
    });
    assert(brief.status === 200 && brief.body.state === "READY_FOR_PRODUCTION", "paid brief becomes ready");
    assert(brief.body.emberos_production === "not_connected", "brief does not connect EmberOS");

    const recoverDb = openDb();
    let failedOnce = false;
    const flaky = {
      async get(sql, params) { return recoverDb.get(sql, params); },
      async run(sql, params) {
        if (!failedOnce && sql.includes("INSERT INTO orders")) {
          failedOnce = true;
          throw new Error("persist down");
        }
        return recoverDb.run(sql, params);
      },
    };
    const recoverStripe = async (secret, method, path, body, options = {}) => {
      calls.push({ method, path, key: options.idempotencyKey, body });
      return {
        status: 200,
        data: { id: "cs_live_RecoverSession001", url: "https://checkout.stripe.com/c/pay/cs_live_RecoverSession001" },
      };
    };
    const first = await persistCheckoutSession({
      db: flaky,
      env: env(),
      origin: "https://embersoullabs.com",
      service: "short",
      region: "my",
      lookupKey: "ai_short_ad_my",
      price: price(),
      stripeRequest: recoverStripe,
      orderId: "ord_recover",
      accessToken: "token_recover_access_value_0123456789",
      now: "2026-10-11T00:00:10.000Z",
    });
    assert(first.status === 503 && !first.body.url && first.body.recovery_handle, "persist failure returns no URL");
    const keysBefore = calls.filter((call) => call.key === "website_order_ord_recover").length;
    const second = await recoverWebsiteCheckout({
      db: recoverDb,
      env: env(),
      handle: first.body.recovery_handle,
      stripeRequest: recoverStripe,
      now: "2026-10-11T00:00:11.000Z",
    });
    const keysAfter = calls.filter((call) => call.key === "website_order_ord_recover").length;
    assert(second.status === 200 && second.body.url, "recovery returns the URL after the order is stored");
    assert(keysAfter === keysBefore + 1, "recovery reuses the order idempotency key");
    const recovered = await recoverDb.get("SELECT state FROM orders WHERE id = ?", ["ord_recover"]);
    assert(recovered.state === "CREATED", "recovery does not mark the order paid");

    const header = await sign("local_webhook_secret_value", '{"id":"evt_sig"}');
    assert(await verifyStripeSignature('{"id":"evt_sig"}', header, "local_webhook_secret_value") === true, "valid signature passes");
    assert(await verifyStripeSignature('{"id":"evt_sig"}', header, "other_webhook_secret_value") === false, "wrong secret fails");
    assert(await verifyStripeSignature('{"id":"evt_other"}', header, "local_webhook_secret_value") === false, "changed payload fails");

    const whsec = "whsec_" + btoa("website-endpoint-key");
    const whsecPayload = '{"id":"evt_whsec"}';
    const whsecHeader = await sign(whsec, whsecPayload);
    assert(await verifyStripeSignature(whsecPayload, whsecHeader, whsec) === true, "whsec secret is the raw HMAC key");
    const decodedKey = atob(whsec.slice(6));
    const decodedHeader = await sign(decodedKey, whsecPayload);
    assert(await verifyStripeSignature(whsecPayload, decodedHeader, whsec) === false, "base64-decoded whsec key is rejected");

    const success = readFileSync(join(root, "ai-ads/checkout/success/index.html"), "utf8");
    assert(success.includes("/api/orders/status"), "success page reads the order ledger");
    assert(!success.includes("/api/checkout/session"), "success page does not confirm from the Stripe session endpoint");
    assert(success.includes("We're verifying your payment") && success.includes("Payment received"), "success copy remains");
    assert(!success.includes("embersoul.app") && !success.includes("fetch(") || success.includes("/api/orders/"), "success page stays on the website");
    assert(retrieves > 0, "webhook retrieved a session");
    return "";
  } catch (error) {
    return error.stack || error.message;
  }
}

async function sign(secret, payload) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}
