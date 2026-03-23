import db from "../db.server";

const SHOP_DETAILS_QUERY = `#graphql
  query AppShopDetails {
    shop {
      name
      email
      contactEmail
      shopOwnerName
      currencyCode
      billingAddress {
        country
        city
        phone
      }
      primaryDomain {
        host
      }
      plan {
        displayName
      }
    }
  }
`;

function toBigIntOrNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeScope(scope) {
  if (Array.isArray(scope)) return scope.join(",");
  if (scope === undefined || scope === null) return null;
  return String(scope);
}

export async function upsertSessionFromAuth(session) {
  console.info("[DB Sync] upsertSessionFromAuth", {
    shop: session.shop,
    sessionId: session.id,
    isOnline: session.isOnline,
  });

  const associatedUser = session.onlineAccessInfo?.associated_user;

  await db.session.upsert({
    where: { id: session.id },
    create: {
      id: session.id,
      shop: session.shop,
      state: session.state ?? "",
      isOnline: session.isOnline,
      scope: normalizeScope(session.scope),
      expires: session.expires ?? null,
      accessToken: session.accessToken ?? "",
      userId: toBigIntOrNull(associatedUser?.id),
      firstName: associatedUser?.first_name ?? null,
      lastName: associatedUser?.last_name ?? null,
      email: associatedUser?.email ?? null,
      accountOwner: associatedUser?.account_owner ?? false,
      locale: associatedUser?.locale ?? null,
      collaborator: associatedUser?.collaborator ?? false,
      emailVerified: associatedUser?.email_verified ?? false,
      refreshToken: session.refreshToken ?? null,
      refreshTokenExpires: session.refreshTokenExpires ?? null,
    },
    update: {
      shop: session.shop,
      state: session.state ?? "",
      isOnline: session.isOnline,
      scope: normalizeScope(session.scope),
      expires: session.expires ?? null,
      accessToken: session.accessToken ?? "",
      userId: toBigIntOrNull(associatedUser?.id),
      firstName: associatedUser?.first_name ?? null,
      lastName: associatedUser?.last_name ?? null,
      email: associatedUser?.email ?? null,
      accountOwner: associatedUser?.account_owner ?? false,
      locale: associatedUser?.locale ?? null,
      collaborator: associatedUser?.collaborator ?? false,
      emailVerified: associatedUser?.email_verified ?? false,
      refreshToken: session.refreshToken ?? null,
      refreshTokenExpires: session.refreshTokenExpires ?? null,
    },
  });
}

export async function upsertShopFromAdmin(session, admin) {
  console.info("[DB Sync] upsertShopFromAdmin", {
    shop: session.shop,
    sessionId: session.id,
  });

  const response = await admin.graphql(SHOP_DETAILS_QUERY);
  const body = await response.json();
  const details = body?.data?.shop;

  // Check previous state so callers can detect a fresh install / reinstall
  const existing = await db.shop.findUnique({
    where: { shop: session.shop },
    select: { installed: true },
  });
  const wasInstalled = existing?.installed === true;

  await db.shop.upsert({
    where: { shop: session.shop },
    create: {
      shop: session.shop,
      accessToken: session.accessToken ?? null,
      installed: true,
      status: "installed",
      ownerName: details?.shopOwnerName ?? null,
      email: details?.email ?? null,
      contactEmail: details?.contactEmail ?? null,
      name: details?.name ?? null,
      country: details?.billingAddress?.country ?? null,
      city: details?.billingAddress?.city ?? null,
      currency: details?.currencyCode ?? null,
      phone: details?.billingAddress?.phone ?? null,
      primaryDomain: details?.primaryDomain?.host ?? null,
      plan: details?.plan?.displayName ?? null,
      onboardedAt: new Date(),
      uninstalledAt: null,
    },
    update: {
      accessToken: session.accessToken ?? null,
      installed: true,
      status: "installed",
      ownerName: details?.shopOwnerName ?? null,
      email: details?.email ?? null,
      contactEmail: details?.contactEmail ?? null,
      name: details?.name ?? null,
      country: details?.billingAddress?.country ?? null,
      city: details?.billingAddress?.city ?? null,
      currency: details?.currencyCode ?? null,
      phone: details?.billingAddress?.phone ?? null,
      primaryDomain: details?.primaryDomain?.host ?? null,
      plan: details?.plan?.displayName ?? null,
      uninstalledAt: null,
    },
  });

  return {
    isNewInstall: !wasInstalled,
    email: details?.contactEmail || details?.email || null,
    ownerName: details?.shopOwnerName || null,
    shopName: details?.name || null,
    shopDomain: session.shop,
  };
}

export async function markShopUninstalled(shop) {
  console.info("[DB Sync] markShopUninstalled", { shop });

  await db.shop.upsert({
    where: { shop },
    create: {
      shop,
      installed: false,
      status: "uninstalled",
      accessToken: null,
      uninstalledAt: new Date(),
    },
    update: {
      installed: false,
      status: "uninstalled",
      accessToken: null,
      uninstalledAt: new Date(),
    },
  });
}

export async function updateShopScope(shop, scope) {
  console.info("[DB Sync] updateShopScope", {
    shop,
    scope: normalizeScope(scope),
  });

  await db.session.updateMany({
    where: { shop },
    data: { scope: normalizeScope(scope) },
  });
}
