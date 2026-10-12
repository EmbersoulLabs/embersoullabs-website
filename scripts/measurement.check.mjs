/**
 * Measurement, consent, purchase dedupe, and inquiry confirmation tests.
 * No Stripe network and no Google network.
 */
import { readFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { createContext, runInContext } from "node:vm";
import { sqliteAdapter } from "../functions/_shared/order-db.js";
import { sha256Hex } from "../functions/_shared/order-access.js";
import { sanitizeAttribution, purchaseValue } from "../functions/_shared/attribution.js";
import { readMeasurementConfig } from "../functions/_shared/measurement-config.js";
import { validateCheckoutBody } from "../functions/_shared/checkout-validate.js";
import { claimInquiryConversion, claimPurchaseConversion, rememberAttribution } from "../functions/_shared/conversion.js";
import { acceptInquiry } from "../functions/_shared/inquiry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error("FAIL", message);
  }
}

function openDb() {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "esl-measure-")), "orders.sqlite"));
  db.exec(readFileSync(join(root, "migrations/0001_website_orders.sql"), "utf8"));
  db.exec(readFileSync(join(root, "migrations/0004_measurement.sql"), "utf8"));
  return sqliteAdapter(db);
}

async function seedOrder(db, input) {
  const hash = await sha256Hex(input.token);
  const now = "2026-10-12T00:00:00.000Z";
  await db.run(
    `INSERT INTO orders (
       id, checkout_session_id, access_token_hash, state, service, region, lookup_key,
       price_id, currency, amount_total, quantity, package_version, livemode,
       brief_status, emberos_production, apply_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'short', ?, 'ai_short_ad_my', 'price_test', ?, ?, 1, 'v1', 1,
       'missing', 'not_connected', 0, ?, ?)`,
    [input.id, input.session, hash, input.state, input.region, input.currency, input.amount, now, now]
  );
}

const disabled = readMeasurementConfig({});
assert(disabled.delivery === "disabled" && disabled.ga4 === null && disabled.ads === null, "missing ids disable delivery");
assert(readMeasurementConfig({ GA4_MEASUREMENT_ID: "UA-123", GOOGLE_ADS_ID: "not-an-id" }).delivery === "disabled", "malformed ids stay disabled");
const configured = readMeasurementConfig({
  GA4_MEASUREMENT_ID: "G-TEST1234",
  GOOGLE_ADS_ID: "AW-123456789",
  GOOGLE_ADS_PURCHASE_LABEL: "purchase1",
  GOOGLE_ADS_INQUIRY_LABEL: "inquiry1",
});
assert(configured.delivery === "consent_required", "real ids require consent before delivery");
assert(configured.purchase_send_to === "AW-123456789/purchase1", "purchase label is paired with the ads id");
assert(!JSON.stringify(configured).includes("secret"), "config response has no secret field");

assert(validateCheckoutBody({ service: "short", region: "my", currency: "USD", attribution: { gclid: "abc" } }).code === "client_amount_rejected", "currency remains forbidden");
assert(sanitizeAttribution({ gclid: "good.click_id-1", gbraid: "bad id", email: "a@b.c", access_token: "tok" }).gclid === "good.click_id-1", "valid gclid kept");
assert(sanitizeAttribution({ gclid: "bad id", email: "a@b.c" }).gclid === null, "invalid and personal fields dropped");
assert(purchaseValue(6900, "myr").value === 69 && purchaseValue(6900, "myr").currency === "MYR", "MYR stays MYR");
assert(purchaseValue(2900, "sgd").currency === "SGD" && purchaseValue(2900, "sgd").value === 29, "SGD stays SGD");
assert(purchaseValue(1900, "usd").currency === "USD" && purchaseValue(1900, "usd").value === 19, "USD stays USD");
assert(purchaseValue(6900, "eur") === null, "unexpected currency is not converted");

const db = openDb();
await seedOrder(db, {
  id: "ord_my_paid_0001",
  session: "cs_my_paid",
  token: "token-my-paid",
  state: "PAID",
  region: "my",
  currency: "myr",
  amount: 6900,
});
await rememberAttribution(db, "ord_my_paid_0001", { gclid: "click.my_1", email: "person@example.com" }, "2026-10-12T00:00:00.000Z");
const storedClick = await db.get("SELECT gclid, gbraid FROM order_attribution WHERE order_id = ?", ["ord_my_paid_0001"]);
assert(storedClick.gclid === "click.my_1", "gclid stored on the order");
assert(!JSON.stringify(storedClick).includes("person@example.com"), "email is not stored as attribution");

const first = await claimPurchaseConversion(db, "cs_my_paid", "token-my-paid", "2026-10-12T01:00:00.000Z");
const second = await claimPurchaseConversion(db, "cs_my_paid", "token-my-paid", "2026-10-12T02:00:00.000Z");
assert(first.body.emit === true && first.body.transaction_id === "ord_my_paid_0001", "first paid claim emits");
assert(first.body.value === 69 && first.body.currency === "MYR" && first.body.gclid === "click.my_1", "paid hit keeps MYR 69 and gclid");
assert(!JSON.stringify(first.body).includes("token-my-paid"), "access token is not in the purchase hit");
assert(second.body.emit === false && second.body.reason === "duplicate", "refresh does not emit again");
const money = await db.get("SELECT amount_total, currency, state FROM orders WHERE id = ?", ["ord_my_paid_0001"]);
assert(money.amount_total === 6900 && money.currency === "myr" && money.state === "PAID", "claim does not change the ledger payment");

await seedOrder(db, { id: "ord_sg_pending_0001", session: "cs_sg_pending", token: "token-sg", state: "PENDING", region: "sg", currency: "sgd", amount: 2900 });
const pending = await claimPurchaseConversion(db, "cs_sg_pending", "token-sg");
assert(pending.body.emit === false && pending.body.reason === "not_paid", "pending is not a purchase");
await db.run("UPDATE orders SET state = 'FAILED' WHERE id = ?", ["ord_sg_pending_0001"]);
const failedState = await claimPurchaseConversion(db, "cs_sg_pending", "token-sg");
assert(failedState.body.emit === false && failedState.body.reason === "not_paid", "failed is not a purchase");

await seedOrder(db, { id: "ord_usd_ready_0001", session: "cs_usd_ready", token: "token-usd", state: "READY_FOR_PRODUCTION", region: "intl", currency: "usd", amount: 1900 });
const ready = await claimPurchaseConversion(db, "cs_usd_ready", "token-usd");
assert(ready.body.emit === true && ready.body.value === 19 && ready.body.currency === "USD", "ready production still reports the original USD amount");
const readyAgain = await claimPurchaseConversion(db, "cs_usd_ready", "token-usd");
assert(readyAgain.body.emit === false && readyAgain.body.reason === "duplicate", "repeat visit does not emit again");

const mailed = [];
const inquiry = await acceptInquiry(db, {}, {
  now: "2026-10-12T03:00:00.000Z",
  ip: "203.0.113.8",
  mailer: async (message) => {
    mailed.push(message);
    return { ok: true };
  },
  body: {
    ad_type: "short",
    region: "sg",
    contact_name: "A Buyer",
    business_name: "Example Shop",
    email_or_contact: "buyer@example.com",
    product_brief: "A product photo",
    agree_privacy: "yes",
  },
});
assert(inquiry.status === 200 && inquiry.body.inquiry_id && inquiry.body.inquiry_id.startsWith("inq_"), "verified email returns an inquiry id");
assert(!JSON.stringify(inquiry.body).includes("buyer@example.com"), "inquiry response has no email");
assert(!JSON.stringify(inquiry.body).includes("A Buyer"), "inquiry response has no name");
assert(mailed.length === 1 && mailed[0].text.includes("buyer@example.com"), "support email still receives the inquiry");
const inquiryClaim = await claimInquiryConversion(db, inquiry.body.inquiry_id);
const inquiryRepeat = await claimInquiryConversion(db, inquiry.body.inquiry_id);
assert(inquiryClaim.body.emit === true && inquiryClaim.body.transaction_id === inquiry.body.inquiry_id, "inquiry emits once");
assert(inquiryRepeat.body.emit === false && inquiryRepeat.body.reason === "duplicate", "inquiry refresh does not emit again");
assert(!JSON.stringify(inquiryClaim.body).includes("buyer@example.com"), "inquiry hit has no email");

const unsent = await acceptInquiry(db, {}, {
  now: "2026-10-12T04:00:00.000Z",
  ip: "203.0.113.9",
  body: {
    ad_type: "story",
    contact_name: "B",
    business_name: "Shop",
    email_or_contact: "b@example.com",
    product_brief: "Hello",
    agree_privacy: "yes",
  },
});
assert(unsent.status === 503 && unsent.body.code === "email_not_configured" && !unsent.body.inquiry_id, "unverified inquiry does not get a conversion id");

const click = await acceptInquiry(db, {}, {
  body: { ad_type: "short", agree_privacy: "no" },
});
assert(click.status === 400, "missing consent and fields are not a submission");

const browser = {
  localStorage: new Map(),
  location: { protocol: "https:", origin: "https://embersoullabs.com", pathname: "/ai-ads/checkout/success/", search: "?session_id=cs_test&access_token=secret-token" },
  document: { cookie: "", head: { appendChild() {} }, body: { appendChild() {} }, getElementById() { return null; }, querySelector() { return null; }, createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; } },
  dataLayer: [],
};
browser.localStorage.getItem = (key) => browser.localStorage.get(key) || null;
browser.localStorage.setItem = (key, value) => browser.localStorage.set(key, value);
browser.window = browser;
browser.URLSearchParams = URLSearchParams;
browser.Date = Date;
browser.JSON = JSON;
browser.encodeURIComponent = encodeURIComponent;
const context = createContext(browser);
runInContext(readFileSync(join(root, "js/measurement.js"), "utf8"), context);
const measure = browser.EmberSoulMeasure;
measure.captureClickIds("?gclid=click.browser_1&access_token=secret-token");
assert(measure.readClicks().gclid === "click.browser_1", "browser stores a bounded gclid");
assert(!JSON.stringify(measure.readClicks()).includes("secret-token"), "access token is not stored with the click");
const noConsent = measure.purchaseHit(first.body, configured, null, { origin: "https://embersoullabs.com", pathname: "/ai-ads/checkout/success/" });
assert(noConsent.deliver === false, "no consent means no purchase hit");
measure.writeConsent({ analytics: true, ads: true });
const hit = measure.purchaseHit(first.body, configured, measure.readConsent(), { origin: "https://embersoullabs.com", pathname: "/ai-ads/checkout/success/" });
assert(hit.deliver === true, "consented configured purchase can be delivered");
assert(hit.page_location === "https://embersoullabs.com/ai-ads/checkout/success/?gclid=click.my_1", "return page keeps the gclid and drops the checkout secrets");
const flat = JSON.stringify(hit.calls);
assert(!flat.includes("secret-token") && !flat.includes("buyer@example.com") && !flat.includes("access_token"), "purchase calls contain no customer secrets");
assert(flat.includes("\"currency\":\"MYR\"") && flat.includes("\"value\":69"), "purchase call keeps the original value");
const disabledHit = measure.purchaseHit(first.body, disabled, measure.readConsent(), { origin: "https://embersoullabs.com", pathname: "/ai-ads/checkout/success/" });
assert(disabledHit.deliver === false, "configured-off environment does not deliver");
const lead = measure.inquiryHit(inquiryClaim.body, configured, measure.readConsent(), { origin: "https://embersoullabs.com", pathname: "/ai-ads/", gclid: "click.browser_1" });
assert(lead.deliver === true && JSON.stringify(lead.calls).includes("generate_lead"), "inquiry is a lead, not a purchase");
assert(!JSON.stringify(lead.calls).includes("purchase"), "inquiry call is not a purchase");

const webhook = readFileSync(join(root, "functions/api/stripe-webhook.js"), "utf8");
assert(!webhook.includes("claimPurchaseConversion"), "webhook retries do not claim purchases");
const thanks = readFileSync(join(root, "ai-ads/thanks/index.html"), "utf8");
assert(!thanks.includes("maybeInquiry"), "opening the thanks page does not count an inquiry");
const robots = readFileSync(join(root, "robots.txt"), "utf8");
assert(robots.includes("Allow: /") && robots.includes("Disallow: /api/"), "crawlers can read the site and not the measurement API");

if (failed) {
  console.error(failed + " measurement checks failed");
  process.exit(1);
}
console.log("measurement ok");
console.log("LIVE_CHARGE_CREATED=NO");
console.log("GOOGLE_EVENT_DELIVERED=NO");
