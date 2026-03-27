import db from "../db.server";

/* ─── Plan config ─────────────────────────────────────────────────── */

export const PRO_PLAN_NAME = "Combo Builder Pro";

export const PLAN_CONFIG = {
  price:       9.99,
  currencyCode: "USD",
  interval:    "EVERY_30_DAYS",
  trialDays:   7,
};

/** Max active boxes allowed on the free tier */
export const FREE_BOX_LIMIT = 1;

/* ─── GraphQL ─────────────────────────────────────────────────────── */

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query GetActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        createdAt
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price { amount currencyCode }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation CreateSubscription(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = `#graphql
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

/* ─── Helpers ─────────────────────────────────────────────────────── */

/** Returns the first active subscription from Shopify, or null */
export async function getActiveSubscription(admin) {
  const resp = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const json = await resp.json();
  const subs = json?.data?.currentAppInstallation?.activeSubscriptions || [];
  return subs[0] || null;
}

/** Returns true when the shop has an ACTIVE Pro subscription */
export async function isProPlan(admin) {
  const sub = await getActiveSubscription(admin);
  return !!sub && sub.status === "ACTIVE";
}

/**
 * Creates a recurring Pro subscription.
 * Returns the Shopify confirmation URL the merchant must visit to approve.
 */
export async function createSubscription(admin, returnUrl) {
  const isTest = process.env.NODE_ENV !== "production";
  const resp = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
    variables: {
      name: PRO_PLAN_NAME,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: PLAN_CONFIG.price, currencyCode: PLAN_CONFIG.currencyCode },
              interval: PLAN_CONFIG.interval,
            },
          },
        },
      ],
      returnUrl,
      trialDays: PLAN_CONFIG.trialDays,
      test: isTest,
    },
  });
  const json = await resp.json();
  const result = json?.data?.appSubscriptionCreate;
  if (result?.userErrors?.length) throw new Error(result.userErrors[0].message);
  return result?.confirmationUrl;
}

/** Cancels an active subscription by GID */
export async function cancelSubscription(admin, subscriptionId) {
  const resp = await admin.graphql(CANCEL_SUBSCRIPTION_MUTATION, {
    variables: { id: subscriptionId },
  });
  const json = await resp.json();
  const result = json?.data?.appSubscriptionCancel;
  if (result?.userErrors?.length) throw new Error(result.userErrors[0].message);
  return result?.appSubscription;
}

/** Count of non-deleted boxes for the shop */
export async function getBoxCount(shop) {
  return db.comboBox.count({ where: { shop, deletedAt: null } });
}

/**
 * Checks whether the shop can create one more box.
 * Returns { allowed, isPro, currentCount }
 */
export async function canCreateBox(admin, shop) {
  const [pro, count] = await Promise.all([isProPlan(admin), getBoxCount(shop)]);
  if (pro) return { allowed: true, isPro: true, currentCount: count };
  if (count < FREE_BOX_LIMIT) return { allowed: true, isPro: false, currentCount: count };
  return { allowed: false, isPro: false, currentCount: count };
}
