import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { createShopifyBundleProduct } from "../models/boxes.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const GET_PRODUCT_DEFAULT_VARIANT_QUERY = `#graphql
  query GetProductDefaultVariant($id: ID!) {
    product(id: $id) {
      id
      status
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

const ACTIVATE_PRODUCT_MUTATION = `#graphql
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status }
      userErrors { field message }
    }
  }
`;

const GET_PUBLICATIONS_QUERY = `#graphql
  query GetPublications {
    publications(first: 20) {
      edges {
        node {
          id
          catalog { title }
        }
      }
    }
  }
`;

const PUBLISH_PRODUCT_MUTATION = `#graphql
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { ... on Product { id } }
      userErrors { field message }
    }
  }
`;

function toNumericShopifyId(gid) {
  if (!gid) return null;
  const raw = String(gid);
  return raw.includes("/") ? raw.split("/").pop() : raw;
}

async function ensureProductPublished(admin, productId) {
  // Step 1: set ACTIVE
  try {
    await admin.graphql(ACTIVATE_PRODUCT_MUTATION, {
      variables: { product: { id: productId, status: "ACTIVE" } },
    });
  } catch (e) {
    console.warn("[variant-repair] activate error:", e);
  }

  // Step 2: publish to every publication including Online Store (catalog is null for Online Store).
  try {
    const pubResp = await admin.graphql(GET_PUBLICATIONS_QUERY);
    const pubJson = await pubResp.json();
    const edges = pubJson?.data?.publications?.edges || [];
    // Publish to ALL publications — Online Store has catalog: null so must not filter
    const salesChannelIds = edges.map((e) => ({ publicationId: e.node.id }));

    if (salesChannelIds.length > 0) {
      await admin.graphql(PUBLISH_PRODUCT_MUTATION, {
        variables: { id: productId, input: salesChannelIds },
      });
    }
  } catch (e) {
    console.warn("[variant-repair] publish error:", e);
  }
}

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return Response.json(
      { error: "shop parameter required" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const boxId = parseInt(params.boxId, 10);
  if (isNaN(boxId)) {
    return Response.json(
      { error: "Invalid box ID" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const box = await db.comboBox.findFirst({
    where: { id: boxId, shop, isActive: true, deletedAt: null },
    select: {
      id: true,
      boxName: true,
      displayTitle: true,
      bundlePrice: true,
      shopifyProductId: true,
      shopifyVariantId: true,
    },
  });

  if (!box) {
    return Response.json(
      { error: "Combo box not found" },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Case 1: no Shopify product linked at all — create one
    if (!box.shopifyProductId) {
      const title = box.boxName || box.displayTitle;
      const { shopifyProductId, shopifyVariantId } =
        await createShopifyBundleProduct(
          admin,
          title,
          parseFloat(box.bundlePrice) || 0,
        );
      await db.comboBox.update({
        where: { id: box.id },
        data: { shopifyProductId, shopifyVariantId },
      });
      console.log("[variant-repair] Created missing product for box", box.id);
      return Response.json(
        {
          shopifyProductId: toNumericShopifyId(shopifyProductId),
          shopifyVariantId: toNumericShopifyId(shopifyVariantId),
        },
        { headers: CORS_HEADERS },
      );
    }

    // Case 2: product linked — check if it still exists in Shopify
    const resp = await admin.graphql(GET_PRODUCT_DEFAULT_VARIANT_QUERY, {
      variables: { id: box.shopifyProductId },
    });
    const json = await resp.json();
    const productData = json?.data?.product;
    const freshVariantId =
      productData?.variants?.edges?.[0]?.node?.id || null;

    // Case 2a: product was deleted from Shopify — recreate it
    if (!productData || !freshVariantId) {
      const title = box.boxName || box.displayTitle;
      const { shopifyProductId, shopifyVariantId } =
        await createShopifyBundleProduct(
          admin,
          title,
          parseFloat(box.bundlePrice) || 0,
        );
      await db.comboBox.update({
        where: { id: box.id },
        data: { shopifyProductId, shopifyVariantId },
      });
      console.log("[variant-repair] Recreated deleted product for box", box.id);
      return Response.json(
        {
          shopifyProductId: toNumericShopifyId(shopifyProductId),
          shopifyVariantId: toNumericShopifyId(shopifyVariantId),
        },
        { headers: CORS_HEADERS },
      );
    }

    // Case 2b: product exists — ensure it's ACTIVE and published so cart accepts it
    await ensureProductPublished(admin, productData.id);

    if (freshVariantId !== box.shopifyVariantId) {
      await db.comboBox.update({
        where: { id: box.id },
        data: { shopifyVariantId: freshVariantId },
      });
    }

    return Response.json(
      {
        shopifyProductId: toNumericShopifyId(box.shopifyProductId),
        shopifyVariantId: toNumericShopifyId(freshVariantId),
      },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    console.error("[api.storefront.boxes.$boxId.variant] error:", e);
    return Response.json(
      { error: "Failed to resolve combo variant" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
};
