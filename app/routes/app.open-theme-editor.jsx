import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  const destination = new URL("shopify://admin/themes/current/editor");
  destination.searchParams.set("template", "index");

  return redirect(destination.toString(), { target: "_self" });
};

export default function OpenThemeEditorRoute() {
  return null;
}
