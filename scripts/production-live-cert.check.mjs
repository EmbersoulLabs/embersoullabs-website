/**
 * Production non-charging certification checks.
 * Does NOT complete any payment.
 * Run: node scripts/production-live-cert.check.mjs
 */
const base = "https://embersoullabs.com";
const results = {};
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

async function check(name, fn) {
  try {
    results[name] = await fn();
  } catch (e) {
    results[name] = { error: e.message };
  }
}

await check("home", async () => {
  const r = await fetch(base + "/");
  const t = await r.text();
  return {
    status: r.status,
    buy: t.includes("Buy AI Short Ad"),
    story: t.includes("Buy AI Story Ad"),
    monthly: t.includes("Buy Monthly Package"),
    oneTime: /One-time payment/i.test(t),
    enquire: t.includes("Enquire first"),
    revisions3: t.includes("Up to 3 revisions included"),
    no149: !t.includes("USD 149") && !t.includes("149/month"),
  };
});

await check("success_page", async () => {
  const r = await fetch(base + "/ai-ads/checkout/success/");
  const t = await r.text();
  return {
    status: r.status,
    hasVerifyCopy: t.includes("verifying your payment"),
    // Default H1 in HTML (before JS) must be verifying, not paid-only
    defaultTitleVerifying: t.includes("We're verifying your payment."),
  };
});

await check("cancel_page", async () => {
  const r = await fetch(base + "/ai-ads/checkout/cancel/");
  const t = await r.text();
  return {
    status: r.status,
    notCompleted: t.includes("Payment was not completed"),
    noOrder: t.includes("No order has been started"),
  };
});

await check("ai_ads", async () => {
  const r = await fetch(base + "/ai-ads/");
  return { status: r.status, ok: r.ok };
});

await check("checkout_get", async () => {
  const r = await fetch(base + "/api/checkout");
  const j = await r.json();
  return { status: r.status, readiness: j.readiness || null, ok: j.ok };
});

await check("checkout_invalid_service", async () => {
  const r = await fetch(base + "/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: "hack", region: "my" }),
  });
  const j = await r.json();
  return { status: r.status, ok: j.ok, code: j.code };
});

await check("checkout_invalid_region", async () => {
  const r = await fetch(base + "/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: "short", region: "jp" }),
  });
  const j = await r.json();
  return { status: r.status, ok: j.ok, code: j.code };
});

for (const field of ["amount", "currency", "price_id", "lookup_key"]) {
  await check("tamper_" + field, async () => {
    const body = { service: "short", region: "my" };
    body[field] = field === "amount" ? 1 : field === "currency" ? "USD" : "tampered";
    const r = await fetch(base + "/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    return { status: r.status, ok: j.ok, code: j.code };
  });
}

await check("checkout_short_my_session", async () => {
  const r = await fetch(base + "/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service: "short", region: "my" }),
  });
  const j = await r.json();
  return {
    status: r.status,
    ok: j.ok,
    code: j.code,
    hasUrl: !!(j.url && String(j.url).includes("checkout.stripe.com")),
    lookupKey: j.lookupKey || null,
    sessionIdPrefix: j.sessionId ? String(j.sessionId).slice(0, 10) : null,
    missing: j.missing || null,
    error: j.ok ? null : j.error,
  };
});

await check("session_arbitrary", async () => {
  const r = await fetch(
    base + "/api/checkout/session?session_id=cs_live_fakeArbitrarySession123456"
  );
  const j = await r.json();
  return {
    status: r.status,
    ok: j.ok,
    paid: j.paid === true,
    payment_state: j.payment_state || null,
    code: j.code || null,
  };
});

await check("webhook_unsigned", async () => {
  const r = await fetch(base + "/api/stripe-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "evt_test",
      type: "checkout.session.completed",
      data: { object: {} },
    }),
  });
  const j = await r.json();
  return { status: r.status, ok: j.ok, code: j.code };
});

await check("webhook_invalid_sig", async () => {
  const r = await fetch(base + "/api/stripe-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature":
        "t=1700000000,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    },
    body: JSON.stringify({
      id: "evt_test",
      type: "checkout.session.completed",
      data: { object: {} },
    }),
  });
  const j = await r.json();
  return { status: r.status, ok: j.ok, code: j.code };
});

await check("webhook_get", async () => {
  const r = await fetch(base + "/api/stripe-webhook");
  const j = await r.json();
  return {
    status: r.status,
    payment_events: j.payment_events,
    webhook_secret_configured: j.webhook_secret_configured,
    stripe_secret_configured: j.stripe_secret_configured,
    runtime_mode: j.runtime_mode,
    in_memory_production_fallback: j.in_memory_production_fallback,
  };
});

// Assertions
const h = results.home || {};
assert(h.status === 200 && h.buy && h.story && h.monthly, "homepage buy CTAs deployed");
assert(h.oneTime && h.enquire, "homepage one-time + enquire");
assert(h.revisions3 && h.no149, "revision policy + no USD149");

const s = results.success_page || {};
assert(s.status === 200 && s.hasVerifyCopy, "success page verifying copy");

const c = results.cancel_page || {};
assert(c.status === 200 && c.notCompleted && c.noOrder, "cancel page copy");

assert((results.ai_ads || {}).status === 200, "ai-ads page");

assert((results.checkout_invalid_service || {}).ok === false, "invalid service rejected");
assert((results.checkout_invalid_region || {}).ok === false, "invalid region rejected");
assert((results.tamper_amount || {}).code === "client_amount_rejected", "tamper amount");
assert((results.tamper_currency || {}).code === "client_amount_rejected", "tamper currency");
assert((results.tamper_price_id || {}).code === "client_amount_rejected", "tamper price_id");
assert((results.tamper_lookup_key || {}).code === "client_amount_rejected", "tamper lookup_key");

const sess = results.checkout_short_my_session || {};
assert(sess.ok === true && sess.hasUrl === true, "short+my creates Checkout Session URL");
assert(sess.lookupKey === "ai_short_ad_my", "short+my resolves ai_short_ad_my");
console.log("SESSION_CREATED_NO_PAYMENT=", sess.sessionIdPrefix);

const arb = results.session_arbitrary || {};
assert(arb.paid !== true && arb.ok !== true, "arbitrary session not paid");

const wu = results.webhook_unsigned || {};
assert(wu.ok === false && (wu.status === 400 || wu.status === 503), "unsigned webhook rejected");
const wi = results.webhook_invalid_sig || {};
assert(wi.ok === false && (wi.code === "bad_signature" || wi.status === 400 || wi.status === 503), "invalid signature rejected");

const wg = results.webhook_get || {};
assert(wg.webhook_secret_configured === true, "webhook secret present (bool only)");
assert(wg.stripe_secret_configured === true, "stripe secret present (bool only)");
assert(wg.payment_events === "kv", "PAYMENT_EVENTS KV available");
assert(wg.in_memory_production_fallback === false, "no in-memory production fallback");
assert(wg.runtime_mode === "production", "runtime mode production");

console.log("\n==== RAW ====");
console.log(JSON.stringify(results, null, 2));

if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nPRODUCTION LIVE CERT PASS");
console.log("REAL_PAYMENT_COMPLETED=NO");
