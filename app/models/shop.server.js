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

const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_PROMPT_DEFAULT_DELAY_DAYS = 7;
const REVIEW_PROMPT_SNOOZE_DAYS = 1;

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

/**
 * Records which app plan the merchant has chosen.
 * status: "free" | "active" (pro subscription confirmed)
 * Called from the plan selection page action / billing return URL.
 */
export async function setShopPlanStatus(shop, status) {
  await db.shop.update({
    where: { shop },
    data:  { status },
  });
}

/**
 * Returns the shop's current plan-selection status, or null if not found.
 */
export async function getShopStatus(shop) {
  const row = await db.shop.findUnique({ where: { shop }, select: { status: true } });
  return row?.status ?? null;
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

export async function getShopReviewPromptState(shopDomain) {
  const rows = await db.$queryRaw`
    SELECT
      createdAt,
      reviewPromptDelayDays,
      reviewPopupDismissedAt,
      reviewSubmittedAt
    FROM shop
    WHERE shop = ${shopDomain}
    LIMIT 1
  `;

  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const now = new Date();

  const createdAt = row?.createdAt ? new Date(row.createdAt) : null;
  const delayDays = normalizePositiveInt(row?.reviewPromptDelayDays, REVIEW_PROMPT_DEFAULT_DELAY_DAYS);
  const daysSinceInstall = createdAt ? Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS) : 0;
  const isDelayOver = createdAt ? now.getTime() >= createdAt.getTime() + delayDays * DAY_MS : false;

  const dismissedAt = row?.reviewPopupDismissedAt ? new Date(row.reviewPopupDismissedAt) : null;
  const snoozeUntil = dismissedAt ? new Date(dismissedAt.getTime() + REVIEW_PROMPT_SNOOZE_DAYS * DAY_MS) : null;
  const isSnoozed = snoozeUntil ? now.getTime() < snoozeUntil.getTime() : false;

  const hasSubmittedReview = Boolean(row?.reviewSubmittedAt);
  const shouldShow = Boolean(createdAt && isDelayOver && !isSnoozed && !hasSubmittedReview);

  return {
    shouldShow,
    daysSinceInstall: Math.max(0, daysSinceInstall),
    delayDays,
    snoozeDays: REVIEW_PROMPT_SNOOZE_DAYS,
  };
}

export async function dismissShopReviewPrompt(shopDomain) {
  await db.$executeRaw`
    UPDATE shop
    SET reviewPopupDismissedAt = NOW(3),
        updatedAt = NOW(3)
    WHERE shop = ${shopDomain}
  `;
}

export async function submitShopReview(shopDomain, { rating, feedback }) {
  const parsedRating = Number.parseInt(String(rating), 10);
  const safeRating =
    Number.isFinite(parsedRating) && parsedRating >= 1 && parsedRating <= 5
      ? parsedRating
      : null;

  const safeFeedback =
    typeof feedback === "string" && feedback.trim().length > 0
      ? feedback.trim().slice(0, 2000)
      : null;

  await db.$executeRaw`
    UPDATE shop
    SET reviewSubmittedAt = NOW(3),
        reviewPopupDismissedAt = NULL,
        reviewRating = ${safeRating},
        reviewComment = ${safeFeedback},
        updatedAt = NOW(3)
    WHERE shop = ${shopDomain}
  `;
}
