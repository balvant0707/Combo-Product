import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";
import { BlockStack, Box, Page, Spinner, Text } from "@shopify/polaris";

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
    <Page title="Finalizing billing">
      <Box paddingBlockStart="1600">
        <BlockStack gap="400" align="center" inlineAlign="center">
          <Spinner accessibilityLabel="Finalizing subscription" size="large" />
          <Text as="p" variant="headingMd" alignment="center">
            Finalizing your subscription
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            Redirecting you to the dashboard…
          </Text>
        </BlockStack>
      </Box>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

