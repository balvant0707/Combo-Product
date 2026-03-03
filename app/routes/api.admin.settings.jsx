import { authenticate } from "../shopify.server";
import { getSettings, upsertSettings } from "../models/settings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return Response.json(settings);
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);
  const body = await request.json();
  const settings = await upsertSettings(session.shop, body);
  return Response.json(settings);
};
