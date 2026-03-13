import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "../models/shop.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  await upsertSessionFromAuth(session);
  await upsertShopFromAdmin(session, admin);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const location = useLocation();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {/* <s-link href="/app">Dashboard</s-link> */}
        <s-link href={withEmbeddedAppParams("/app/boxes", location.search)}>Manage Boxes</s-link>
        <s-link href={withEmbeddedAppParams("/app/analytics", location.search)}>Analytics</s-link>
        <s-link href={withEmbeddedAppParams("/app/settings", location.search)}>Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
