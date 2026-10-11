/**
 * Passwordless customer login. OTP and session tokens are stored only as hashes.
 * A missing account and an existing account return the same start response.
 */
import { randomToken, sha256Hex, timingSafeEqual } from "./order-access.js";

export const PORTAL_COOKIE = "es_portal";
const START_LIMIT = 5;
const START_WINDOW_MS = 60 * 60 * 1000;
const IP_START_LIMIT = 20;
const VERIFY_IP_LIMIT = 30;
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 120) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  return email;
}

export function sessionCookie(token, { secure }) {
  const parts = [
    `${PORTAL_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=1209600",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie({ secure }) {
  const parts = [
    `${PORTAL_COOKIE}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(request, name) {
  const header = request && request.headers && request.headers.get("Cookie");
  if (!header) return "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function cookieSecure(env, request) {
  const mode = String((env && (env.ENVIRONMENT || env.APP_ENV || env.NODE_ENV)) || "").toLowerCase();
  if (mode === "production" || mode === "prod") return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function randomCode() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const n = (buf[0] * 16777216 + buf[1] * 65536 + buf[2] * 256 + buf[3]) >>> 0;
  return String(n % 1000000).padStart(6, "0");
}

async function codeHash(challengeId, code) {
  return sha256Hex(`${challengeId}:${code}`);
}

export function mailConfigured(env, mailer) {
  if (typeof mailer === "function") return true;
  return !!(env && env.RESEND_API_KEY && env.PORTAL_EMAIL_FROM);
}

async function sendMail(env, mailer, message) {
  if (typeof mailer === "function") return mailer(message);
  if (!env.RESEND_API_KEY || !env.PORTAL_EMAIL_FROM) {
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
      to: [message.to],
      subject: message.subject,
      text: message.text,
    }),
  });
  if (response.status >= 400) return { ok: false, code: "email_failed" };
  return { ok: true };
}

async function hitLimit(db, bucket, limit, nowIso) {
  const now = Date.parse(nowIso);
  const row = await db.get(
    "SELECT window_start, hits FROM auth_rate_limits WHERE bucket = ?",
    [bucket]
  );
  if (!row || Date.parse(row.window_start) + START_WINDOW_MS <= now) {
    await db.run(
      `INSERT INTO auth_rate_limits (bucket, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, hits = 1`,
      [bucket, nowIso]
    );
    return false;
  }
  if (row.hits >= limit) return true;
  await db.run("UPDATE auth_rate_limits SET hits = hits + 1 WHERE bucket = ?", [bucket]);
  return false;
}

export async function startLogin(db, env, input) {
  const email = normalizeEmail(input.email);
  if (!email) return { status: 400, body: { ok: false, code: "invalid_email" } };
  if (!mailConfigured(env, input.mailer)) {
    return { status: 503, body: { ok: false, code: "email_not_configured" } };
  }
  const now = input.now || new Date().toISOString();
  const emailHash = await sha256Hex(email);
  const ipHash = await sha256Hex(input.ip || "unknown");
  const emailLimited = await hitLimit(db, `email:${emailHash}`, START_LIMIT, now);
  const ipLimited = await hitLimit(db, `ip:${ipHash}`, IP_START_LIMIT, now);
  if (emailLimited || ipLimited) {
    return { status: 200, body: { ok: true } };
  }
  const id = `ch_${randomToken(18)}`;
  const code = randomCode();
  const expires = new Date(Date.parse(now) + OTP_TTL_MS).toISOString();
  await db.run(
    `INSERT INTO auth_challenges (id, email, email_hash, code_hash, expires_at, consumed_at, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 0, ?)`,
    [id, email, emailHash, await codeHash(id, code), expires, now]
  );
  const origin = String((env && env.SITE_ORIGIN) || input.origin || "").replace(/\/$/, "");
  const link = origin ? `${origin}/login/?challenge=${encodeURIComponent(id)}&code=${encodeURIComponent(code)}` : "";
  const sent = await sendMail(env, input.mailer, {
    to: email,
    subject: "Your EmberSoul Labs login code",
    text: `Your login code is ${code}. It expires in 10 minutes and works once.${link ? `\n\n${link}` : ""}`,
  });
  if (!sent || sent.ok === false) {
    await db.run("DELETE FROM auth_challenges WHERE id = ?", [id]);
    return { status: 503, body: { ok: false, code: sent && sent.code ? sent.code : "email_failed" } };
  }
  return { status: 200, body: { ok: true } };
}

async function invalidCode() {
  await sha256Hex("missing-challenge");
  return { status: 400, body: { ok: false, code: "invalid_code" } };
}

export async function verifyLogin(db, env, input) {
  const now = input.now || new Date().toISOString();
  const ipHash = await sha256Hex(input.ip || "unknown");
  if (await hitLimit(db, `verify:${ipHash}`, VERIFY_IP_LIMIT, now)) {
    return { status: 429, body: { ok: false, code: "rate_limited" } };
  }
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!/^[0-9]{6}$/.test(code)) return invalidCode();

  let challenge = null;
  if (typeof input.challengeId === "string" && input.challengeId.startsWith("ch_")) {
    challenge = await db.get("SELECT * FROM auth_challenges WHERE id = ?", [input.challengeId]);
  } else {
    const email = normalizeEmail(input.email);
    if (!email) return invalidCode();
    const emailHash = await sha256Hex(email);
    challenge = await db.get(
      `SELECT * FROM auth_challenges
       WHERE email_hash = ? AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [emailHash]
    );
  }
  if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.parse(now)) {
    return invalidCode();
  }
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) return invalidCode();
  const expected = await codeHash(challenge.id, code);
  if (!timingSafeEqual(expected, challenge.code_hash)) {
    const attempts = challenge.attempts + 1;
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await db.run(
        "UPDATE auth_challenges SET attempts = ?, consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
        [attempts, now, challenge.id]
      );
    } else {
      await db.run("UPDATE auth_challenges SET attempts = ? WHERE id = ?", [attempts, challenge.id]);
    }
    return invalidCode();
  }
  const consumed = await db.run(
    "UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL",
    [now, challenge.id]
  );
  if (!consumed.changes) return invalidCode();

  let customer = await db.get("SELECT id, email FROM customers WHERE email_hash = ?", [challenge.email_hash]);
  if (!customer) {
    const id = `cus_${randomToken(16)}`;
    await db.run(
      "INSERT INTO customers (id, email, email_hash, created_at, verified_at) VALUES (?, ?, ?, ?, ?)",
      [id, challenge.email, challenge.email_hash, now, now]
    );
    customer = { id, email: challenge.email };
  }
  const token = randomToken(32);
  const expires = new Date(Date.parse(now) + SESSION_TTL_MS).toISOString();
  await db.run(
    `INSERT INTO customer_sessions (token_hash, customer_id, expires_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [await sha256Hex(token), customer.id, expires, now]
  );
  await db.run(
    "INSERT INTO portal_audit (id, actor, action, order_id, created_at) VALUES (?, ?, 'login', NULL, ?)",
    [`aud_${randomToken(12)}`, customer.id, now]
  );
  return {
    status: 200,
    cookie: sessionCookie(token, { secure: input.secure === true }),
    body: { ok: true },
  };
}

export async function readSession(db, token, nowIso) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = await db.get(
    `SELECT s.token_hash, s.expires_at, s.revoked_at, c.id, c.email
     FROM customer_sessions s
     JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = ?`,
    [await sha256Hex(token)]
  );
  if (!row || row.revoked_at) return null;
  if (Date.parse(row.expires_at) <= Date.parse(nowIso)) return null;
  return { id: row.id, email: row.email };
}

export async function revokeSession(db, token, nowIso) {
  if (!token) return;
  await db.run(
    "UPDATE customer_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    [nowIso, await sha256Hex(token)]
  );
}

export async function requireCustomer(db, request, nowIso) {
  const token = readCookie(request, PORTAL_COOKIE);
  const customer = await readSession(db, token, nowIso || new Date().toISOString());
  if (!customer) return { status: 401, body: { ok: false, code: "auth_required" } };
  return { status: 200, customer, token };
}
