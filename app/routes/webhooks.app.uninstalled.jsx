import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled } from "../models/shop.server";
import { sendMail } from "../utils/mailer.server";
import { uninstalledEmailHtml } from "../emails/app-uninstalled";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Fetch shop details before marking as uninstalled so we have the email
  const shopRecord = await db.shop.findUnique({
    where: { shop },
    select: { email: true, contactEmail: true, ownerName: true, name: true },
  });

  await markShopUninstalled(shop);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // Deleting by shop keeps this idempotent even when webhook retries happen.
  await db.session.deleteMany({ where: { shop } });

  const recipientEmail = shopRecord?.contactEmail || shopRecord?.email;
  if (recipientEmail) {
    sendMail(
      recipientEmail,
      "We're sad to see you go 😢 — Combo Product Builder",
      uninstalledEmailHtml({
        ownerName: shopRecord?.ownerName,
        shopName: shopRecord?.name,
        shopDomain: shop,
      }),
    ).catch((err) => console.error("[uninstall webhook] email failed", err));
  }

  return new Response();
};
