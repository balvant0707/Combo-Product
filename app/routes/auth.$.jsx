import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "../models/shop.server";
import { sendMail } from "../utils/mailer.server";
import { installedEmailHtml } from "../emails/app-installed";
import { ownerInstallNotifyHtml } from "../emails/owner-notify";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  await upsertSessionFromAuth(session);
  const shopInfo = await upsertShopFromAdmin(session, admin);

  if (shopInfo.isNewInstall) {
    const emailData = {
      ownerName:  shopInfo.ownerName,
      shopName:   shopInfo.shopName,
      shopDomain: shopInfo.shopDomain,
      email:      shopInfo.email,
      plan:       shopInfo.plan,
      country:    shopInfo.country,
    };

    // Email to merchant
    if (shopInfo.email) {
      sendMail(
        shopInfo.email,
        "Welcome to MixBox – Box & Bundle Builder 🎁",
        installedEmailHtml(emailData),
      ).catch((err) => console.error("[auth] merchant install email failed", err));
    }

    // Email to app owner
    const ownerEmail = process.env.APP_OWNER_EMAIL;
    if (ownerEmail) {
      sendMail(
        ownerEmail,
        `🎉 New Install: ${shopInfo.shopName || shopInfo.shopDomain}`,
        ownerInstallNotifyHtml(emailData),
      ).catch((err) => console.error("[auth] owner install notification failed", err));
    }
  }

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
