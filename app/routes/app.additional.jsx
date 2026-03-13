import { redirect } from "react-router";
import { withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";

export const loader = ({ request }) =>
  redirect(withEmbeddedAppParamsFromRequest("/app", request));
