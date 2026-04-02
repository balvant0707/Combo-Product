import { useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
import { getSettings, upsertSettings } from "../models/settings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    widgetHeadingText: formData.get("widgetHeadingText"),
    ctaButtonLabel: formData.get("ctaButtonLabel"),
    addToCartLabel: formData.get("addToCartLabel"),
    buttonColor: formData.get("buttonColor"),
    activeSlotColor: formData.get("activeSlotColor"),
    showSavingsBadge: formData.get("showSavingsBadge"),
    allowDuplicates: formData.get("allowDuplicates"),
    showProductPrices: formData.get("showProductPrices"),
    forceShowOos: formData.get("forceShowOos"),
    giftMessageField: formData.get("giftMessageField"),
    analyticsTracking: formData.get("analyticsTracking"),
    emailNotifications: formData.get("emailNotifications"),
    presetTheme: formData.get("presetTheme"),
    widgetMaxWidth: formData.get("widgetMaxWidth"),
    productCardsPerRow: formData.get("productCardsPerRow"),
  };

  await upsertSettings(session.shop, data);
  return { success: true };
};

const THEMES = [
  { id: "custom",            name: "Custom",            primary: "#2A7A4F", bg: "#ffffff", dark: false },
  { id: "oh-so-minimal",     name: "Oh So Minimal",     primary: "#1a1a1a", bg: "#fafafa", dark: false },
  { id: "fresh-gradient",    name: "Fresh Gradient",    primary: "#7c3aed", bg: "#faf5ff", dark: false },
  { id: "aqua",              name: "Aqua",              primary: "#0891b2", bg: "#ecfeff", dark: false },
  { id: "golden-hour",       name: "Golden Hour",       primary: "#d97706", bg: "#fffbeb", dark: false },
  { id: "sharp-edge",        name: "Sharp Edge",        primary: "#000000", bg: "#ffffff", dark: false },
  { id: "poseidon",          name: "Poseidon",          primary: "#38bdf8", bg: "#0c1445", dark: true  },
  { id: "sand-dunes",        name: "Sand Dunes",        primary: "#92400e", bg: "#fef9ee", dark: false },
  { id: "bubblegum",         name: "Bubblegum",         primary: "#db2777", bg: "#fdf2f8", dark: false },
  { id: "cape-town",         name: "Cape Town",         primary: "#dc2626", bg: "#f8fafc", dark: false },
  { id: "blackout",          name: "Blackout",          primary: "#e5e7eb", bg: "#000000", dark: true  },
  { id: "urban-underground", name: "Urban Underground", primary: "#a855f7", bg: "#1e1b4b", dark: true  },
  { id: "cyber-pink",        name: "Cyber Pink",        primary: "#ec4899", bg: "#0f172a", dark: true  },
  { id: "key-lime-pie",      name: "Key Lime Pie",      primary: "#84cc16", bg: "#111827", dark: true  },
  { id: "lemonade",          name: "Lemonade",          primary: "#ca8a04", bg: "#fefce8", dark: false },
  { id: "nile",              name: "Nile",              primary: "#f59e0b", bg: "#0c1a0e", dark: true  },
  { id: "lavender",          name: "Lavender",          primary: "#8b5cf6", bg: "#f5f3ff", dark: false },
  { id: "magma-lake",        name: "Magma Lake",        primary: "#f97316", bg: "#1c0a00", dark: true  },
  { id: "smooth-silk",       name: "Smooth Silk",       primary: "#f43f5e", bg: "#fff1f2", dark: false },
];

const PRODUCT_CARD_ROW_OPTIONS = [3, 4, 5, 6];

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const isPageLoading = navigation.state !== "idle";
  const [buttonColor, setButtonColor] = useState(settings.buttonColor || "#2A7A4F");
  const [activeSlotColor, setActiveSlotColor] = useState(settings.activeSlotColor || "#2A7A4F");
  const [selectedTheme, setSelectedTheme] = useState(settings.presetTheme || "custom");
  const [widgetMaxWidth, setWidgetMaxWidth] = useState(settings.widgetMaxWidth ?? 1140);
  const [productCardsPerRow, setProductCardsPerRow] = useState(settings.productCardsPerRow ?? 4);

  const inputStyle = {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #c9c6be",
    borderRadius: "5px",
    fontSize: "13px",
    color: "#1a1814",
    background: "#fff",
    boxSizing: "border-box",
  };

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        onClick={() => document.getElementById("settings-form").requestSubmit()}
        disabled={isSaving || undefined}
      >
        {isSaving ? "Saving..." : "Save Settings"}
      </s-button>

      {actionData?.success && (
        <div
          style={{
            background: "#d1fae5",
            border: "1px solid #6ee7b7",
            borderRadius: "5px",
            padding: "12px 16px",
            marginBottom: "16px",
            color: "#065f46",
            fontSize: "13px",
          }}
        >
          Settings saved successfully.
        </div>
      )}

      {/* Hero banner */}
      <div style={{ marginBottom: "20px", borderRadius: "20px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(15,23,42,0.08)", overflow: "hidden", position: "relative", padding: "24px 32px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#f3f4f6", borderRadius: "999px", padding: "4px 14px", fontSize: "10px", fontWeight: "800", letterSpacing: "0.10em", textTransform: "uppercase", color: "#000000", marginBottom: "10px" }}>
          <AdminIcon type="settings" size="small" /> Settings
        </div>
        <div style={{ fontSize: "18px", fontWeight: "800", color: "#000000", letterSpacing: "-0.5px" }}>Widget & Theme Configuration</div>
        <div style={{ fontSize: "13px", color: "#4b5563", marginTop: "4px" }}>Customize the appearance and behaviour of the combo builder on your storefront.</div>
      </div>

      <Form id="settings-form" method="post">

        {/* ── All sections wrapper with gap ────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

        {/* ── Theme Customizer + Widget Width side-by-side ─────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", alignItems: "start" }}>

          {/* ── Theme Customizer ─────────────────────────────────────────────── */}
          <s-section heading="Theme Customizer">
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
                Select a preset theme for your storefront widget. The chosen theme overrides block-level color settings.
              </p>

              {/* Hidden input carries the selected value on submit */}
              <input type="hidden" name="presetTheme" value={selectedTheme} />


              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
                  gap: "10px",
                  maxHeight: "380px",
                  overflowY: "auto",
                  paddingRight: "4px",
                }}
              >
                {THEMES.map((theme) => {
                  const isActive = selectedTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setSelectedTheme(theme.id)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "8px",
                        padding: "10px 8px",
                        border: isActive ? "2px solid #000000" : "2px solid #e5e1d8",
                        borderRadius: "5px",
                        background: isActive ? "" : "#fff",
                        cursor: "pointer",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                    >
                      {/* Split-circle swatch */}
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          borderRadius: "50%",
                          overflow: "hidden",
                          border: "2px solid rgba(0,0,0,0.08)",
                          flexShrink: 0,
                          position: "relative",
                        }}
                      >
                        <div style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%", background: theme.primary }} />
                        <div style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%", background: theme.bg }} />
                      </div>

                      <div style={{ textAlign: "center" }}>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: isActive ? "" : "500",
                            color: isActive ? "" : "#1a1814",
                            lineHeight: 1.3,
                            wordBreak: "break-word",
                          }}
                        >
                          {theme.name}
                        </div>
                        <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>
                          {theme.dark ? "Dark" : "Light"}
                        </div>
                      </div>

                      {isActive && (
                        <div
                          style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "50%",
                            background: "#000000",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                            <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom color pickers — only shown when "Custom" theme is active */}
              {selectedTheme === "custom" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", paddingTop: "4px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: "500", color: "#1a1814", marginBottom: "6px" }}>
                      Primary Button Color
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input
                        type="color"
                        name="buttonColor"
                        value={buttonColor}
                        onChange={(e) => setButtonColor(e.target.value)}
                        style={{ width: "40px", height: "36px", border: "1px solid #c9c6be", borderRadius: "5px", cursor: "pointer", padding: "2px" }}
                      />
                      <input
                        type="text"
                        value={buttonColor}
                        onChange={(e) => setButtonColor(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: "500", color: "#1a1814", marginBottom: "6px" }}>
                      Active Slot Color
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <input
                        type="color"
                        name="activeSlotColor"
                        value={activeSlotColor}
                        onChange={(e) => setActiveSlotColor(e.target.value)}
                        style={{ width: "40px", height: "36px", border: "1px solid #c9c6be", borderRadius: "5px", cursor: "pointer", padding: "2px" }}
                      />
                      <input
                        type="text"
                        value={activeSlotColor}
                        onChange={(e) => setActiveSlotColor(e.target.value)}
                        style={{ ...inputStyle, flex: 1}}
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedTheme !== "custom" && (
                <>
                  <input type="hidden" name="buttonColor" value={buttonColor} />
                  <input type="hidden" name="activeSlotColor" value={activeSlotColor} />
                </>
              )}
            </div>
          </s-section>

          {/* ── Widget Width ─────────────────────────────────────────────────── */}
          <s-section heading="Widget Width">
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
                Controls the maximum width of the combo builder widget on the storefront. Choose a preset or enter a custom pixel value.
              </p>

              <input type="hidden" name="widgetMaxWidth" value={widgetMaxWidth} />


              {/* Preset cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "10px" }}>
                {[
                  { value: 0,    label: "Full Width", desc: "100%" },
                  { value: 860,  label: "Narrow",     desc: "860px" },
                  { value: 1140, label: "Default",    desc: "1140px" },
                  { value: 1400, label: "Wide",       desc: "1400px" },
                  { value: 1920, label: "Full HD",    desc: "1920px" },
                ].map((preset) => {
                  const isActive = widgetMaxWidth === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setWidgetMaxWidth(preset.value)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "10px",
                        padding: "12px 8px",
                        border: isActive ? "2px solid #000000" : "2px solid #e5e7eb",
                        borderRadius: "5px",
                        background: isActive ? "" : "#fff",
                        cursor: "pointer",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                    >
                      <div style={{ width: "100%", height: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div
                          style={{
                            height: "8px",
                            borderRadius: "5px",
                            background: isActive ? "#ffffff" : "#d1d5db",
                            width: preset.value === 0 ? "100%" :
                                   preset.value <= 860 ? "45%" :
                                   preset.value <= 1140 ? "62%" :
                                   preset.value <= 1400 ? "80%" : "100%",
                            transition: "background 0.15s",
                          }}
                        />
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "12px", fontWeight: isActive ? "700" : "600", color: isActive ? "#000000" : "#111827" }}>
                          {preset.label}
                        </div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                          {preset.desc}
                        </div>
                      </div>
                      {isActive && (
                        <div style={{ width: "16px", height: "16px", borderRadius: "50%", background: "#000000", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                            <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Custom value input */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ fontSize: "13px", color: "#374151", fontWeight: "500", flexShrink: 0 }}>
                  Custom value:
                </div>
                <div style={{ display: "flex", alignItems: "center", border: "1.5px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
                  <input
                    type="number"
                    min="0"
                    max="3840"
                    step="10"
                    value={widgetMaxWidth === 0 ? "" : widgetMaxWidth}
                    placeholder="e.g. 1200"
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v >= 0) setWidgetMaxWidth(v);
                      else if (e.target.value === "") setWidgetMaxWidth(0);
                    }}
                    style={{
                      padding: "8px 12px",
                      border: "none",
                      outline: "none",
                      fontSize: "13px",
                      color: "#111827",
                      width: "100px",
                      background: "transparent",
                    }}
                  />
                  <span style={{ padding: "8px 12px 8px 0", fontSize: "13px", color: "#9ca3af" }}>
                    {widgetMaxWidth === 0 ? "= 100%" : "px"}
                  </span>
                </div>
                {widgetMaxWidth === 0 && (
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>Full section width</span>
                )}
              </div>
            </div>
          </s-section>

        </div>

        {/* ── Widget Text Labels ───────────────────────────────────────────── */}
        <s-section heading="Product Grid">
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: 0 }}>
              Controls how many product cards appear in each row on desktop storefront layouts.
            </p>

            <input type="hidden" name="productCardsPerRow" value={productCardsPerRow} />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px" }}>
              {PRODUCT_CARD_ROW_OPTIONS.map((count) => {
                const isActive = productCardsPerRow === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setProductCardsPerRow(count)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "10px",
                      padding: "14px 10px",
                      border: isActive ? "2px solid #000000" : "2px solid #e5e7eb",
                      borderRadius: "5px",
                      background: isActive ? "#000000" : "#fff",
                      cursor: "pointer",
                      boxShadow: isActive ? "0 0 0 3px rgba(0,0,0,0.12)" : "none",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${count}, 1fr)`, gap: "3px", width: "100%", maxWidth: "86px" }}>
                      {Array.from({ length: count }).map((_, idx) => (
                        <span
                          key={idx}
                          style={{
                            display: "block",
                            height: "16px",
                            borderRadius: "5px",
                            background: isActive ? "#ffffff" : "#d1d5db",
                            opacity: isActive ? 1 : 0.85,
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "12px", fontWeight: isActive ? "700" : "600", color: isActive ? "#ffffff" : "#111827" }}>
                        {count} per row
                      </div>
                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                        Desktop layout
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </s-section>

        <s-section heading="Widget Settings">
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "500", color: "#1a1814", marginBottom: "6px" }}>
                Widget Heading Text
              </label>
              <input
                type="text"
                name="widgetHeadingText"
                defaultValue={settings.widgetHeadingText || "Pick your favorite products and build your own box!"}
                style={inputStyle}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "500", color: "#1a1814", marginBottom: "6px" }}>
                  CTA Button Label
                </label>
                <input
                  type="text"
                  name="ctaButtonLabel"
                  defaultValue={settings.ctaButtonLabel || "BUILD YOUR OWN BOX"}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "500", color: "#1a1814", marginBottom: "6px" }}>
                  Add to Cart Label
                </label>
                <input
                  type="text"
                  name="addToCartLabel"
                  defaultValue={settings.addToCartLabel || "Add To Cart"}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>
        </s-section>

        {/* ── Display Options ──────────────────────────────────────────────── */}
        <s-section heading="Display Options">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            {[
              { name: "showSavingsBadge", label: "Show Savings Badge", desc: "Display a badge showing how much customers save vs buying individually", defaultChecked: settings.showSavingsBadge },
              { name: "showProductPrices", label: "Show Product Prices", desc: "Show individual product prices in the selection grid", defaultChecked: settings.showProductPrices },
              { name: "allowDuplicates", label: "Allow Duplicate Products", desc: "Let customers pick the same product more than once", defaultChecked: settings.allowDuplicates },
              { name: "forceShowOos", label: "Show Out-of-Stock Products", desc: "Show out-of-stock products (greyed out) in the selection grid", defaultChecked: settings.forceShowOos },
            ].map((toggle) => (
              <label
                key={toggle.name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  padding: "12px",
                  border: "1px solid #e5e1d8",
                  borderRadius: "5px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name={toggle.name}
                  value="true"
                  defaultChecked={toggle.defaultChecked}
                  style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#000000", flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "500", color: "#1a1814" }}>{toggle.label}</div>
                  <div style={{ fontSize: "12px", color: "#7a7670", marginTop: "2px" }}>{toggle.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </s-section>

        {/* ── Advanced Settings ────────────────────────────────────────────── */}
        <s-section heading="Advanced Settings">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
            {[
              { name: "giftMessageField", label: "Enable Gift Message Field", desc: "Show a gift message text field during checkout", defaultChecked: settings.giftMessageField },
              { name: "analyticsTracking", label: "Enable Analytics Tracking", desc: "Track bundle orders for analytics (recommended)", defaultChecked: settings.analyticsTracking },
              { name: "emailNotifications", label: "Email Notifications", desc: "Send email notifications for new bundle orders", defaultChecked: settings.emailNotifications },
            ].map((toggle) => (
              <label
                key={toggle.name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  padding: "12px",
                  border: "1px solid #e5e1d8",
                  borderRadius: "5px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name={toggle.name}
                  value="true"
                  defaultChecked={toggle.defaultChecked}
                  style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#000000", flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "500", color: "#1a1814" }}>{toggle.label}</div>
                  <div style={{ fontSize: "12px", color: "#7a7670", marginTop: "2px" }}>{toggle.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </s-section>

        </div>{/* ── end sections wrapper ── */}
      </Form>

      {isPageLoading && (
        <div
          aria-live="polite"
          aria-busy="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            background: "rgba(255,255,255,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <s-spinner accessibilityLabel="Loading page" size="large" />
        </div>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
