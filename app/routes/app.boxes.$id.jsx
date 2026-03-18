import { Outlet, useLoaderData, useLocation, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBox } from "../models/boxes.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

export const loader = async ({ request, params }) => {
  const { session, redirect } = await authenticate.admin(request);
  const box = await getBox(params.id, session.shop);
  if (!box) throw redirect("/app/boxes");
  return { boxId: String(params.id), boxName: box.boxName };
};

export default function EditBoxLayout() {
  const { boxId, boxName } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const isCombo = location.pathname.endsWith("/combo");

  return (
    <s-page
      heading={`Edit: ${boxName}`}
      back-url={withEmbeddedAppParams("/app/boxes", location.search)}
    >
      {/* Hero banner */}
      <div style={{ marginBottom: "20px", borderRadius: "5px", background: "linear-gradient(135deg, #091fd6 0%, #c11a10 55%, #706cd3 100%)", boxShadow: "0 8px 32px rgba(9,31,214,0.22)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "180px", height: "180px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", pointerEvents: "none" }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#d1fae5", marginBottom: "10px" }}>✏️ Edit Box</div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: "#fff", letterSpacing: "-0.5px" }}>Edit Combo Box</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.65)", marginTop: "4px" }}>Update settings, pricing, and eligible products for this bundle.</div>
      </div>

      {/* Tab Nav */}
      <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", marginBottom: "20px" }}>
        {[
          { label: "📋 Box Settings",       path: withEmbeddedAppParams(`/app/boxes/${boxId}`, location.search),         active: !isCombo },
          { label: "🎯 Specific Combo Box", path: withEmbeddedAppParams(`/app/boxes/${boxId}/combo`, location.search),   active: isCombo  },
        ].map((tab) => (
          <button
            key={tab.label}
            onClick={() => navigate(tab.path)}
            style={{
              padding: "10px 20px", fontSize: "13px", fontWeight: "700", cursor: "pointer",
              border: "none", background: "none",
              borderBottom: tab.active ? "2px solid #091fd6" : "2px solid transparent",
              marginBottom: "-2px", color: tab.active ? "#091fd6" : "#6b7280",
              transition: "color 0.15s, border-color 0.15s", letterSpacing: "0.01em",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Outlet />
    </s-page>
  );
}

export const ErrorBoundary = boundary.error;
