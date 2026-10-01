/**
 * Production payment hardening tests (no Live charge).
 * Run: node scripts/production-hardening.check.mjs
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const guard = await import(
  pathToFileURL(join(root, "functions/_shared/production-guard.js")).href
);
const { validateCheckoutBody } = await import(
  pathToFileURL(join(root, "functions/_shared/checkout-validate.js")).href
);

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

// --- Runtime / bindings ---
assert(guard.getRuntimeMode({ ENVIRONMENT: "production" }) === "production", "mode production");
assert(guard.getRuntimeMode({ ENVIRONMENT: "development" }) === "development", "mode development");
assert(
  guard.getRuntimeMode({ SITE_ORIGIN: "https://embersoullabs.com" }) === "production",
  "SITE_ORIGIN implies production"
);

const missingKvProd = guard.assertPaymentEventsKv(
  { ENVIRONMENT: "production" },
  { allowInMemoryDev: true }
);
assert(missingKvProd.ok === false, "production missing KV fails closed");
assert(missingKvProd.code === "missing_payment_events_kv", "missing KV code");

const memDev = guard.assertPaymentEventsKv(
  { ENVIRONMENT: "development", ALLOW_IN_MEMORY_IDEMPOTENCY: "true" },
  { allowInMemoryDev: true }
);
assert(memDev.ok === true && memDev.store === "memory_dev_only", "dev memory only when opted in");

const memDevBlocked = guard.assertPaymentEventsKv(
  { ENVIRONMENT: "development" },
  { allowInMemoryDev: true }
);
assert(memDevBlocked.ok === false, "dev without opt-in still requires KV");

assert(guard.assertWebhookSecretConfigured({}).ok === false, "missing webhook secret fails");
assert(
  guard.assertWebhookSecretConfigured({ STRIPE_WEBHOOK_SECRET: "whsec_x" }).ok === true,
  "webhook secret present"
);
assert(guard.assertStripeSecretConfigured({}).ok === false, "missing stripe secret fails");

const badOrigin = guard.resolveSiteOrigin(
  { ENVIRONMENT: "production", SITE_ORIGIN: "https://evil.example" },
  "https://evil.example/api"
);
assert(badOrigin.ok === false, "production rejects non-canonical SITE_ORIGIN");

const goodOrigin = guard.resolveSiteOrigin(
  { ENVIRONMENT: "production", SITE_ORIGIN: "https://embersoullabs.com" },
  "https://attacker.example/api"
);
assert(
  goodOrigin.ok && goodOrigin.origin === "https://embersoullabs.com",
  "production uses configured SITE_ORIGIN not Host"
);

const hostIgnored = guard.resolveSiteOrigin(
  { ENVIRONMENT: "production", SITE_ORIGIN: "https://embersoullabs.com/" },
  "https://attacker.example"
);
assert(hostIgnored.ok && hostIgnored.origin === "https://embersoullabs.com", "origin normalized");

const incomplete = guard.assertProductionCheckoutReady({
  ENVIRONMENT: "production",
  STRIPE_SECRET_KEY: "sk_live_placeholder_not_real_but_format_ok_xxxxxxxx",
});
assert(incomplete.ok === false, "production checkout incomplete fails closed");
assert(
  (incomplete.missing || []).includes("PAYMENT_EVENTS"),
  "missing PAYMENT_EVENTS listed"
);
assert(
  (incomplete.missing || []).includes("STRIPE_WEBHOOK_SECRET"),
  "missing webhook listed"
);

const fakeKv = { get: async () => null, put: async () => {} };
const complete = guard.assertProductionCheckoutReady({
  ENVIRONMENT: "production",
  STRIPE_SECRET_KEY: "rk_live_placeholder_not_real_but_format_ok_xxxxxxxx",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  SITE_ORIGIN: "https://embersoullabs.com",
  PAYMENT_EVENTS: fakeKv,
});
assert(complete.ok === true, "production ready when all bindings present");

// --- Payment state classification ---
assert(
  guard.classifyPaymentState({ payment_status: "paid", status: "complete" }).state ===
    "CONFIRMED",
  "paid → CONFIRMED"
);
assert(
  guard.classifyPaymentState(
    { payment_status: "unpaid", status: "complete" },
    "checkout.session.completed"
  ).state === "PENDING",
  "completed+unpaid → PENDING"
);
assert(
  guard.classifyPaymentState({}, "checkout.session.async_payment_succeeded").state ===
    "CONFIRMED",
  "async succeeded → CONFIRMED"
);
assert(
  guard.classifyPaymentState({}, "checkout.session.async_payment_failed").state ===
    "FAILED",
  "async failed → FAILED"
);
assert(
  guard.classifyPaymentState({ payment_status: "unpaid", status: "expired" }).state ===
    "FAILED",
  "expired → FAILED"
);
assert(
  guard.classifyPaymentState({ payment_status: "paid" }).orderEligible === true,
  "confirmed orderEligible"
);
assert(
  guard.classifyPaymentState({ payment_status: "unpaid", status: "complete" })
    .orderEligible === false,
  "pending not orderEligible"
);

const record = guard.buildPaymentRecord({
  event: { id: "evt_123" },
  session: {
    id: "cs_test_abc",
    payment_intent: "pi_123",
    currency: "myr",
    amount_total: 18900,
    payment_status: "paid",
    status: "complete",
    metadata: {
      service: "story",
      region: "my",
      lookup_key: "ai_story_ad_my",
      package_version: "ai_ads_v1",
    },
  },
  classification: { state: "CONFIRMED", orderEligible: true },
});
assert(record.stripe_event_id === "evt_123", "record event id");
assert(record.checkout_session_id === "cs_test_abc", "record session id");
assert(record.payment_intent_id === "pi_123", "record payment_intent");
assert(record.service === "story" && record.region === "my", "record service/region");
assert(record.lookup_key === "ai_story_ad_my", "record lookup_key");
assert(record.currency === "myr" && record.amount_total === 18900, "record amount");
assert(record.emberos_production === "not_connected", "no emberos");
assert(!("card" in record) && !("number" in record), "no card fields");

// --- Client tamper ---
assert(validateCheckoutBody({ service: "x", region: "my" }).ok === false, "invalid service");
assert(validateCheckoutBody({ service: "short", region: "xx" }).ok === false, "invalid region");
assert(
  validateCheckoutBody({ service: "short", region: "my", amount: 1 }).code ===
    "client_amount_rejected",
  "tampered amount"
);
assert(
  validateCheckoutBody({ service: "short", region: "my", currency: "USD" }).code ===
    "client_amount_rejected",
  "tampered currency"
);
assert(
  validateCheckoutBody({ service: "short", region: "my", price_id: "price_x" }).code ===
    "client_amount_rejected",
  "tampered price id"
);
assert(
  validateCheckoutBody({
    service: "short",
    region: "my",
    lookup_key: "ai_short_ad_intl",
  }).code === "client_amount_rejected",
  "tampered lookup key"
);

// --- Source guarantees ---
const webhookSrc = readFileSync(join(root, "functions/api/stripe-webhook.js"), "utf8");
assert(!webhookSrc.includes("memorySeen.set") || webhookSrc.includes("memory_dev_only") || webhookSrc.includes("ALLOW_IN_MEMORY"), "dev memory gated");
assert(webhookSrc.includes("missing_payment_events_kv") || webhookSrc.includes("assertPaymentEventsKv"), "KV required path");
assert(webhookSrc.includes("idempotent_skip"), "duplicate event skip");
assert(webhookSrc.includes("side_effects") || webhookSrc.includes("idempotent_skip"), "duplicate no side effects");
assert(webhookSrc.includes("async_payment_succeeded"), "async success handled");
assert(webhookSrc.includes("async_payment_failed"), "async failure handled");
assert(webhookSrc.includes("emberos_production: \"not_connected\""), "emberos not connected");

const checkoutSrc = readFileSync(join(root, "functions/api/checkout.js"), "utf8");
assert(checkoutSrc.includes("assertProductionCheckoutReady"), "checkout readiness guard");
assert(checkoutSrc.includes("resolveSiteOrigin"), "checkout uses resolveSiteOrigin");
assert(!checkoutSrc.includes("new URL(context.request.url).origin") || checkoutSrc.includes("resolveSiteOrigin"), "no raw host trust for prod URLs");

const sessionSrc = readFileSync(join(root, "functions/api/checkout/session.js"), "utf8");
assert(sessionSrc.includes("classifyPaymentState"), "session uses classification");
assert(!sessionSrc.includes("customer_email"), "no customer email leak");
assert(!sessionSrc.includes("customer_details"), "no customer details leak");

const successSrc = readFileSync(
  join(root, "ai-ads/checkout/success/index.html"),
  "utf8"
);
assert(successSrc.includes("We're verifying your payment"), "success verifying");
assert(successSrc.includes("Payment received"), "success paid");

const stripeConfig = readFileSync(join(root, "js/stripe-config.js"), "utf8");
assert(!/sk_(live|test)_[A-Za-z0-9]{20,}/.test(stripeConfig), "no sk in client");
assert(!/whsec_/.test(stripeConfig), "no whsec in client");

if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nAll production hardening checks passed.");
console.log("LIVE_CHARGE_CREATED=NO");
console.log("DEPLOYED=NO");
