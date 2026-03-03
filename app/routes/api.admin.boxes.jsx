import { authenticate } from "../shopify.server";
import { listBoxes, createBox } from "../models/boxes.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const boxes = await listBoxes(session.shop);
  return Response.json(boxes);
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { session, admin } = await authenticate.admin(request);
  const body = await request.json();
  const box = await createBox(session.shop, body, admin);
  return Response.json(box, { status: 201 });
};
