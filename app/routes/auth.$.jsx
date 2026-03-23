import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "../models/shop.server";
import { sendMail } from "../utils/mailer.server";
import { installedEmailHtml } from "../emails/app-installed";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  await upsertSessionFromAuth(session);
  const shopInfo = await upsertShopFromAdmin(session, admin);

  if (shopInfo.isNewInstall && shopInfo.email) {
    sendMail(
      shopInfo.email,
      "Welcome to Combo Product Builder 🎁",
      installedEmailHtml({
        ownerName: shopInfo.ownerName,
        shopName: shopInfo.shopName,
        shopDomain: shopInfo.shopDomain,
      }),
    ).catch((err) => console.error("[auth] install email failed", err));
  }

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
