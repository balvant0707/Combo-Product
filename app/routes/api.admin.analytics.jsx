import { authenticate } from "../shopify.server";
import { getAnalytics } from "../models/orders.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const analytics = await getAnalytics(session.shop, from, to);
  return Response.json(analytics);
};
