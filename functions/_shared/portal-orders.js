/**
 * Customer order ownership, briefs, revisions and delivery grants.
 * Financial columns on orders are read-only here.
 */
import { SERVICE_LABELS } from "./catalog.js";
import { randomToken, readAuthorizedOrder } from "./order-access.js";
import { completeCreativeBrief } from "./order-state.js";
import { sha256Hex } from "./order-access.js";
import { storeCustomerAsset } from "./portal-assets.js";
import { dispatchEmbercoreOutbox, enqueueReadyForProduction } from "./portal-embercore.js";

const NOT_FOUND = { status: 404, body: { ok: false, code: "not_found" } };
const PAYMENT_FILTERS = new Set([
  "CREATED",
  "PENDING",
  "PAID",
  "READY_FOR_PRODUCTION",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
]);
const PROGRESS_FILTERS = new Set(["PAID", "BRIEF_RECEIVED", "IN_PRODUCTION", "REVIEW", "DELIVERED"]);
const FIELD_LIMITS = Object.freeze({
  business_name: 120,
  objective: 500,
  audience: 500,
  visual_style: 200,
  asset_links: 1000,
  special_instructions: 2000,
  story_idea: 2000,
});

/**
 * Accept http(s) photo/file share links only. Never fetched by this service
 * (avoids SSRF). Rejects credentials, non-http schemes, and junk tokens.
 */
export function normalizeAssetLinks(raw) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return { ok: false, error: { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_links" } } };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > FIELD_LIMITS.asset_links) {
    return { ok: false, error: { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_links" } } };
  }
  const parts = trimmed.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { ok: true, value: null };
  if (parts.length > 12) {
    return { ok: false, error: { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_links" } } };
  }
  const normalized = [];
  for (const part of parts) {
    let url;
    try {
      url = new URL(part);
    } catch {
      return { ok: false, error: { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_links" } } };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, error: { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_links" } } };
    }
    if (url.username || url.password) {
      return { ok: false, error: { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_links" } } };
    }
    if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) {
      return { ok: false, error: { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_links" } } };
    }
    normalized.push(url.toString());
  }
  return { ok: true, value: normalized.join("\n") };
}

function money(amount, currency) {
  return `${String(currency || "").toUpperCase()} ${(Number(amount) / 100).toFixed(2)}`;
}

function nextAction(order, op) {
  if (order.state !== "PAID" && order.state !== "READY_FOR_PRODUCTION") return "wait_for_payment";
  if (order.brief_status !== "complete") return "submit_creative_brief";
  if (!op || op.workflow_status === "PAID" || op.workflow_status === "BRIEF_RECEIVED") return "wait_for_production";
  if (op.workflow_status === "IN_PRODUCTION") return "wait_for_review";
  if (op.workflow_status === "REVIEW") return "review_or_request_revision";
  if (op.delivery_status === "ready") return "download_delivery";
  return "wait_for_file";
}

async function ownedOrder(db, customerId, orderId) {
  return db.get(
    `SELECT o.id, o.state, o.service, o.region, o.lookup_key, o.currency, o.amount_total,
            o.brief_status, o.created_at, o.paid_at, o.emberos_production, o.stripe_payment_status
     FROM orders o
     JOIN order_owners w ON w.order_id = o.id
     WHERE o.id = ? AND w.customer_id = ?`,
    [orderId, customerId]
  );
}

async function ensureOperation(db, order, now) {
  if (order.state !== "PAID" && order.state !== "READY_FOR_PRODUCTION") return;
  const workflow = order.brief_status === "complete" || order.state === "READY_FOR_PRODUCTION" ? "BRIEF_RECEIVED" : "PAID";
  await db.run(
    `INSERT INTO order_operations (
       order_id, workflow_status, revision_allowance, revisions_used, video_slots,
       delivery_status, sync_status, updated_at
     ) VALUES (?, ?, 3, 0, 1, 'unavailable', 'SYNC_PENDING', ?)
     ON CONFLICT(order_id) DO NOTHING`,
    [order.id, workflow, now]
  );
  if (workflow === "BRIEF_RECEIVED") {
    await db.run(
      `UPDATE order_operations SET workflow_status = 'BRIEF_RECEIVED', updated_at = ?
       WHERE order_id = ? AND workflow_status = 'PAID'`,
      [now, order.id]
    );
  }
  const marked = await db.get(
    "SELECT id FROM order_timeline WHERE order_id = ? AND status = ?",
    [order.id, workflow]
  );
  if (!marked) {
    await db.run(
      `INSERT INTO order_timeline (id, order_id, status, note, actor, created_at)
       VALUES (?, ?, ?, NULL, 'system', ?)`,
      [`tl_${randomToken(12)}`, order.id, workflow, now]
    );
  }
}

export async function presentOrder(db, order, { includeTimeline = false } = {}) {
  const op = await db.get("SELECT * FROM order_operations WHERE order_id = ?", [order.id]);
  const pending = await db.get(
    "SELECT COUNT(*) AS n FROM revision_requests WHERE order_id = ? AND status = 'pending_approval'",
    [order.id]
  );
  const slots = op ? op.video_slots : 1;
  const allowance = op ? op.revision_allowance : 3;
  const used = op ? op.revisions_used : 0;
  const waiting = pending ? Number(pending.n) : 0;
  const view = {
    reference: order.id,
    service: order.service,
    package: SERVICE_LABELS[order.service] || order.service,
    lookup_key: order.lookup_key,
    region: order.region,
    amount_total: order.amount_total,
    currency: order.currency,
    amount_display: money(order.amount_total, order.currency),
    payment_status: order.state,
    stripe_payment_status: order.stripe_payment_status,
    brief_status: order.brief_status,
    workflow_status: op ? op.workflow_status : null,
    revision_allowance: allowance,
    revision_scope: order.service === "monthly" ? "per_video" : "per_order",
    video_slots: slots,
    revisions_used: used,
    revisions_pending: waiting,
    revisions_remaining: Math.max(0, allowance * slots - used - waiting),
    delivery_status: op ? op.delivery_status : "unavailable",
    delivered_at: op ? op.delivered_at : null,
    created_at: order.created_at,
    paid_at: order.paid_at,
    sync_status: op ? op.sync_status : "SYNC_PENDING",
    embercore_sync_live: false,
    emberos_production: "not_connected",
    next_action: nextAction(order, op),
  };
  if (includeTimeline) {
    view.timeline = await db.all(
      "SELECT status, note, actor, created_at FROM order_timeline WHERE order_id = ? ORDER BY created_at ASC",
      [order.id]
    );
    const brief = await db.get("SELECT * FROM creative_briefs WHERE order_id = ?", [order.id]);
    view.brief = brief
      ? {
          business_name: brief.business_name || null,
          promotion_text: brief.promotion_text,
          objective: brief.objective || null,
          audience: brief.audience || null,
          language: brief.language,
          visual_style: brief.visual_style || null,
          asset_links: brief.asset_links || null,
          special_instructions: brief.special_instructions || null,
          story_idea: brief.story_idea || null,
          contact: brief.contact,
          asset_status: brief.asset_status,
        }
      : null;
    view.revisions = await db.all(
      "SELECT id, comment, status, created_at, decided_at FROM revision_requests WHERE order_id = ? ORDER BY created_at ASC",
      [order.id]
    );
  }
  return view;
}

export async function claimOrder(db, customer, input) {
  const auth = await readAuthorizedOrder(db, input.sessionId, input.accessToken);
  if (auth.status !== 200) return NOT_FOUND;
  const full = await db.get(
    `SELECT id, state, service, region, lookup_key, currency, amount_total, brief_status,
            created_at, paid_at, emberos_production, stripe_payment_status
     FROM orders WHERE id = ?`,
    [auth.order.id]
  );
  const owner = await db.get("SELECT customer_id FROM order_owners WHERE order_id = ?", [full.id]);
  const now = input.now || new Date().toISOString();
  if (owner && owner.customer_id !== customer.id) {
    return { status: 409, body: { ok: false, code: "already_claimed" } };
  }
  if (!owner) {
    await db.run(
      "INSERT INTO order_owners (order_id, customer_id, claimed_at, claim_method) VALUES (?, ?, ?, 'access_token')",
      [full.id, customer.id, now]
    );
    await db.run(
      "INSERT INTO portal_audit (id, actor, action, order_id, created_at) VALUES (?, ?, 'claim', ?, ?)",
      [`aud_${randomToken(12)}`, customer.id, full.id, now]
    );
  }
  await ensureOperation(db, full, now);
  return { status: 200, body: { ok: true, order_id: full.id, claimed: true, duplicate: !!owner } };
}

export async function listOrders(db, customer, filters = {}) {
  if (filters.payment && !PAYMENT_FILTERS.has(filters.payment)) {
    return { status: 400, body: { ok: false, code: "invalid_filter" } };
  }
  if (filters.progress && !PROGRESS_FILTERS.has(filters.progress)) {
    return { status: 400, body: { ok: false, code: "invalid_filter" } };
  }
  const rows = await db.all(
    `SELECT o.id, o.state, o.service, o.region, o.lookup_key, o.currency, o.amount_total,
            o.brief_status, o.created_at, o.paid_at, o.emberos_production, o.stripe_payment_status
     FROM orders o
     JOIN order_owners w ON w.order_id = o.id
     WHERE w.customer_id = ?
     ORDER BY o.created_at DESC
     LIMIT 100`,
    [customer.id]
  );
  const orders = [];
  for (const order of rows) {
    const view = await presentOrder(db, order);
    if (filters.payment && view.payment_status !== filters.payment) continue;
    if (filters.progress && view.workflow_status !== filters.progress) continue;
    orders.push(view);
  }
  return { status: 200, body: { ok: true, orders, embercore_sync_live: false } };
}

export async function getOwnedOrder(db, customer, orderId) {
  const order = await ownedOrder(db, customer.id, orderId);
  if (!order) return NOT_FOUND;
  return { status: 200, body: { ok: true, order: await presentOrder(db, order, { includeTimeline: true }) } };
}

function briefFields(input, { requireText }) {
  const values = {};
  for (const [key, max] of Object.entries(FIELD_LIMITS)) {
    if (input[key] === undefined) continue;
    if (key === "asset_links") {
      const links = normalizeAssetLinks(input[key]);
      if (!links.ok) return { error: links.error };
      values[key] = links.value;
      continue;
    }
    if (typeof input[key] !== "string") return { error: { status: 400, body: { ok: false, code: "invalid_brief", field: key } } };
    const trimmed = input[key].trim();
    if (!trimmed) {
      values[key] = null;
      continue;
    }
    if (trimmed.length > max) return { error: { status: 400, body: { ok: false, code: "invalid_brief", field: key } } };
    values[key] = trimmed;
  }
  return { values, requireText };
}

export async function applyBriefPortalEffects(db, input) {
  const columns = await db.all("SELECT name FROM pragma_table_info('creative_briefs')");
  const available = new Set((columns || []).map((row) => row.name));
  if (!available.has("business_name")) return { status: 200, skipped: true };
  const parsed = briefFields(input.fields || {}, { requireText: false });
  if (parsed.error) return parsed.error;
  const extra = Object.keys(FIELD_LIMITS).filter((name) => available.has(name));
  for (const name of Object.keys(parsed.values)) {
    if (!extra.includes(name)) delete parsed.values[name];
  }
  const current = await db.get(
    `SELECT ${extra.join(", ")} FROM creative_briefs WHERE order_id = ?`,
    [input.orderId]
  );
  if (!current) return { status: 200, skipped: true };
  if (input.duplicate) {
    for (const [key, value] of Object.entries(parsed.values)) {
      if ((current[key] || null) !== value) {
        return { status: 409, body: { ok: false, code: "brief_exists", emberos_production: "not_connected" } };
      }
    }
  } else if (Object.keys(parsed.values).length) {
    const names = Object.keys(parsed.values);
    await db.run(
      `UPDATE creative_briefs SET ${names.map((name) => `${name} = ?`).join(", ")} WHERE order_id = ?`,
      [...names.map((name) => parsed.values[name]), input.orderId]
    );
  }
  const order = await db.get(
    "SELECT id, state, brief_status, service FROM orders WHERE id = ?",
    [input.orderId]
  );
  await ensureOperation(db, { ...order, brief_status: "complete" }, input.now);
  await enqueueReadyForProduction(db, input.orderId, input.now);
  const dispatched = await dispatchEmbercoreOutbox(db, input.env || {}, input.now, input.fetchImpl);
  return {
    status: 200,
    sync: dispatched.reason === "receiver_not_configured" ? "SYNC_PENDING" : dispatched.sync,
  };
}

export async function submitOwnedBrief(db, env, customer, orderId, body, now) {
  const order = await ownedOrder(db, customer.id, orderId);
  if (!order) return NOT_FOUND;
  const existing = await db.get(
    "SELECT promotion_text, asset_status, language, contact FROM creative_briefs WHERE order_id = ?",
    [orderId]
  );
  if (order.state !== "PAID" && !(order.state === "READY_FOR_PRODUCTION" && existing)) {
    return { status: 409, body: { ok: false, code: "not_paid", state: order.state, emberos_production: "not_connected" } };
  }
  const promotion = typeof body.promotion_text === "string" ? body.promotion_text.trim() : "";
  const language = (typeof body.language === "string" && body.language.trim()) || "en";
  const contact = (typeof body.contact === "string" && body.contact.trim()) || "not provided";
  const assets = typeof body.asset_status === "string" && body.asset_status.trim() ? body.asset_status.trim() : "text_only";
  if (!["en", "zh", "ms", "mix"].includes(language)) {
    return { status: 400, body: { ok: false, code: "invalid_brief", field: "language" } };
  }
  if (contact.length < 1 || contact.length > 120) {
    return { status: 400, body: { ok: false, code: "invalid_brief", field: "contact" } };
  }
  if (promotion.length < 1 || promotion.length > 2000 || assets.length > 500) {
    return { status: 400, body: { ok: false, code: "invalid_brief", field: "promotion_text" } };
  }
  if (existing) {
    const same =
      existing.promotion_text === promotion &&
      existing.asset_status === assets &&
      existing.language === language &&
      existing.contact === contact;
    if (!same) {
      return { status: 409, body: { ok: false, code: "brief_exists", emberos_production: "not_connected" } };
    }
  } else {
    const required = briefFields(
      {
        business_name: body.business_name,
        objective: body.objective,
        audience: body.audience,
        visual_style: body.visual_style,
        asset_links: body.asset_links,
      special_instructions: body.special_instructions,
      story_idea: body.story_idea,
    },
    { requireText: false }
  );
    if (required.error) return required.error;
    try {
      await completeCreativeBrief(db, {
        id: `brief_${randomToken(12)}`,
        orderId,
        promotionText: promotion,
        assetStatus: assets,
        language,
        contact,
        now,
      });
    } catch (error) {
      if (String(error && error.message).includes("UNIQUE")) {
        return { status: 409, body: { ok: false, code: "brief_exists", emberos_production: "not_connected" } };
      }
      throw error;
    }
  }
  const effects = await applyBriefPortalEffects(db, {
    orderId,
    duplicate: !!existing,
    fields: {
      business_name: body.business_name,
      objective: body.objective,
      audience: body.audience,
      visual_style: body.visual_style,
      asset_links: body.asset_links,
      special_instructions: body.special_instructions,
      story_idea: body.story_idea,
    },
    now,
    env,
  });
  if (effects.status !== 200) return effects;
  const current = await ownedOrder(db, customer.id, orderId);
  return {
    status: 200,
    body: {
      ok: true,
      duplicate: !!existing,
      order: await presentOrder(db, current, { includeTimeline: true }),
      sync_status: effects.sync || "SYNC_PENDING",
      emberos_production: "not_connected",
    },
  };
}

export async function requestRevision(db, customer, orderId, body, now) {
  const order = await ownedOrder(db, customer.id, orderId);
  if (!order) return NOT_FOUND;
  if (body && (body.kind === "new_concept" || body.replaces_concept === true)) {
    return { status: 400, body: { ok: false, code: "new_concept_not_a_revision" } };
  }
  if (body && body.kind && body.kind !== "revision") {
    return { status: 400, body: { ok: false, code: "invalid_revision" } };
  }
  const comment = body && typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length < 1 || comment.length > 2000) {
    return { status: 400, body: { ok: false, code: "invalid_revision", field: "comment" } };
  }
  const op = await db.get("SELECT * FROM order_operations WHERE order_id = ?", [orderId]);
  if (!op || !["IN_PRODUCTION", "REVIEW", "DELIVERED"].includes(op.workflow_status)) {
    return { status: 409, body: { ok: false, code: "revision_not_open" } };
  }
  const pending = await db.get(
    "SELECT COUNT(*) AS n FROM revision_requests WHERE order_id = ? AND status = 'pending_approval'",
    [orderId]
  );
  const cap = op.revision_allowance * op.video_slots;
  if (op.revisions_used + Number(pending.n) >= cap) {
    return { status: 409, body: { ok: false, code: "revision_limit" } };
  }
  const id = `rev_${randomToken(12)}`;
  await db.run(
    `INSERT INTO revision_requests (id, order_id, customer_id, comment, kind, status, created_at, decided_at)
     VALUES (?, ?, ?, ?, 'revision', 'pending_approval', ?, NULL)`,
    [id, orderId, customer.id, comment, now]
  );
  return {
    status: 200,
    body: {
      ok: true,
      revision_id: id,
      status: "pending_approval",
      revisions_remaining: cap - op.revisions_used - Number(pending.n) - 1,
    },
  };
}

export async function uploadOwnedAsset(db, env, customer, orderId, file, now) {
  const order = await ownedOrder(db, customer.id, orderId);
  if (!order) return NOT_FOUND;
  if (order.state !== "PAID" && order.state !== "READY_FOR_PRODUCTION") {
    return { status: 409, body: { ok: false, code: "not_paid" } };
  }
  return storeCustomerAsset(db, env, customer, orderId, file, now);
}

export async function createDownloadGrant(db, customer, orderId, now) {
  const order = await ownedOrder(db, customer.id, orderId);
  if (!order) return NOT_FOUND;
  const op = await db.get("SELECT delivery_status, delivery_object_key FROM order_operations WHERE order_id = ?", [orderId]);
  if (!op || op.delivery_status !== "ready" || !op.delivery_object_key) {
    return { status: 404, body: { ok: false, code: "not_available", delivered: false } };
  }
  const token = randomToken(32);
  const expires = new Date(Date.parse(now) + 10 * 60 * 1000).toISOString();
  await db.run(
    "INSERT INTO download_grants (token_hash, order_id, object_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [await sha256Hex(token), orderId, op.delivery_object_key, expires, now]
  );
  return {
    status: 200,
    body: {
      ok: true,
      delivered: true,
      expires_at: expires,
      download_path: `/api/account/orders/${orderId}/file?grant=${encodeURIComponent(token)}`,
    },
  };
}

export async function readDeliveryObject(db, customer, env, orderId, grant, now) {
  const order = await ownedOrder(db, customer.id, orderId);
  if (!order || !grant) return NOT_FOUND;
  const row = await db.get(
    "SELECT object_key, expires_at FROM download_grants WHERE token_hash = ? AND order_id = ?",
    [await sha256Hex(grant), orderId]
  );
  if (!row || Date.parse(row.expires_at) <= Date.parse(now)) return NOT_FOUND;
  const bucket = env && env.ASSET_BUCKET;
  if (!bucket || typeof bucket.get !== "function") {
    return { status: 503, body: { ok: false, code: "uploads_disabled" } };
  }
  const object = await bucket.get(row.object_key);
  if (!object) return { status: 404, body: { ok: false, code: "storage_not_verified", delivered: false } };
  await db.run("DELETE FROM download_grants WHERE token_hash = ?", [await sha256Hex(grant)]);
  return {
    status: 200,
    bytes: object.bytes || object,
    headers: {
      "Content-Type": object.contentType || "application/octet-stream",
      "Content-Disposition": "attachment",
      "Cache-Control": "no-store",
    },
  };
}
