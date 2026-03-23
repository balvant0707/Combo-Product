import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { upsertSessionFromAuth, upsertShopFromAdmin } from "../models/shop.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { sendMail } from "../utils/mailer.server";
import { installedEmailHtml } from "../emails/app-installed";
import { ownerInstallNotifyHtml } from "../emails/owner-notify";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  await upsertSessionFromAuth(session);
  const installInfo = await upsertShopFromAdmin(session, admin);

  // Send install emails only on first install or reinstall
  if (installInfo?.isNewInstall) {
    const emailData = {
      ownerName:  installInfo.ownerName,
      shopName:   installInfo.shopName,
      shopDomain: installInfo.shopDomain,
      email:      installInfo.email,
      plan:       installInfo.plan,
      country:    installInfo.country,
    };

    const mailJobs = [];

    if (emailData.email) {
      mailJobs.push(
        sendMail(
          emailData.email,
          `Welcome to MixBox – Box & Bundle Builder! 🎉`,
          installedEmailHtml(emailData),
        ).catch((err) => console.error("[install] merchant welcome email failed", err)),
      );
    }

    const ownerEmail = process.env.APP_OWNER_EMAIL;
    if (ownerEmail) {
      mailJobs.push(
        sendMail(
          ownerEmail,
          `🎉 New App Install: ${installInfo.shopName || installInfo.shopDomain}`,
          ownerInstallNotifyHtml(emailData),
        ).catch((err) => console.error("[install] owner notification failed", err)),
      );
    }

    // Do not await — install emails must not block the page load / redirect
    Promise.all(mailJobs);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();
  const location = useLocation();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <style>{`
        ui-title-bar button {
          background: #000000;
          color: #ffffff;
          border: 1px solid #000000;
          border-radius: 6px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        ui-title-bar button:hover {
          background: #000000;
          color: #ffffff;
          border-color: #000000;
        }
      `}</style>
      <s-app-nav>
        {/* <s-link href="/app">Dashboard</s-link> */}
        <s-link href={withEmbeddedAppParams("/app/boxes", location.search)}>Box Settings</s-link>
        <s-link href={withEmbeddedAppParams("/app/analytics", location.search)}>Analytics</s-link>
        <s-link href={withEmbeddedAppParams("/app/settings", location.search)}>Settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
