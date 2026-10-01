/**
 * EmberSoul Labs — regional AI Ads pricing (single source of truth).
 * Fixed commercial prices per market — NOT live FX conversion.
 * Country detection: Cloudflare /cdn-cgi/trace (loc=XX). No GPS.
 *
 * Stripe: lookup keys are documented for future Checkout.
 * Never hardcode Stripe Price IDs here. Server must map
 * (service + region) → official Price ID when payments go live.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "embersoul_pricing_region";
  var SOURCE_KEY = "embersoul_pricing_source"; // "manual" | "auto"

  var REGIONS = {
    sg: {
      id: "sg",
      label_en: "Singapore — SGD",
      label_zh: "新加坡 — SGD",
      flag: "🇸🇬",
      currency: "SGD",
      regionName: "Singapore",
    },
    my: {
      id: "my",
      label_en: "Malaysia — MYR",
      label_zh: "马来西亚 — MYR",
      flag: "🇲🇾",
      currency: "MYR",
      regionName: "Malaysia",
    },
    intl: {
      id: "intl",
      label_en: "International — USD",
      label_zh: "国际 — USD",
      flag: "🌍",
      currency: "USD",
      regionName: "International",
    },
  };

  /**
   * Official fixed regional prices.
   * Monthly = one-time 30-day package (NOT automatic recurring subscription).
   */
  var PRICES = {
    my: {
      short: { amount: 69, display: "RM 69", billing: "one_time" },
      story: { amount: 189, display: "RM 189", billing: "one_time" },
      monthly: {
        amount: 499,
        display: "RM 499 / 30-day package",
        billing: "one_time_30_day",
      },
    },
    sg: {
      short: { amount: 29, display: "SGD 29", billing: "one_time" },
      story: { amount: 79, display: "SGD 79", billing: "one_time" },
      monthly: {
        amount: 199,
        display: "SGD 199 / 30-day package",
        billing: "one_time_30_day",
      },
    },
    intl: {
      short: { amount: 19, display: "USD 19", billing: "one_time" },
      story: { amount: 59, display: "USD 59", billing: "one_time" },
      monthly: {
        amount: 129,
        display: "USD 129 / 30-day package",
        billing: "one_time_30_day",
      },
    },
  };

  /**
   * Expected Stripe lookup_key convention (products created in Stripe separately).
   * DO NOT invent Price IDs (price_xxx). Fill priceId only when provided securely.
   */
  var STRIPE_LOOKUP_KEYS = {
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
  };

  var SERVICE_NAMES = {
    short: "AI Short Ad",
    story: "AI Story Ad",
    monthly: "Monthly AI Content",
    unsure: "Not sure yet",
  };

  function normalizeRegion(raw) {
    if (!raw) return null;
    var v = String(raw).toLowerCase().trim();
    if (v === "sg" || v === "singapore" || v === "sgd") return "sg";
    if (v === "my" || v === "malaysia" || v === "myr" || v === "rm") return "my";
    if (v === "intl" || v === "international" || v === "usd" || v === "us" || v === "world")
      return "intl";
    return null;
  }

  function countryToRegion(cc) {
    if (!cc) return "intl";
    var c = String(cc).toUpperCase();
    if (c === "SG") return "sg";
    if (c === "MY") return "my";
    return "intl";
  }

  function getManualRegion() {
    try {
      if (localStorage.getItem(SOURCE_KEY) === "manual") {
        return normalizeRegion(localStorage.getItem(STORAGE_KEY));
      }
    } catch (e) {}
    return null;
  }

  function setManualRegion(regionId) {
    var id = normalizeRegion(regionId) || "intl";
    try {
      localStorage.setItem(STORAGE_KEY, id);
      localStorage.setItem(SOURCE_KEY, "manual");
    } catch (e) {}
    return id;
  }

  function getQueryRegion() {
    try {
      var params = new URLSearchParams(window.location.search);
      return normalizeRegion(params.get("region"));
    } catch (e) {
      return null;
    }
  }

  function detectCountryCode() {
    return fetch("/cdn-cgi/trace", { credentials: "omit", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("trace unavailable");
        return res.text();
      })
      .then(function (text) {
        var match = text.match(/(?:^|\n)loc=([A-Z]{2})(?:\n|$)/i);
        return match ? match[1].toUpperCase() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function getPrice(regionId, offer) {
    var region = normalizeRegion(regionId) || "intl";
    var table = PRICES[region] || PRICES.intl;
    return table[offer] || null;
  }

  function getStripeLookupKey(offer, regionId) {
    var region = normalizeRegion(regionId) || "intl";
    var keys = STRIPE_LOOKUP_KEYS[offer];
    return keys ? keys[region] || null : null;
  }

  function applyPrices(regionId) {
    var id = normalizeRegion(regionId) || "intl";
    var meta = REGIONS[id];

    document.querySelectorAll("[data-price-offer]").forEach(function (el) {
      var offer = el.getAttribute("data-price-offer");
      var p = getPrice(id, offer);
      if (!p) return;
      el.textContent = p.display;
      el.setAttribute("data-currency", meta.currency);
      el.setAttribute("data-region", id);
      el.setAttribute("data-display-price", p.display);
      el.setAttribute("data-amount", String(p.amount));
      var lookup = getStripeLookupKey(offer, id);
      if (lookup) el.setAttribute("data-stripe-lookup-key", lookup);
    });

    document.querySelectorAll("[data-region-select]").forEach(function (sel) {
      if (sel.value !== id) sel.value = id;
    });

    document.querySelectorAll('a[href*="/ai-ads"]').forEach(function (a) {
      try {
        var url = new URL(a.getAttribute("href"), window.location.origin);
        url.searchParams.set("region", id);
        a.setAttribute("href", url.pathname + url.search + url.hash);
      } catch (e) {}
    });

    syncOrderForm(id);
    toggleMonthlyFields();

    document.documentElement.setAttribute("data-pricing-region", id);
    try {
      document.dispatchEvent(
        new CustomEvent("embersoul:pricing-region", { detail: { region: id } })
      );
    } catch (e) {}
  }

  function toggleMonthlyFields() {
    var typeSelect = document.getElementById("ad_type");
    var monthlyBlock = document.getElementById("monthly-format-block");
    if (!monthlyBlock) return;
    var isMonthly = typeSelect && typeSelect.value === "monthly";
    monthlyBlock.hidden = !isMonthly;
    var formatSelect = document.getElementById("monthly_content_format");
    if (formatSelect) {
      formatSelect.required = !!isMonthly;
      if (!isMonthly) formatSelect.value = "";
    }
    toggleStoryConcept();
  }

  function toggleStoryConcept() {
    var formatSelect = document.getElementById("monthly_content_format");
    var conceptBlock = document.getElementById("story-concept-block");
    if (!conceptBlock || !formatSelect) return;
    var show =
      formatSelect.value === "story_series" || formatSelect.value === "mix";
    conceptBlock.hidden = !show;
  }

  function syncOrderForm(regionId) {
    var form = document.getElementById("ai-ad-form");
    if (!form) return;
    var id = normalizeRegion(regionId) || "intl";
    var meta = REGIONS[id];
    var typeSelect = document.getElementById("ad_type");
    var offer = typeSelect && typeSelect.value ? typeSelect.value : "";
    var formatSelect = document.getElementById("monthly_content_format");

    var serviceName =
      SERVICE_NAMES[offer] || (offer ? String(offer) : "Not selected");
    var price = offer && offer !== "unsure" ? getPrice(id, offer) : null;
    var formatVal =
      offer === "monthly" && formatSelect && formatSelect.value
        ? formatSelect.value
        : "";

    setHidden(form, "selected_service", serviceName);
    setHidden(form, "pricing_region", meta.regionName);
    setHidden(form, "currency", meta.currency);
    setHidden(
      form,
      "displayed_price",
      price ? price.display : "N/A — help me decide"
    );
    setHidden(form, "monthly_content_format", formatVal || "n/a");
    setHidden(
      form,
      "stripe_lookup_key",
      offer && offer !== "unsure" ? getStripeLookupKey(offer, id) || "" : ""
    );
    // Explicitly do NOT submit client-authored payment amounts for checkout.
    // displayed_price is ops context only.

    var preview = document.getElementById("displayed-price-preview");
    if (preview) {
      if (price) {
        preview.textContent = price.display;
        preview.hidden = false;
      } else if (offer === "unsure") {
        preview.textContent =
          document.documentElement.getAttribute("data-lang") === "zh"
            ? "价格待确认"
            : "Price to be confirmed";
        preview.hidden = false;
      } else {
        preview.hidden = true;
      }
    }
  }

  function setHidden(form, name, value) {
    var input = form.querySelector('input[name="' + name + '"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      form.appendChild(input);
    }
    input.value = value;
  }

  function bindSelectors() {
    document.querySelectorAll("[data-region-select]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        applyPrices(setManualRegion(sel.value));
      });
    });
  }

  function bindFormType() {
    var typeSelect = document.getElementById("ad_type");
    if (typeSelect) {
      typeSelect.addEventListener("change", function () {
        var region =
          document.documentElement.getAttribute("data-pricing-region") || "intl";
        toggleMonthlyFields();
        syncOrderForm(region);
      });
    }
    var formatSelect = document.getElementById("monthly_content_format");
    if (formatSelect) {
      formatSelect.addEventListener("change", function () {
        toggleStoryConcept();
        var region =
          document.documentElement.getAttribute("data-pricing-region") || "intl";
        syncOrderForm(region);
      });
    }
    var form = document.getElementById("ai-ad-form");
    if (form) {
      form.addEventListener("submit", function () {
        var region =
          document.documentElement.getAttribute("data-pricing-region") || "intl";
        syncOrderForm(region);
      });
    }
  }

  function init() {
    bindSelectors();
    bindFormType();

    var queryRegion = getQueryRegion();
    if (queryRegion) {
      setManualRegion(queryRegion);
      applyPrices(queryRegion);
      return;
    }

    var manual = getManualRegion();
    if (manual) {
      applyPrices(manual);
      return;
    }

    applyPrices("intl");

    detectCountryCode().then(function (cc) {
      if (getManualRegion()) return;
      var region = countryToRegion(cc);
      applyPrices(region);
      try {
        if (localStorage.getItem(SOURCE_KEY) !== "manual") {
          localStorage.setItem(STORAGE_KEY, region);
          localStorage.setItem(SOURCE_KEY, "auto");
        }
      } catch (e) {}
    });
  }

  global.EmberSoulPricing = {
    REGIONS: REGIONS,
    PRICES: PRICES,
    STRIPE_LOOKUP_KEYS: STRIPE_LOOKUP_KEYS,
    applyPrices: applyPrices,
    setManualRegion: setManualRegion,
    getManualRegion: getManualRegion,
    countryToRegion: countryToRegion,
    getPrice: getPrice,
    getStripeLookupKey: getStripeLookupKey,
    detectCountryCode: detectCountryCode,
    STORAGE_KEY: STORAGE_KEY,
    /** Future Checkout must resolve Price ID server-side from lookup key. */
    STRIPE_INTEGRATION_STATUS: "test_checkout_prepared_catalog_missing",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : this);
