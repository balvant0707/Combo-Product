import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  // authenticate.admin handles OAuth and fires the afterAuth hook in shopify.server.js
  // which upserts session/shop and sends install emails.
  await authenticate.admin(request);
  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
