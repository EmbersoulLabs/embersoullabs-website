/**
 * Order authorization. The raw access token is never stored.
 * A wrong token and an unknown session return the same not-found response.
 */
import { completeCreativeBrief } from "./order-state.js";

const NOT_FOUND = { status: 404, body: { ok: false, code: "not_found" } };

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function readAuthorizedOrder(db, sessionId, accessToken) {
  if (
    typeof sessionId !== "string" ||
    typeof accessToken !== "string" ||
    !sessionId ||
    !accessToken ||
    sessionId.length > 255 ||
    accessToken.length > 200
  ) {
    return NOT_FOUND;
  }
  const order = await db.get(
    `SELECT id, state, service, region, brief_status, access_token_hash
     FROM orders WHERE checkout_session_id = ?`,
    [sessionId]
  );
  if (!order || !order.access_token_hash) return NOT_FOUND;
  const hash = await sha256Hex(accessToken);
  if (!timingSafeEqual(hash, order.access_token_hash)) return NOT_FOUND;
  return {
    status: 200,
    order,
    body: {
      ok: true,
      state: order.state,
      service: order.service,
      region: order.region,
      confirmed: order.state === "PAID" || order.state === "READY_FOR_PRODUCTION",
      brief_status: order.brief_status,
      emberos_production: "not_connected",
    },
  };
}

const LANGUAGES = new Set(["en", "zh", "ms", "mix"]);

export async function submitCreativeBrief(db, input) {
  const auth = await readAuthorizedOrder(db, input.sessionId, input.accessToken);
  if (auth.status !== 200) return { status: auth.status, body: auth.body };
  const promotion = typeof input.promotionText === "string" ? input.promotionText.trim() : "";
  const assetsRaw = typeof input.assetStatus === "string" ? input.assetStatus.trim() : "";
  const assets = assetsRaw || "text_only";
  const contact = typeof input.contact === "string" ? input.contact.trim() : "";
  const language = typeof input.language === "string" ? input.language.trim() : "";
  if (promotion.length < 1 || promotion.length > 2000) {
    return { status: 400, body: { ok: false, code: "invalid_brief", field: "promotion_text" } };
  }
  if (!LANGUAGES.has(language)) {
    return { status: 400, body: { ok: false, code: "invalid_brief", field: "language" } };
  }
  if (assets.length > 500) {
    return { status: 400, body: { ok: false, code: "invalid_brief", field: "asset_status" } };
  }
  if (contact.length < 1 || contact.length > 120) {
    return { status: 400, body: { ok: false, code: "invalid_brief", field: "contact" } };
  }
  const existing = await db.get(
    `SELECT promotion_text, asset_status, language, contact
     FROM creative_briefs WHERE order_id = ?`,
    [auth.order.id]
  );
  if (auth.order.state !== "PAID" && !(auth.order.state === "READY_FOR_PRODUCTION" && existing)) {
    return {
      status: 409,
      body: {
        ok: false,
        code: "not_paid",
        state: auth.order.state,
        emberos_production: "not_connected",
      },
    };
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
    const current = await db.get(
      "SELECT state, brief_status FROM orders WHERE id = ?",
      [auth.order.id]
    );
    return {
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        order_id: auth.order.id,
        state: current.state,
        brief_status: current.brief_status,
        confirmed: current.state === "READY_FOR_PRODUCTION",
        emberos_production: "not_connected",
      },
    };
  }
  try {
    const row = await completeCreativeBrief(db, {
      id: input.briefId,
      orderId: auth.order.id,
      promotionText: promotion,
      assetStatus: assets,
      language,
      contact,
      now: input.now,
    });
    return {
      status: 200,
      body: {
        ok: true,
        order_id: auth.order.id,
        state: row.state,
        brief_status: row.brief_status,
        confirmed: row.state === "READY_FOR_PRODUCTION",
        emberos_production: "not_connected",
      },
    };
  } catch (error) {
    if (String(error && error.message).includes("UNIQUE")) {
      return { status: 409, body: { ok: false, code: "brief_exists", emberos_production: "not_connected" } };
    }
    throw error;
  }
}
