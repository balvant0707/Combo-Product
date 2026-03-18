import db from "../db.server";
import { Buffer } from "node:buffer";

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

  const hasUploadedBanner = Boolean(data.bannerImage?.bytes);

  const box = await db.comboBox.create({
    data: {
      shop,
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
    },
  });

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
export async function upsertComboConfig(boxId, config) {
  const parsed = typeof config === "string" ? JSON.parse(config) : config;
  const rawJson = typeof config === "string" ? config : JSON.stringify(config);
  const stepsJson = JSON.stringify(Array.isArray(parsed.steps) ? parsed.steps : []);

  const payload = {
    comboType:         parseInt(parsed.type) || 2,
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

  // Persist raw JSON to ComboBox.comboStepsConfig so the edit page can read it back
  await db.comboBox.update({
    where: { id: parseInt(boxId) },
    data:  { comboStepsConfig: rawJson },
  });

  return db.comboBoxConfig.upsert({
    where:  { boxId: parseInt(boxId) },
    create: { boxId: parseInt(boxId), ...payload },
    update: payload,
  });
}

export async function updateBox(id, shop, data, admin) {
  const existing = await db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null },
  });
  if (!existing) throw new Error("Box not found");

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
    },
  });

  // Replace eligible products if provided
  if (data.eligibleProducts && Array.isArray(data.eligibleProducts)) {
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
