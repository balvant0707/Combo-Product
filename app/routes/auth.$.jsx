import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "../models/shop.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  await upsertSessionFromAuth(session);
  await upsertShopFromAdmin(session, admin);

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
