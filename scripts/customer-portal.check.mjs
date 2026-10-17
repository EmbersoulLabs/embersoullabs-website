/**
 * Customer portal tests. No network, no live payment, no Production writes.
 * Run: node scripts/customer-portal.check.mjs
 */
import { readFileSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";
import { sqliteAdapter } from "../functions/_shared/order-db.js";
import { applyPaymentEvent, createOrder } from "../functions/_shared/order-state.js";
import { sha256Hex, submitCreativeBrief } from "../functions/_shared/order-access.js";
import {
  clearSessionCookie,
  readSession,
  requireCustomer,
  revokeSession,
  sessionCookie,
  startLogin,
  verifyLogin,
} from "../functions/_shared/portal-auth.js";
import {
  claimOrder,
  createDownloadGrant,
  getOwnedOrder,
  listOrders,
  normalizeAssetLinks,
  readDeliveryObject,
  requestRevision,
  submitOwnedBrief,
  uploadOwnedAsset,
} from "../functions/_shared/portal-orders.js";
import { dispatchEmbercoreOutbox, handleEmbercoreEvent, hmacHex } from "../functions/_shared/portal-embercore.js";
import { onRequestGet as orderPage } from "../functions/account/orders/[orderId].js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-10-11T12:00:00.000Z";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "portal-"));
  const db = new DatabaseSync(join(dir, "orders.sqlite"));
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(join(root, "migrations/0001_website_orders.sql"), "utf8"));
  db.exec(readFileSync(join(root, "migrations/0002_customer_portal.sql"), "utf8"));
  db.exec(readFileSync(join(root, "migrations/0003_story_idea.sql"), "utf8"));
  return sqliteAdapter(db);
}

function raw(db) {
  return db;
}

function session(id) {
  return {
    id,
    livemode: true,
    mode: "payment",
    payment_status: "paid",
    currency: "myr",
    amount_total: 6900,
    metadata: {
      service: "short",
      region: "my",
      lookup_key: "ai_short_ad_my",
      package_version: "ai_ads_v1",
    },
    line_items: [{ quantity: 1, price: { id: "price_1ShortMyLive001", lookup_key: "ai_short_ad_my", currency: "myr", unit_amount: 6900, livemode: true, active: true, type: "one_time" } }],
  };
}

async function paidOrder(db, id, checkoutId, token) {
  await createOrder(db, {
    id,
    checkoutSessionId: checkoutId,
    accessTokenHash: await sha256Hex(token),
    service: "short",
    region: "my",
    lookupKey: "ai_short_ad_my",
    priceId: "price_1ShortMyLive001",
    currency: "myr",
    amountTotal: 6900,
    now: NOW,
  });
  const paid = await applyPaymentEvent(db, {
    eventId: `evt_${id}`,
    eventType: "checkout.session.completed",
    session: session(checkoutId),
    now: NOW,
  });
  assert(paid.ok === true && paid.state === "PAID", "payment event still marks the order paid " + JSON.stringify(paid));
  return paid;
}

async function login(db, email) {
  const sent = [];
  const started = await startLogin(db, { SITE_ORIGIN: "https://embersoullabs.com" }, {
    email,
    ip: "203.0.113.10",
    now: NOW,
    mailer: async (message) => {
      sent.push(message);
      return { ok: true };
    },
  });
  assert(started.status === 200 && started.body.ok === true, "login start accepted");
  assert(!JSON.stringify(started.body).includes("code"), "start response has no code");
  const code = sent[0].text.match(/(\d{6})/)[1];
  const challenge = sent[0].text.match(/challenge=([^&]+)/)[1];
  const verified = await verifyLogin(db, {}, {
    challengeId: decodeURIComponent(challenge),
    code,
    secure: true,
    now: NOW,
  });
  assert(verified.status === 200 && verified.body.ok === true, "code verifies");
  assert(!JSON.stringify(verified.body).includes(code), "verify response does not echo the code");
  assert(verified.cookie.includes("HttpOnly") && verified.cookie.includes("Secure") && verified.cookie.includes("SameSite=Lax"), "session cookie flags");
  const token = decodeURIComponent(verified.cookie.split(";")[0].split("=").slice(1).join("="));
  const customer = await readSession(db, token, NOW);
  const stored = await db.get("SELECT code_hash, email FROM auth_challenges WHERE id = ?", [decodeURIComponent(challenge)]);
  assert(stored.code_hash !== code && stored.code_hash.length === 64, "otp is stored as a hash");
  return { customer, token, code, challenge: decodeURIComponent(challenge) };
}

const briefBody = {
  business_name: "Kedai Api",
  promotion_text: "Weekend lunch set",
  objective: "Store visits",
  audience: "Office workers in KL",
  language: "en",
  visual_style: "Warm and direct",
  asset_links: "",
  special_instructions: "",
  contact: "buyer@example.com",
};

async function sign(secret, body, now) {
  const ts = Math.floor(Date.parse(now) / 1000);
  return `t=${ts},v1=${await hmacHex(secret, `${ts}.${body}`)}`;
}

async function run() {
  const cookie = sessionCookie("abc", { secure: true });
  assert(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Lax"), "cookie helper");
  assert(clearSessionCookie({ secure: true }).includes("Max-Age=0"), "logout cookie expires");

  const db = openDb();
  const token = "token_portal_access_value_0123456789";
  await paidOrder(db, "ord_portal_paid", "cs_live_portalpaid001", token);
  const row = await db.get("SELECT state, apply_count, amount_total FROM orders WHERE id = ?", ["ord_portal_paid"]);
  assert(row.state === "PAID" && row.apply_count === 1 && row.amount_total === 6900, "ledger payment preserved");
  let locked = false;
  try {
    await db.run("UPDATE orders SET amount_total = 1 WHERE id = ?", ["ord_portal_paid"]);
  } catch (error) {
    locked = String(error.message).includes("financial_fields_locked");
  }
  assert(locked, "financial fields stay locked");

  const columns = await db.all("SELECT name FROM pragma_table_info('auth_challenges')");
  assert(!columns.some((column) => column.name === "code"), "no plaintext otp column");
  assert(!columns.some((column) => column.name === "role"), "no self-service role column");

  const missingMailA = await startLogin(db, {}, { email: "a@example.com", ip: "203.0.113.9", now: NOW });
  const missingMailB = await startLogin(db, {}, { email: "known@example.com", ip: "203.0.113.9", now: NOW });
  assert(missingMailA.status === 503 && JSON.stringify(missingMailA.body) === JSON.stringify(missingMailB.body), "missing mailer does not enumerate");

  const first = await startLogin(db, { SITE_ORIGIN: "https://embersoullabs.com" }, {
    email: "one@example.com",
    ip: "203.0.113.8",
    now: NOW,
    mailer: async () => ({ ok: true }),
  });
  const second = await startLogin(db, { SITE_ORIGIN: "https://embersoullabs.com" }, {
    email: "two@example.com",
    ip: "203.0.113.8",
    now: NOW,
    mailer: async () => ({ ok: true }),
  });
  assert(first.status === second.status && JSON.stringify(first.body) === JSON.stringify(second.body), "start response does not reveal accounts");

  const owner = await login(db, "buyer@example.com");
  const reused = await verifyLogin(db, {}, { challengeId: owner.challenge, code: owner.code, secure: true, now: NOW });
  assert(reused.status === 400 && reused.body.code === "invalid_code", "otp is one-time");
  const lateMail = {};
  const expired = await startLogin(db, { SITE_ORIGIN: "https://embersoullabs.com" }, {
    email: "late@example.com",
    ip: "203.0.113.12",
    now: NOW,
    mailer: async (message) => {
      lateMail.code = message.text.match(/(\d{6})/)[1];
      lateMail.challenge = decodeURIComponent(message.text.match(/challenge=([^&]+)/)[1]);
      return { ok: true };
    },
  });
  assert(expired.status === 200, "late login started");
  const late = await verifyLogin(db, {}, {
    challengeId: lateMail.challenge,
    code: lateMail.code,
    secure: true,
    now: "2026-10-11T12:11:00.000Z",
  });
  assert(late.status === 400, "expired otp is rejected");

  const limitedEmail = "limit@example.com";
  for (let i = 0; i < 6; i += 1) {
    const result = await startLogin(db, { SITE_ORIGIN: "https://embersoullabs.com" }, {
      email: limitedEmail,
      ip: "203.0.113.40",
      now: NOW,
      mailer: async () => ({ ok: true }),
    });
    assert(result.status === 200 && JSON.stringify(result.body) === "{\"ok\":true}", "rate limit stays generic");
  }
  const limitedCount = await db.get("SELECT COUNT(*) AS n FROM auth_challenges WHERE email = ?", [limitedEmail]);
  assert(Number(limitedCount.n) === 5, "email start rate limit");

  const sessionGone = await readSession(db, owner.token, "2026-10-25T12:00:01.000Z");
  assert(sessionGone === null, "session expires");
  const live = await readSession(db, owner.token, NOW);
  assert(live && live.email === "buyer@example.com", "session maps to the verified customer");
  await revokeSession(db, owner.token, NOW);
  const request = new Request("https://embersoullabs.com/account/", { headers: { Cookie: `es_portal=${encodeURIComponent(owner.token)}` } });
  const required = await requireCustomer(db, request, NOW);
  assert(required.status === 401, "logout revokes the session");
  const ownerAgain = await login(db, "buyer@example.com");

  const stranger = await login(db, "stranger@example.com");
  const unclaimed = await listOrders(db, ownerAgain.customer);
  assert(unclaimed.body.orders.length === 0, "email match does not list historical orders");
  const histToken = "token_hist_access_value_012345678901";
  await paidOrder(db, "ord_hist_hidden", "cs_live_histhidden001", histToken);
  await db.run(
    "INSERT INTO creative_briefs (id, order_id, promotion_text, asset_status, language, contact, completed_at) VALUES ('brief_hist', 'ord_hist_hidden', 'x', 'text_only', 'en', 'buyer@example.com', ?)",
    [NOW]
  );
  const stillHidden = await listOrders(db, ownerAgain.customer);
  assert(stillHidden.body.orders.length === 0, "brief contact email does not grant access");

  const badClaim = await claimOrder(db, ownerAgain.customer, { sessionId: "cs_live_portalpaid001", accessToken: "wrong-token-value-000000000000", now: NOW });
  assert(badClaim.status === 404, "wrong access token cannot claim");
  const claimed = await claimOrder(db, ownerAgain.customer, { sessionId: "cs_live_portalpaid001", accessToken: token, now: NOW });
  assert(claimed.status === 200 && claimed.body.order_id === "ord_portal_paid", "access token claims the order");
  const claimedAgain = await claimOrder(db, ownerAgain.customer, { sessionId: "cs_live_portalpaid001", accessToken: token, now: NOW });
  assert(claimedAgain.body.duplicate === true, "repeat claim is idempotent");
  const stolen = await claimOrder(db, stranger.customer, { sessionId: "cs_live_portalpaid001", accessToken: token, now: NOW });
  assert(stolen.status === 409 && stolen.body.code === "already_claimed", "second customer cannot take the order");
  const hidden = await getOwnedOrder(db, stranger.customer, "ord_portal_paid");
  assert(hidden.status === 404, "cross-customer read is not found");

  const textOnly = await submitCreativeBrief(db, {
    sessionId: "cs_live_portalpaid001",
    accessToken: token,
    promotionText: "Weekend lunch set",
    language: "en",
    assetStatus: "",
    contact: "buyer@example.com",
    briefId: "brief_text_only",
    now: NOW,
  });
  assert(textOnly.status === 200 && textOnly.body.state === "READY_FOR_PRODUCTION", "text-only brief completes");
  const saved = await db.get("SELECT asset_status FROM creative_briefs WHERE order_id = ?", ["ord_portal_paid"]);
  assert(saved.asset_status === "text_only", "blank assets are text only");
  const duplicate = await submitCreativeBrief(db, {
    sessionId: "cs_live_portalpaid001",
    accessToken: token,
    promotionText: "Weekend lunch set",
    language: "en",
    assetStatus: "text_only",
    contact: "buyer@example.com",
    briefId: "brief_text_only_2",
    now: NOW,
  });
  assert(duplicate.status === 200 && duplicate.body.duplicate === true, "identical brief is idempotent");
  const changed = await submitCreativeBrief(db, {
    sessionId: "cs_live_portalpaid001",
    accessToken: token,
    promotionText: "A different promotion",
    language: "en",
    assetStatus: "text_only",
    contact: "buyer@example.com",
    briefId: "brief_text_only_3",
    now: NOW,
  });
  assert(changed.status === 409 && changed.body.code === "brief_exists", "changed brief is rejected");
  const briefCount = await db.get("SELECT COUNT(*) AS n FROM creative_briefs WHERE order_id = ?", ["ord_portal_paid"]);
  assert(Number(briefCount.n) === 1, "one brief row");

  const workToken = "token_work_access_value_0123456789012";
  await paidOrder(db, "ord_portal_work", "cs_live_portalwork001", workToken);
  const workClaim = await claimOrder(db, ownerAgain.customer, { sessionId: "cs_live_portalwork001", accessToken: workToken, now: NOW });
  assert(workClaim.status === 200, "work order claimed");
  const ownedBrief = await submitOwnedBrief(db, {}, ownerAgain.customer, "ord_portal_work", briefBody, NOW);
  assert(ownedBrief.status === 200 && ownedBrief.body.order.sync_status === "SYNC_PENDING", "owned brief queues sync");
  assert(ownedBrief.body.order.embercore_sync_live === false, "sync is not claimed live");
  assert(ownedBrief.body.emberos_production === "not_connected", "brief does not connect EmberOS");
  const outbox = await db.get("SELECT status, payload_json FROM embercore_outbox WHERE id = ?", ["ready:ord_portal_work"]);
  const payload = JSON.parse(outbox.payload_json);
  assert(outbox.status === "SYNC_PENDING" && payload.type === "order.ready_for_production" && payload.paid === true && payload.order_id === "ord_portal_work" && payload.brief.promotion_text === "Weekend lunch set", "outbox contract");
  const calls = [];
  const held = await dispatchEmbercoreOutbox(db, { EMBERCORE_WEBHOOK_URL: "https://embercore.example/hooks", EMBERCORE_OUTBOUND_SECRET: "outbound-secret" }, NOW, async (url, init) => {
    calls.push({ url, init });
    return { status: 500 };
  });
  assert(held.delivered === 0 && calls.length === 1, "failed delivery is retried later");
  const tooSoon = await dispatchEmbercoreOutbox(db, { EMBERCORE_WEBHOOK_URL: "https://embercore.example/hooks", EMBERCORE_OUTBOUND_SECRET: "outbound-secret" }, NOW, async () => {
    calls.push({ early: true });
    return { status: 200 };
  });
  assert(tooSoon.delivered === 0 && calls.length === 1, "backoff blocks an immediate retry");
  const later = await dispatchEmbercoreOutbox(db, { EMBERCORE_WEBHOOK_URL: "https://embercore.example/hooks", EMBERCORE_OUTBOUND_SECRET: "outbound-secret" }, "2026-10-11T12:30:00.000Z", async () => ({ status: 200 }));
  assert(later.delivered === 1, "retry delivers once");
  const quiet = await dispatchEmbercoreOutbox(db, { EMBERCORE_WEBHOOK_URL: "https://embercore.example/hooks", EMBERCORE_OUTBOUND_SECRET: "outbound-secret" }, "2026-10-11T13:00:00.000Z", async () => {
    calls.push({ extra: true });
    return { status: 200 };
  });
  assert(quiet.delivered === 0 && !calls.some((call) => call.extra), "delivered event is not sent again");
  const pendingOnly = await dispatchEmbercoreOutbox(db, {}, NOW);
  assert(pendingOnly.reason === "receiver_not_configured", "missing receiver stays pending");

  const env = { EMBERCORE_INBOUND_SECRET: "inbound-secret" };
  const badBody = JSON.stringify({ id: "evt_bad", type: "production.status", order_id: "ord_portal_work", workflow_status: "IN_PRODUCTION", financial_state: "REFUNDED" });
  const bad = await handleEmbercoreEvent(db, env, badBody, "t=1,v1=00", NOW, null);
  assert(bad.status === 401, "bad embercore signature is rejected");
  const signed = await sign("inbound-secret", badBody, NOW);
  const moved = await handleEmbercoreEvent(db, env, badBody, signed, NOW, null);
  assert(moved.status === 200, "signed status update is accepted");
  const replay = await handleEmbercoreEvent(db, env, badBody, signed, NOW, null);
  assert(replay.body.duplicate === true, "inbound event is idempotent");
  const financial = await db.get("SELECT state, amount_total FROM orders WHERE id = ?", ["ord_portal_work"]);
  assert(financial.state === "READY_FOR_PRODUCTION" && financial.amount_total === 6900, "embercore cannot change payment state");
  const reviewBody = JSON.stringify({ id: "evt_review", type: "production.status", order_id: "ord_portal_work", workflow_status: "REVIEW" });
  const review = await handleEmbercoreEvent(db, env, reviewBody, await sign("inbound-secret", reviewBody, NOW), NOW, null);
  assert(review.status === 200, "review status accepted");

  const concept = await requestRevision(db, ownerAgain.customer, "ord_portal_work", { kind: "new_concept", comment: "Make a different film" }, NOW);
  assert(concept.status === 400 && concept.body.code === "new_concept_not_a_revision", "new concept is not a revision");
  for (let i = 0; i < 3; i += 1) {
    const revision = await requestRevision(db, ownerAgain.customer, "ord_portal_work", { comment: `Change ${i}`, status: "approved" }, NOW);
    assert(revision.status === 200 && revision.body.status === "pending_approval", "customer revision waits for approval");
  }
  const limited = await requestRevision(db, ownerAgain.customer, "ord_portal_work", { comment: "One more" }, NOW);
  assert(limited.status === 409 && limited.body.code === "revision_limit", "revision limit holds");
  const pending = await db.get("SELECT status FROM revision_requests WHERE order_id = ?", ["ord_portal_work"]);
  assert(pending.status === "pending_approval", "customer cannot approve a revision");

  const disabled = await uploadOwnedAsset(db, {}, ownerAgain.customer, "ord_portal_work", { filename: "photo.png", bytes: new Uint8Array([1]) }, NOW);
  assert(disabled.status === 503 && disabled.body.code === "uploads_disabled", "uploads stay disabled without storage and scanning");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const store = new Map();
  const bucket = {
    async put(key, bytes) { store.set(key, bytes); },
    async head(key) { return store.has(key) ? { key } : null; },
    async get(key) { return store.has(key) ? { bytes: store.get(key), contentType: "image/png" } : null; },
  };
  const assetEnv = { ASSET_BUCKET: bucket, ASSET_SCANNER: { async scan() { return { ok: true }; } } };
  const unsafe = await uploadOwnedAsset(db, assetEnv, ownerAgain.customer, "ord_portal_work", {
    filename: "photo.png",
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74]),
  }, NOW);
  assert(unsafe.status === 400 && unsafe.body.code === "unsafe_file", "unsafe file is rejected");
  const storedAsset = await uploadOwnedAsset(db, assetEnv, ownerAgain.customer, "ord_portal_work", { filename: "photo.png", bytes: png }, NOW);
  assert(storedAsset.status === 200 && !JSON.stringify(storedAsset.body).includes("http"), "stored file has no public url");
  const otherUpload = await uploadOwnedAsset(db, assetEnv, stranger.customer, "ord_portal_work", { filename: "photo.png", bytes: png }, NOW);
  assert(otherUpload.status === 404, "another customer cannot upload");

  const missingFile = await createDownloadGrant(db, ownerAgain.customer, "ord_portal_work", NOW);
  assert(missingFile.status === 404 && missingFile.body.delivered === false, "delivery is not claimed without a file");
  const videoKey = "orders/ord_portal_work/delivery/final.mp4";
  store.set(videoKey, new Uint8Array([1, 2, 3]));
  const deliveryBody = JSON.stringify({ id: "evt_delivery", type: "delivery.ready", order_id: "ord_portal_work", object_key: videoKey });
  const noStore = await handleEmbercoreEvent(db, env, deliveryBody, await sign("inbound-secret", deliveryBody, NOW), NOW, null);
  assert(noStore.status === 409 && noStore.body.code === "storage_not_verified", "delivery without storage is refused");
  const delivered = await handleEmbercoreEvent(db, env, deliveryBody, await sign("inbound-secret", deliveryBody, NOW), NOW, bucket);
  assert(delivered.status === 200, "verified object can be delivered");
  const grant = await createDownloadGrant(db, ownerAgain.customer, "ord_portal_work", NOW);
  assert(grant.status === 200 && grant.body.download_path.includes("grant=") && !grant.body.download_path.includes("r2.dev"), "download grant is temporary");
  const file = await readDeliveryObject(db, ownerAgain.customer, assetEnv, "ord_portal_work", new URL(`https://embersoullabs.com${grant.body.download_path}`).searchParams.get("grant"), NOW);
  assert(file.status === 200 && file.bytes.length === 3, "owner can read the file once");
  const again = await readDeliveryObject(db, ownerAgain.customer, assetEnv, "ord_portal_work", new URL(`https://embersoullabs.com${grant.body.download_path}`).searchParams.get("grant"), NOW);
  assert(again.status === 404, "download grant is single use");
  const strangerFile = await createDownloadGrant(db, stranger.customer, "ord_portal_work", NOW);
  assert(strangerFile.status === 404, "another customer cannot download");

  const detail = await getOwnedOrder(db, ownerAgain.customer, "ord_portal_work");
  assert(detail.body.order.workflow_status === "DELIVERED" && detail.body.order.payment_status === "READY_FOR_PRODUCTION", "tracking stays separate from payment");
  assert(detail.body.order.emberos_production === "not_connected" && detail.body.order.embercore_sync_live === false, "no live production claim");
  const filtered = await listOrders(db, ownerAgain.customer, { progress: "DELIVERED" });
  assert(filtered.body.orders.length === 1 && filtered.body.orders[0].reference === "ord_portal_work", "progress filter");

  const page = await orderPage({ params: { orderId: "nope" }, request: new Request("https://embersoullabs.com/account/orders/nope") });
  assert(page.status === 404, "bad order path is not served");
  const portalSource = readFileSync(join(root, "functions/_shared/portal-orders.js"), "utf8");
  const coreSource = readFileSync(join(root, "functions/_shared/portal-embercore.js"), "utf8");
  assert(!portalSource.includes("UPDATE orders SET state") && !coreSource.includes("UPDATE orders SET state"), "portal code does not write payment state");
  const success = readFileSync(join(root, "ai-ads/checkout/success/index.html"), "utf8");
  assert(success.includes("Payment received") && success.includes("/api/orders/status"), "success page payment confirmation remains");
  assert(success.includes("Complete Your Creative Brief"), "success page leads to the brief");
  assert(success.includes("anyone with the link can view") && success.includes('name="asset_links"'), "success brief explains shareable photo links");
  assert(!success.includes("reply with photos") && !success.includes("email attachments are accepted"), "no unverified email-attachment path");

  assert(normalizeAssetLinks("").ok && normalizeAssetLinks("").value === null, "empty asset links ok");
  assert(normalizeAssetLinks("https://drive.google.com/file/d/abc/view").ok, "https drive link accepted");
  assert(!normalizeAssetLinks("javascript:alert(1)").ok, "javascript links rejected");
  assert(!normalizeAssetLinks("file:///etc/passwd").ok, "file links rejected");
  assert(!normalizeAssetLinks("https://user:pass@evil.example/a").ok, "credentialed URLs rejected");
  assert(!normalizeAssetLinks("https://localhost/secret").ok, "localhost links rejected");

  await paidOrder(db, "ord_one_line", "cs_live_oneline001", "one-line-token-0000000000000000");
  const claimedLine = await claimOrder(db, ownerAgain.customer, {
    sessionId: "cs_live_oneline001",
    accessToken: "one-line-token-0000000000000000",
    now: NOW,
  });
  assert(claimedLine.status === 200, "one-line order can be claimed");
  const oneLine = await submitOwnedBrief(db, {}, ownerAgain.customer, "ord_one_line", {
    promotion_text: "Lunch set this weekend.",
  }, NOW);
  assert(oneLine.status === 200 && oneLine.body.order.payment_status === "READY_FOR_PRODUCTION", "one sentence brief is enough");
  const repeatLine = await submitOwnedBrief(db, {}, ownerAgain.customer, "ord_one_line", {
    promotion_text: "Lunch set this weekend.",
  }, NOW);
  assert(repeatLine.status === 200 && repeatLine.body.duplicate === true, "identical one sentence brief is idempotent");
  const strangerLine = await submitOwnedBrief(db, {}, stranger.customer, "ord_one_line", {
    promotion_text: "Lunch set this weekend.",
  }, NOW);
  assert(strangerLine.status === 404, "another customer cannot submit the brief");

  await paidOrder(db, "ord_links", "cs_live_portallinks01", "token_links_access_value_012345678");
  const linkClaim = await claimOrder(db, ownerAgain.customer, {
    sessionId: "cs_live_portallinks01",
    accessToken: "token_links_access_value_012345678",
    now: NOW,
  });
  assert(linkClaim.status === 200, "link order claimed");
  const badLinks = await submitOwnedBrief(db, {}, ownerAgain.customer, "ord_links", {
    promotion_text: "Need product photos",
    asset_status: "links_ready",
    asset_links: "javascript:alert(1)",
  }, NOW);
  assert(badLinks.status === 400 && badLinks.body.field === "asset_links", "unsafe asset links rejected");
  const goodLinks = await submitOwnedBrief(db, {}, ownerAgain.customer, "ord_links", {
    promotion_text: "Need product photos",
    asset_status: "links_ready",
    asset_links: "https://drive.google.com/file/d/abc/view\nhttps://www.dropbox.com/scl/fi/demo?dl=0",
    contact: "buyer@example.com",
  }, NOW);
  assert(goodLinks.status === 200, "http(s) photo links accepted");
  const savedLinks = await db.get("SELECT asset_links, asset_status FROM creative_briefs WHERE order_id = ?", ["ord_links"]);
  assert(String(savedLinks.asset_links).includes("drive.google.com") && savedLinks.asset_status === "links_ready", "photo links stored on paid order");

  const orderDetail = readFileSync(join(root, "account/orders/_/index.html"), "utf8");
  assert(orderDetail.includes('name="asset_links"') && orderDetail.includes("Upload unavailable"), "portal brief collects links; upload stays disabled");

  return "";
}

const failed = await run().catch((error) => error.stack || error.message);
if (failed) {
  console.error("\nFAILED:", failed);
  process.exit(1);
}
console.log("\nAll customer portal checks passed.");
console.log("LIVE_CHARGE_CREATED=NO");
console.log("EMBEROS_CONNECTED=NO");
