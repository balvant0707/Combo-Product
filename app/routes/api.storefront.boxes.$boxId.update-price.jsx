import db from "../db.server";
import { unauthenticated } from "../shopify.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

const UPDATE_VARIANT_PRICE_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

function toNumericId(gid) {
  if (!gid) return null;
  const raw = String(gid);
  return raw.includes("/") ? raw.split("/").pop() : raw;
}

async function activateAndPublish(admin, productId) {
  // Step 1: set ACTIVE
  try {
    await admin.graphql(ACTIVATE_PRODUCT_MUTATION, {
      variables: { product: { id: productId, status: "ACTIVE" } },
    });
  } catch (e) {
    console.warn("[update-price] activate error:", e);
  }

  // Step 2: publish to every sales-channel publication (all entries that have a catalog).
  // Matching by catalog title is fragile; publishing to all catalog-based channels is safe.
  try {
    const pubResp = await admin.graphql(GET_PUBLICATIONS_QUERY);
    const pubJson = await pubResp.json();
    const edges = pubJson?.data?.publications?.edges || [];
    const salesChannelIds = edges
      .filter((e) => e?.node?.catalog != null)
      .map((e) => ({ publicationId: e.node.id }));

    if (salesChannelIds.length > 0) {
      await admin.graphql(PUBLISH_PRODUCT_MUTATION, {
        variables: { id: productId, input: salesChannelIds },
      });
    }
  } catch (e) {
    console.warn("[update-price] publish error:", e);
  }
}

// Handle CORS preflight via loader (GET/OPTIONS)
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return new Response(null, { status: 405, headers: CORS_HEADERS });
};

export const action = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: CORS_HEADERS },
    );
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

  let price;
  try {
    const body = await request.json();
    price = parseFloat(body.price);
  } catch {
    return Response.json(
      { error: "Invalid request body" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (!price || price <= 0) {
    return Response.json(
      { error: "price must be a positive number" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const box = await db.comboBox.findFirst({
    where: { id: boxId, shop, isActive: true, deletedAt: null },
    select: { id: true, shopifyProductId: true, shopifyVariantId: true },
  });

  if (!box || !box.shopifyProductId || !box.shopifyVariantId) {
    return Response.json(
      { error: "Combo box not linked to a Shopify product" },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Ensure ACTIVE + published, then update price — all before responding so
    // the client can immediately call /cart/add.js and find the variant.
    await activateAndPublish(admin, box.shopifyProductId);

    const resp = await admin.graphql(UPDATE_VARIANT_PRICE_MUTATION, {
      variables: {
        productId: box.shopifyProductId,
        variants: [{ id: box.shopifyVariantId, price: price.toFixed(2) }],
      },
    });
    const json = await resp.json();

    const userErrors =
      json?.data?.productVariantsBulkUpdate?.userErrors || [];
    if (userErrors.length > 0) {
      console.error("[update-price] userErrors:", userErrors);
      return Response.json(
        { error: userErrors[0].message },
        { status: 422, headers: CORS_HEADERS },
      );
    }

    return Response.json(
      {
        shopifyVariantId: toNumericId(box.shopifyVariantId),
        price: price.toFixed(2),
      },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    console.error("[update-price] error:", e);
    return Response.json(
      { error: "Failed to update product price" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
};
