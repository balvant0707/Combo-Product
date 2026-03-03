import { useState } from "react";
import { useLoaderData, useNavigate, useFetcher, Form, useActionData } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox } from "../models/boxes.server";

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          featuredImage {
            url
          }
          variants(first: 1) {
            edges {
              node {
                id
                price
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";

  const resp = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 50, query: query || null },
  });
  const json = await resp.json();
  const products = (json?.data?.products?.edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    imageUrl: node.featuredImage?.url || null,
    variantId: node.variants?.edges?.[0]?.node?.id || null,
    price: node.variants?.edges?.[0]?.node?.price || "0",
  }));

  return { products };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  // Parse eligible products from JSON string
  let eligibleProducts = [];
  try {
    eligibleProducts = JSON.parse(formData.get("eligibleProducts") || "[]");
  } catch {}

  const data = {
    boxName: formData.get("boxName"),
    displayTitle: formData.get("displayTitle"),
    itemCount: formData.get("itemCount"),
    bundlePrice: formData.get("bundlePrice"),
    isGiftBox: formData.get("isGiftBox") === "on",
    allowDuplicates: formData.get("allowDuplicates") === "on",
    bannerImageUrl: formData.get("bannerImageUrl") || null,
    isActive: formData.get("isActive") !== "off",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "on",
    eligibleProducts,
  };

  // Validation
  const errors = {};
  if (!data.boxName?.trim()) errors.boxName = "Box name is required";
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1 || parseInt(data.itemCount) > 20)
    errors.itemCount = "Item count must be between 1 and 20";
  if (!data.bundlePrice || parseFloat(data.bundlePrice) <= 0)
    errors.bundlePrice = "Bundle price must be greater than 0";
  if (eligibleProducts.length === 0)
    errors.eligibleProducts = "Select at least one eligible product";

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  await createBox(shop, data, admin);
  throw redirect("/app/boxes");
};

export default function CreateBoxPage() {
  const { products } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const searchFetcher = useFetcher();

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");

  const errors = actionData?.errors || {};

  const displayProducts =
    searchFetcher.data?.products || products;

  function handleSearchChange(e) {
    const val = e.target.value;
    setProductSearch(val);
    if (val.length > 1) {
      searchFetcher.load(`/app/boxes/new?q=${encodeURIComponent(val)}`);
    }
  }

  function toggleProduct(product) {
    setSelectedProducts((prev) => {
      const exists = prev.find((p) => p.id === product.id);
      if (exists) return prev.filter((p) => p.id !== product.id);
      return [
        ...prev,
        {
          id: product.id,
          productId: product.id,
          productTitle: product.title,
          productImageUrl: product.imageUrl,
          productHandle: product.handle,
        },
      ];
    });
  }

  const isSelected = (id) => selectedProducts.some((p) => p.id === id);

  return (
    <s-page heading="Create New Box Type">
      <s-button slot="primary-action" variant="tertiary" onClick={() => navigate("/app/boxes")}>
        Cancel
      </s-button>

      <s-section>
        <Form method="POST">
          <input
            type="hidden"
            name="eligibleProducts"
            value={JSON.stringify(selectedProducts)}
          />

          {/* Basic Information */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid #e5e1d8", color: "#6b7280" }}>
              Basic Information
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <s-text-field
                  label="Box Internal Name"
                  name="boxName"
                  placeholder="e.g. Box of 4 Bestsellers"
                  error={errors.boxName}
                />
              </div>
              <div>
                <s-text-field
                  label="Display Title (Storefront)"
                  name="displayTitle"
                  placeholder="Shown to customers"
                  error={errors.displayTitle}
                />
              </div>
              <div>
                <s-text-field
                  label="Number of Items"
                  name="itemCount"
                  type="number"
                  placeholder="e.g. 4"
                  min="1"
                  max="20"
                  error={errors.itemCount}
                />
              </div>
              <div>
                <s-text-field
                  label="Bundle Price (₹)"
                  name="bundlePrice"
                  type="number"
                  placeholder="e.g. 1200"
                  min="0"
                  step="0.01"
                  error={errors.bundlePrice}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <s-text-field
                  label="Banner Image URL (optional)"
                  name="bannerImageUrl"
                  placeholder="https://... (600×300px recommended)"
                />
              </div>
            </div>
          </div>

          {/* Options */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid #e5e1d8", color: "#6b7280" }}>
              Options
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="isGiftBox" style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Gift Box Mode</div>
                  <div style={{ fontSize: "12px", color: "#7a7670" }}>Shows size selector Step 1</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="allowDuplicates" style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Allow Duplicate Products</div>
                  <div style={{ fontSize: "12px", color: "#7a7670" }}>Same product can fill multiple slots</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="giftMessageEnabled" style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Gift Message Field</div>
                  <div style={{ fontSize: "12px", color: "#7a7670" }}>Show text area for gift message</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="isActive" defaultChecked style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Active (visible on storefront)</div>
                  <div style={{ fontSize: "12px", color: "#7a7670" }}>Uncheck to save as draft</div>
                </div>
              </label>
            </div>
          </div>

          {/* Eligible Products */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px solid #e5e1d8", color: "#6b7280" }}>
              Eligible Products
              {selectedProducts.length > 0 && (
                <span style={{ marginLeft: "8px", background: "#059669", color: "#fff", borderRadius: "20px", padding: "2px 8px", fontSize: "11px", fontWeight: "600" }}>
                  {selectedProducts.length} selected
                </span>
              )}
            </div>
            {errors.eligibleProducts && (
              <div style={{ color: "#e11d48", fontSize: "12px", marginBottom: "8px" }}>
                {errors.eligibleProducts}
              </div>
            )}

            <input
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={handleSearchChange}
              style={{
                width: "100%",
                padding: "8px 12px",
                border: "1px solid #e5e1d8",
                borderRadius: "6px",
                fontSize: "13px",
                marginBottom: "12px",
                boxSizing: "border-box",
              }}
            />

            {selectedProducts.length > 0 && (
              <div style={{ marginBottom: "12px", padding: "10px 14px", background: "#ecfdf5", borderRadius: "6px", border: "1px solid #a7f3d0" }}>
                <div style={{ fontSize: "12px", fontWeight: "600", color: "#059669", marginBottom: "6px" }}>
                  Selected Products
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {selectedProducts.map((p) => (
                    <span
                      key={p.id}
                      onClick={() => toggleProduct(p)}
                      style={{
                        background: "#059669",
                        color: "#fff",
                        borderRadius: "20px",
                        padding: "3px 10px",
                        fontSize: "11px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {p.productTitle} ✕
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div
              style={{
                maxHeight: "300px",
                overflowY: "auto",
                border: "1px solid #e5e1d8",
                borderRadius: "6px",
              }}
            >
              {displayProducts.map((product) => (
                <label
                  key={product.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 14px",
                    borderBottom: "1px solid #f0ede4",
                    cursor: "pointer",
                    background: isSelected(product.id) ? "#ecfdf5" : "#fff",
                    transition: "background 0.1s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected(product.id)}
                    onChange={() => toggleProduct(product)}
                    style={{ width: "14px", height: "14px", flexShrink: 0 }}
                  />
                  {product.imageUrl && (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                    />
                  )}
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#1a1814" }}>
                      {product.title}
                    </div>
                    <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace" }}>
                      {product.handle}
                    </div>
                  </div>
                </label>
              ))}
              {displayProducts.length === 0 && (
                <div style={{ padding: "20px", textAlign: "center", color: "#7a7670" }}>
                  No products found
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => navigate("/app/boxes")}
              style={{
                background: "transparent",
                border: "1px solid #e5e1d8",
                borderRadius: "6px",
                padding: "10px 20px",
                fontSize: "13px",
                cursor: "pointer",
                color: "#374151",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                background: "#059669",
                border: "none",
                borderRadius: "6px",
                padding: "10px 20px",
                fontSize: "13px",
                cursor: "pointer",
                color: "#fff",
                fontWeight: "600",
              }}
            >
              Save &amp; Publish
            </button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
