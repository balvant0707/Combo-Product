const EMBEDDED_APP_PARAM_KEYS = ["embedded", "host", "shop", "locale"];

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
