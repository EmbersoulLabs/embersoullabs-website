import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const login = readFileSync(join(root, "login/index.html"), "utf8");
assert(login.includes('params.get("next") || "/"'), "login defaults to the homepage");
assert(!login.includes('next = "/account/orders/"'), "login no longer defaults to the orders page");
const fnStart = login.indexOf("function allowedNext");
const fnEnd = login.indexOf("var next = allowedNext");
const allowedNext = runInContext(`${login.slice(fnStart, fnEnd)}\nallowedNext`, createContext({}));
assert(allowedNext(null) === "/", "missing next goes home");
assert(allowedNext("/account/orders/?session_id=cs_live_example&access_token=token").startsWith("/account/orders/?"), "checkout claim path stays allowed");
assert(allowedNext("//evil.example") === "/", "protocol-relative next is rejected");
assert(allowedNext("https://evil.example") === "/", "external next is rejected");
assert(allowedNext("/ai-ads/") === "/ai-ads/", "products path stays allowed");

const nav = readFileSync(join(root, "js/site-nav.js"), "utf8");
for (const label of ["Home", "Products & Services", "Login", "My Profile", "My Orders", "Order Tracking", "Logout"]) {
  assert(nav.includes(`label: "${label}"`), `menu includes ${label}`);
}
assert(nav.includes('aria-expanded') && nav.includes('"Escape"') && nav.includes("/api/auth/session"), "menu is keyboard accessible and session aware");
assert(nav.includes('label: "Light"') && nav.includes('label: "Dark"') && nav.includes('label: "Auto"'), "menu includes appearance choices");
assert(nav.includes("es-appearance") && nav.includes("prefers-color-scheme"), "appearance is saved and follows the system in auto");
assert(nav.includes('render(false)'), "private links wait for a confirmed session");
assert(nav.includes('window.location.href = "/"'), "logout returns to the homepage");

for (const page of [
  "account/index.html",
  "account/orders/index.html",
  "account/orders/_/index.html",
  "account/tracking/index.html",
  "js/order-copy.js"
]) {
  const text = readFileSync(join(root, page), "utf8");
  assert(!/SYNC_PENDING|EmberCore|embercore_sync/.test(text), `${page} does not show production sync`);
}

const profile = readFileSync(join(root, "account/index.html"), "utf8");
assert(profile.includes("Verified email") && profile.includes("Customer profile") && profile.includes("Account settings") && profile.includes("Logout"), "profile sections");
assert(profile.includes('id="signed-out"'), "profile logged-out state");

const orders = readFileSync(join(root, "account/orders/index.html"), "utf8");
assert(orders.includes("View order details") && orders.includes("Creative brief") && orders.includes("Loading your orders"), "order cards and states");
assert(orders.includes("access_token") && orders.includes("history.replaceState"), "checkout claim still strips the token");
assert(orders.includes('id="signed-out"'), "orders stay hidden until login");

const tracking = readFileSync(join(root, "account/tracking/index.html"), "utf8");
assert(tracking.includes("progress-track") && tracking.includes("nextText") && tracking.includes("Revisions remaining"), "tracking timeline");

const home = readFileSync(join(root, "index.html"), "utf8");
assert(home.includes("/js/site-nav.js") && home.includes("/js/pricing.js") && home.includes('id="menu-btn"'), "homepage keeps pricing and adds the menu");

const success = readFileSync(join(root, "ai-ads/checkout/success/index.html"), "utf8");
assert(
  success.includes("We're verifying your payment") && success.includes("Payment received") && success.includes("/api/orders/status"),
  "checkout confirmation is unchanged"
);
assert(success.includes("Complete Your Creative Brief"), "paid success page offers the brief");

const css = readFileSync(join(root, "css/style.css"), "utf8");
assert(css.includes("[hidden]") && css.includes("display: none !important"), "hidden cards stay hidden");
assert(home.includes("Request a Quote") && !home.includes("Enquire first"), "homepage quote CTA is one secondary action");
assert(!home.includes("Submit Inquiry"), "homepage no longer uses submit-inquiry wording");
assert((home.match(/data-checkout-service=/g) || []).length === 3, "homepage keeps three buy actions");
const products = readFileSync(join(root, "ai-ads/index.html"), "utf8");
assert((products.match(/data-checkout-service=/g) || []).length === 3, "product page has one buy action per package");
assert((products.match(/id="ai-ad-form"/g) || []).length === 1, "inquiry form is not duplicated");
assert(products.includes('id="inquiry"') && products.includes("Request a Quote"), "quote path sits with the packages");
assert(products.includes('id="packages"') && products.includes("Buy Now"), "standard buy path remains");
assert(!products.includes('id="ad_type"') && !products.includes("Selected Package"), "inquiry no longer requires a package");
assert(!products.includes('class="order-price-list"'), "inquiry does not repeat the price list");
assert(products.includes('name="inquiry_type"') && products.includes("agency_whitelabel"), "custom and agency inquiry types remain");
assert(success.includes('name="asset_links"') && success.includes('name="asset_status"'), "paid success brief collects photo links securely");
assert(success.includes("anyone with the link can view") && success.includes("Customer login"), "photo-link sharing + claim guidance");
const orderDetail = readFileSync(join(root, "account/orders/_/index.html"), "utf8");
assert(orderDetail.includes('name="asset_links"') && orderDetail.includes("Upload unavailable"), "portal order brief uses photo links");

const sandbox = createContext({ window: {} });
runInContext(readFileSync(join(root, "js/order-copy.js"), "utf8"), sandbox);
const copy = sandbox.window.EmberOrderCopy;
assert(copy.label("PAID") === "Payment received", "payment label");
assert(copy.label("complete") === "Brief received", "brief label");
assert(copy.stepIndex({ payment_status: "PAID", workflow_status: "IN_PRODUCTION" }) === 2, "production step");
assert(copy.nextText("submit_creative_brief").includes("Tell us"), "next action copy");
assert(!JSON.stringify(copy.steps).includes("SYNC"), "timeline has no sync step");

console.log("site-ux ok");
