/**
 * Purchase vs inquiry path separation checks (no network, no real payments).
 * Run: node scripts/purchase-inquiry.check.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const aiAds = readFileSync(join(root, "ai-ads/index.html"), "utf8");
const home = readFileSync(join(root, "index.html"), "utf8");
const success = readFileSync(join(root, "ai-ads/checkout/success/index.html"), "utf8");
const pricing = readFileSync(join(root, "js/pricing.js"), "utf8");
const stripe = readFileSync(join(root, "js/stripe-config.js"), "utf8");
const briefApi = readFileSync(join(root, "functions/api/orders/brief.js"), "utf8");
const orderAccess = readFileSync(join(root, "functions/_shared/order-access.js"), "utf8");
const webhook = readFileSync(join(root, "functions/api/stripe-webhook.js"), "utf8");

assert((aiAds.match(/data-checkout-service=/g) || []).length === 3, "three Buy Now actions");
assert(aiAds.includes("Request a Quote") && aiAds.includes("Path A") && aiAds.includes("Path B"), "paths separated");
assert(aiAds.includes("purchase-desc") && aiAds.includes("7–10s vertical") && aiAds.includes("EP01→EP04"), "package cards include explanations");
assert(!aiAds.includes('id="ad_type"'), "no required package select in inquiry");
assert(!aiAds.includes('class="order-price-list"'), "no duplicated price list in inquiry");
assert(!aiAds.includes("Selected Package"), "no package fieldset in inquiry");
assert(aiAds.includes('name="inquiry_type"') && aiAds.includes("agency_whitelabel"), "custom + agency inquiry");
assert(aiAds.includes("agree_privacy") && aiAds.includes("product_brief"), "privacy + product essentials");
assert(aiAds.includes('name="inquiry_path"') && aiAds.includes("custom_quote"), "inquiry marked as quote path");
assert(aiAds.includes("portfolio_reference") && aiAds.includes("preferred_style"), "portfolio metadata preserved");
assert((aiAds.match(/data-price-offer="/g) || []).length === 3, "prices appear once in package cards only");

assert(home.includes("Request a Quote") && home.includes('href="/ai-ads/#inquiry"'), "home quote CTA");
assert(home.includes('ref=agency-whitelabel') && home.includes("#inquiry"), "agency CTA to inquiry");

assert(pricing.includes("N/A — quote request"), "pricing sync clears displayed package price");
assert(pricing.includes('setHidden(form, "stripe_lookup_key", "")'), "inquiry does not send lookup keys");
assert(!pricing.includes("toggleMonthlyFields"), "monthly package UI removed from inquiry sync");

assert(stripe.includes("checkoutEnabled: true") && stripe.includes('clientMaySubmitAmount: false'), "checkout boundary intact");
assert(success.includes("access_token") && success.includes("/api/orders/status"), "success is token-gated");
assert(success.includes("/api/orders/brief") && success.includes('name="asset_links"'), "paid intake + photo links");
assert(!success.includes("File upload is not available yet, so a written brief is all we need."), "stale upload-only copy removed");
assert(briefApi.includes("access_token") && orderAccess.includes("readAuthorizedOrder"), "brief requires auth token");
assert(orderAccess.includes("not_paid") && orderAccess.includes("PAID"), "brief rejects unpaid orders");
assert(webhook.includes("constructEvent") || webhook.includes("webhook") || webhook.includes("STRIPE_WEBHOOK"), "webhook handler present");

console.log("purchase-inquiry ok");
