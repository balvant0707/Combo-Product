import { useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export default function CreateComboInfoPage() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <s-section>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" }}>
        <div style={{ fontSize: "56px", marginBottom: "20px" }}>🎯</div>

        <div style={{ fontSize: "20px", fontWeight: "800", color: "#111827", marginBottom: "10px", letterSpacing: "-0.3px" }}>
          Save Box Settings First
        </div>

        <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "8px", maxWidth: "440px", lineHeight: "1.6" }}>
          To configure the Specific Combo Box, you need to <strong>first save the Box Settings</strong> to create the box.
        </div>
        <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "32px", maxWidth: "420px", lineHeight: "1.6" }}>
          After saving, you'll be taken directly to the Specific Combo Box configuration for the new box.
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "36px", width: "100%", maxWidth: "380px" }}>
          {[
            { step: 1, label: "Fill in Box Settings", desc: "Name, price, products, options", active: false },
            { step: 2, label: "Click Save & Continue", desc: "Box is created in your store", active: false },
            { step: 3, label: "Configure Combo Steps", desc: "Collections, products, step labels", active: true },
          ].map((item) => (
            <div key={item.step} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "12px 16px", background: item.active ? "#f0fdf4" : "#f9fafb", border: item.active ? "1.5px solid #2A7A4F" : "1.5px solid #e5e7eb", borderRadius: "8px" }}>
              <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: item.active ? "#2A7A4F" : "#e5e7eb", color: item.active ? "#fff" : "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "700", flexShrink: 0 }}>
                {item.step}
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: "13px", fontWeight: "700", color: item.active ? "#166534" : "#374151" }}>{item.label}</div>
                <div style={{ fontSize: "11px", color: item.active ? "#4ade80" : "#9ca3af", marginTop: "1px" }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => navigate(withEmbeddedAppParams("/app/boxes/new", location.search))}
          style={{ background: "#2A7A4F", color: "#fff", border: "none", borderRadius: "6px", padding: "12px 32px", fontSize: "14px", fontWeight: "700", cursor: "pointer", boxShadow: "0 2px 8px rgba(42,122,79,0.35)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#1f5c3a")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#2A7A4F")}
        >
          Go to Box Settings
        </button>
      </div>
    </s-section>
  );
}

export const ErrorBoundary = boundary.error;
