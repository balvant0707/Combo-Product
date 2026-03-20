import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listBoxes, toggleBoxStatus } from "../models/boxes.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const boxes = await listBoxes(session.shop, false, false);
  return {
    boxes: boxes.map((b) => ({
      id: b.id,
      boxName: b.boxName,
      displayTitle: b.displayTitle,
      isActive: b.isActive,
      comboType: b.config?.comboType ?? null,
    })),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const id = formData.get("id");
  const isActive = formData.get("isActive") === "true";
  await toggleBoxStatus(id, session.shop, isActive);
  return { ok: true };
};

export const headers = (h) => boundary.headers(h);

export default function StorefrontVisibilityPage() {
  const { boxes } = useLoaderData();
  const fetcher = useFetcher();

  const pendingId = fetcher.formData ? parseInt(fetcher.formData.get("id")) : null;
  const pendingState = pendingId !== null ? fetcher.formData.get("isActive") === "true" : null;

  function toggle(id, currentActive) {
    fetcher.submit(
      { id: String(id), isActive: String(!currentActive) },
      { method: "POST" }
    );
  }

  const activeCount = boxes.filter((b) => {
    if (b.id === pendingId) return pendingState;
    return b.isActive;
  }).length;

  return (
    <div style={{ padding: "24px", maxWidth: "720px", margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#111827", margin: "0 0 6px" }}>
          Frontend Visibility
        </h1>
        <p style={{ fontSize: "13px", color: "#6a7280", margin: 0 }}>
          Control which combo boxes appear on your storefront.
          <strong style={{ color: "#000000" }}> {activeCount} of {boxes.length}</strong> boxes visible.
        </p>
      </div>

      {/* Box list */}
      <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e5e7ea", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        {boxes.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>
            No combo boxes found. Create a box first.
          </div>
        ) : (
          boxes.map((box, idx) => {
            const active = box.id === pendingId ? pendingState : box.isActive;
            const comboLabel = box.comboType > 0
              ? box.comboType + " Step"
              : "Single";

            return (
              <div
                key={box.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 20px",
                  borderBottom: idx < boxes.length - 1 ? "1px solid #f3f4f6" : "none",
                  background: active ? "#fff" : "#fafafa",
                  transition: "background 0.15s",
                }}
              >
                {/* Left: name + badge */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                  {/* Status dot */}
                  <span style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: active ? "#000000" : "#d1d5da",
                    flexShrink: 0,
                    transition: "background 0.2s",
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontWeight: "700",
                      fontSize: "14px",
                      color: active ? "#111827" : "#9ca3af",
                      transition: "color 0.15s",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {box.boxName}
                    </div>
                    {box.displayTitle !== box.boxName && (
                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                        {box.displayTitle}
                      </div>
                    )}
                  </div>
                  {/* Combo type badge */}
                  <span style={{
                    display: "inline-block",
                    fontSize: "10px",
                    fontWeight: "700",
                    padding: "2px 8px",
                    borderRadius: "5px",
                    background: "#ffffff",
                    color: "#000000",
                    border: "1px solid #d1d5db",
                    flexShrink: 0,
                  }}>
                    {comboLabel}
                  </span>
                </div>

                {/* Right: toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                  <span style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    color: active ? "#000000" : "#9ca3af",
                    transition: "color 0.15s",
                    minWidth: "46px",
                    textAlign: "right",
                  }}>
                    {active ? "Visible" : "Hidden"}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(box.id, active)}
                    title={active ? "Hide from storefront" : "Show on storefront"}
                    style={{
                      position: "relative",
                      display: "inline-flex",
                      alignItems: "center",
                      width: "44px",
                      height: "24px",
                      borderRadius: "999px",
                      background: active ? "#000000" : "#d1d5da",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                      transition: "background 0.2s",
                      boxShadow: active ? "0 0 0 3px rgba(0,0,0,0.15)" : "none",
                    }}
                  >
                    <span style={{
                      position: "absolute",
                      width: "18px",
                      height: "18px",
                      borderRadius: "50%",
                      background: "#fff",
                      left: active ? "23px" : "3px",
                      transition: "left 0.2s",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
                    }} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer note */}
      <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "14px", textAlign: "center" }}>
        Changes apply instantly to your storefront — no page refresh needed.
      </p>
    </div>
  );
}
