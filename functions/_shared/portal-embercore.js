/**
 * EmberCore contract. This module does not call a guessed production URL.
 * Without a configured receiver, events stay SYNC_PENDING.
 */
import { randomToken, timingSafeEqual } from "./order-access.js";

const TENANT = "embersoullabs-website";

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyEmbercoreSignature(payload, header, secret, nowIso) {
  if (typeof header !== "string" || !secret) return false;
  const stamp = header.match(/(?:^|,)t=(\d+)/);
  const signatures = [...header.matchAll(/(?:^|,)v1=([a-f0-9]+)/g)].map((match) => match[1]);
  if (!stamp || !signatures.length) return false;
  const ts = Number(stamp[1]);
  const now = Math.floor(Date.parse(nowIso) / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const hex = await hmacHex(secret, `${stamp[1]}.${payload}`);
  return signatures.some((value) => timingSafeEqual(hex, value));
}

async function timeline(db, orderId, status, actor, now) {
  const existing = await db.get(
    "SELECT id FROM order_timeline WHERE order_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1",
    [orderId, status]
  );
  if (existing && status !== "IN_PRODUCTION") return;
  await db.run(
    `INSERT INTO order_timeline (id, order_id, status, note, actor, created_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
    [`tl_${randomToken(12)}`, orderId, status, actor, now]
  );
}

export async function enqueueReadyForProduction(db, orderId, now) {
  const order = await db.get(
    `SELECT id, state, service, region, lookup_key, currency, amount_total, emberos_production
     FROM orders WHERE id = ?`,
    [orderId]
  );
  const brief = await db.get("SELECT * FROM creative_briefs WHERE order_id = ?", [orderId]);
  if (!order || !brief || order.state !== "READY_FOR_PRODUCTION") {
    return { sync: "SYNC_PENDING", queued: false };
  }
  const id = `ready:${orderId}`;
  const payload = {
    id,
    type: "order.ready_for_production",
    tenant: TENANT,
    order_id: order.id,
    paid: true,
    financial_state: order.state,
    service: order.service,
    region: order.region,
    lookup_key: order.lookup_key,
    currency: order.currency,
    amount_total: order.amount_total,
    brief: {
      business_name: brief.business_name || null,
      promotion_text: brief.promotion_text,
      objective: brief.objective || null,
      audience: brief.audience || null,
      language: brief.language,
      visual_style: brief.visual_style || null,
      asset_links: brief.asset_links || null,
      special_instructions: brief.special_instructions || null,
      contact: brief.contact,
      asset_status: brief.asset_status,
    },
    emberos_production: "not_connected",
  };
  await db.run(
    `INSERT INTO embercore_outbox (
       id, event_type, order_id, payload_json, status, attempts, next_attempt_at, last_error, created_at, delivered_at
     ) VALUES (?, 'order.ready_for_production', ?, ?, 'SYNC_PENDING', 0, NULL, NULL, ?, NULL)
     ON CONFLICT(id) DO NOTHING`,
    [id, orderId, JSON.stringify(payload), now]
  );
  return { sync: "SYNC_PENDING", queued: true, event_id: id };
}

function retryDelayMs(attempts) {
  return Math.min(86400, 60 * 2 ** attempts) * 1000;
}

export async function dispatchEmbercoreOutbox(db, env, now, fetchImpl) {
  const url = env && env.EMBERCORE_WEBHOOK_URL;
  const secret = env && env.EMBERCORE_OUTBOUND_SECRET;
  if (!url || !secret) {
    return { ok: true, sync: "SYNC_PENDING", delivered: 0, reason: "receiver_not_configured" };
  }
  const send = typeof fetchImpl === "function" ? fetchImpl : fetch;
  const rows = await db.all(
    `SELECT id, order_id, payload_json, attempts FROM embercore_outbox
     WHERE status = 'SYNC_PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY created_at ASC LIMIT 10`,
    [now]
  );
  let delivered = 0;
  for (const row of rows || []) {
    const ts = Math.floor(Date.parse(now) / 1000);
    const signature = await hmacHex(secret, `${ts}.${row.payload_json}`);
    let status = 0;
    try {
      const response = await send(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-EmberCore-Signature": `t=${ts},v1=${signature}`,
        },
        body: row.payload_json,
      });
      status = response && response.status ? response.status : 0;
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      await db.run(
        `UPDATE embercore_outbox
         SET status = 'delivered', attempts = attempts + 1, delivered_at = ?, last_error = NULL
         WHERE id = ? AND status = 'SYNC_PENDING'`,
        [now, row.id]
      );
      await db.run(
        "UPDATE order_operations SET sync_status = 'delivered', updated_at = ? WHERE order_id = ?",
        [now, row.order_id]
      );
      delivered += 1;
    } else {
      const attempts = row.attempts + 1;
      const next = new Date(Date.parse(now) + retryDelayMs(attempts)).toISOString();
      const failed = attempts >= 8;
      await db.run(
        `UPDATE embercore_outbox
         SET attempts = ?, next_attempt_at = ?, last_error = ?, status = ?
         WHERE id = ?`,
        [attempts, next, `http_${status}`, failed ? "failed" : "SYNC_PENDING", row.id]
      );
    }
  }
  return { ok: true, sync: delivered ? "delivered" : "SYNC_PENDING", delivered };
}

function notFound() {
  return { status: 404, body: { ok: false, code: "not_found" } };
}

export async function handleEmbercoreEvent(db, env, rawBody, signature, now, bucket) {
  if (!env || !env.EMBERCORE_INBOUND_SECRET) {
    return { status: 503, body: { ok: false, code: "embercore_not_configured", sync: "SYNC_PENDING" } };
  }
  const valid = await verifyEmbercoreSignature(rawBody, signature, env.EMBERCORE_INBOUND_SECRET, now);
  if (!valid) return { status: 401, body: { ok: false, code: "bad_signature" } };
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, code: "invalid_json" } };
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string" || typeof event.order_id !== "string") {
    return { status: 400, body: { ok: false, code: "invalid_event" } };
  }
  const seen = await db.get("SELECT event_id FROM embercore_inbound WHERE event_id = ?", [event.id]);
  if (seen) return { status: 200, body: { ok: true, duplicate: true, sync: "SYNC_PENDING" } };
  const order = await db.get("SELECT id, state FROM orders WHERE id = ?", [event.order_id]);
  if (!order) return notFound();
  const op = await db.get("SELECT * FROM order_operations WHERE order_id = ?", [event.order_id]);
  if (!op) return { status: 409, body: { ok: false, code: "operation_missing" } };

  if (event.type === "production.status") {
    const next = event.workflow_status;
    if (next !== "IN_PRODUCTION" && next !== "REVIEW") {
      return { status: 400, body: { ok: false, code: "invalid_status" } };
    }
    const allowed =
      (op.workflow_status === next) ||
      (op.workflow_status === "BRIEF_RECEIVED" && next === "IN_PRODUCTION") ||
      (op.workflow_status === "IN_PRODUCTION" && next === "REVIEW") ||
      (op.workflow_status === "REVIEW" && next === "IN_PRODUCTION");
    if (!allowed) return { status: 409, body: { ok: false, code: "invalid_transition" } };
    if (op.workflow_status !== next) {
      await db.run(
        "UPDATE order_operations SET workflow_status = ?, updated_at = ? WHERE order_id = ?",
        [next, now, event.order_id]
      );
      await timeline(db, event.order_id, next, "embercore", now);
    }
  } else if (event.type === "revision.decision") {
    if (event.decision !== "approved" && event.decision !== "rejected") {
      return { status: 400, body: { ok: false, code: "invalid_decision" } };
    }
    const revision = await db.get(
      "SELECT id, status FROM revision_requests WHERE id = ? AND order_id = ?",
      [event.revision_id, event.order_id]
    );
    if (!revision) return notFound();
    if (revision.status === "pending_approval") {
      if (event.decision === "approved") {
        const cap = op.revision_allowance * op.video_slots;
        if (op.revisions_used >= cap) {
          return { status: 409, body: { ok: false, code: "revision_limit" } };
        }
      }
      const changed = await db.run(
        "UPDATE revision_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending_approval'",
        [event.decision, now, revision.id]
      );
      if (changed.changes && event.decision === "approved") {
        await db.run(
          `UPDATE order_operations
           SET revisions_used = revisions_used + 1, workflow_status = 'IN_PRODUCTION', updated_at = ?
           WHERE order_id = ? AND revisions_used < ?`,
          [now, event.order_id, op.revision_allowance * op.video_slots]
        );
      }
    }
  } else if (event.type === "production.capacity") {
    const slots = event.video_slots;
    if (!Number.isInteger(slots) || slots < op.video_slots || slots > 24) {
      return { status: 400, body: { ok: false, code: "invalid_capacity" } };
    }
    await db.run(
      "UPDATE order_operations SET video_slots = ?, updated_at = ? WHERE order_id = ?",
      [slots, now, event.order_id]
    );
  } else if (event.type === "delivery.ready") {
    const key = event.object_key;
    if (typeof key !== "string" || key.includes("..") || !key.startsWith(`orders/${event.order_id}/delivery/`)) {
      return { status: 400, body: { ok: false, code: "invalid_object_key" } };
    }
    if (!bucket || typeof bucket.head !== "function") {
      return { status: 409, body: { ok: false, code: "storage_not_verified" } };
    }
    const head = await bucket.head(key);
    if (!head) return { status: 409, body: { ok: false, code: "storage_not_verified" } };
    if (!["REVIEW", "IN_PRODUCTION", "DELIVERED"].includes(op.workflow_status)) {
      return { status: 409, body: { ok: false, code: "invalid_transition" } };
    }
    await db.run(
      `UPDATE order_operations
       SET workflow_status = 'DELIVERED', delivery_status = 'ready', delivery_object_key = ?, delivered_at = COALESCE(delivered_at, ?), updated_at = ?
       WHERE order_id = ?`,
      [key, now, now, event.order_id]
    );
    await timeline(db, event.order_id, "DELIVERED", "embercore", now);
  } else {
    return { status: 400, body: { ok: false, code: "unknown_event" } };
  }

  await db.run(
    "INSERT INTO embercore_inbound (event_id, event_type, order_id, received_at) VALUES (?, ?, ?, ?)",
    [event.id, event.type, event.order_id, now]
  );
  await db.run(
    "INSERT INTO portal_audit (id, actor, action, order_id, created_at) VALUES (?, 'embercore', ?, ?, ?)",
    [`aud_${randomToken(12)}`, event.type, event.order_id, now]
  );
  return { status: 200, body: { ok: true, duplicate: false, embercore_sync_live: false, sync: "SYNC_PENDING" } };
}
