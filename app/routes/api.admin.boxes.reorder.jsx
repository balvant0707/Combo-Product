import { authenticate } from "../shopify.server";
import { reorderBoxes } from "../models/boxes.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);
  const { orderedIds } = await request.json();
  if (!Array.isArray(orderedIds)) {
    return Response.json({ error: "orderedIds must be an array" }, { status: 400 });
  }
  await reorderBoxes(session.shop, orderedIds);
  return Response.json({ success: true });
};
