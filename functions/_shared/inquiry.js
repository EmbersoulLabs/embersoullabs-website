/**
 * Inquiry acceptance. A conversion id is returned only after the support email is accepted.
 * The response never includes the visitor's name, email, or phone.
 */
import { randomToken, sha256Hex } from "./order-access.js";

const SERVICES = new Set(["short", "story", "monthly", "unsure"]);
const REGIONS = new Set(["my", "sg", "intl"]);
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 5;

function text(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function validateInquiry(body) {
  if (!body || typeof body !== "object") return { ok: false, code: "invalid_json" };
  if (typeof body._honey === "string" && body._honey.trim()) return { ok: true, ignored: true };
  if (body.agree_privacy !== "yes") return { ok: false, code: "privacy_required" };
  const service = text(body.ad_type, 20);
  if (!SERVICES.has(service)) return { ok: false, code: "invalid_service" };
  const name = text(body.contact_name, 80);
  const business = text(body.business_name, 120);
  const contact = text(body.email_or_contact, 120);
  const brief = text(body.product_brief, 2000);
  if (!name || !business || !contact || !brief) return { ok: false, code: "missing_fields" };
  const region = REGIONS.has(body.region) ? body.region : null;
  const details = {
    has_assets: text(body.has_assets, 20),
    preferred_language: text(body.preferred_language, 20),
    additional_notes: text(body.additional_notes, 1500),
    monthly_content_format: text(body.monthly_content_format, 40),
    story_concept: text(body.story_concept, 1500),
    displayed_price: text(body.displayed_price, 40),
  };
  return {
    ok: true,
    ignored: false,
    inquiry: { service, region, name, business, contact, brief, details },
  };
}

function mailText(inquiry) {
  return [
    "AI Ads inquiry",
    `Package: ${inquiry.service}`,
    `Region: ${inquiry.region || "unspecified"}`,
    `Name: ${inquiry.name}`,
    `Business: ${inquiry.business}`,
    `Contact: ${inquiry.contact}`,
    `Promoting: ${inquiry.brief}`,
    `Assets: ${inquiry.details.has_assets || "-"}`,
    `Language: ${inquiry.details.preferred_language || "-"}`,
    `Notes: ${inquiry.details.additional_notes || "-"}`,
    `Monthly format: ${inquiry.details.monthly_content_format || "-"}`,
    `Story: ${inquiry.details.story_concept || "-"}`,
    `Displayed price: ${inquiry.details.displayed_price || "-"}`,
  ].join("\n");
}

async function limited(db, bucket, nowIso) {
  const now = Date.parse(nowIso);
  const row = await db.get(
    "SELECT window_start, hits FROM inquiry_rate_limits WHERE bucket = ?",
    [bucket]
  );
  if (!row || Date.parse(row.window_start) + WINDOW_MS <= now) {
    await db.run(
      `INSERT INTO inquiry_rate_limits (bucket, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, hits = 1`,
      [bucket, nowIso]
    );
    return false;
  }
  if (row.hits >= LIMIT) return true;
  await db.run("UPDATE inquiry_rate_limits SET hits = hits + 1 WHERE bucket = ?", [bucket]);
  return false;
}

async function sendMail(env, mailer, message) {
  if (typeof mailer === "function") return mailer(message);
  if (!env || !env.RESEND_API_KEY || !env.PORTAL_EMAIL_FROM) {
    return { ok: false, code: "email_not_configured" };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.PORTAL_EMAIL_FROM,
      to: [env.INQUIRY_TO_EMAIL || "support@embersoullabs.com"],
      subject: message.subject,
      text: message.text,
    }),
  });
  if (response.status >= 400) return { ok: false, code: "email_failed" };
  return { ok: true };
}

export async function acceptInquiry(db, env, input) {
  const validated = validateInquiry(input.body);
  if (!validated.ok) return { status: 400, body: { ok: false, code: validated.code } };
  if (validated.ignored) return { status: 200, body: { ok: true, ignored: true } };
  const now = input.now || new Date().toISOString();
  const bucket = await sha256Hex(input.ip || "unknown");
  if (await limited(db, bucket, now)) return { status: 429, body: { ok: false, code: "rate_limited" } };
  const inquiry = validated.inquiry;
  const mailed = await sendMail(env, input.mailer, {
    subject: "AI Ad enquiry — EmberSoul Labs",
    text: mailText(inquiry),
  });
  if (!mailed.ok) {
    const status = mailed.code === "email_not_configured" ? 503 : 502;
    return { status, body: { ok: false, code: mailed.code } };
  }
  const id = `inq_${randomToken(18)}`;
  try {
    await db.run(
      `INSERT INTO inquiries (
         id, created_at, service, region, contact_name, business_name, contact, product_brief, details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        now,
        inquiry.service,
        inquiry.region,
        inquiry.name,
        inquiry.business,
        inquiry.contact,
        inquiry.brief,
        JSON.stringify(inquiry.details),
      ]
    );
  } catch {
    return { status: 200, body: { ok: true, emailed: true } };
  }
  return { status: 200, body: { ok: true, emailed: true, inquiry_id: id } };
}
