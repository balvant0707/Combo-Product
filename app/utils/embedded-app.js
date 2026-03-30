const EMBEDDED_APP_PARAM_KEYS = ["embedded", "host", "shop", "locale"];
const SHOPIFY_ADMIN_HOST = "admin.shopify.com";
const SHOPIFY_APP_HANDLE =
  process.env.SHOPIFY_APP_HANDLE?.trim() || "mixbox-box-bundle-builder";

export function withEmbeddedAppParams(target, currentSearch = "") {
  const baseUrl = new URL("https://app.local");
  const nextUrl = new URL(target, baseUrl);
  const currentParams = new URLSearchParams(currentSearch);

  for (const key of EMBEDDED_APP_PARAM_KEYS) {
    const value = currentParams.get(key);
    if (value && !nextUrl.searchParams.has(key)) {
      nextUrl.searchParams.set(key, value);
    }
  }

  const search = nextUrl.searchParams.toString();
  return `${nextUrl.pathname}${search ? `?${search}` : ""}${nextUrl.hash}`;
}

export function withEmbeddedAppParamsFromRequest(target, request) {
  return withEmbeddedAppParams(target, new URL(request.url).search);
}

function getStoreHandle(shop) {
  return String(shop || "").replace(/\.myshopify\.com$/i, "");
}

export function buildShopifyAdminAppUrl({ shop, path = "/app", request }) {
  const storeHandle = getStoreHandle(shop);
  if (!storeHandle) {
    throw new Error("Missing shop for Shopify admin app URL.");
  }

  const targetUrl = new URL(path, "https://app.local");
  const adminUrl = new URL(
    `https://${SHOPIFY_ADMIN_HOST}/store/${storeHandle}/apps/${SHOPIFY_APP_HANDLE}${targetUrl.pathname}`,
  );

  targetUrl.searchParams.forEach((value, key) => {
    adminUrl.searchParams.set(key, value);
  });

  if (request) {
    const requestUrl = new URL(request.url);
    const locale = requestUrl.searchParams.get("locale");
    if (locale && !adminUrl.searchParams.has("locale")) {
      adminUrl.searchParams.set("locale", locale);
    }
  }

  adminUrl.hash = targetUrl.hash;
  return adminUrl.toString();
}
