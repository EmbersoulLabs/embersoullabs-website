/**
 * Consent-gated measurement. Event delivery stays off until real Google IDs
 * are configured and the visitor allows analytics or advertising storage.
 * Hits never include name, email, phone, access tokens, or checkout session ids.
 */
(function (global) {
  var CLICK_KEY = "esl-click-v1";
  var CONSENT_KEY = "esl-consent-v1";
  var SENT_PREFIX = "esl-measured-v1:";
  var MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
  var CLICK_ID = /^[A-Za-z0-9._-]{1,150}$/;
  var ORDER_ID = /^ord_[A-Za-z0-9_-]{8,80}$/;
  var INQUIRY_ID = /^inq_[A-Za-z0-9_-]{8,80}$/;
  var CURRENCIES = { MYR: 1, SGD: 1, USD: 1 };
  var configPromise = null;

  function sanitizeClickId(value) {
    if (typeof value !== "string") return null;
    var trimmed = value.trim();
    return CLICK_ID.test(trimmed) ? trimmed : null;
  }

  function storageGet(key) {
    try { return global.localStorage.getItem(key); } catch (err) { return null; }
  }

  function storageSet(key, value) {
    try { global.localStorage.setItem(key, value); } catch (err) {}
  }

  function captureClickIds(search) {
    var params;
    try { params = new URLSearchParams(search || ""); } catch (err) { return readClicks(); }
    var next = readClicks() || {};
    var found = false;
    ["gclid", "gbraid", "wbraid"].forEach(function (key) {
      var clean = sanitizeClickId(params.get(key));
      if (clean) {
        next[key] = clean;
        found = true;
      }
    });
    if (!found && readClicks()) return readClicks();
    if (!next.gclid && !next.gbraid && !next.wbraid) return null;
    next.stored_at = Date.now();
    storageSet(CLICK_KEY, JSON.stringify(next));
    return readClicks();
  }

  function readClicks() {
    var raw = storageGet(CLICK_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.stored_at !== "number") return null;
      if (Date.now() - parsed.stored_at > MAX_AGE_MS) return null;
      var out = { stored_at: parsed.stored_at };
      ["gclid", "gbraid", "wbraid"].forEach(function (key) {
        var clean = sanitizeClickId(parsed[key]);
        if (clean) out[key] = clean;
      });
      if (!out.gclid && !out.gbraid && !out.wbraid) return null;
      return out;
    } catch (err) {
      return null;
    }
  }

  function readConsent() {
    var raw = storageGet(CONSENT_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) return null;
      return {
        v: 1,
        analytics: parsed.analytics === true,
        ads: parsed.ads === true,
      };
    } catch (err) {
      return null;
    }
  }

  function writeConsent(choice) {
    var stored = {
      v: 1,
      analytics: !!(choice && choice.analytics),
      ads: !!(choice && choice.ads),
      updated_at: new Date().toISOString(),
    };
    storageSet(CONSENT_KEY, JSON.stringify(stored));
    try {
      var secure = global.location && global.location.protocol === "https:" ? "; Secure" : "";
      global.document.cookie =
        "esl_consent=v1." + (stored.analytics ? "1" : "0") + "." + (stored.ads ? "1" : "0") +
        "; Path=/; Max-Age=15552000; SameSite=Lax" + secure;
    } catch (err) {}
    return readConsent();
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/analytics/config", { credentials: "omit", cache: "no-store" })
        .then(function (response) { return response.ok ? response.json() : { delivery: "disabled" }; })
        .catch(function () { return { delivery: "disabled" }; });
    }
    return configPromise;
  }

  function canDeliver(config, consent) {
    if (!config || config.delivery !== "consent_required" || !consent) return false;
    var ga4 = consent.analytics === true && !!config.ga4;
    var ads = consent.ads === true && !!config.ads;
    return ga4 || ads;
  }

  function alreadySent(id) {
    return storageGet(SENT_PREFIX + id) === "1";
  }

  function markSent(id) {
    storageSet(SENT_PREFIX + id, "1");
  }

  function pageLocation(origin, pathname, gclid) {
    var base = String(origin || "") + String(pathname || "/");
    var click = sanitizeClickId(gclid);
    return click ? base + "?gclid=" + encodeURIComponent(click) : base;
  }

  function purchaseHit(claim, config, consent, page) {
    if (!canDeliver(config, consent)) return { deliver: false, reason: "disabled" };
    if (!claim || claim.emit !== true) return { deliver: false, reason: "not_emitted" };
    if (!ORDER_ID.test(claim.transaction_id || "")) return { deliver: false, reason: "transaction_id" };
    if (!CURRENCIES[claim.currency] || typeof claim.value !== "number" || !isFinite(claim.value) || claim.value <= 0) {
      return { deliver: false, reason: "value" };
    }
    if (alreadySent(claim.transaction_id)) return { deliver: false, reason: "duplicate" };
    var calls = [];
    var location = pageLocation(page && page.origin, page && page.pathname, claim.gclid);
    if (location.indexOf("access_token") !== -1 || location.indexOf("session_id") !== -1) {
      return { deliver: false, reason: "unsafe_location" };
    }
    calls.push(["set", { page_location: location }]);
    if (consent.analytics && config.ga4) {
      calls.push(["event", "purchase", {
        transaction_id: claim.transaction_id,
        value: claim.value,
        currency: claim.currency,
        send_to: config.ga4,
      }]);
    }
    if (consent.ads && config.purchase_send_to) {
      calls.push(["event", "conversion", {
        transaction_id: claim.transaction_id,
        value: claim.value,
        currency: claim.currency,
        send_to: config.purchase_send_to,
      }]);
    }
    if (calls.length === 1) return { deliver: false, reason: "no_destination" };
    return { deliver: true, calls: calls, page_location: location };
  }

  function inquiryHit(claim, config, consent, page) {
    if (!canDeliver(config, consent)) return { deliver: false, reason: "disabled" };
    if (!claim || claim.emit !== true) return { deliver: false, reason: "not_emitted" };
    if (!INQUIRY_ID.test(claim.transaction_id || "")) return { deliver: false, reason: "transaction_id" };
    if (alreadySent(claim.transaction_id)) return { deliver: false, reason: "duplicate" };
    var calls = [];
    var location = pageLocation(page && page.origin, page && page.pathname, page && page.gclid);
    if (location.indexOf("access_token") !== -1 || location.indexOf("session_id") !== -1) {
      return { deliver: false, reason: "unsafe_location" };
    }
    calls.push(["set", { page_location: location }]);
    if (consent.analytics && config.ga4) {
      calls.push(["event", "generate_lead", {
        transaction_id: claim.transaction_id,
        send_to: config.ga4,
      }]);
    }
    if (consent.ads && config.inquiry_send_to) {
      calls.push(["event", "conversion", {
        transaction_id: claim.transaction_id,
        send_to: config.inquiry_send_to,
      }]);
    }
    if (calls.length === 1) return { deliver: false, reason: "no_destination" };
    return { deliver: true, calls: calls, page_location: location };
  }

  function ensureStyle() {
    if (global.document.getElementById("esl-consent-style")) return;
    var style = global.document.createElement("style");
    style.id = "esl-consent-style";
    style.textContent =
      ".esl-consent{position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:80;max-width:40rem;margin:0 auto;background:var(--bg,#fff);color:var(--text,#122);border:1px solid var(--border,#d5dbe6);border-radius:16px;box-shadow:0 12px 40px rgba(16,24,40,.16);padding:1rem 1.1rem}" +
      ".esl-consent p{margin:.35rem 0 .8rem;font-size:.92rem;line-height:1.45}" +
      ".esl-consent-actions,.esl-consent-choices{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}" +
      ".esl-consent button,.esl-consent-link{font:inherit;border-radius:999px;border:1px solid var(--border,#d5dbe6);background:transparent;color:inherit;padding:.45rem .8rem;cursor:pointer}" +
      ".esl-consent button:focus-visible,.esl-consent-link:focus-visible{outline:2px solid var(--focus-ring,#1f6feb);outline-offset:2px}" +
      ".esl-consent-primary{background:var(--accent,#0f6);color:#062;border-color:transparent}" +
      ".esl-consent-backdrop{position:fixed;inset:0;z-index:90;background:rgba(8,12,20,.45);display:flex;align-items:flex-end;justify-content:center;padding:1rem}" +
      ".esl-consent-dialog{width:min(36rem,100%);background:var(--bg,#fff);color:var(--text,#122);border-radius:16px;padding:1rem 1.1rem 1.2rem}" +
      "@media (prefers-reduced-motion: reduce){.esl-consent,.esl-consent-backdrop{scroll-behavior:auto}}";
    global.document.head.appendChild(style);
  }

  function field(labelEn, labelZh, name, checked) {
    var wrap = global.document.createElement("label");
    wrap.className = "esl-consent-choices";
    var input = global.document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.checked = !!checked;
    var text = global.document.createElement("span");
    text.innerHTML = '<span class="lang-en"></span><span class="lang-zh"></span>';
    text.querySelector(".lang-en").textContent = labelEn;
    text.querySelector(".lang-zh").textContent = labelZh;
    wrap.appendChild(input);
    wrap.appendChild(text);
    return wrap;
  }

  function openDialog() {
    ensureStyle();
    var current = readConsent() || { analytics: false, ads: false };
    var backdrop = global.document.createElement("div");
    backdrop.className = "esl-consent-backdrop";
    var dialog = global.document.createElement("div");
    dialog.className = "esl-consent-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "esl-consent-title");
    dialog.innerHTML =
      '<h2 id="esl-consent-title"><span class="lang-en">Cookie preferences</span><span class="lang-zh">Cookie 偏好</span></h2>' +
      '<p><span class="lang-en">Essential cookies remember language, appearance, and pricing region. Analytics and advertising stay off until you allow them.</span>' +
      '<span class="lang-zh">必要 Cookie 只记住语言、外观和报价地区。在你允许之前，分析和广告保持关闭。</span></p>';
    var analytics = field("Allow analytics (Google Analytics 4, when configured)", "允许分析（配置后使用 Google Analytics 4）", "analytics", current.analytics);
    var ads = field("Allow advertising measurement (Google Ads, when configured)", "允许广告衡量（配置后使用 Google Ads）", "ads", current.ads);
    dialog.appendChild(analytics);
    dialog.appendChild(ads);
    var actions = global.document.createElement("div");
    actions.className = "esl-consent-actions";
    var save = global.document.createElement("button");
    save.type = "button";
    save.className = "esl-consent-primary";
    save.innerHTML = '<span class="lang-en">Save preferences</span><span class="lang-zh">保存偏好</span>';
    var cancel = global.document.createElement("button");
    cancel.type = "button";
    cancel.innerHTML = '<span class="lang-en">Cancel</span><span class="lang-zh">取消</span>';
    actions.appendChild(save);
    actions.appendChild(cancel);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    global.document.body.appendChild(backdrop);
    save.focus();
    function close() { backdrop.remove(); }
    cancel.addEventListener("click", close);
    backdrop.addEventListener("click", function (event) { if (event.target === backdrop) close(); });
    backdrop.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });
    save.addEventListener("click", function () {
      writeConsent({
        analytics: analytics.querySelector("input").checked,
        ads: ads.querySelector("input").checked,
      });
      close();
      var banner = global.document.getElementById("esl-consent-banner");
      if (banner) banner.remove();
    });
  }

  function showBanner() {
    if (readConsent() || global.document.getElementById("esl-consent-banner")) return;
    ensureStyle();
    var banner = global.document.createElement("div");
    banner.id = "esl-consent-banner";
    banner.className = "esl-consent";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Cookie preferences");
    banner.innerHTML =
      '<p><span class="lang-en">We use essential storage for language, appearance, and pricing. Analytics and advertising measurement stay off unless you allow them.</span>' +
      '<span class="lang-zh">我们只用必要存储记住语言、外观和报价。除非你允许，分析和广告衡量保持关闭。</span></p>';
    var actions = global.document.createElement("div");
    actions.className = "esl-consent-actions";
    function button(className, en, zh, choice) {
      var el = global.document.createElement("button");
      el.type = "button";
      el.className = className;
      el.innerHTML = '<span class="lang-en"></span><span class="lang-zh"></span>';
      el.querySelector(".lang-en").textContent = en;
      el.querySelector(".lang-zh").textContent = zh;
      el.addEventListener("click", function () {
        if (choice) writeConsent(choice);
        else openDialog();
        if (choice) banner.remove();
      });
      return el;
    }
    actions.appendChild(button("esl-consent-primary", "Allow analytics and ads", "允许分析和广告", { analytics: true, ads: true }));
    actions.appendChild(button("", "Reject non-essential", "拒绝非必要", { analytics: false, ads: false }));
    actions.appendChild(button("", "Customize", "自定义", null));
    banner.appendChild(actions);
    global.document.body.appendChild(banner);
  }

  function showPreferencesLink() {
    var footer = global.document.querySelector(".footer-links");
    if (!footer || footer.querySelector("[data-cookie-preferences]")) return;
    var link = global.document.createElement("button");
    link.type = "button";
    link.className = "esl-consent-link";
    link.setAttribute("data-cookie-preferences", "true");
    link.innerHTML = '<span class="lang-en">Cookie preferences</span><span class="lang-zh">Cookie 偏好</span>';
    link.addEventListener("click", openDialog);
    footer.appendChild(link);
    ensureStyle();
  }

  function loadGoogle(config, consent) {
    if (global.__eslGtagLoaded || !canDeliver(config, consent)) return;
    var id = (consent.analytics && config.ga4) || (consent.ads && config.ads);
    if (!id) return;
    global.dataLayer = global.dataLayer || [];
    global.gtag = global.gtag || function () { global.dataLayer.push(arguments); };
    global.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      wait_for_update: 500,
    });
    global.gtag("js", new Date());
    var script = global.document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    global.document.head.appendChild(script);
    if (consent.analytics && config.ga4) {
      global.gtag("config", config.ga4, { send_page_view: true, allow_google_signals: false, allow_enhanced_conversions: false });
    }
    if (consent.ads && config.ads) {
      global.gtag("config", config.ads, { allow_enhanced_conversions: false });
    }
    global.gtag("consent", "update", {
      analytics_storage: consent.analytics ? "granted" : "denied",
      ad_storage: consent.ads ? "granted" : "denied",
      ad_user_data: consent.ads ? "granted" : "denied",
      ad_personalization: "denied",
    });
    global.__eslGtagLoaded = true;
  }

  function postPhase(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) { return response.json(); });
  }

  function dispatch(hit) {
    return new Promise(function (resolve) {
      if (!hit || !hit.deliver || !global.gtag) {
        resolve(false);
        return;
      }
      var pending = 0;
      var settled = false;
      function finish(acknowledged) {
        if (settled) return;
        settled = true;
        resolve(acknowledged === true);
      }
      var timer = setTimeout(function () { finish(false); }, 1500);
      hit.calls.forEach(function (call) {
        if (call[0] !== "event") {
          global.gtag.apply(null, call);
          return;
        }
        pending += 1;
        var params = {};
        var source = call[2] || {};
        Object.keys(source).forEach(function (key) { params[key] = source[key]; });
        params.event_callback = function () {
          pending -= 1;
          if (pending === 0) {
            clearTimeout(timer);
            finish(true);
          }
        };
        global.gtag(call[0], call[1], params);
      });
      if (pending === 0) {
        clearTimeout(timer);
        finish(false);
      }
    });
  }

  function deliverHit(url, identity, hit, transactionId) {
    if (!hit.deliver) return Promise.resolve(hit);
    return postPhase(url, Object.assign({ phase: "attempt" }, identity)).then(function () {
      return dispatch(hit);
    }).then(function (acknowledged) {
      if (!acknowledged) return Object.assign({}, hit, { acknowledged: false });
      return postPhase(url, Object.assign({ phase: "acknowledge" }, identity)).then(function () {
        markSent(transactionId);
        return Object.assign({}, hit, { acknowledged: true });
      });
    });
  }

  function maybePurchase(input) {
    var sessionId = input && input.sessionId;
    var accessToken = input && input.accessToken;
    if (!sessionId || !accessToken) return Promise.resolve({ deliver: false, reason: "missing_order" });
    return loadConfig().then(function (config) {
      var consent = readConsent();
      if (!canDeliver(config, consent)) return { deliver: false, reason: "disabled" };
      var identity = { session_id: sessionId, access_token: accessToken };
      return postPhase("/api/measurement/purchase", Object.assign({ phase: "reserve" }, identity)).then(function (claim) {
        loadGoogle(config, consent);
        var hit = purchaseHit(claim, config, consent, {
          origin: global.location.origin,
          pathname: global.location.pathname,
        });
        return deliverHit("/api/measurement/purchase", identity, hit, claim.transaction_id);
      });
    });
  }

  function maybeInquiry(inquiryId) {
    return loadConfig().then(function (config) {
      var consent = readConsent();
      if (!canDeliver(config, consent)) return { deliver: false, reason: "disabled" };
      var identity = { inquiry_id: inquiryId };
      return postPhase("/api/measurement/inquiry", Object.assign({ phase: "reserve" }, identity)).then(function (claim) {
        loadGoogle(config, consent);
        var hit = inquiryHit(claim, config, consent, {
          origin: global.location.origin,
          pathname: global.location.pathname,
          gclid: (readClicks() || {}).gclid || null,
        });
        return deliverHit("/api/measurement/inquiry", identity, hit, claim.transaction_id);
      });
    });
  }

  function start() {
    if (!global.document || !global.document.body) return;
    captureClickIds(global.location && global.location.search);
    showPreferencesLink();
    showBanner();
    loadConfig().then(function (config) { loadGoogle(config, readConsent()); });
  }

  global.EmberSoulMeasure = {
    captureClickIds: captureClickIds,
    readClicks: readClicks,
    readConsent: readConsent,
    writeConsent: writeConsent,
    canDeliver: canDeliver,
    purchaseHit: purchaseHit,
    inquiryHit: inquiryHit,
    pageLocation: pageLocation,
    maybePurchase: maybePurchase,
    maybeInquiry: maybeInquiry,
    start: start,
  };
})(window);
