/**
 * Private order files. Production uploads stay disabled until both a private
 * bucket and a malware scanner binding exist. Nothing here mints a public URL.
 */
import { randomToken } from "./order-access.js";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_TOTAL = 20 * 1024 * 1024;

const TYPES = Object.freeze({
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
});

export function uploadsEnabled(env) {
  const bucket = env && env.ASSET_BUCKET;
  const scanner = env && env.ASSET_SCANNER;
  return !!(
    bucket &&
    typeof bucket.put === "function" &&
    typeof bucket.head === "function" &&
    scanner &&
    typeof scanner.scan === "function"
  );
}

function extensionOf(filename) {
  const clean = String(filename || "").split(/[/\\]/).pop();
  const match = clean.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : "";
}

function sniff(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return "";
}

export async function storeCustomerAsset(db, env, customer, orderId, file, now) {
  if (!uploadsEnabled(env)) {
    return { status: 503, body: { ok: false, code: "uploads_disabled" } };
  }
  const filename = String((file && file.filename) || "").split(/[/\\]/).pop();
  if (!/^[A-Za-z0-9._ -]{1,80}$/.test(filename) || filename.includes("..")) {
    return { status: 400, body: { ok: false, code: "invalid_file", field: "filename" } };
  }
  const bytes = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array();
  if (!bytes.length || bytes.length > MAX_BYTES) {
    return { status: 400, body: { ok: false, code: "invalid_file", field: "size" } };
  }
  const sniffed = sniff(bytes);
  const ext = extensionOf(filename);
  if (!sniffed || !(TYPES[sniffed] || []).includes(ext)) {
    return { status: 400, body: { ok: false, code: "invalid_file", field: "type" } };
  }
  const text = new TextDecoder().decode(bytes.slice(0, 256));
  if (/<script|<\?php/i.test(text)) {
    return { status: 400, body: { ok: false, code: "unsafe_file" } };
  }
  const scan = await env.ASSET_SCANNER.scan(bytes, filename);
  if (!scan || scan.ok !== true) {
    return { status: 400, body: { ok: false, code: "unsafe_file" } };
  }
  const count = await db.get(
    "SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM order_assets WHERE order_id = ?",
    [orderId]
  );
  if ((count && count.n) >= MAX_FILES || (count ? count.bytes : 0) + bytes.length > MAX_TOTAL) {
    return { status: 409, body: { ok: false, code: "storage_limit" } };
  }
  const id = `ast_${randomToken(12)}`;
  const objectKey = `orders/${orderId}/customer/${id}`;
  await env.ASSET_BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: sniffed } });
  const head = await env.ASSET_BUCKET.head(objectKey);
  if (!head) return { status: 503, body: { ok: false, code: "uploads_disabled" } };
  await db.run(
    `INSERT INTO order_assets (id, order_id, customer_id, object_key, filename, content_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orderId, customer.id, objectKey, filename, sniffed, bytes.length, now]
  );
  return {
    status: 200,
    body: { ok: true, asset_id: id, filename, content_type: sniffed, size_bytes: bytes.length },
  };
}
