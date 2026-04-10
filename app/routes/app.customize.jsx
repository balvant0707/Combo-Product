import { useEffect, useState } from "react";
import { useLoaderData, useActionData, Form, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSettings, upsertSettings } from "../models/settings.server";
import { showPolarisToast } from "../utils/polaris-toast";
import { ToggleSwitch } from "../components/toggle-switch";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  return { settings };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    buttonColor: formData.get("buttonColor"),
    activeSlotColor: formData.get("activeSlotColor"),
    showSavingsBadge: formData.get("showSavingsBadge"),
    allowDuplicates: formData.get("allowDuplicates"),
    showProductPrices: formData.get("showProductPrices"),
    forceShowOos: formData.get("forceShowOos"),
    presetTheme: formData.get("presetTheme"),
    widgetMaxWidth: formData.get("widgetMaxWidth"),
    productCardsPerRow: formData.get("productCardsPerRow"),
  };

  await upsertSettings(session.shop, data);
  return { success: true };
};

const PRODUCT_CARD_ROW_OPTIONS = [3, 4, 5, 6];
const COLOR_COMBINATIONS = [
  { label: "Forest", primary: "#2A7A4F", secondary: "#14532D" },
  { label: "Ocean", primary: "#0E7490", secondary: "#164E63" },
  { label: "Sunset", primary: "#EA580C", secondary: "#9A3412" },
  { label: "Plum", primary: "#7C3AED", secondary: "#4C1D95" },
  { label: "Rose", primary: "#E11D48", secondary: "#9F1239" },
];

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const isPageLoading = navigation.state !== "idle";
  const [buttonColor, setButtonColor] = useState(settings.buttonColor || "#2A7A4F");
  const [activeSlotColor, setActiveSlotColor] = useState(settings.activeSlotColor || "#2A7A4F");
  const [widgetMaxWidth, setWidgetMaxWidth] = useState(settings.widgetMaxWidth ?? 1140);
  const [productCardsPerRow, setProductCardsPerRow] = useState(settings.productCardsPerRow ?? 4);
  const [showSavingsBadge, setShowSavingsBadge] = useState(!!settings.showSavingsBadge);
  const [showProductPrices, setShowProductPrices] = useState(!!settings.showProductPrices);
  const [forceShowOos, setForceShowOos] = useState(!!settings.forceShowOos);

  useEffect(() => {
    if (actionData?.success) {
      showPolarisToast("Configuration saved successfully.");
    }
  }, [actionData?.success]);

  return (
    <Page
      title="Widget Settings"
      subtitle="Customize the appearance and behaviour of the combo builder on your storefront"
      primaryAction={{
        content: isSaving ? "Saving..." : "Save Settings",
        loading: isSaving,
        onAction: () => document.getElementById("settings-form")?.requestSubmit(),
      }}
    >
      <Form id="settings-form" method="post">
        <BlockStack gap="500">

          {/* Success banner */}
          {actionData?.success && (
            <Banner tone="success" title="Settings saved">
              <p>Your widget configuration has been updated.</p>
            </Banner>
          )}

          {/* Theme Customizer + Widget Width stacked (top and bottom) */}
          <BlockStack gap="400">

            {/* Theme Customizer Card */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Theme Customizer</Text>
                <Text as="p" tone="subdued">
                  Customize the primary and secondary widget colors for your storefront.
                </Text>
                <input type="hidden" name="presetTheme" value="custom" />
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">Recommended color combinations</Text>
                  <InlineStack gap="200" wrap>
                    {COLOR_COMBINATIONS.map((combo) => (
                      <button
                        key={combo.label}
                        type="button"
                        onClick={() => { setButtonColor(combo.primary); setActiveSlotColor(combo.secondary); }}
                        style={{
                          border: "1.5px solid #e5e7eb",
                          borderRadius: 8,
                          background: "#fff",
                          cursor: "pointer",
                          padding: "6px 10px",
                        }}
                      >
                        <InlineStack gap="100" blockAlign="center">
                          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: combo.primary }} />
                          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: combo.secondary }} />
                          <Text as="span" variant="bodySm" fontWeight="semibold">{combo.label}</Text>
                        </InlineStack>
                      </button>
                    ))}
                  </InlineStack>
                </BlockStack>
                <InlineGrid columns={2} gap="400">
                  <BlockStack gap="200">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Primary Color</Text>
                    <InlineStack gap="200" blockAlign="center">
                      <input
                        type="color"
                        name="buttonColor"
                        value={buttonColor}
                        onChange={(e) => setButtonColor(e.target.value)}
                        style={{ width: 40, height: 36, border: "1px solid #c9c6be", borderRadius: 5, cursor: "pointer", padding: 2 }}
                      />
                      <input
                        type="text"
                        value={buttonColor}
                        onChange={(e) => setButtonColor(e.target.value)}
                        style={{ flex: 1, padding: "8px 12px", border: "1px solid #c9c6be", borderRadius: 5, fontSize: 13 }}
                      />
                    </InlineStack>
                  </BlockStack>
                  <BlockStack gap="200">
                    <Text as="label" variant="bodySm" fontWeight="semibold">Secondary Color</Text>
                    <InlineStack gap="200" blockAlign="center">
                      <input
                        type="color"
                        name="activeSlotColor"
                        value={activeSlotColor}
                        onChange={(e) => setActiveSlotColor(e.target.value)}
                        style={{ width: 40, height: 36, border: "1px solid #c9c6be", borderRadius: 5, cursor: "pointer", padding: 2 }}
                      />
                      <input
                        type="text"
                        value={activeSlotColor}
                        onChange={(e) => setActiveSlotColor(e.target.value)}
                        style={{ flex: 1, padding: "8px 12px", border: "1px solid #c9c6be", borderRadius: 5, fontSize: 13 }}
                      />
                    </InlineStack>
                  </BlockStack>
                </InlineGrid>
              </BlockStack>
            </Card>

            {/* Widget Width Card */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Widget Width</Text>
                <Text as="p" tone="subdued">
                  Controls the maximum width of the combo builder widget on the storefront.
                </Text>
                <input type="hidden" name="widgetMaxWidth" value={widgetMaxWidth} />

                {/* Preset buttons */}
                <InlineGrid columns={{ xs: 1, md: 5 }} gap="300">
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
                          padding: "12px 8px",
                          border: isActive ? "2px solid #000" : "2px solid #e5e7eb",
                          borderRadius: 8,
                          background: isActive ? "#f9fafb" : "#fff",
                          cursor: "pointer",
                          textAlign: "center",
                        }}
                      >
                        <Text variant="bodySm" fontWeight={isActive ? "semibold" : "regular"}>{preset.label}</Text>
                        <Text variant="bodySm" tone="subdued">{preset.desc}</Text>
                      </button>
                    );
                  })}
                </InlineGrid>

                {/* Custom value */}
                <InlineStack gap="200" blockAlign="center">
                  <Text tone="subdued">Custom:</Text>
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
                    style={{ width: 100, padding: "8px 12px", border: "1.5px solid #e5e7eb", borderRadius: 6, fontSize: 13 }}
                  />
                  <Text tone="subdued">{widgetMaxWidth === 0 ? "= 100%" : "px"}</Text>
                </InlineStack>
              </BlockStack>
            </Card>

          </BlockStack>

          {/* Product Grid Card */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Product Grid</Text>
              <Text as="p" tone="subdued">
                Controls how many product cards appear in each row on desktop storefront layouts.
              </Text>
              <input type="hidden" name="productCardsPerRow" value={productCardsPerRow} />
              <InlineStack gap="300">
                {PRODUCT_CARD_ROW_OPTIONS.map((count) => {
                  const isActive = productCardsPerRow === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setProductCardsPerRow(count)}
                      style={{
                        padding: "14px 20px",
                        border: isActive ? "2px solid #000" : "2px solid #e5e7eb",
                        borderRadius: 8,
                        background: isActive ? "#000" : "#fff",
                        cursor: "pointer",
                        textAlign: "center",
                      }}
                    >
                      <span style={{ color: isActive ? "#fff" : "#111", fontSize: 13, fontWeight: 600 }}>
                        {count} per row
                      </span>
                    </button>
                  );
                })}
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Display Options Card */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Display Options</Text>
              <input type="hidden" name="showSavingsBadge" value={String(showSavingsBadge)} />
              <input type="hidden" name="showProductPrices" value={String(showProductPrices)} />
              <input type="hidden" name="forceShowOos" value={String(forceShowOos)} />
              {/* Keep existing value as-is; field intentionally removed from Customize UI */}
              <input type="hidden" name="allowDuplicates" value={String(!!settings.allowDuplicates)} />
              <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                <Card>
                  <BlockStack gap="100">
                    <InlineStack gap="150" blockAlign="center">
                      <ToggleSwitch checked={showSavingsBadge} onChange={() => setShowSavingsBadge((v) => !v)} showStateText={false} />
                      <Text as="p" variant="bodySm" fontWeight="semibold">Show Savings Badge</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">Display a badge showing how much customers save vs buying individually</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <InlineStack gap="150" blockAlign="center">
                      <ToggleSwitch checked={showProductPrices} onChange={() => setShowProductPrices((v) => !v)} showStateText={false} />
                      <Text as="p" variant="bodySm" fontWeight="semibold">Show Product Prices</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">Show individual product prices in the selection grid</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="100">
                    <InlineStack gap="150" blockAlign="center">
                      <ToggleSwitch checked={forceShowOos} onChange={() => setForceShowOos((v) => !v)} showStateText={false} />
                      <Text as="p" variant="bodySm" fontWeight="semibold">Show Out-of-Stock Products</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">Show out-of-stock products (greyed out) in the selection grid</Text>
                  </BlockStack>
                </Card>
              </InlineGrid>
            </BlockStack>
          </Card>

        </BlockStack>
      </Form>

      {/* Loading overlay */}
      {isPageLoading && (
        <Box
          as="div"
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
          <Spinner accessibilityLabel="Saving" size="large" />
        </Box>
      )}
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
