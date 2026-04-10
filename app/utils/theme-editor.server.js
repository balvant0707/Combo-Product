import process from "node:process";
import db from "../db.server";

const GET_MAIN_THEME_ID_QUERY = `#graphql
  query GetMainThemeId {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
      }
    }
  }
`;

function getStoreHandle(shop) {
  return shop.replace(/\.myshopify\.com$/i, "");
}

function extractNumericId(gid) {
  if (!gid) return null;
  const match = String(gid).match(/\/(\d+)$/);
  return match?.[1] || null;
}

async function getPreviewProductHandle(shop) {
  const product = await db.comboBoxProduct.findFirst({
    where: {
      productHandle: { not: null },
      box: {
        shop,
        deletedAt: null,
        isActive: true,
      },
    },
    orderBy: [{ boxId: "asc" }, { id: "asc" }],
    select: {
      productHandle: true,
    },
  });

  return product?.productHandle || null;
}

async function getMainThemeId(admin) {
  const themeResponse = await admin.graphql(GET_MAIN_THEME_ID_QUERY);
  const themeJson = await themeResponse.json();
  return extractNumericId(themeJson?.data?.themes?.nodes?.[0]?.id || null);
}

export async function getEmbedBlockStatus({ shop, admin, session }) {
  try {
    const themeId = await getMainThemeId(admin);
    if (!themeId) return false;

    const response = await fetch(
      `https://${shop}/admin/api/2026-04/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`,
      { headers: { "X-Shopify-Access-Token": session.accessToken } },
    );
    if (!response.ok) return false;

    const data = await response.json();
    const settingsData = JSON.parse(data.asset?.value || "{}");
    const blocks = settingsData?.current?.blocks || {};

    return Object.values(blocks).some(
      (block) => block.type?.includes("combo-embed") && block.disabled !== true,
    );
  } catch {
    return false;
  }
}

export async function setEmbedBlockStatus({ shop, admin, session, enabled }) {
  try {
    const themeId = await getMainThemeId(admin);
    if (!themeId) {
      return { ok: false, requiresManualSetup: true, message: "Main theme not found." };
    }

    const assetUrl = `https://${shop}/admin/api/2026-04/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`;
    const response = await fetch(assetUrl, {
      headers: { "X-Shopify-Access-Token": session.accessToken },
    });
    if (!response.ok) {
      return { ok: false, requiresManualSetup: true, message: "Unable to read theme settings." };
    }

    const data = await response.json();
    const settingsData = JSON.parse(data.asset?.value || "{}");
    settingsData.current = settingsData.current || {};
    settingsData.current.blocks = settingsData.current.blocks || {};

    const entries = Object.entries(settingsData.current.blocks);
    const embedEntry = entries.find(([, block]) => block?.type?.includes("combo-embed"));
    if (!embedEntry) {
      // First-time activation needs theme editor because Shopify owns app embed block registration.
      return { ok: false, requiresManualSetup: true, message: "Open Theme Editor once to add the app embed block." };
    }

    const [blockKey, embedBlock] = embedEntry;
    const nextDisabled = !enabled;
    if (embedBlock.disabled === nextDisabled) {
      return { ok: true, changed: false };
    }

    settingsData.current.blocks[blockKey] = {
      ...embedBlock,
      disabled: nextDisabled,
    };

    const updateResp = await fetch(`https://${shop}/admin/api/2026-04/themes/${themeId}/assets.json`, {
      method: "PUT",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        asset: {
          key: "config/settings_data.json",
          value: JSON.stringify(settingsData),
        },
      }),
    });

    if (!updateResp.ok) {
      return { ok: false, requiresManualSetup: false, message: "Unable to update theme settings." };
    }

    return { ok: true, changed: true };
  } catch {
    return { ok: false, requiresManualSetup: false, message: "Failed to update embed status." };
  }
}

export async function buildEmbedBlockUrl({ shop, admin }) {
  const storeHandle = getStoreHandle(shop);
  const apiKey = process.env.SHOPIFY_API_KEY?.trim();
  const themeId = await getMainThemeId(admin);
  const themeIdSegment = themeId || "current";

  const destination = new URL(
    `https://admin.shopify.com/store/${storeHandle}/themes/${themeIdSegment}/editor`,
  );
  destination.searchParams.set("context", "apps");
  if (apiKey) {
    destination.searchParams.set("activateAppId", `${apiKey}/combo-embed`);
  }

  return destination.toString();
}

export async function buildThemeEditorUrl({ shop, admin }) {
  const storeHandle = getStoreHandle(shop);
  const apiKey = process.env.SHOPIFY_API_KEY?.trim();
  const [previewProductHandle, themeId] = await Promise.all([
    getPreviewProductHandle(shop),
    getMainThemeId(admin),
  ]);

  const themeIdSegment = themeId || "current";
  const destination = new URL(
    `https://admin.shopify.com/store/${storeHandle}/themes/${themeIdSegment}/editor`,
  );

  destination.searchParams.set("template", "product");

  if (previewProductHandle) {
    destination.searchParams.set("previewPath", `/products/${previewProductHandle}`);
  }

  if (apiKey) {
    destination.searchParams.set("addAppBlockId", `${apiKey}/combo-builder`);
    destination.searchParams.set("target", "newAppsSection");
  }

  return destination.toString();
}
