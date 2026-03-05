import db from "../db.server";

const DEFAULTS = {
  widgetHeadingText: "Pick your favorite products and build your own box!",
  ctaButtonLabel: "BUILD YOUR OWN BOX",
  addToCartLabel: "UPDATE BOX",
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
};

export async function getSettings(shop) {
  const settings = await db.appSettings.findUnique({ where: { shop } });
  if (!settings) return { ...DEFAULTS, shop };
  return settings;
}

export async function upsertSettings(shop, data) {
  const payload = {
    widgetHeadingText: data.widgetHeadingText ?? DEFAULTS.widgetHeadingText,
    ctaButtonLabel: data.ctaButtonLabel ?? DEFAULTS.ctaButtonLabel,
    addToCartLabel: data.addToCartLabel ?? DEFAULTS.addToCartLabel,
    buttonColor: data.buttonColor ?? DEFAULTS.buttonColor,
    activeSlotColor: data.activeSlotColor ?? DEFAULTS.activeSlotColor,
    showSavingsBadge: parseBool(data.showSavingsBadge, DEFAULTS.showSavingsBadge),
    allowDuplicates: parseBool(data.allowDuplicates, DEFAULTS.allowDuplicates),
    showProductPrices: parseBool(data.showProductPrices, DEFAULTS.showProductPrices),
    forceShowOos: parseBool(data.forceShowOos, DEFAULTS.forceShowOos),
    giftMessageField: parseBool(data.giftMessageField, DEFAULTS.giftMessageField),
    analyticsTracking: parseBool(data.analyticsTracking, DEFAULTS.analyticsTracking),
    emailNotifications: parseBool(data.emailNotifications, DEFAULTS.emailNotifications),
    presetTheme: data.presetTheme ?? DEFAULTS.presetTheme,
    widgetMaxWidth: data.widgetMaxWidth != null ? parseInt(data.widgetMaxWidth) || DEFAULTS.widgetMaxWidth : DEFAULTS.widgetMaxWidth,
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
