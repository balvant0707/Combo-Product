import { useState } from "react";
import { useLoaderData, useNavigate, useFetcher, Form, useActionData, useNavigation } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBox, updateBox, deleteBox } from "../models/boxes.server";

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

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const box = await getBox(params.id, shop);
  if (!box) throw redirect("/app/boxes");

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
  }));

  return {
    box: { ...box, bundlePrice: parseFloat(box.bundlePrice) },
    products,
  };
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "delete") {
    await deleteBox(params.id, shop);
    throw redirect("/app/boxes");
  }

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
    isActive: formData.get("isActive") === "true",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "true",
    eligibleProducts,
  };

  const errors = {};
  if (!data.boxName?.trim()) errors.boxName = "Box name is required";
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1) errors.itemCount = "Invalid item count";
  if (!data.bundlePrice || parseFloat(data.bundlePrice) <= 0) errors.bundlePrice = "Invalid price";
  if (eligibleProducts.length === 0) errors.eligibleProducts = "Select at least one product";

  if (Object.keys(errors).length > 0) return { errors };

  try {
    await updateBox(params.id, shop, data, admin);
  } catch (e) {
    console.error("[app.boxes.$id] updateBox error:", e);
    return { errors: { _global: "Failed to save changes. Please try again." } };
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

const errorStyle = { color: "#e11d48", fontSize: "11px", marginTop: "4px" };

export default function EditBoxPage() {
  const { box, products } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const searchFetcher = useFetcher();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const errors = actionData?.errors || {};

  const initialSelected = (box.products || []).map((p) => ({
    id: p.productId,
    productId: p.productId,
    productTitle: p.productTitle,
    productImageUrl: p.productImageUrl,
    productHandle: p.productHandle,
    variantIds: p.variantIds || [],
  }));

  const [selectedProducts, setSelectedProducts] = useState(initialSelected);
  const [productSearch, setProductSearch] = useState("");
  const [options, setOptions] = useState({
    isGiftBox: box.isGiftBox,
    allowDuplicates: box.allowDuplicates,
    giftMessageEnabled: box.giftMessageEnabled,
    isActive: box.isActive,
  });

  const displayProducts = searchFetcher.data?.products ||
    (productSearch
      ? products.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase()))
      : products);

  function handleSearchChange(e) {
    const val = e.target.value;
    setProductSearch(val);
    if (val.length > 1) {
      searchFetcher.load(`/app/boxes/${box.id}?q=${encodeURIComponent(val)}`);
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

  function toggleOption(name) {
    setOptions((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const isSelected = (id) => selectedProducts.some((p) => p.id === id);

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
    <s-page heading={`Edit: ${box.boxName}`}>
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
                <input type="text" name="boxName" defaultValue={box.boxName} style={{ ...fieldStyle, borderColor: errors.boxName ? "#e11d48" : "#c9c6be" }} />
                {errors.boxName && <div style={errorStyle}>{errors.boxName}</div>}
              </div>
              <div>
                <label style={labelStyle}>Display Title (Storefront) *</label>
                <input type="text" name="displayTitle" defaultValue={box.displayTitle} style={{ ...fieldStyle, borderColor: errors.displayTitle ? "#e11d48" : "#c9c6be" }} />
                {errors.displayTitle && <div style={errorStyle}>{errors.displayTitle}</div>}
              </div>
              <div>
                <label style={labelStyle}>Number of Items *</label>
                <input type="number" name="itemCount" defaultValue={box.itemCount} min="1" max="20" style={{ ...fieldStyle, borderColor: errors.itemCount ? "#e11d48" : "#c9c6be" }} />
                {errors.itemCount && <div style={errorStyle}>{errors.itemCount}</div>}
              </div>
              <div>
                <label style={labelStyle}>Bundle Price (₹) *</label>
                <input type="number" name="bundlePrice" defaultValue={box.bundlePrice} step="0.01" min="0" style={{ ...fieldStyle, borderColor: errors.bundlePrice ? "#e11d48" : "#c9c6be" }} />
                {errors.bundlePrice && <div style={errorStyle}>{errors.bundlePrice}</div>}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Banner Image URL (optional)</label>
                <input type="url" name="bannerImageUrl" defaultValue={box.bannerImageUrl || ""} placeholder="https://..." style={fieldStyle} />
              </div>
            </div>
          </div>

          {/* Options */}
          <div style={{ marginBottom: "28px" }}>
            <div style={sectionHeadingStyle}>Options</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              {[
                { key: "isGiftBox", label: "Gift Box Mode", desc: "Enables gift packaging option" },
                { key: "allowDuplicates", label: "Allow Duplicate Products", desc: "Same product in multiple slots" },
                { key: "giftMessageEnabled", label: "Gift Message Field", desc: "Show text area for gift message" },
                { key: "isActive", label: "Active (visible on storefront)", desc: "Uncheck to hide from customers" },
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
              <span style={{ marginLeft: "8px", background: "#2A7A4F", color: "#fff", borderRadius: "20px", padding: "2px 8px", fontSize: "10px", fontWeight: "600", fontFamily: "monospace" }}>
                {selectedProducts.length} selected
              </span>
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
                <div style={{ fontSize: "11px", fontWeight: "600", color: "#15803d", marginBottom: "6px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.5px" }}>Selected</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {selectedProducts.map((p) => (
                    <span key={p.id} onClick={() => toggleProduct(p)} style={{ background: "#2A7A4F", color: "#fff", borderRadius: "20px", padding: "3px 10px", fontSize: "11px", cursor: "pointer" }}>
                      {p.productTitle} ✕
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ maxHeight: "280px", overflowY: "auto", border: "1px solid #e5e1d8", borderRadius: "6px" }}>
              {displayProducts.map((product) => (
                <label key={product.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderBottom: "1px solid #f0ede4", cursor: "pointer", background: isSelected(product.id) ? "#f0fdf4" : "#fff" }}>
                  <input type="checkbox" checked={isSelected(product.id)} onChange={() => toggleProduct(product)} style={{ width: "14px", height: "14px", flexShrink: 0, accentColor: "#2A7A4F" }} />
                  {product.imageUrl && <img src={product.imageUrl} alt={product.title} style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }} />}
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600", color: "#1a1814" }}>{product.title}</div>
                    <div style={{ fontSize: "11px", color: "#7a7670", fontFamily: "monospace" }}>{product.handle}</div>
                  </div>
                </label>
              ))}
              {displayProducts.length === 0 && (
                <div style={{ padding: "24px", textAlign: "center", color: "#7a7670", fontSize: "13px" }}>No products found</div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "space-between", paddingTop: "16px", borderTop: "1px solid #e5e1d8" }}>
            <button
              type="submit"
              name="_action"
              value="delete"
              onClick={(e) => { if (!window.confirm(`Delete "${box.boxName}"? This cannot be undone.`)) e.preventDefault(); }}
              style={{ background: "transparent", border: "1px solid #fca5a5", borderRadius: "6px", padding: "10px 20px", fontSize: "13px", cursor: "pointer", color: "#e11d48" }}
            >
              Delete Box
            </button>
            <div style={{ display: "flex", gap: "12px" }}>
              <button type="button" onClick={() => navigate("/app/boxes")} style={{ background: "transparent", border: "1px solid #c9c6be", borderRadius: "6px", padding: "10px 20px", fontSize: "13px", cursor: "pointer", color: "#374151" }}>
                Cancel
              </button>
              <button
                type="submit"
                name="_action"
                value="save"
                disabled={isSaving}
                style={{ background: isSaving ? "#9ca3af" : "#2A7A4F", border: "none", borderRadius: "6px", padding: "10px 24px", fontSize: "13px", cursor: isSaving ? "not-allowed" : "pointer", color: "#fff", fontWeight: "600" }}
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
