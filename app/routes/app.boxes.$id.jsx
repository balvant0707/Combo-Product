import { useState } from "react";
import { useLoaderData, useNavigate, Form, useActionData } from "react-router";
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
    box: {
      ...box,
      bundlePrice: parseFloat(box.bundlePrice),
      products: box.products,
    },
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
    isGiftBox: formData.get("isGiftBox") === "on",
    allowDuplicates: formData.get("allowDuplicates") === "on",
    bannerImageUrl: formData.get("bannerImageUrl") || null,
    isActive: formData.get("isActive") === "on",
    giftMessageEnabled: formData.get("giftMessageEnabled") === "on",
    eligibleProducts,
  };

  const errors = {};
  if (!data.boxName?.trim()) errors.boxName = "Box name is required";
  if (!data.displayTitle?.trim()) errors.displayTitle = "Display title is required";
  if (!data.itemCount || parseInt(data.itemCount) < 1) errors.itemCount = "Invalid item count";
  if (!data.bundlePrice || parseFloat(data.bundlePrice) <= 0) errors.bundlePrice = "Invalid price";
  if (eligibleProducts.length === 0) errors.eligibleProducts = "Select at least one product";

  if (Object.keys(errors).length > 0) return { errors };

  await updateBox(params.id, shop, data, admin);
  throw redirect("/app/boxes");
};

export default function EditBoxPage() {
  const { box, products } = useLoaderData();
  const actionData = useActionData();
  const navigate = useNavigate();
  const errors = actionData?.errors || {};

  const initialSelected = (box.products || []).map((p) => ({
    id: p.productId,
    productId: p.productId,
    productTitle: p.productTitle,
    productImageUrl: p.productImageUrl,
    productHandle: p.productHandle,
  }));
  const [selectedProducts, setSelectedProducts] = useState(initialSelected);
  const [productSearch, setProductSearch] = useState("");

  const displayProducts = products.filter((p) =>
    p.title.toLowerCase().includes(productSearch.toLowerCase()),
  );

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
    <s-page heading={`Edit: ${box.boxName}`}>
      <s-button
        slot="primary-action"
        variant="tertiary"
        onClick={() => navigate("/app/boxes")}
      >
        Cancel
      </s-button>

      <s-section>
        <Form method="POST">
          <input type="hidden" name="eligibleProducts" value={JSON.stringify(selectedProducts)} />

          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid #e5e1d8", color: "#6b7280" }}>
              Basic Information
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <s-text-field
                  label="Box Internal Name"
                  name="boxName"
                  value={box.boxName}
                  error={errors.boxName}
                />
              </div>
              <div>
                <s-text-field
                  label="Display Title (Storefront)"
                  name="displayTitle"
                  value={box.displayTitle}
                  error={errors.displayTitle}
                />
              </div>
              <div>
                <s-text-field
                  label="Number of Items"
                  name="itemCount"
                  type="number"
                  value={String(box.itemCount)}
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
                  value={String(box.bundlePrice)}
                  step="0.01"
                  error={errors.bundlePrice}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <s-text-field
                  label="Banner Image URL (optional)"
                  name="bannerImageUrl"
                  value={box.bannerImageUrl || ""}
                  placeholder="https://..."
                />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid #e5e1d8", color: "#6b7280" }}>
              Options
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="isGiftBox" defaultChecked={box.isGiftBox} style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Gift Box Mode</div>
                  <div style={{ fontSize: "12px", color: "#7a7670" }}>Shows size selector Step 1</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="allowDuplicates" defaultChecked={box.allowDuplicates} style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Allow Duplicate Products</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="giftMessageEnabled" defaultChecked={box.giftMessageEnabled} style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Gift Message Field</div>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
                <input type="checkbox" name="isActive" defaultChecked={box.isActive} style={{ width: "16px", height: "16px" }} />
                <div>
                  <div style={{ fontWeight: "600", fontSize: "13px" }}>Active (visible on storefront)</div>
                </div>
              </label>
            </div>
          </div>

          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "14px", fontWeight: "700", marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px solid #e5e1d8", color: "#6b7280" }}>
              Eligible Products
              <span style={{ marginLeft: "8px", background: "#059669", color: "#fff", borderRadius: "20px", padding: "2px 8px", fontSize: "11px" }}>
                {selectedProducts.length} selected
              </span>
            </div>
            {errors.eligibleProducts && (
              <div style={{ color: "#e11d48", fontSize: "12px", marginBottom: "8px" }}>{errors.eligibleProducts}</div>
            )}
            <input
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #e5e1d8", borderRadius: "6px", fontSize: "13px", marginBottom: "12px", boxSizing: "border-box" }}
            />
            <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #e5e1d8", borderRadius: "6px" }}>
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
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected(product.id)}
                    onChange={() => toggleProduct(product)}
                    style={{ width: "14px", height: "14px", flexShrink: 0 }}
                  />
                  {product.imageUrl && (
                    <img src={product.imageUrl} alt={product.title} style={{ width: "36px", height: "36px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }} />
                  )}
                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "600" }}>{product.title}</div>
                    <div style={{ fontSize: "11px", color: "#7a7670" }}>{product.handle}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "space-between" }}>
            <button
              type="submit"
              name="_action"
              value="delete"
              onClick={(e) => {
                if (!window.confirm(`Delete "${box.boxName}"?`)) e.preventDefault();
              }}
              style={{
                background: "transparent",
                border: "1px solid #fca5a5",
                borderRadius: "6px",
                padding: "10px 20px",
                fontSize: "13px",
                cursor: "pointer",
                color: "#e11d48",
              }}
            >
              Delete Box
            </button>
            <div style={{ display: "flex", gap: "12px" }}>
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
                name="_action"
                value="save"
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
                Save Changes
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
