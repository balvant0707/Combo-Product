import { Outlet } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBox } from "../models/boxes.server";

export const loader = async ({ request, params }) => {
  const { session, redirect } = await authenticate.admin(request);
  const box = await getBox(params.id, session.shop);
  if (!box) throw redirect("/app/boxes");
  return {};
};

export default function EditBoxLayout() {
  return <Outlet />;
}

export const ErrorBoundary = boundary.error;
