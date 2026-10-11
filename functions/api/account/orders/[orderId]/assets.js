import { uploadOwnedAsset } from "../../../../_shared/portal-orders.js";
import { customerContext } from "../../../../_shared/portal-http.js";
import { jsonResponse } from "../../../../_shared/stripe.js";

export async function onRequestPost(context) {
  const ctx = await customerContext(context.env, context.request);
  if (ctx.error) return ctx.error;
  const type = context.request.headers.get("Content-Type") || "";
  if (!type.includes("multipart/form-data")) {
    return jsonResponse({ ok: false, code: "invalid_file" }, 400);
  }
  const form = await context.request.formData();
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") {
    return jsonResponse({ ok: false, code: "invalid_file" }, 400);
  }
  const result = await uploadOwnedAsset(
    ctx.db,
    context.env,
    ctx.customer,
    context.params.orderId,
    {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
    ctx.now
  );
  return jsonResponse(result.body, result.status);
}
