/**
 * Bounded Google click IDs and purchase values.
 * These helpers never accept customer names, email, phone, or access tokens.
 */

const CLICK_ID = /^[A-Za-z0-9._-]{1,150}$/;
const CURRENCIES = new Set(["MYR", "SGD", "USD"]);

export function sanitizeClickId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!CLICK_ID.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeAttribution(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    gclid: sanitizeClickId(source.gclid),
    gbraid: sanitizeClickId(source.gbraid),
    wbraid: sanitizeClickId(source.wbraid),
  };
}

export function hasAttribution(attribution) {
  return !!(attribution && (attribution.gclid || attribution.gbraid || attribution.wbraid));
}

export function purchaseValue(amountTotal, currency) {
  const code = String(currency || "").toUpperCase();
  if (!CURRENCIES.has(code)) return null;
  if (!Number.isInteger(amountTotal) || amountTotal <= 0) return null;
  return { value: amountTotal / 100, currency: code };
}
