export async function onRequestGet(context) {
  const orderId = context.params.orderId || "";
  if (!/^ord_[A-Za-z0-9_-]{4,80}$/.test(orderId)) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const assets = context.env && context.env.ASSETS;
  if (assets && typeof assets.fetch === "function") {
    const assetUrl = new URL("/account/orders/_/", context.request.url);
    return assets.fetch(new Request(assetUrl.toString(), context.request));
  }
  return new Response("Customer order", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
