import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  const { billing, session, redirect } = await authenticate.admin(request);
  const shop = session.shop;

  const { syncSubscription } = await import("../models/billing.server.js");
  const { setShopPlanStatus } = await import("../models/shop.server.js");

  const { subscription } = await syncSubscription(billing, shop).catch(() => ({ subscription: null }));

  if (subscription?.subscriptionId || process.env.SKIP_BILLING === "true") {
    await setShopPlanStatus(shop, "active").catch(() => {});
  }

  throw redirect(withEmbeddedAppParamsFromRequest("/app?subscribed=1", request));
};

export default function BillingSuccessPage() {
  return (
    <s-page heading="Finalizing billing" inlineSize="medium">
      <div style={{ maxWidth: "520px", margin: "40px auto", padding: "24px", textAlign: "center", background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <div style={{ fontSize: "16px", fontWeight: "700", color: "#111827", marginBottom: "8px" }}>
          Finalizing your subscription
        </div>
        <div style={{ fontSize: "13px", color: "#000000", marginBottom: "18px" }}>
          Redirecting you to the dashboard.
        </div>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

