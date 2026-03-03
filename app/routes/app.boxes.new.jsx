import { useState } from "react";
import { useLoaderData, useNavigate, useFetcher, Form, useActionData, useNavigation } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createBox } from "../models/boxes.server";

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          handle
          featuredImage { url }
          variants(first: 1) {
            edges { node { id price } }
          }
        }
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
  const formData = await request.formData();

  let eligibleProducts = [];
  try {
    eligibleProducts = JSON.parse(formData.get("eligibleProducts") || "[]");
  } catch {}

  const data = {
    boxName: formData.get("boxName"),
    displayTitle: formData.get("displayTitle"),
    itemCount: formData.get("itemCount"),
    bundlePrice: formData.get("bundlePrice"),
    isGiftBox: formData.get("isGiftBox") === "true",
    allowDuplicates: formData.get("allowDuplicates") === "true",
    bannerImageUrl: formData.get("bannerImageUrl") || null,
    isActive: formData.get("isActive") !== "false",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    eligibleProducts,
  };

  const errors = {};
  if (!data.boxName?.trim()) errors.boxName = "Box name is required";
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1 || parseInt(data.itemCount) > 20)
    errors.itemCount = "Item count must be between 1 and 20";
  if (!data.bundlePrice || parseFloat(data.bundlePrice) <= 0)
    errors.bundlePrice = "Bundle price must be greater than 0";
  if (eligibleProducts.length === 0)
    errors.eligibleProducts = "Select at least one eligible product";

  if (Object.keys(errors).length > 0) return { errors };

  try {
    await createBox(session.shop, data, admin);
  } catch (e) {
    console.error("[app.boxes.new] createBox error:", e);
    return { errors: { _global: "Failed to create box. Please try again." } };
  }

  throw redirect("/app/boxes");
};

const fieldStyle = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid #c9c6be",
  borderRadius: "6px",
  fontSize: "13px",
  color: "#1a1814",
  background: "#fff",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: "500",
  color: "#1a1814",
  marginBottom: "6px",
};

const errorStyle = {
  color: "#e11d48",
  fontSize: "11px",
  marginTop: "4px",
};

export default function CreateBoxPage() {
  const { products } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const searchFetcher = useFetcher();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [productSearch, setProductSearch] = useState("");
  const [options, setOptions] = useState({
    isGiftBox: false,
    allowDuplicates: false,
    giftMessageEnabled: false,
    isActive: true,
  });

  const errors = actionData?.errors || {};
  const displayProducts = searchFetcher.data?.products || products;

  function handleSearchChange(e) {
    const val = e.target.value;
    setProductSearch(val);
    if (val.length > 1) {
      searchFetcher.load(`/app/boxes/new?q=${encodeURIComponent(val)}`);
    } else if (val.length === 0) {
      searchFetcher.load(`/app/boxes/new`);
    }
  }

  function toggleProduct(product) {
    setSelectedProducts((prev) => {
      const exists = prev.find((p) => p.id === product.id);
      if (exists) return prev.filter((p) => p.id !== product.id);
      return [...prev, {
        id: product.id,
        productId: product.id,
        productTitle: product.title,
        productImageUrl: product.imageUrl,
        productHandle: product.handle,
        variantIds: product.variantId ? [product.variantId] : [],
      }];
    });
  }

  const isSelected = (id) => selectedProducts.some((p) => p.id === id);

  function toggleOption(name) {
    setOptions((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const sectionHeadingStyle = {
    fontSize: "12px",
    fontWeight: "600",
    color: "#7a7670",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    fontFamily: "monospace",
    marginBottom: "14px",
    paddingBottom: "8px",
    borderBottom: "1px solid #e5e1d8",
  };

  return (
    <s-page heading="Create New Box Type">
      <s-button slot="primary-action" variant="tertiary" onClick={() => navigate("/app/boxes")}>
        Cancel
      </s-button>

      {errors._global && (
        <div style={{ background: "#fff5f5", border: "1px solid #fca5a5", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#991b1b", fontSize: "13px" }}>
          {errors._global}
        </div>
      )}

      <s-section>
        <Form method="POST">
          {/* Hidden inputs for booleans and products */}
          <input type="hidden" name="eligibleProducts" value={JSON.stringify(selectedProducts)} />
          <input type="hidden" name="isGiftBox" value={String(options.isGiftBox)} />
          <input type="hidden" name="allowDuplicates" value={String(options.allowDuplicates)} />
          <input type="hidden" name="giftMessageEnabled" value={String(options.giftMessageEnabled)} />
          <input type="hidden" name="isActive" value={String(options.isActive)} />

          {/* Basic Information */}
          <div style={{ marginBottom: "28px" }}>
            <div style={sectionHeadingStyle}>Basic Information</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={labelStyle}>Box Internal Name *</label>
                <input type="text" name="boxName" placeholder="e.g. Box of 4 Bestsellers" style={{ ...fieldStyle, borderColor: errors.boxName ? "#e11d48" : "#c9c6be" }} />
                {errors.boxName && <div style={errorStyle}>{errors.boxName}</div>}
              </div>
              <div>
                <label style={labelStyle}>Display Title (Storefront) *</label>
                <input type="text" name="displayTitle" placeholder="Shown to customers" style={{ ...fieldStyle, borderColor: errors.displayTitle ? "#e11d48" : "#c9c6be" }} />
                {errors.displayTitle && <div style={errorStyle}>{errors.displayTitle}</div>}
              </div>
              <div>
                <label style={labelStyle}>Number of Items *</label>
                <input type="number" name="itemCount" placeholder="e.g. 4" min="1" max="20" defaultValue="4" style={{ ...fieldStyle, borderColor: errors.itemCount ? "#e11d48" : "#c9c6be" }} />
                {errors.itemCount && <div style={errorStyle}>{errors.itemCount}</div>}
              </div>
              <div>
                <label style={labelStyle}>Bundle Price (₹) *</label>
                <input type="number" name="bundlePrice" placeholder="e.g. 1200" min="0" step="0.01" style={{ ...fieldStyle, borderColor: errors.bundlePrice ? "#e11d48" : "#c9c6be" }} />
                {errors.bundlePrice && <div style={errorStyle}>{errors.bundlePrice}</div>}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Banner Image URL (optional)</label>
                <input type="url" name="bannerImageUrl" placeholder="https://... (600×300px recommended)" style={fieldStyle} />
              </div>
            </div>
          </div>

          {/* Options */}
          <div style={{ marginBottom: "28px" }}>
            <div style={sectionHeadingStyle}>Options</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {[
                { key: "isGiftBox", label: "Gift Box Mode", desc: "Shows gift wrapping option to customers" },
                { key: "allowDuplicates", label: "Allow Duplicate Products", desc: "Same product can fill multiple slots" },
                { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message" },
                { key: "isActive", label: "Active (visible on storefront)", desc: "Uncheck to save as draft" },
              ].map((opt) => (
                <label key={opt.key} style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", padding: "12px", border: "1px solid #e5e1d8", borderRadius: "8px", background: options[opt.key] ? "#f0fdf4" : "#fff" }}>
                  <input
                    type="checkbox"
                    checked={options[opt.key]}
                    onChange={() => toggleOption(opt.key)}
                    style={{ marginTop: "2px", width: "15px", height: "15px", accentColor: "#2A7A4F", flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#1a1814" }}>{opt.label}</div>
                    <div style={{ fontSize: "11px", color: "#7a7670", marginTop: "2px" }}>{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Eligible Products */}
          <div style={{ marginBottom: "28px" }}>
            <div style={sectionHeadingStyle}>
              Eligible Products
              {selectedProducts.length > 0 && (
                <span style={{ marginLeft: "8px", background: "#2A7A4F", color: "#fff", borderRadius: "20px", padding: "2px 8px", fontSize: "10px", fontWeight: "600", fontFamily: "monospace" }}>
                  {selectedProducts.length} selected
                </span>
              )}
            </div>
            {errors.eligibleProducts && (
              <div style={{ color: "#e11d48", fontSize: "12px", marginBottom: "8px", padding: "8px 12px", background: "#fff5f5", borderRadius: "6px" }}>
                {errors.eligibleProducts}
              </div>
            )}

            <input
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={handleSearchChange}
              style={{ ...fieldStyle, marginBottom: "10px" }}
            />

            {selectedProducts.length > 0 && (
              <div style={{ marginBottom: "10px", padding: "10px 14px", background: "#f0fdf4", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "#15803d", marginBottom: "6px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Selected
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {selectedProducts.map((p) => (
                    <span
                      key={p.id}
                      onClick={() => toggleProduct(p)}
                      style={{ background: "#2A7A4F", color: "#fff", borderRadius: "20px", padding: "3px 10px", fontSize: "11px", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      {p.productTitle} ✕
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ maxHeight: "280px", overflowY: "auto", border: "1px solid #e5e1d8", borderRadius: "6px" }}>
              {displayProducts.map((product) => (
                <label
                  key={product.id}
                  style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderBottom: "1px solid #f0ede4", cursor: "pointer", background: isSelected(product.id) ? "#f0fdf4" : "#fff" }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected(product.id)}
                    onChange={() => toggleProduct(product)}
                    style={{ width: "14px", height: "14px", flexShrink: 0, accentColor: "#2A7A4F" }}
                  />
                  {product.imageUrl && (
                    <img src={product.imageUrl} alt={product.title} style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }} />
                  )}
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#1a1814" }}>{product.title}</div>
                    <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace" }}>{product.handle}</div>
                  </div>
                </label>
              ))}
              {displayProducts.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "#7a7670", fontSize: "13px" }}>
                  No products found
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end", paddingTop: "16px", borderTop: "1px solid #e5e1d8" }}>
            <button
              type="button"
              onClick={() => navigate("/app/boxes")}
              style={{ background: "transparent", border: "1px solid #c9c6be", borderRadius: "6px", padding: "10px 20px", fontSize: "13px", cursor: "pointer", color: "#374151" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              style={{ background: isSaving ? "#9ca3af" : "#2A7A4F", border: "none", borderRadius: "6px", padding: "10px 24px", fontSize: "13px", cursor: isSaving ? "not-allowed" : "pointer", color: "#fff", fontWeight: "600" }}
            >
              {isSaving ? "Saving..." : "Save & Publish"}
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
