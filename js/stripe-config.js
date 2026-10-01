/**
 * Stripe Checkout client boundary.
 * Sends ONLY { service, region }. Never amounts / price IDs / lookup keys.
 *
 * Live catalog certified. checkoutEnabled=true locally — requires Pages Function
 * env STRIPE_SECRET_KEY before sessions can be created.
 */
window.EmberSoulStripe = {
  mode: "live",
  checkoutEnabled: true,
  checkoutEndpoint: "/api/checkout",
  sessionStatusEndpoint: "/api/checkout/session",
  recurringBillingEnabled: false,
  clientMaySubmitAmount: false,
  lookupKeys: {
    short: {
      my: "ai_short_ad_my",
      sg: "ai_short_ad_sg",
      intl: "ai_short_ad_intl",
    },
    story: {
      my: "ai_story_ad_my",
      sg: "ai_story_ad_sg",
      intl: "ai_story_ad_intl",
    },
    monthly: {
      my: "monthly_ai_content_my",
      sg: "monthly_ai_content_sg",
      intl: "monthly_ai_content_intl",
    },
  },
  priceIds: {},
  routes: {
    success: "/ai-ads/checkout/success/",
    cancel: "/ai-ads/checkout/cancel/",
    webhook: "/api/stripe-webhook",
  },
  catalogStatus: {
    lastAudit: "live_rk_2026-10-01_recheck",
    account: "acct_1TlBCeH5ZiMpbPaM",
    allLookupKeysOk: true,
    okLookupKeys: [
      "ai_short_ad_my",
      "ai_short_ad_sg",
      "ai_short_ad_intl",
      "ai_story_ad_my",
      "ai_story_ad_sg",
      "ai_story_ad_intl",
      "monthly_ai_content_my",
      "monthly_ai_content_sg",
      "monthly_ai_content_intl",
    ],
    mismatchLookupKeys: [],
    missingLookupKeys: [],
  },
  requiredBeforeCheckout: [
    "PRODUCTION REQUIRED: STRIPE_SECRET_KEY",
    "PRODUCTION REQUIRED: STRIPE_WEBHOOK_SECRET",
    "PRODUCTION REQUIRED: SITE_ORIGIN=https://embersoullabs.com",
    "PRODUCTION REQUIRED: PAYMENT_EVENTS KV binding",
    "No in-memory idempotency in production",
    "EmberOS production remains disconnected",
  ],

  getActiveRegion: function () {
    var el = document.documentElement.getAttribute("data-pricing-region");
    if (el === "my" || el === "sg" || el === "intl") return el;
    try {
      if (localStorage.getItem("embersoul_pricing_source") === "manual") {
        var stored = localStorage.getItem("embersoul_pricing_region");
        if (stored === "my" || stored === "sg" || stored === "intl") return stored;
      }
    } catch (e) {}
    return "intl";
  },

  startCheckout: async function (service, region) {
    if (!this.checkoutEnabled) {
      return { ok: false, code: "checkout_disabled", error: "Checkout is disabled" };
    }
    var allowedService = { short: 1, story: 1, monthly: 1 };
    var allowedRegion = { my: 1, sg: 1, intl: 1 };
    if (!allowedService[service] || !allowedRegion[region]) {
      return { ok: false, code: "invalid_input", error: "Invalid service or region" };
    }
    try {
      var res = await fetch(this.checkoutEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: service, region: region }),
      });
      var data = await res.json();
      if (!data.ok || !data.url) {
        return {
          ok: false,
          code: data.code || "checkout_failed",
          error: data.error || "Checkout unavailable",
        };
      }
      return { ok: true, url: data.url, sessionId: data.sessionId };
    } catch (e) {
      return {
        ok: false,
        code: "network_error",
        error: "Unable to reach checkout endpoint. Is the Pages Function env configured?",
      };
    }
  },

  redirectToCheckout: async function (service, region, buttonEl) {
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.setAttribute("aria-busy", "true");
    }
    var result = await this.startCheckout(service, region || this.getActiveRegion());
    if (result.ok && result.url) {
      window.location.href = result.url;
      return result;
    }
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.removeAttribute("aria-busy");
    }
    var msg =
      (result && result.error) ||
      "Checkout is temporarily unavailable. Please use the enquiry form or email support@embersoullabs.com.";
    window.alert(msg);
    return result;
  },
};

document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-checkout-service]");
  if (!btn) return;
  ev.preventDefault();
  if (!window.EmberSoulStripe || !window.EmberSoulStripe.checkoutEnabled) return;
  var service = btn.getAttribute("data-checkout-service");
  var region =
    btn.getAttribute("data-checkout-region") ||
    window.EmberSoulStripe.getActiveRegion();
  window.EmberSoulStripe.redirectToCheckout(service, region, btn);
});
