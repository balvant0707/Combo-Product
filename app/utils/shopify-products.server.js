function escapeSearchValue(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function extractNumericProductId(gid) {
  const raw = String(gid || "").trim();
  const match = raw.match(/gid:\/\/shopify\/Product\/(\d+)/i);
  return match?.[1] || null;
}

export function normalizeProductLookupLabel(label) {
  return String(label || "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toLowerCase();
}

const PRODUCT_LOOKUP_QUERY = `#graphql
  query ProductLookup($query: String!) {
    products(first: 5, query: $query) {
      nodes {
        id
        title
      }
    }
  }
`;

export async function fetchProductIdsByLabels(admin, labels = []) {
  const normalizedLabels = [...new Set(
    (labels || [])
      .map((label) => normalizeProductLookupLabel(label))
      .filter(Boolean),
  )];

  const result = new Map();
  if (normalizedLabels.length === 0) return result;

  await Promise.all(
    normalizedLabels.map(async (label) => {
      const query = `title:"${escapeSearchValue(label)}"`;

      try {
        const response = await admin.graphql(PRODUCT_LOOKUP_QUERY, {
          variables: { query },
        });
        const json = await response.json();
        const nodes = Array.isArray(json?.data?.products?.nodes) ? json.data.products.nodes : [];
        if (nodes.length === 0) return;

        const exactMatch =
          nodes.find((node) => normalizeProductLookupLabel(node?.title) === label) || nodes[0];
        const numericId = extractNumericProductId(exactMatch?.id);
        if (numericId) result.set(label, numericId);
      } catch (error) {
        console.error("[shopify-products] Failed to resolve product by label", { label, error });
      }
    }),
  );

  return result;
}
