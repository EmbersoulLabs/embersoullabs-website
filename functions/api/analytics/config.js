import { readMeasurementConfig } from "../../_shared/measurement-config.js";
import { jsonResponse } from "../../_shared/stripe.js";

export async function onRequestGet(context) {
  return jsonResponse(readMeasurementConfig(context.env || {}));
}
