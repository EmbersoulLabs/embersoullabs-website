(function () {
  var APPEARANCE_KEY = "es-appearance";
  var appearanceMedia = window.matchMedia("(prefers-color-scheme: dark)");
  function readAppearance() {
    try {
      var saved = localStorage.getItem(APPEARANCE_KEY);
      if (saved === "light" || saved === "dark" || saved === "auto") return saved;
    } catch (err) {}
    return "light";
  }
  function resolveTheme(pref) {
    if (pref === "auto") return appearanceMedia.matches ? "dark" : "light";
    return pref === "dark" ? "dark" : "light";
  }
  function applyAppearance(pref, persist) {
    var choice = pref === "dark" || pref === "auto" ? pref : "light";
    var theme = resolveTheme(choice);
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-appearance", choice);
    document.documentElement.style.colorScheme = theme;
    if (persist) {
      try { localStorage.setItem(APPEARANCE_KEY, choice); } catch (err) {}
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-appearance-option]"), function (button) {
      button.setAttribute("aria-checked", button.getAttribute("data-appearance-option") === choice ? "true" : "false");
    });
  }
  function pathOnly() {
    return window.location.pathname.replace(/\/index\.html$/, "") || "/";
  }

  function isCurrent(href) {
    var path = pathOnly();
    if (href === "/") return path === "/";
    if (href === "/account/") return path === "/account" || path === "/account/";
    if (href === "/account/orders/") return path === "/account/orders" || path === "/account/orders/";
    if (href === "/account/tracking/") {
      return path.indexOf("/account/tracking") === 0 || /\/account\/orders\/ord_/.test(path);
    }
    if (href === "/ai-ads/") return path.indexOf("/ai-ads") === 0;
    if (href === "/login/") return path.indexOf("/login") === 0;
    return path === href;
  }

  function items(loggedIn) {
    if (!loggedIn) {
      return [
        { href: "/", label: "Home" },
        { href: "/ai-ads/", label: "Products & Services" },
        { href: "/login/", label: "Login" }
      ];
    }
    return [
      { href: "/", label: "Home" },
      { href: "/ai-ads/", label: "Products & Services" },
      { href: "/account/", label: "My Profile" },
      { href: "/account/orders/", label: "My Orders" },
      { href: "/account/tracking/", label: "Order Tracking" },
      { action: "logout", label: "Logout" }
    ];
  }

  function setup(header) {
    var inner = header.querySelector(".header-inner");
    if (!inner || header.querySelector("[data-customer-panel]")) return;
    var button = header.querySelector("#menu-btn") || header.querySelector("[data-customer-menu]");
    if (!button) {
      button = document.createElement("button");
      button.className = "menu-btn";
      inner.appendChild(button);
    }
    button.setAttribute("data-customer-menu", "");
    button.type = "button";
    button.setAttribute("aria-label", "Open menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "customer-nav");
    button.innerHTML = '<span aria-hidden="true">☰</span><span class="visually-hidden">Menu</span>';
    var panel = document.createElement("nav");
    panel.id = "customer-nav";
    panel.className = "customer-nav";
    panel.setAttribute("data-customer-panel", "");
    panel.setAttribute("aria-label", "Site menu");
    panel.hidden = true;
    inner.appendChild(panel);

    function closeMenu() {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open menu");
    }

    function openMenu() {
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      button.setAttribute("aria-label", "Close menu");
      var first = panel.querySelector("a, button");
      if (first) first.focus();
    }

    var signedIn = false;
    var compact = window.matchMedia("(max-width: 768px)");

    function pageLinks() {
      if (!compact.matches) return [];
      var nav = header.querySelector("#main-nav");
      if (!nav) return [];
      return Array.prototype.map.call(nav.querySelectorAll("a"), function (anchor) {
        var english = anchor.querySelector(".lang-en");
        return {
          href: anchor.getAttribute("href"),
          label: (english ? english.textContent : anchor.textContent).replace(/\s+/g, " ").trim()
        };
      }).filter(function (item) { return item.href && item.label; });
    }

    function render(loggedIn) {
      signedIn = loggedIn;
      var wasOpen = !panel.hidden;
      panel.replaceChildren();
      items(loggedIn).forEach(function (item) {
        if (item.action === "logout") {
          var logout = document.createElement("button");
          logout.type = "button";
          logout.textContent = item.label;
          logout.addEventListener("click", function () {
            fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(function () {
              window.location.href = "/";
            });
          });
          panel.appendChild(logout);
          return;
        }
        var link = document.createElement("a");
        link.href = item.href;
        link.textContent = item.label;
        if (isCurrent(item.href)) link.setAttribute("aria-current", "page");
        link.addEventListener("click", closeMenu);
        panel.appendChild(link);
      });
      var extra = pageLinks();
      if (extra.length) {
        var group = document.createElement("div");
        group.className = "customer-nav-extra";
        extra.forEach(function (item) {
          var link = document.createElement("a");
          link.href = item.href;
          link.textContent = item.label;
          link.addEventListener("click", closeMenu);
          group.appendChild(link);
        });
        panel.appendChild(group);
      }

      var appearance = document.createElement("div");
      appearance.className = "appearance";
      appearance.setAttribute("role", "radiogroup");
      appearance.setAttribute("aria-label", "Appearance");
      var caption = document.createElement("p");
      caption.className = "appearance-label";
      caption.id = "appearance-label";
      caption.textContent = "Appearance";
      appearance.setAttribute("aria-labelledby", "appearance-label");
      appearance.appendChild(caption);
      [
        { value: "light", icon: "\u2600\uFE0F", label: "Light" },
        { value: "dark", icon: "\uD83C\uDF19", label: "Dark" },
        { value: "auto", icon: "\uD83D\uDCBB", label: "Auto" }
      ].forEach(function (option) {
        var choice = document.createElement("button");
        choice.type = "button";
        choice.setAttribute("role", "radio");
        choice.setAttribute("data-appearance-option", option.value);
        choice.setAttribute("aria-checked", "false");
        var icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = option.icon + " ";
        choice.appendChild(icon);
        choice.appendChild(document.createTextNode(option.label));
        choice.addEventListener("click", function () { applyAppearance(option.value, true); });
        appearance.appendChild(choice);
      });
      panel.appendChild(appearance);
      applyAppearance(readAppearance(), false);
      if (!wasOpen) panel.hidden = true;
    }

    render(false);
    button.addEventListener("click", function () {
      if (panel.hidden) openMenu();
      else closeMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) {
        closeMenu();
        button.focus();
      }
      if (panel.hidden || !panel.contains(document.activeElement)) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      var focusable = Array.prototype.slice.call(panel.querySelectorAll("a, button"));
      var index = focusable.indexOf(document.activeElement);
      if (index === -1) return;
      event.preventDefault();
      var next = event.key === "ArrowDown" ? index + 1 : index - 1;
      if (next < 0) next = focusable.length - 1;
      if (next >= focusable.length) next = 0;
      focusable[next].focus();
    });
    document.addEventListener("click", function (event) {
      if (panel.hidden || header.contains(event.target)) return;
      closeMenu();
    });
    if (compact.addEventListener) compact.addEventListener("change", function () { render(signedIn); });
    if (appearanceMedia.addEventListener) appearanceMedia.addEventListener("change", function () { if (readAppearance() === "auto") applyAppearance("auto", false); });
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) { render(!!(data && data.ok)); })
      .catch(function () { render(false); });
  }

  document.querySelectorAll(".site-header").forEach(setup);
  var measure = document.createElement("script");
  measure.src = "/js/measurement.js?v=20261012d";
  measure.defer = true;
  measure.onload = function () {
    if (window.EmberSoulMeasure) window.EmberSoulMeasure.start();
  };
  document.head.appendChild(measure);
})();
