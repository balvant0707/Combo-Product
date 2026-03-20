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

const EXTENSION_UUID = "36974c12-cb97-9ae2-ba3d-8f81be5ac21bc8a9a0a7";

export async function buildEmbedBlockUrl({ shop, admin }) {
  const storeHandle = getStoreHandle(shop);
  const themeId = await getMainThemeId(admin);
  const themeIdSegment = themeId || "current";

  const destination = new URL(
    `https://admin.shopify.com/store/${storeHandle}/themes/${themeIdSegment}/editor`,
  );
  destination.searchParams.set("context", "apps");
  destination.searchParams.set("activateAppId", `${EXTENSION_UUID}/combo-embed`);

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
