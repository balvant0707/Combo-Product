import { authenticate } from "../shopify.server";
import { getAnalytics } from "../models/orders.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const comboTypeParam = String(url.searchParams.get("comboType") || "all").toLowerCase();
  const comboType = comboTypeParam === "simple" || comboTypeParam === "specific" ? comboTypeParam : "all";
  const analytics = await getAnalytics(session.shop, from, to, { comboTypeFilter: comboType });
  return Response.json(analytics);
};
