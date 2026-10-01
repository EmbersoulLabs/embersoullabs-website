/**
 * Local Stripe TEST catalog audit (does not print secrets).
 * Usage (from website/):
 *   node scripts/stripe-audit-lookup-keys.mjs
 *
 * Reads ../stripe.local.txt for sk_test_ only.
 * Writes .stripe-test-audit.json (gitignored).
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const secretFile = join(root, "..", "stripe.local.txt");

const LOOKUP_KEYS = [
  "ai_short_ad_my",
  "ai_short_ad_sg",
  "ai_short_ad_intl",
  "ai_story_ad_my",
  "ai_story_ad_sg",
  "ai_story_ad_intl",
  "monthly_ai_content_my",
  "monthly_ai_content_sg",
  "monthly_ai_content_intl",
];

const EXPECTED = {
  ai_short_ad_my: { currency: "myr", amount: 6900 },
  ai_short_ad_sg: { currency: "sgd", amount: 2900 },
  ai_short_ad_intl: { currency: "usd", amount: 1900 },
  ai_story_ad_my: { currency: "myr", amount: 18900 },
  ai_story_ad_sg: { currency: "sgd", amount: 7900 },
  ai_story_ad_intl: { currency: "usd", amount: 5900 },
  monthly_ai_content_my: { currency: "myr", amount: 49900 },
  monthly_ai_content_sg: { currency: "sgd", amount: 19900 },
  monthly_ai_content_intl: { currency: "usd", amount: 12900 },
};

const raw = readFileSync(secretFile, "utf8");
const sk = (raw.match(/sk_test_[A-Za-z0-9]+/) || [])[0];
if (!sk) {
  console.error("NO_SK_TEST in stripe.local.txt");
  process.exit(1);
}
if (raw.includes("sk_live_")) {
  console.error("LIVE key detected — refusing audit");
  process.exit(1);
}

console.log("STRIPE_MODE=test");
console.log("SECRET_PRINTED=NO");

const found = [];
const missing = [];
const mismatch = [];

for (const lookup of LOOKUP_KEYS) {
  const url =
    "https://api.stripe.com/v1/prices?lookup_keys[]=" +
    encodeURIComponent(lookup) +
    "&limit=1";
  const res = await fetch(url, { headers: { Authorization: "Bearer " + sk } });
  const data = await res.json();
  const price = data.data && data.data[0];
  if (!price) {
    missing.push(lookup);
    console.log("MISSING=" + lookup);
    continue;
  }
  const exp = EXPECTED[lookup];
  const ok =
    price.currency === exp.currency &&
    price.unit_amount === exp.amount &&
    price.type === "one_time" &&
    price.active === true;
  if (!ok) {
    mismatch.push(lookup);
    console.log("MISMATCH=" + lookup);
  } else {
    console.log("OK=" + lookup);
  }
  found.push({
    lookup,
    priceId: price.id,
    currency: price.currency,
    unit_amount: price.unit_amount,
    type: price.type,
    matchesApproved: ok,
  });
}

const products = await fetch("https://api.stripe.com/v1/products?limit=100", {
  headers: { Authorization: "Bearer " + sk },
}).then((r) => r.json());

const report = {
  mode: "test",
  productCount: (products.data || []).length,
  foundCount: found.length,
  missing,
  mismatch,
  found,
};
writeFileSync(join(root, ".stripe-test-audit.json"), JSON.stringify(report, null, 2));
console.log("PRODUCTS_FOUND=" + report.productCount);
console.log("PRICES_FOUND=" + found.length);
console.log("MISSING_COUNT=" + missing.length);
if (missing.length) process.exit(2);
