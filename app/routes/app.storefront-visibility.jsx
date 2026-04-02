import { redirect as rrRedirect } from "react-router";
import { withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  return rrRedirect(withEmbeddedAppParamsFromRequest("/app/boxes", request));
};

export default function StorefrontVisibilityPageRedirect() {
  return null;
}
