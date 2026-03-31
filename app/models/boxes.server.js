import db, { ensureAppTables } from "../db.server";
import { Buffer } from "node:buffer";

// Generate a 5-digit unique box code
const BOX_CODE_CHARS = "0123456789";
const BOX_CODE_MIN_LENGTH = 3;
const BOX_CODE_MAX_LENGTH = 10;
const BOX_CODE_PATTERN = /^\d+$/;
const MIN_COMBO_STEPS = 2;
const MAX_COMBO_STEPS = 8;

function clampComboStepCount(value) {
  return Math.max(MIN_COMBO_STEPS, Math.min(MAX_COMBO_STEPS, value));
}

export class BoxCodeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BoxCodeValidationError";
  }
}

export function isBoxCodeValidationError(error) {
  return error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError";
}

function generateBoxCode() {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += BOX_CODE_CHARS[Math.floor(Math.random() * BOX_CODE_CHARS.length)];
  }
  return code;
}

async function getUniqueBoxCode() {
  let code, exists;
  do {
    code = generateBoxCode();
    exists = await db.comboBox.findFirst({ where: { boxCode: code } });
  } while (exists);
  return code;
}

async function getRequestedBoxCode(rawValue, excludeId = null) {
  const normalized = rawValue == null ? "" : String(rawValue).trim().toUpperCase();
  if (!normalized) return null;
  if (excludeId) {
    const existingRecord = await db.comboBox.findUnique({
      where: { id: parseInt(excludeId) },
      select: { boxCode: true },
    });
    if (existingRecord?.boxCode === normalized) {
      return normalized;
    }
  }
  if (normalized.length < BOX_CODE_MIN_LENGTH || normalized.length > BOX_CODE_MAX_LENGTH) {
    throw new BoxCodeValidationError(`Box code must be ${BOX_CODE_MIN_LENGTH}-${BOX_CODE_MAX_LENGTH} characters long`);
  }
  if (!BOX_CODE_PATTERN.test(normalized)) {
    throw new BoxCodeValidationError("Box code can only contain numbers");
  }

  const where = excludeId
    ? { boxCode: normalized, NOT: { id: parseInt(excludeId) } }
    : { boxCode: normalized };
  const existing = await db.comboBox.findFirst({
    where,
    select: { id: true },
  });
  if (existing) {
    throw new BoxCodeValidationError("Box code is already in use");
  }

  return normalized;
}

const CREATE_BUNDLE_PRODUCT_MUTATION = `#graphql
  mutation productCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        variants(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_PRODUCT_DEFAULT_VARIANT_QUERY = `#graphql
  query GetProductDefaultVariant($id: ID!) {
    product(id: $id) {
      id
      variants(first: 1) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`;

const GET_PUBLICATIONS_QUERY = `#graphql
  query GetPublications {
    publications(first: 20) {
      edges {
        node {
          id
          name
          catalog {
            title
          }
        }
      }
    }
  }
`;

const PUBLISH_TO_CHANNEL_MUTATION = `#graphql
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { ... on Product { id } }
      userErrors { field message }
    }
  }
`;

const UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ACTIVATE_BUNDLE_PRODUCT_MUTATION = `#graphql
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status }
      userErrors { field message }
    }
  }
`;

const DELETE_BUNDLE_PRODUCT_MUTATION = `#graphql
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

const COMBO_COLLECTION_PRODUCTS_QUERY = `#graphql
  query GetComboCollectionProducts($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title handle
            featuredImage { url }
            variants(first: 1) { edges { node { id price } } }
          }
        }
      }
    }
  }
`;

const DISCOUNT_AUTOMATIC_BASIC_CREATE_MUTATION = `#graphql
  mutation discountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBasic {
            title
            status
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const DISCOUNT_AUTOMATIC_BASIC_UPDATE_MUTATION = `#graphql
  mutation discountAutomaticBasicUpdate($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBasic {
            title
            status
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const DISCOUNT_AUTOMATIC_DELETE_MUTATION = `#graphql
  mutation discountAutomaticDelete($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message }
    }
  }
`;

/**
 * Build the DiscountAutomaticBasicInput object for create/update mutations.
 * Uses ORDER-level discount (items.all = true) so it applies at the cart/order level.
 */
function buildDiscountInput({ title, discountType, discountValue }) {
  const pct = parseFloat(discountValue) || 0;
  const customerGets = discountType === "fixed"
    ? { value: { discountAmount: { amount: String(pct), appliesOnEachItem: false } }, items: { all: true } }
    : { value: { percentage: pct / 100 }, items: { all: true } };

  return {
    title,
    startsAt: new Date().toISOString(),
    customerGets,
  };
}

/** True when a caught error is a Shopify "missing write_discounts scope" error. */
function isScopeError(e) {
  const msg = e?.message || "";
  return msg.includes("write_discounts") || msg.includes("Access denied") || msg.includes("access scope");
}

/**
 * Create or update an automatic basic discount in Shopify for a dynamic-priced box.
 * Returns the discount GID, or null on failure.
 * Silently skips (returns null) when the app token lacks write_discounts scope —
 * the scope is declared in shopify.app.toml and will be granted on next merchant re-auth.
 */
export async function syncShopifyDiscount(admin, { boxId, existingDiscountId, title, discountType, discountValue, shopifyProductId }) {
  if (!admin || !shopifyProductId) return null;
  if (!discountType || discountType === "none" || !(parseFloat(discountValue) > 0)) {
    // Remove existing discount if switching away from dynamic
    if (existingDiscountId) {
      try {
        await admin.graphql(DISCOUNT_AUTOMATIC_DELETE_MUTATION, { variables: { id: existingDiscountId } });
        await db.comboBox.update({ where: { id: boxId }, data: { shopifyDiscountId: null } });
      } catch (e) {
        if (!isScopeError(e)) console.error("[syncShopifyDiscount] delete error:", e);
      }
    }
    return null;
  }

  const input = buildDiscountInput({ title, discountType, discountValue, shopifyProductId });

  try {
    if (existingDiscountId) {
      const resp = await admin.graphql(DISCOUNT_AUTOMATIC_BASIC_UPDATE_MUTATION, {
        variables: { id: existingDiscountId, automaticBasicDiscount: input },
      });
      const json = await resp.json();
      const errors = json?.data?.discountAutomaticBasicUpdate?.userErrors || [];
      if (errors.length) { console.error("[syncShopifyDiscount] update userErrors:", errors); }
      return existingDiscountId;
    } else {
      const resp = await admin.graphql(DISCOUNT_AUTOMATIC_BASIC_CREATE_MUTATION, {
        variables: { automaticBasicDiscount: input },
      });
      const json = await resp.json();
      const errors = json?.data?.discountAutomaticBasicCreate?.userErrors || [];
      if (errors.length) { console.error("[syncShopifyDiscount] create userErrors:", errors); return null; }
      const discountId = json?.data?.discountAutomaticBasicCreate?.automaticDiscountNode?.id || null;
      if (discountId && boxId) {
        await db.comboBox.update({ where: { id: boxId }, data: { shopifyDiscountId: discountId } });
      }
      return discountId;
    }
  } catch (e) {
    if (isScopeError(e)) {
      // write_discounts not yet granted — merchant must re-authorize the app.
      // Scope is declared in shopify.app.toml; re-auth happens automatically on next app open.
      console.warn("[syncShopifyDiscount] write_discounts scope not yet granted — discount skipped until merchant re-authorizes.");
    } else {
      console.error("[syncShopifyDiscount] error:", e);
    }
    return existingDiscountId || null;
  }
}

const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = `#graphql
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { status }
      mediaUserErrors { field message }
    }
  }
`;

const GET_PRODUCT_MEDIA_QUERY = `#graphql
  query GetProductMedia($id: ID!) {
    product(id: $id) {
      media(first: 50) {
        edges {
          node {
            id
            ... on MediaImage {
              image { url }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_DELETE_MEDIA_MUTATION = `#graphql
  mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      product { id }
      mediaUserErrors { field message }
    }
  }
`;

// Cache the Online Store publication ID within a warm serverless container.
let _cachedPubId = null;

async function getOnlineStorePublicationId(admin) {
  if (_cachedPubId) return _cachedPubId;
  try {
    const r = await admin.graphql(GET_PUBLICATIONS_QUERY);
    const j = await r.json();
    const edges = j?.data?.publications?.edges || [];
    // Online Store publication has name "Online Store" and catalog: null
    // Must NOT filter by catalog != null — that excludes Online Store
    const os =
      edges.find((e) => (e?.node?.name || "").toLowerCase() === "online store") ||
      edges.find((e) => (e?.node?.catalog?.title || "").toLowerCase() === "online store") ||
      edges[0]; // last resort: first publication
    _cachedPubId = os?.node?.id || null;
    if (!_cachedPubId) {
      console.warn("[getOnlineStorePublicationId] No publications found — product will not be purchasable via storefront");
    }
    return _cachedPubId;
  } catch (e) {
    console.error("[getOnlineStorePublicationId] error:", e);
    return null;
  }
}

// imageSource: a URL string, or { bytes: Buffer, mimeType, fileName }
async function addImageToProduct(admin, productId, imageSource) {
  let imageUrl = null;

  if (typeof imageSource === "string" && imageSource.startsWith("http")) {
    imageUrl = imageSource;
  } else if (imageSource?.bytes) {
    // Binary upload — use staged upload to get a Shopify-hosted URL
    try {
      const byteLength = Buffer.byteLength(imageSource.bytes);
      const stageResp = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
        variables: {
          input: [{
            filename: imageSource.fileName || "banner.jpg",
            mimeType: imageSource.mimeType || "image/jpeg",
            httpMethod: "POST",
            resource: "IMAGE",
            fileSize: String(byteLength),
          }],
        },
      });
      const stageJson = await stageResp.json();
      const target = stageJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!target) throw new Error("No staged target returned");

      const form = new FormData();
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append(
        "file",
        new Blob([imageSource.bytes], { type: imageSource.mimeType || "image/jpeg" }),
        imageSource.fileName || "banner.jpg",
      );

      const uploadResp = await fetch(target.url, { method: "POST", body: form });
      if (!uploadResp.ok) throw new Error(`Staged upload HTTP ${uploadResp.status}`);
      imageUrl = target.resourceUrl;
    } catch (e) {
      console.warn("[addImageToProduct] staged upload failed:", e.message);
      return;
    }
  }

  if (!imageUrl) return;

  try {
    await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
      variables: {
        productId,
        media: [{ originalSource: imageUrl, mediaContentType: "IMAGE" }],
      },
    });
  } catch (e) {
    console.warn("[addImageToProduct] productCreateMedia failed:", e.message);
  }
}

/** Collect all unique image URLs from combo step products/collections. */
function extractStepImageUrls(parsedCombo) {
  const seen = new Set();
  const urls = [];
  const allSteps = Array.isArray(parsedCombo?.steps) ? parsedCombo.steps : [];
  const requestedType = parseInt(parsedCombo?.type, 10);
  const comboType =
    Number.isInteger(requestedType)
      ? clampComboStepCount(requestedType)
      : allSteps.length;

  for (const step of allSteps.slice(0, comboType)) {
    const selectedProductImageUrls = Array.isArray(step?.selectedProducts)
      ? step.selectedProducts.map((product) => product?.imageUrl).filter(Boolean)
      : [];
    const collectionImageUrls = Array.isArray(step?.collections)
      ? step.collections.map((collection) => collection?.imageUrl).filter(Boolean)
      : [];
    const resolvedProductImageUrls = Array.isArray(step?.resolvedProducts)
      ? step.resolvedProducts.map((product) => product?.imageUrl).filter(Boolean)
      : [];
    const fallbackResolvedImageUrls =
      collectionImageUrls.length === 0
        ? resolvedProductImageUrls.slice(0, Math.max(step?.collections?.length || 0, 1))
        : [];
    const sources =
      step?.scope === "product"
        ? selectedProductImageUrls
        // Collection records often have no image, so use expanded product images
        // from the saved combo config as representative media for that step.
        : collectionImageUrls.length > 0
          ? collectionImageUrls
          : fallbackResolvedImageUrls;

    for (const url of sources) {
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }
  return urls;
}

/** Return the path segment of a URL for dedup comparison. */
function urlPath(raw) {
  try { return new URL(raw).pathname; } catch { return raw; }
}

/** Fetch existing media URLs already attached to a Shopify product. */
async function getExistingProductMedia(admin, productId) {
  try {
    const resp = await admin.graphql(GET_PRODUCT_MEDIA_QUERY, { variables: { id: productId } });
    const json = await resp.json();
    return (json?.data?.product?.media?.edges || [])
      .map((e) => ({ id: e?.node?.id, url: e?.node?.image?.url }))
      .filter((m) => m.id);
  } catch (e) {
    console.warn("[getExistingProductMedia] failed:", e.message);
    return [];
  }
}

/**
 * Delete all existing media from a Shopify product, then optionally add a new image.
 * Used when the banner image is changed or removed on an existing box.
 */
async function replaceProductImage(admin, productId, imageSource) {
  try {
    const existing = await getExistingProductMedia(admin, productId);
    if (existing.length > 0) {
      const mediaIds = existing.map((m) => m.id);
      const delResp = await admin.graphql(PRODUCT_DELETE_MEDIA_MUTATION, {
        variables: { productId, mediaIds },
      });
      const delJson = await delResp.json();
      const delErrors = delJson?.data?.productDeleteMedia?.mediaUserErrors || [];
      if (delErrors.length) console.warn("[replaceProductImage] deleteMedia errors:", delErrors);
    }
  } catch (e) {
    console.warn("[replaceProductImage] delete existing media failed:", e.message);
  }

  if (imageSource) {
    await addImageToProduct(admin, productId, imageSource);
  }
}

async function deleteAllProductMedia(admin, productId) {
  try {
    const existing = await getExistingProductMedia(admin, productId);
    if (existing.length === 0) return;

    const mediaIds = existing.map((media) => media.id).filter(Boolean);
    if (mediaIds.length === 0) return;

    const delResp = await admin.graphql(PRODUCT_DELETE_MEDIA_MUTATION, {
      variables: { productId, mediaIds },
    });
    const delJson = await delResp.json();
    const delErrors = delJson?.data?.productDeleteMedia?.mediaUserErrors || [];
    if (delErrors.length > 0) {
      console.warn("[deleteAllProductMedia] deleteMedia errors:", delErrors);
    }
  } catch (e) {
    console.warn("[deleteAllProductMedia] failed:", e.message);
  }
}

/**
 * Add images from each combo step's selected products / collections to the
 * Shopify bundle product. Already-present images are skipped to avoid duplicates.
 */
export async function addComboStepImagesToProduct(admin, shopifyProductId, comboStepsConfigJson) {
  if (!admin || !shopifyProductId || !comboStepsConfigJson) return;
  try {
    const parsedCombo =
      typeof comboStepsConfigJson === "string"
        ? JSON.parse(comboStepsConfigJson)
        : comboStepsConfigJson;

    const imageUrls = extractStepImageUrls(parsedCombo);
    if (imageUrls.length === 0) return;

    const existingMedia = await getExistingProductMedia(admin, shopifyProductId);
    const existingPaths = new Set(existingMedia.map((m) => urlPath(m.url)).filter(Boolean));

    for (const imageUrl of imageUrls) {
      if (!existingPaths.has(urlPath(imageUrl))) {
        await addImageToProduct(admin, shopifyProductId, imageUrl);
      }
    }
  } catch (e) {
    console.error("[addComboStepImagesToProduct] error:", e);
  }
}

export async function syncSpecificComboProductMedia(
  admin,
  box,
  comboStepsConfigJson = null,
  stepImages = null,
) {
  if (!admin || !box?.shopifyProductId) return;

  const rawConfig = comboStepsConfigJson || box.comboStepsConfig;
  let parsedCombo = null;
  if (rawConfig) {
    try {
      parsedCombo = typeof rawConfig === "string" ? JSON.parse(rawConfig) : rawConfig;
    } catch (e) {
      console.warn("[syncSpecificComboProductMedia] Invalid combo config:", e.message);
    }
  }

  const requestedType = parseInt(parsedCombo?.type, 10);
  const activeStepCount =
    Number.isInteger(requestedType) ? clampComboStepCount(requestedType) : 0;

  const persistedStepImages = Array.isArray(stepImages)
    ? stepImages
    : await getComboStepImages(box.id);
  const activeStepImages = persistedStepImages
    .filter((image) => image && (image.bytes || image.imageData))
    .filter((image) => activeStepCount === 0 || image.stepIndex < activeStepCount)
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .map((image) => ({
      bytes: image.bytes || image.imageData,
      mimeType: image.mimeType || "image/jpeg",
      fileName: image.fileName || `combo-step-${image.stepIndex + 1}.jpg`,
    }));

  if (activeStepImages.length > 0) {
    await deleteAllProductMedia(admin, box.shopifyProductId);
    for (const imageSource of activeStepImages) {
      await addImageToProduct(admin, box.shopifyProductId, imageSource);
    }
    return;
  }

  await deleteAllProductMedia(admin, box.shopifyProductId);
  if (rawConfig) {
    await addComboStepImagesToProduct(admin, box.shopifyProductId, rawConfig);
  }
}

function extractGraphqlMessages(payload) {
  const topLevelErrors = Array.isArray(payload?.errors)
    ? payload.errors
        .map((error) => error?.message)
        .filter((message) => typeof message === "string" && message.length > 0)
    : [];
  return topLevelErrors;
}

function formatUserErrors(userErrors) {
  return (userErrors || [])
    .map((err) => {
      const field = Array.isArray(err?.field)
        ? err.field.join(".")
        : err?.field || "unknown";
      const message = err?.message || "Unknown error";
      return `${field}: ${message}`;
    })
    .join("; ");
}

async function resolveDefaultVariantId(admin, shopifyProductId) {
  if (!shopifyProductId) return null;

  try {
    const resp = await admin.graphql(GET_PRODUCT_DEFAULT_VARIANT_QUERY, {
      variables: { id: shopifyProductId },
    });
    const json = await resp.json();

    const topLevelErrors = extractGraphqlMessages(json);
    if (topLevelErrors.length > 0) {
      console.error(
        "[resolveDefaultVariantId] GraphQL errors:",
        topLevelErrors,
      );
      return null;
    }

    return (
      json?.data?.product?.variants?.edges?.[0]?.node?.id ||
      null
    );
  } catch (e) {
    console.error("[resolveDefaultVariantId] error:", e);
    return null;
  }
}

export async function createShopifyBundleProduct(admin, title, bundlePrice, imageSource = null) {
  // Step 1: Create product
  const resp = await admin.graphql(CREATE_BUNDLE_PRODUCT_MUTATION, {
    variables: {
      product: {
        title,
        status: "ACTIVE",
        vendor: "ComboBuilder",
        tags: ["combo-builder-internal"],
      },
    },
  });
  const json = await resp.json();
  const topLevelErrors = extractGraphqlMessages(json);
  if (topLevelErrors.length > 0) {
    throw new Error(
      `Shopify productCreate failed: ${topLevelErrors.join(" | ")}`,
    );
  }

  const userErrors = json?.data?.productCreate?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(
      `Shopify productCreate userErrors: ${formatUserErrors(userErrors)}`,
    );
  }

  const product = json?.data?.productCreate?.product;
  if (!product) {
    throw new Error("Shopify productCreate returned no product");
  }

  const shopifyProductId = product.id;
  let shopifyVariantId = product.variants?.edges?.[0]?.node?.id || null;
  if (!shopifyVariantId) {
    shopifyVariantId = await resolveDefaultVariantId(admin, shopifyProductId);
  }
  if (!shopifyVariantId) {
    throw new Error(
      "Shopify product created but default variant was not resolved",
    );
  }

  // Step 2: Update default variant price
  if (shopifyVariantId && bundlePrice > 0) {
    try {
      const priceResp = await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
        variables: {
          productId: shopifyProductId,
          variants: [{ id: shopifyVariantId, price: String(bundlePrice) }],
        },
      });
      const priceJson = await priceResp.json();
      const priceTopLevelErrors = extractGraphqlMessages(priceJson);
      const priceUserErrors =
        priceJson?.data?.productVariantsBulkUpdate?.userErrors || [];

      if (priceTopLevelErrors.length > 0 || priceUserErrors.length > 0) {
        console.error(
          "[createShopifyBundleProduct] productVariantsBulkUpdate errors:",
          {
            errors: priceTopLevelErrors,
            userErrors: priceUserErrors,
          },
        );
      }
    } catch (e) {
      console.error("[createShopifyBundleProduct] productVariantsBulkUpdate error:", e);
    }
  }

  // Step 3: Attach banner image if provided
  if (imageSource) {
    await addImageToProduct(admin, shopifyProductId, imageSource);
  }

  // Step 4: Publish to Online Store so /cart/add.js accepts it
  const pubId = await getOnlineStorePublicationId(admin);
  if (pubId) {
    try {
      const publishResp = await admin.graphql(PUBLISH_TO_CHANNEL_MUTATION, {
        variables: { id: shopifyProductId, input: [{ publicationId: pubId }] },
      });
      const publishJson = await publishResp.json();
      const publishTopLevelErrors = extractGraphqlMessages(publishJson);
      const publishUserErrors =
        publishJson?.data?.publishablePublish?.userErrors || [];

      if (publishTopLevelErrors.length > 0 || publishUserErrors.length > 0) {
        console.error(
          "[createShopifyBundleProduct] publishablePublish errors:",
          {
            errors: publishTopLevelErrors,
            userErrors: publishUserErrors,
          },
        );
      }
    } catch (e) {
      console.error("[createShopifyBundleProduct] publish error:", e);
    }
  } else {
    console.warn("[createShopifyBundleProduct] Could not find Online Store publication ID — product may not be purchasable via storefront");
  }

  return { shopifyProductId, shopifyVariantId };
}

function getBannerImageDataUri(box) {
  if (!box?.bannerImageData || !box?.bannerImageMimeType) return null;
  const base64 = Buffer.from(box.bannerImageData).toString("base64");
  return `data:${box.bannerImageMimeType};base64,${base64}`;
}

export function getBannerImageSrc(box) {
  return box?.bannerImageUrl || getBannerImageDataUri(box);
}

export async function listBoxes(shop, activeOnly = false, includeBannerBinary = false) {
  await ensureAppTables();
  const where = {
    shop,
    deletedAt: null,
    ...(activeOnly ? { isActive: true } : {}),
  };

  const boxes = await db.comboBox.findMany({
    where,
    include: {
      products: true,
      config: true,
      _count: { select: { orders: true } },
    },
    orderBy: { sortOrder: "asc" },
  });

  // Lazy backfill: assign a boxCode to any existing box that doesn't have one
  const noCode = boxes.filter((b) => !b.boxCode);
  if (noCode.length > 0) {
    await Promise.all(
      noCode.map(async (b) => {
        const code = await getUniqueBoxCode();
        await db.comboBox.update({ where: { id: b.id }, data: { boxCode: code } });
        b.boxCode = code;
      })
    );
  }

  if (includeBannerBinary) return boxes;

  return boxes.map((box) => {
    const sanitized = { ...box };
    delete sanitized.bannerImageData;
    // Keep bannerImageMimeType as a marker that a binary upload exists
    delete sanitized.bannerImageFileName;
    return sanitized;
  });
}

export async function getBox(id, shop) {
  return db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null },
    include: { products: true, config: true },
  });
}

export async function getBoxWithProducts(id, shop) {
  const box = await db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null, isActive: true },
    include: { products: true },
  });
  return box;
}

export async function createBox(shop, data, admin) {
  const itemCount = parseInt(data.itemCount) || 1;
  const bundlePrice = parseFloat(data.bundlePrice) || 0;
  const bundleProductTitle = data.boxName || data.displayTitle;

  // Create hidden Shopify product for bundle pricing
  let shopifyProductId = null;
  let shopifyVariantId = null;

  if (admin) {
    try {
      const imageSource =
        data.bannerImageUrl ||
        (data.bannerImage?.bytes
          ? { bytes: data.bannerImage.bytes, mimeType: data.bannerImage.mimeType, fileName: data.bannerImage.fileName }
          : null);
      const result = await createShopifyBundleProduct(
        admin,
        bundleProductTitle,
        bundlePrice,
        imageSource,
      );
      shopifyProductId = result.shopifyProductId;
      shopifyVariantId = result.shopifyVariantId;
    } catch (e) {
      console.error("[createBox] Failed to create Shopify product", e);
      const message =
        e instanceof Error && e.message
          ? e.message
          : "Failed to create Shopify product in admin";
      throw new Error(message);
    }
  }

  const nextSortOrder = await getNextSortOrder(shop);
  const requestedBoxCode = await getRequestedBoxCode(data.boxCode);
  const boxCode = requestedBoxCode || await getUniqueBoxCode();

  const hasUploadedBanner = Boolean(data.bannerImage?.bytes);

  const box = await db.comboBox.create({
    data: {
      shop,
      boxCode,
      boxName: data.boxName,
      displayTitle: data.displayTitle,
      itemCount,
      bundlePrice,
      isGiftBox: data.isGiftBox === "true" || data.isGiftBox === true,
      allowDuplicates:
        data.allowDuplicates === "true" || data.allowDuplicates === true,
      bannerImageUrl: hasUploadedBanner ? null : data.bannerImageUrl || null,
      bannerImageData: hasUploadedBanner ? data.bannerImage.bytes : null,
      bannerImageMimeType: hasUploadedBanner ? data.bannerImage.mimeType : null,
      bannerImageFileName: hasUploadedBanner ? data.bannerImage.fileName : null,
      sortOrder: nextSortOrder,
      isActive: data.isActive !== "false" && data.isActive !== false,
      giftMessageEnabled:
        data.giftMessageEnabled === "true" || data.giftMessageEnabled === true,
      bundlePriceType: data.bundlePriceType === "dynamic" ? "dynamic" : "manual",
      shopifyProductId,
      shopifyVariantId,
      scopeType: data.scopeType || "specific_collections",
      scopeItemsJson: Array.isArray(data.scopeItems) && data.scopeItems.length > 0 ? JSON.stringify(data.scopeItems) : null,
      comboStepsConfig: JSON.stringify({
        bundlePriceType: data.bundlePriceType === "dynamic" ? "dynamic" : "manual",
        discountType: data.discountType || "none",
        discountValue: data.discountValue || "0",
        bundlePrice: bundlePrice,
      }),
    },
  });

  // Create Shopify automatic discount for dynamic-priced boxes
  if (admin && data.bundlePriceType === "dynamic" && shopifyProductId) {
    await syncShopifyDiscount(admin, {
      boxId: box.id,
      existingDiscountId: null,
      title: `${data.boxName || data.displayTitle} Bundle Discount`,
      discountType: data.discountType || "none",
      discountValue: data.discountValue || "0",
      shopifyProductId,
    });
  }

  // Save eligible products
  if (data.eligibleProducts && Array.isArray(data.eligibleProducts)) {
    const productRows = data.eligibleProducts.map((p) => {
      const rawIds = Array.isArray(p.variantIds) ? p.variantIds : [];
      const numericIds = rawIds.map((id) => (typeof id === 'string' && id.includes('/') ? id.split('/').pop() : String(id)));
      return {
        boxId: box.id,
        productId: p.productId || p.id,
        productTitle: p.productTitle || p.title || null,
        productImageUrl: p.productImageUrl || p.imageUrl || null,
        productHandle: p.productHandle || p.handle || null,
        productPrice: p.price != null && parseFloat(p.price) > 0 ? parseFloat(p.price) : null,
        variantIds: numericIds.length > 0 ? JSON.stringify(numericIds) : null,
      };
    });
    if (productRows.length > 0) {
      await db.comboBoxProduct.createMany({ data: productRows });
    }
  }

  return db.comboBox.findUnique({
    where: { id: box.id },
    include: { products: true },
  });
}

export async function updateComboStepsConfig(id, shop, comboStepsConfig) {
  await db.comboBox.findFirstOrThrow({ where: { id: parseInt(id), shop, deletedAt: null } });
  return db.comboBox.update({
    where: { id: parseInt(id) },
    data: { comboStepsConfig: typeof comboStepsConfig === "string" ? comboStepsConfig : JSON.stringify(comboStepsConfig) },
  });
}

/**
 * Upsert the ComboBoxConfig record for a box.
 * Handles both INSERT (first save) and UPDATE (subsequent saves).
 * `config` may be a JSON string or a plain object matching DEFAULT_COMBO_CONFIG shape.
 */
export async function upsertComboConfig(boxId, config, admin = null) {
  const parsed = typeof config === "string" ? JSON.parse(config) : config;
  const requestedType = parseInt(parsed?.type, 10);
  const comboType = Number.isInteger(requestedType)
    ? clampComboStepCount(requestedType)
    : MIN_COMBO_STEPS;
  const allSteps = Array.isArray(parsed.steps) ? parsed.steps : [];

  // Pre-expand collection-scoped steps via Admin API so the storefront widget
  // can read products directly without relying on /collections/{handle}/products.json
  if (admin) {
    for (let i = 0; i < Math.min(allSteps.length, comboType); i++) {
      const step = allSteps[i];
      if (step.scope === "collection" && Array.isArray(step.collections) && step.collections.length > 0) {
        const resolvedProducts = [];
        const seenIds = new Set();
        for (const coll of step.collections) {
          if (!coll.id) continue;
          try {
            let cursor = null;
            let hasNextPage = true;
            while (hasNextPage) {
              const resp = await admin.graphql(COMBO_COLLECTION_PRODUCTS_QUERY, {
                variables: { id: coll.id, first: 250, after: cursor },
              });
              const json = await resp.json();
              const productsConn = json?.data?.collection?.products;
              for (const { node } of productsConn?.edges || []) {
                if (!seenIds.has(node.id)) {
                  seenIds.add(node.id);
                  resolvedProducts.push({
                    id: node.id,
                    title: node.title,
                    handle: node.handle,
                    imageUrl: node.featuredImage?.url || null,
                    variantId: node.variants?.edges?.[0]?.node?.id || null,
                    price: node.variants?.edges?.[0]?.node?.price || "0",
                  });
                }
              }
              hasNextPage = productsConn?.pageInfo?.hasNextPage || false;
              cursor = productsConn?.pageInfo?.endCursor || null;
            }
          } catch (e) {
            console.warn(`[upsertComboConfig] Failed to expand collection ${coll.id}:`, e.message);
          }
        }
        allSteps[i] = { ...step, resolvedProducts };
      }
    }
  }

  const activeSteps = allSteps.slice(0, comboType).map((step) => ({
    ...(step || {}),
    optional: step?.optional === true || String(step?.optional).toLowerCase() === "true",
  }));
  const stepsJson = JSON.stringify(activeSteps);
  const rawJson = JSON.stringify({ ...parsed, type: comboType, steps: activeSteps });

  const payload = {
    comboType,
    title:             parsed.title            ?? null,
    subtitle:          parsed.subtitle         ?? null,
    bundlePrice:       parsed.bundlePrice != null ? parseFloat(parsed.bundlePrice) : null,
    bundlePriceType:   parsed.bundlePriceType  ?? "manual",
    isActive:          parsed.isActive         !== false,
    showProductImages: parsed.showProductImages !== false,
    showProgressBar:   parsed.showProgressBar  !== false,
    allowReselection:  parsed.allowReselection !== false,
    stepsJson,
  };

  // Persist raw JSON to ComboBox and sync bundlePrice/bundlePriceType so both tables stay in sync
  const comboBoxUpdate = {
    comboStepsConfig: rawJson,
    itemCount: payload.comboType,
    bundlePriceType: payload.bundlePriceType,
  };
  if (payload.bundlePrice != null) comboBoxUpdate.bundlePrice = payload.bundlePrice;
  await db.comboBox.update({
    where: { id: parseInt(boxId) },
    data:  comboBoxUpdate,
  });

  const result = await db.comboBoxConfig.upsert({
    where:  { boxId: parseInt(boxId) },
    create: { boxId: parseInt(boxId), ...payload },
    update: payload,
  });

  // Sync Shopify automatic discount for specific combo boxes (both manual and dynamic pricing)
  if (admin) {
    const box = await db.comboBox.findUnique({ where: { id: parseInt(boxId) }, select: { shopifyProductId: true, shopifyDiscountId: true, boxName: true, displayTitle: true } });
    if (box?.shopifyProductId) {
      await syncShopifyDiscount(admin, {
        boxId: parseInt(boxId),
        existingDiscountId: box.shopifyDiscountId || null,
        title: `${box.boxName || box.displayTitle} Bundle Discount`,
        discountType: parsed.discountType || "none",
        discountValue: parsed.discountValue || "0",
        shopifyProductId: box.shopifyProductId,
      });
    }
  }

  return result;
}

/**
 * Sync a combo box's title and price to its associated Shopify bundle product.
 * Call this whenever combo config is saved (price or title may have changed).
 */
export async function syncShopifyBundleProduct(admin, shopifyProductId, shopifyVariantId, { title, bundlePrice }) {
  if (!admin || !shopifyProductId) return;

  try {
    await admin.graphql(ACTIVATE_BUNDLE_PRODUCT_MUTATION, {
      variables: {
        product: {
          id: shopifyProductId,
          status: "ACTIVE",
          title,
        },
      },
    });
  } catch (e) {
    console.error("[syncShopifyBundleProduct] Failed to update product title/status:", e);
  }

  if (bundlePrice != null) {
    const variantId = shopifyVariantId || (await resolveDefaultVariantId(admin, shopifyProductId));
    if (variantId) {
      try {
        await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
          variables: {
            productId: shopifyProductId,
            variants: [{ id: variantId, price: String(bundlePrice) }],
          },
        });
      } catch (e) {
        console.error("[syncShopifyBundleProduct] Failed to update product price:", e);
      }
    }
  }
}

export async function updateBox(id, shop, data, admin) {
  const existing = await db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null },
  });
  if (!existing) throw new Error("Box not found");

  const requestedBoxCode = data.boxCode !== undefined
    ? await getRequestedBoxCode(data.boxCode, id)
    : undefined;
  const nextBoxCode = data.boxCode !== undefined
    ? (requestedBoxCode || existing.boxCode || await getUniqueBoxCode())
    : (existing.boxCode || await getUniqueBoxCode());

  const bundlePrice = parseFloat(data.bundlePrice) || existing.bundlePrice;
  const priceChanged =
    parseFloat(bundlePrice) !== parseFloat(existing.bundlePrice);

  // Ensure bundle product is ACTIVE (may be DRAFT from old boxes) and update price if changed
  let resolvedVariantId = existing.shopifyVariantId;
  const desiredBundleTitle = data.boxName ?? existing.boxName ?? data.displayTitle ?? existing.displayTitle;

  if (existing.shopifyProductId && admin) {
    if (!resolvedVariantId) {
      resolvedVariantId = await resolveDefaultVariantId(
        admin,
        existing.shopifyProductId,
      );
      if (resolvedVariantId) {
        try {
          await db.comboBox.update({
            where: { id: existing.id },
            data: { shopifyVariantId: resolvedVariantId },
          });
          console.log(
            "[updateBox] Repaired missing shopifyVariantId for box",
            existing.id,
          );
        } catch (e) {
          console.error(
            "[updateBox] Failed to persist repaired shopifyVariantId",
            e,
          );
        }
      }
    }

    try {
      await admin.graphql(ACTIVATE_BUNDLE_PRODUCT_MUTATION, {
        variables: {
          product: {
            id: existing.shopifyProductId,
            status: "ACTIVE",
            title: desiredBundleTitle,
          },
        },
      });
    } catch (e) {
      console.error("[updateBox] Failed to activate Shopify product", e);
    }
    if (priceChanged && resolvedVariantId) {
      try {
        await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
          variables: {
            productId: existing.shopifyProductId,
            variants: [
              { id: resolvedVariantId, price: String(bundlePrice) },
            ],
          },
        });
      } catch (e) {
        console.error("[updateBox] Failed to update Shopify product price", e);
      }
    }
  }

  const hasUploadedBanner = Boolean(data.bannerImage?.bytes);
  const shouldRemoveBanner = data.removeBannerImage === true;

  await db.comboBox.update({
    where: { id: parseInt(id) },
    data: {
      boxCode: nextBoxCode,
      boxName: data.boxName ?? existing.boxName,
      displayTitle: data.displayTitle ?? existing.displayTitle,
      itemCount: data.itemCount ? parseInt(data.itemCount) : existing.itemCount,
      bundlePrice,
      isGiftBox:
        data.isGiftBox !== undefined
          ? data.isGiftBox === "true" || data.isGiftBox === true
          : existing.isGiftBox,
      allowDuplicates:
        data.allowDuplicates !== undefined
          ? data.allowDuplicates === "true" || data.allowDuplicates === true
          : existing.allowDuplicates,
      bannerImageUrl: hasUploadedBanner
        ? null
        : shouldRemoveBanner
          ? null
          : data.bannerImageUrl !== undefined
            ? data.bannerImageUrl || null
            : existing.bannerImageUrl,
      bannerImageData: hasUploadedBanner
        ? data.bannerImage.bytes
        : shouldRemoveBanner
          ? null
          : existing.bannerImageData,
      bannerImageMimeType: hasUploadedBanner
        ? data.bannerImage.mimeType
        : shouldRemoveBanner
          ? null
          : existing.bannerImageMimeType,
      bannerImageFileName: hasUploadedBanner
        ? data.bannerImage.fileName
        : shouldRemoveBanner
          ? null
          : existing.bannerImageFileName,
      isActive:
        data.isActive !== undefined
          ? data.isActive !== "false" && data.isActive !== false
          : existing.isActive,
      giftMessageEnabled:
        data.giftMessageEnabled !== undefined
          ? data.giftMessageEnabled === "true" ||
            data.giftMessageEnabled === true
          : existing.giftMessageEnabled,
      bundlePriceType:
        data.bundlePriceType !== undefined
          ? data.bundlePriceType === "dynamic" ? "dynamic" : "manual"
          : existing.bundlePriceType,
      scopeType: data.scopeType !== undefined ? data.scopeType : existing.scopeType,
      scopeItemsJson: data.scopeItems !== undefined
        ? (Array.isArray(data.scopeItems) && data.scopeItems.length > 0 ? JSON.stringify(data.scopeItems) : null)
        : existing.scopeItemsJson,
    },
  });

  // Sync banner image to Shopify product (replace on upload, delete on removal)
  if (existing.shopifyProductId && admin) {
    if (hasUploadedBanner) {
      await replaceProductImage(admin, existing.shopifyProductId, {
        bytes: data.bannerImage.bytes,
        mimeType: data.bannerImage.mimeType,
        fileName: data.bannerImage.fileName,
      });
    } else if (shouldRemoveBanner) {
      await replaceProductImage(admin, existing.shopifyProductId, null);
    }
  }

  // Replace eligible products only when a non-empty list is submitted (prevents accidental wipe)
  if (data.eligibleProducts && Array.isArray(data.eligibleProducts) && data.eligibleProducts.length > 0) {
    await db.comboBoxProduct.deleteMany({ where: { boxId: parseInt(id) } });
    const productRows = data.eligibleProducts.map((p) => {
      const rawIds = Array.isArray(p.variantIds) ? p.variantIds : [];
      const numericIds = rawIds.map((id) => (typeof id === 'string' && id.includes('/') ? id.split('/').pop() : String(id)));
      return {
        boxId: parseInt(id),
        productId: p.productId || p.id,
        productTitle: p.productTitle || p.title || null,
        productImageUrl: p.productImageUrl || p.imageUrl || null,
        productHandle: p.productHandle || p.handle || null,
        productPrice: p.price != null && parseFloat(p.price) > 0 ? parseFloat(p.price) : null,
        variantIds: numericIds.length > 0 ? JSON.stringify(numericIds) : null,
      };
    });
    if (productRows.length > 0) {
      await db.comboBoxProduct.createMany({ data: productRows });
    }
  }

  // Persist discount settings into comboStepsConfig (merge, preserve existing steps/config)
  if (data.discountType !== undefined || data.discountValue !== undefined) {
    let rawConfig = {};
    if (existing.comboStepsConfig) {
      try { rawConfig = JSON.parse(existing.comboStepsConfig); } catch {}
    }
    rawConfig.bundlePriceType = data.bundlePriceType === "dynamic" ? "dynamic" : (rawConfig.bundlePriceType || "manual");
    rawConfig.discountType = data.discountType || "none";
    rawConfig.discountValue = data.discountValue || "0";
    rawConfig.bundlePrice = bundlePrice;
    await db.comboBox.update({
      where: { id: parseInt(id) },
      data: { comboStepsConfig: JSON.stringify(rawConfig) },
    });
  }

  // Sync Shopify automatic discount for dynamic-priced boxes
  if (admin && existing.shopifyProductId) {
    const effectivePriceType = data.bundlePriceType !== undefined
      ? (data.bundlePriceType === "dynamic" ? "dynamic" : "manual")
      : existing.bundlePriceType;
    await syncShopifyDiscount(admin, {
      boxId: parseInt(id),
      existingDiscountId: existing.shopifyDiscountId || null,
      title: `${data.boxName ?? existing.boxName} Bundle Discount`,
      discountType: effectivePriceType === "dynamic" ? (data.discountType || "none") : "none",
      discountValue: data.discountValue || "0",
      shopifyProductId: existing.shopifyProductId,
    });
  }

  return db.comboBox.findUnique({
    where: { id: parseInt(id) },
    include: { products: true },
  });
}

export async function deleteBox(id, shop, admin = null) {
  const existing = await db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null },
  });
  if (!existing) throw new Error("Box not found");

  // Delete the associated Shopify bundle product
  if (admin && existing.shopifyProductId) {
    try {
      await admin.graphql(DELETE_BUNDLE_PRODUCT_MUTATION, {
        variables: { input: { id: existing.shopifyProductId } },
      });
    } catch (e) {
      console.error("[deleteBox] Failed to delete Shopify product", e);
    }
  }

  // Delete associated Shopify automatic discount
  if (admin && existing.shopifyDiscountId) {
    try {
      await admin.graphql(DISCOUNT_AUTOMATIC_DELETE_MUTATION, { variables: { id: existing.shopifyDiscountId } });
    } catch (e) {
      console.error("[deleteBox] Failed to delete Shopify discount", e);
    }
  }

  return db.comboBox.update({
    where: { id: parseInt(id) },
    data: { deletedAt: new Date(), isActive: false },
  });
}

export async function toggleBoxStatus(id, shop, isActive) {
  return db.comboBox.updateMany({
    where: { id: parseInt(id), shop, deletedAt: null },
    data: { isActive },
  });
}

export async function assignBoxPage(id, shop, pageHandle) {
  return db.comboBox.updateMany({
    where: { id: parseInt(id), shop, deletedAt: null },
    data: { pageHandle: pageHandle || null },
  });
}

export async function toggleComboConfigStatus(boxId, isActive) {
  return db.comboBoxConfig.updateMany({
    where: { boxId: parseInt(boxId) },
    data: { isActive },
  });
}

export async function reorderBoxes(shop, orderedIds) {
  const updates = orderedIds.map((id, index) =>
    db.comboBox.updateMany({
      where: { id: parseInt(id), shop },
      data: { sortOrder: index },
    }),
  );
  return Promise.all(updates);
}

async function getNextSortOrder(shop) {
  const last = await db.comboBox.findFirst({
    where: { shop, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

export async function activateAllBundleProducts(shop, admin) {
  const boxes = await db.comboBox.findMany({
    where: { shop, deletedAt: null, shopifyProductId: { not: null } },
    select: { id: true, shopifyProductId: true },
  });
  await Promise.all(boxes.map(async (box) => {
    try {
      await admin.graphql(ACTIVATE_BUNDLE_PRODUCT_MUTATION, {
        variables: { product: { id: box.shopifyProductId, status: "ACTIVE" } },
      });
    } catch (e) {
      console.error("[activateAllBundleProducts] Failed for box", box.id, e);
    }
  }));
}

export async function repairMissingShopifyProducts(shop, admin) {
  const boxes = await db.comboBox.findMany({
    where: { shop, deletedAt: null, shopifyProductId: null },
    select: { id: true, boxName: true, displayTitle: true, bundlePrice: true },
  });
  if (boxes.length === 0) return;

  await Promise.all(boxes.map(async (box) => {
    try {
      const { shopifyProductId, shopifyVariantId } = await createShopifyBundleProduct(
        admin,
        box.boxName || box.displayTitle,
        parseFloat(box.bundlePrice),
      );
      if (shopifyProductId) {
        await db.comboBox.update({
          where: { id: box.id },
          data: { shopifyProductId, shopifyVariantId },
        });
        console.log("[repairMissingShopifyProducts] Repaired box", box.id);
      }
    } catch (e) {
      console.error("[repairMissingShopifyProducts] Failed for box", box.id, e);
    }
  }));
}

export async function repairMissingShopifyVariantIds(shop, admin) {
  const boxes = await db.comboBox.findMany({
    where: {
      shop,
      deletedAt: null,
      shopifyProductId: { not: null },
      shopifyVariantId: null,
    },
    select: { id: true, shopifyProductId: true },
  });
  if (boxes.length === 0) return;

  await Promise.all(
    boxes.map(async (box) => {
      try {
        const shopifyVariantId = await resolveDefaultVariantId(
          admin,
          box.shopifyProductId,
        );
        if (shopifyVariantId) {
          await db.comboBox.update({
            where: { id: box.id },
            data: { shopifyVariantId },
          });
          console.log("[repairMissingShopifyVariantIds] Repaired box", box.id);
        } else {
          console.warn(
            "[repairMissingShopifyVariantIds] Variant not found for box",
            box.id,
          );
        }
      } catch (e) {
        console.error(
          "[repairMissingShopifyVariantIds] Failed for box",
          box.id,
          e,
        );
      }
    }),
  );
}

export async function getActiveBoxCount(shop) {
  return db.comboBox.count({
    where: { shop, isActive: true, deletedAt: null },
  });
}

/**
 * Upsert per-step images for a combo box.
 * stepImages: array of { stepIndex, bytes, mimeType, fileName }
 */
export async function saveComboStepImages(boxId, stepImages) {
  if (!boxId || !Array.isArray(stepImages)) return;
  for (const img of stepImages) {
    if (!img || !img.bytes) continue;
    await db.comboStepImage.upsert({
      where: { boxId_stepIndex: { boxId: parseInt(boxId), stepIndex: img.stepIndex } },
      create: {
        boxId: parseInt(boxId),
        stepIndex: img.stepIndex,
        imageData: img.bytes,
        mimeType: img.mimeType || null,
        fileName: img.fileName || null,
      },
      update: {
        imageData: img.bytes,
        mimeType: img.mimeType || null,
        fileName: img.fileName || null,
      },
    });
  }
}

/**
 * Retrieve all step images for a box (binary data included).
 */
export async function getComboStepImages(boxId) {
  return db.comboStepImage.findMany({
    where: { boxId: parseInt(boxId) },
    orderBy: { stepIndex: "asc" },
    select: { stepIndex: true, mimeType: true, imageData: true, fileName: true },
  });
}

/**
 * Delete a specific step image.
 */
export async function deleteComboStepImage(boxId, stepIndex) {
  return db.comboStepImage.deleteMany({
    where: { boxId: parseInt(boxId), stepIndex: parseInt(stepIndex) },
  });
}
