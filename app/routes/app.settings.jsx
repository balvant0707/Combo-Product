import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
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
  };

  await upsertSettings(session.shop, data);
  return { success: true };
};

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  return (
    <s-page heading="Settings">
      {actionData?.success && (
        <div
          style={{
            background: "#d1fae5",
            border: "1px solid #6ee7b7",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "16px",
            color: "#065f46",
            fontSize: "13px",
          }}
        >
          Settings saved successfully.
        </div>
      )}

      <Form method="post">
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
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #c9c6be",
                  borderRadius: "6px",
                  fontSize: "13px",
                  color: "#1a1814",
                  background: "#fff",
                  boxSizing: "border-box",
                }}
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
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #c9c6be",
                    borderRadius: "6px",
                    fontSize: "13px",
                    color: "#1a1814",
                    background: "#fff",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "500", color: "#1a1814", marginBottom: "6px" }}>
                  Add to Cart Label
                </label>
                <input
                  type="text"
                  name="addToCartLabel"
                  defaultValue={settings.addToCartLabel || "ADD TO CART"}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: "1px solid #c9c6be",
                    borderRadius: "6px",
                    fontSize: "13px",
                    color: "#1a1814",
                    background: "#fff",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "500", color: "#1a1814", marginBottom: "6px" }}>
                  Primary Button Color
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <input
                    type="color"
                    name="buttonColor"
                    defaultValue={settings.buttonColor || "#2A7A4F"}
                    style={{ width: "40px", height: "36px", border: "1px solid #c9c6be", borderRadius: "6px", cursor: "pointer", padding: "2px" }}
                  />
                  <input
                    type="text"
                    id="buttonColorText"
                    defaultValue={settings.buttonColor || "#2A7A4F"}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      border: "1px solid #c9c6be",
                      borderRadius: "6px",
                      fontSize: "13px",
                      color: "#1a1814",
                      background: "#fff",
                      fontFamily: "monospace",
                    }}
                    readOnly
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
                    defaultValue={settings.activeSlotColor || "#2A7A4F"}
                    style={{ width: "40px", height: "36px", border: "1px solid #c9c6be", borderRadius: "6px", cursor: "pointer", padding: "2px" }}
                  />
                  <input
                    type="text"
                    id="activeSlotColorText"
                    defaultValue={settings.activeSlotColor || "#2A7A4F"}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      border: "1px solid #c9c6be",
                      borderRadius: "6px",
                      fontSize: "13px",
                      color: "#1a1814",
                      background: "#fff",
                      fontFamily: "monospace",
                    }}
                    readOnly
                  />
                </div>
              </div>
            </div>
          </div>
        </s-section>

        <s-section heading="Display Options">
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
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
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name={toggle.name}
                  value="true"
                  defaultChecked={toggle.defaultChecked}
                  style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#2A7A4F", flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "500", color: "#1a1814" }}>{toggle.label}</div>
                  <div style={{ fontSize: "12px", color: "#7a7670", marginTop: "2px" }}>{toggle.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </s-section>

        <s-section heading="Advanced Settings">
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
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
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  name={toggle.name}
                  value="true"
                  defaultChecked={toggle.defaultChecked}
                  style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#2A7A4F", flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "500", color: "#1a1814" }}>{toggle.label}</div>
                  <div style={{ fontSize: "12px", color: "#7a7670", marginTop: "2px" }}>{toggle.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </s-section>

        <s-section>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              type="submit"
              disabled={isSaving}
              style={{
                padding: "10px 24px",
                background: isSaving ? "#9ca3af" : "#2A7A4F",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: isSaving ? "not-allowed" : "pointer",
                letterSpacing: "0.5px",
              }}
            >
              {isSaving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </s-section>
      </Form>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
