import db from "../db.server";

const DEFAULTS = {
  widgetHeadingText: "Pick your favorite products and build your own box!",
  ctaButtonLabel: "BUILD YOUR OWN BOX",
  addToCartLabel: "Add To Cart",
  buttonColor: "#2A7A4F",
  activeSlotColor: "#2A7A4F",
  showSavingsBadge: false,
  allowDuplicates: false,
  showProductPrices: false,
  forceShowOos: false,
  giftMessageField: false,
  analyticsTracking: true,
  emailNotifications: false,
  presetTheme: "custom",
  widgetMaxWidth: 1140,
  productCardsPerRow: 4,
};

export async function getSettings(shop) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  if (!settings) return { ...DEFAULTS, shop };
  return {
    ...DEFAULTS,
    ...settings,
    widgetMaxWidth: parseWidgetMaxWidth(settings.widgetMaxWidth),
    productCardsPerRow: parseProductCardsPerRow(settings.productCardsPerRow),
  };
}

export async function upsertSettings(shop, data) {
  const existing = await db.appSettings.findUnique({ where: { shop } });

  const payload = {
    widgetHeadingText: data.widgetHeadingText ?? DEFAULTS.widgetHeadingText,
    ctaButtonLabel: data.ctaButtonLabel ?? DEFAULTS.ctaButtonLabel,
    addToCartLabel: data.addToCartLabel ?? DEFAULTS.addToCartLabel,
    buttonColor: data.buttonColor ?? DEFAULTS.buttonColor,
    activeSlotColor: data.activeSlotColor ?? DEFAULTS.activeSlotColor,
    // Checkboxes: absent field = unchecked = false (never fall back to default)
    showSavingsBadge: parseBool(data.showSavingsBadge, false),
    allowDuplicates: parseBool(data.allowDuplicates, false),
    showProductPrices: parseBool(data.showProductPrices, false),
    forceShowOos: parseBool(data.forceShowOos, false),
    giftMessageField: parseBool(data.giftMessageField, false),
    analyticsTracking:
      data.analyticsTracking === undefined || data.analyticsTracking === null
        ? (existing?.analyticsTracking ?? DEFAULTS.analyticsTracking)
        : parseBool(data.analyticsTracking, false),
    emailNotifications:
      data.emailNotifications === undefined || data.emailNotifications === null
        ? (existing?.emailNotifications ?? DEFAULTS.emailNotifications)
        : parseBool(data.emailNotifications, false),
    presetTheme: data.presetTheme ?? DEFAULTS.presetTheme,
    widgetMaxWidth: parseWidgetMaxWidth(data.widgetMaxWidth),
    productCardsPerRow: parseProductCardsPerRow(data.productCardsPerRow),
  };

  return db.appSettings.upsert({
    where: { shop },
    create: { shop, ...payload },
    update: payload,
  });
}

function parseBool(val, fallback) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === "boolean") return val;
  return val === "true" || val === "on" || val === "1";
}

function parseWidgetMaxWidth(value) {
  if (value === undefined || value === null || value === "") return DEFAULTS.widgetMaxWidth;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULTS.widgetMaxWidth;
  return parsed;
}

function parseProductCardsPerRow(value) {
  const parsed = Number.parseInt(String(value), 10);
  return [3, 4, 5, 6].includes(parsed) ? parsed : DEFAULTS.productCardsPerRow;
}
