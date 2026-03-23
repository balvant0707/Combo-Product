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

  const shopFields = {
    accessToken:   session.accessToken ?? null,
    installed:     true,
    status:        "installed",
    ownerName:     details?.shopOwnerName ?? null,
    email:         details?.email ?? null,
    contactEmail:  details?.contactEmail ?? null,
    name:          details?.name ?? null,
    country:       details?.billingAddress?.country ?? null,
    city:          details?.billingAddress?.city ?? null,
    currency:      details?.currencyCode ?? null,
    phone:         details?.billingAddress?.phone ?? null,
    primaryDomain: details?.primaryDomain?.host ?? null,
    plan:          details?.plan?.displayName ?? null,
    uninstalledAt: null,
  };

  // ── Atomic install detection ──────────────────────────────────────────────
  // Strategy: perform the DB write and detect the install type in one atomic
  // step so the "shouldSendEmail" flag is never separated from the write that
  // clears uninstalledAt (which was the previous race-condition bug).
  //
  // 1. Try reinstall:  updateMany WHERE uninstalledAt IS NOT NULL OR installed=false
  //    → count > 0  means THIS request owns the reinstall event
  // 2. Try first install: create (catches P2002 if a concurrent request races)
  //    → success   means THIS request is the very first install
  // 3. Otherwise it is a normal re-auth of an already-installed shop → no email

  // Step 1 — reinstall
  const reinstallResult = await db.shop.updateMany({
    where: {
      shop: session.shop,
      OR: [{ installed: false }, { uninstalledAt: { not: null } }],
    },
    data: shopFields,
  });

  if (reinstallResult.count > 0) {
    console.info("[DB Sync] reinstall detected", { shop: session.shop });
    return {
      isNewInstall:   true,
      isFirstInstall: false,
      isReinstall:    true,
      email:      details?.contactEmail || details?.email || null,
      ownerName:  details?.shopOwnerName || null,
      shopName:   details?.name || null,
      shopDomain: session.shop,
      plan:       details?.plan?.displayName || null,
      country:    details?.billingAddress?.country || null,
    };
  }

  // Step 2 — first install (try to create; ignore P2002 from concurrent races)
  try {
    await db.shop.create({
      data: { shop: session.shop, ...shopFields, onboardedAt: new Date() },
    });
    console.info("[DB Sync] first install detected", { shop: session.shop });
    return {
      isNewInstall:   true,
      isFirstInstall: true,
      isReinstall:    false,
      email:      details?.contactEmail || details?.email || null,
      ownerName:  details?.shopOwnerName || null,
      shopName:   details?.name || null,
      shopDomain: session.shop,
      plan:       details?.plan?.displayName || null,
      country:    details?.billingAddress?.country || null,
    };
  } catch (err) {
    if (err.code !== "P2002") throw err;
    // Another concurrent request already created the record — fall through to re-auth
  }

  // Step 3 — re-auth: shop already installed, just refresh fields
  await db.shop.update({
    where: { shop: session.shop },
    data:  shopFields,
  });

  return {
    isNewInstall:   false,
    isFirstInstall: false,
    isReinstall:    false,
    email:      details?.contactEmail || details?.email || null,
    ownerName:  details?.shopOwnerName || null,
    shopName:   details?.name || null,
    shopDomain: session.shop,
    plan:       details?.plan?.displayName || null,
    country:    details?.billingAddress?.country || null,
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
