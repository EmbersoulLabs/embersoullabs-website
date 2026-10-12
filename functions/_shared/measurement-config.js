/**
 * Public measurement IDs come only from the environment.
 * Missing or malformed IDs keep event delivery disabled.
 */

const GA4_ID = /^G-[A-Z0-9]{4,20}$/;
const ADS_ID = /^AW-[0-9]{6,20}$/;
const LABEL = /^[A-Za-z0-9_-]{1,40}$/;

function readId(env, name, pattern) {
  const value = env && typeof env[name] === "string" ? env[name].trim() : "";
  return pattern.test(value) ? value : null;
}

export function readMeasurementConfig(env) {
  const ga4 = readId(env, "GA4_MEASUREMENT_ID", GA4_ID);
  const ads = readId(env, "GOOGLE_ADS_ID", ADS_ID);
  const purchaseLabel = readId(env, "GOOGLE_ADS_PURCHASE_LABEL", LABEL);
  const inquiryLabel = readId(env, "GOOGLE_ADS_INQUIRY_LABEL", LABEL);
  const purchaseSendTo = ads && purchaseLabel ? `${ads}/${purchaseLabel}` : null;
  const inquirySendTo = ads && inquiryLabel ? `${ads}/${inquiryLabel}` : null;
  const delivery = ga4 || purchaseSendTo || inquirySendTo ? "consent_required" : "disabled";
  return {
    ok: true,
    delivery,
    ga4,
    ads,
    purchase_send_to: purchaseSendTo,
    inquiry_send_to: inquirySendTo,
  };
}
