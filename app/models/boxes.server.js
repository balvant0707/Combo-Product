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
    include: { products: true },
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

  // Create hidden Shopify product for bundle pricing
  let shopifyProductId = null;
  let shopifyVariantId = null;

  if (admin) {
    try {
      // Step 1: Create the product (API 2025-01+ removed variants from ProductCreateInput)
      const resp = await admin.graphql(CREATE_BUNDLE_PRODUCT_MUTATION, {
        variables: {
          product: {
            title: `[Bundle] ${data.displayTitle}`,
            status: "DRAFT",
            vendor: "ComboBuilder",
          },
        },
      });
      const json = await resp.json();
      const product = json?.data?.productCreate?.product;
      if (product) {
        shopifyProductId = product.id;
        shopifyVariantId = product.variants?.edges?.[0]?.node?.id || null;

        // Step 2: Update the auto-created default variant price
        if (shopifyVariantId && bundlePrice > 0) {
          await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
            variables: {
              productId: shopifyProductId,
              variants: [{ id: shopifyVariantId, price: String(bundlePrice) }],
            },
          });
        }
      }
    } catch (e) {
      console.error("[createBox] Failed to create Shopify product", e);
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
      shopifyProductId,
      shopifyVariantId,
    },
  });

  // Save eligible products
  if (data.eligibleProducts && Array.isArray(data.eligibleProducts)) {
    const productRows = data.eligibleProducts.map((p) => ({
      boxId: box.id,
      productId: p.productId || p.id,
      productTitle: p.productTitle || p.title || null,
      productImageUrl: p.productImageUrl || p.imageUrl || null,
      productHandle: p.productHandle || p.handle || null,
      productPrice: p.price != null && parseFloat(p.price) > 0 ? parseFloat(p.price) : null,
    }));
    if (productRows.length > 0) {
      await db.comboBoxProduct.createMany({ data: productRows });
    }
  }

  return db.comboBox.findUnique({
    where: { id: box.id },
    include: { products: true },
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

  // Update Shopify product price if changed
  if (
    priceChanged &&
    existing.shopifyProductId &&
    existing.shopifyVariantId &&
    admin
  ) {
    try {
      await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
        variables: {
          productId: existing.shopifyProductId,
          variants: [
            { id: existing.shopifyVariantId, price: String(bundlePrice) },
          ],
        },
      });
    } catch (e) {
      console.error("[updateBox] Failed to update Shopify product price", e);
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
    },
  });

  // Replace eligible products if provided
  if (data.eligibleProducts && Array.isArray(data.eligibleProducts)) {
    await db.comboBoxProduct.deleteMany({ where: { boxId: parseInt(id) } });
    const productRows = data.eligibleProducts.map((p) => ({
      boxId: parseInt(id),
      productId: p.productId || p.id,
      productTitle: p.productTitle || p.title || null,
      productImageUrl: p.productImageUrl || p.imageUrl || null,
      productHandle: p.productHandle || p.handle || null,
      productPrice: p.price != null && parseFloat(p.price) > 0 ? parseFloat(p.price) : null,
    }));
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

export async function getActiveBoxCount(shop) {
  return db.comboBox.count({
    where: { shop, isActive: true, deletedAt: null },
  });
}
