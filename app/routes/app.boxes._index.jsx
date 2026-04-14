import { useState, useMemo, useEffect } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listBoxes,
  deleteBox,
  toggleBoxStatus,
  toggleComboConfigStatus,
  reorderBoxes,
  activateAllBundleProducts,
  repairMissingShopifyProducts,
  repairMissingShopifyVariantIds,
  upsertComboConfig,
  getBoxListImageSrc,
} from "../models/boxes.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { AdminIcon } from "../components/admin-icons";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { formatCurrencyAmount, getCurrencySymbol } from "../utils/currency";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";

const BUNDLE_PREVIEW_PRODUCTS_QUERY = `#graphql
  query BundlePreviewProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        onlineStoreUrl
      }
    }
  }
`;

async function getBundlePreviewUrlByProductId(admin, shop, productIds = []) {
  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(productIds) ? productIds : [])
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  );
  if (uniqueIds.length === 0) return new Map();

  try {
    const response = await admin.graphql(BUNDLE_PREVIEW_PRODUCTS_QUERY, {
      variables: { ids: uniqueIds },
    });
    const json = await response.json();
    const nodes = Array.isArray(json?.data?.nodes) ? json.data.nodes : [];

    const map = new Map();
    for (const node of nodes) {
      if (!node?.id || !node?.handle) continue;
      const fallbackUrl = `https://${shop}/products/${node.handle}`;
      map.set(node.id, node.onlineStoreUrl || fallbackUrl);
    }
    return map;
  } catch (error) {
    console.error("[app.boxes._index] Failed to resolve bundle preview URLs", error);
    return new Map();
  }
}

function buildBundlePreviewUrl(shopDomain, previewToken, fallbackBaseUrl) {
  if (!previewToken) return fallbackBaseUrl || null;
  const safeToken = String(previewToken).trim();
  if (!safeToken) return fallbackBaseUrl || null;

  try {
    // Use a real storefront page (bundle product URL when available), then pass preview token.
    // Direct /{boxId} paths can 404 on themes without that route.
    const baseUrl = fallbackBaseUrl || `https://${shopDomain}/`;
    const url = new URL(baseUrl);
    url.searchParams.set("cb_preview_box", safeToken);
    return url.toString();
  } catch {
    return fallbackBaseUrl || null;
  }
}

function getDiscountSummary(box) {
  // Always read from comboStepsConfig JSON — works for both regular and specific combo boxes
  const src = box.comboStepsConfig;
  if (!src) return null;
  try {
    const p = JSON.parse(src);
    const type = p?.discountType;
    const value = p?.discountValue;
    if (!type || type === "none") return null;
    if (type !== "buy_x_get_y" && value == null) return null;
    const buyQuantity = Math.max(1, parseInt(String(p?.buyQuantity ?? 1), 10) || 1);
    const getQuantity = Math.max(1, parseInt(String(p?.getQuantity ?? 1), 10) || 1);
    return { discountType: type, discountValue: value, buyQuantity, getQuantity };
  } catch { return null; }
}

function getComboConfigSummary(box) {
  if (box.config) {
    const comboType = box.config.comboType;
    if (!comboType || comboType < 2) return null;
    // Require at least one step to be saved — prevents misidentifying regular boxes
    let hasSteps = false;
    try { hasSteps = JSON.parse(box.config.stepsJson || "[]").length > 0; } catch {}
    if (!hasSteps) return null;
    return { comboType, title: box.config.title, isActive: box.config.isActive, stepsJson: box.config.stepsJson };
  }
  if (!box.comboStepsConfig) return null;
  try {
    const parsed = JSON.parse(box.comboStepsConfig);
    const comboType = parseInt(parsed?.type) || 0;
    if (comboType < 2) return null;
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    if (steps.length === 0) return null;
    return { comboType, title: parsed?.title || null, isActive: parsed?.isActive !== false, stepsJson: JSON.stringify(steps) };
  } catch { return null; }
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  await repairMissingShopifyProducts(session.shop, admin);
  await repairMissingShopifyVariantIds(session.shop, admin);
  let boxes = await listBoxes(session.shop, false, true);
  const boxesMissingTypedComboConfig = boxes.filter((box) => {
    if (box.config || !box.comboStepsConfig) return false;
    try { const p = JSON.parse(box.comboStepsConfig); return parseInt(p?.type) >= 2; } catch { return false; }
  });
  if (boxesMissingTypedComboConfig.length > 0) {
    await Promise.all(
      boxesMissingTypedComboConfig.map((box) =>
        upsertComboConfig(box.id, box.comboStepsConfig).catch((error) => {
          console.error("[app.boxes._index] Failed to repair combo config for box", box.id, error);
        })
      )
    );
    boxes = await listBoxes(session.shop, false, true);
  }
  activateAllBundleProducts(session.shop, admin).catch(() => {});
  const currencyCode = await getShopCurrencyCode(session.shop);
  const previewUrlByProductId = await getBundlePreviewUrlByProductId(
    admin,
    session.shop,
    boxes.map((b) => b.shopifyProductId),
  );
  return {
    currencyCode,
    boxes: boxes.map((b) => ({
      id: b.id,
      boxCode: b.boxCode || null,
      boxName: b.boxName,
      displayTitle: b.displayTitle,
      itemCount: b.itemCount,
      bundlePrice: parseFloat(b.bundlePrice),
      bundlePriceType: b.bundlePriceType || "manual",
      isGiftBox: b.isGiftBox,
      isActive: b.isActive,
      sortOrder: b.sortOrder,
      orderCount: b._count?.orders ?? 0,
      comboConfig: getComboConfigSummary(b),
      discount: getDiscountSummary(b),
      listImageSrc: getBoxListImageSrc(b),
      previewUrl: buildBundlePreviewUrl(
        session.shop,
        b.boxCode || b.id,
        b.shopifyProductId ? previewUrlByProductId.get(b.shopifyProductId) || null : null,
      ),
    })),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");
  if (intent === "delete") {
    const id = formData.get("id");
    await deleteBox(id, shop, admin);
    return { ok: true };
  }
  if (intent === "reorder") {
    const orderedIds = JSON.parse(formData.get("orderedIds") || "[]");
    await reorderBoxes(shop, orderedIds);
    return { ok: true };
  }
  if (intent === "toggle_status") {
    const id = formData.get("id");
    const isActive = formData.get("isActive") === "true";
    await toggleBoxStatus(id, shop, isActive);
    await toggleComboConfigStatus(id, isActive).catch(() => {});
    return { ok: true };
  }
  return { ok: false };
};

// Avatar color palette for box initials
const AVATAR_COLORS = [
  { bg: "#dbeafe", color: "#1d4ed8" },
  { bg: "#dcfce7", color: "#15803d" },
  { bg: "#ede9fe", color: "#7c3aed" },
  { bg: "#fce7f3", color: "#be185d" },
  { bg: "#ffedd5", color: "#c2410c" },
  { bg: "#ecfeff", color: "#0e7490" },
  { bg: "#fef9c3", color: "#854d0e" },
  { bg: "#f0fdf4", color: "#166534" },
];

function getAvatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function CopyCodeIcon({ size = 16 }) {
  return (
    <svg
      width={`${size}px`}
      height={`${size}px`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7.5 3H14.6C16.8402 3 17.9603 3 18.816 3.43597C19.5686 3.81947 20.1805 4.43139 20.564 5.18404C21 6.03969 21 7.15979 21 9.4V16.5M6.2 21H14.3C15.4201 21 15.9802 21 16.408 20.782C16.7843 20.5903 17.0903 20.2843 17.282 19.908C17.5 19.4802 17.5 18.9201 17.5 17.8V9.7C17.5 8.57989 17.5 8.01984 17.282 7.59202C17.0903 7.21569 16.7843 6.90973 16.408 6.71799C15.9802 6.5 15.4201 6.5 14.3 6.5H6.2C5.0799 6.5 4.51984 6.5 4.09202 6.71799C3.71569 6.90973 3.40973 7.21569 3.21799 7.59202C3 8.01984 3 8.57989 3 9.7V17.8C3 18.9201 3 19.4802 3.21799 19.908C3.40973 20.2843 3.71569 20.5903 4.09202 20.782C4.51984 21 5.0799 21 6.2 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon({ size = 16, color = "#ffffff" }) {
  return (
    <svg
      width={`${size}px`}
      height={`${size}px`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M1.5 12s3.75-6.75 10.5-6.75S22.5 12 22.5 12s-3.75 6.75-10.5 6.75S1.5 12 1.5 12Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.25" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function CopyCodeBtn({ code }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <InlineStack gap="100" blockAlign="center">
      <span
        style={{
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "#1d4ed8",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: "5px",
          padding: "3px 8px",
          userSelect: "all",
        }}
      >
        {code}
      </span>
      <button
        type="button"
        title={copied ? "Copied!" : "Copy code"}
        onClick={handleCopy}
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "5px",
          border: `1px solid ${copied ? "#86efac" : "#e5e7eb"}`,
          background: copied ? "#dcfce7" : "#fff",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: copied ? "#16a34a" : "#9ca3af",
          fontSize: "12px",
          transition: "all 0.13s",
          flexShrink: 0,
        }}
      >
        <CopyCodeIcon size={16} />
      </button>
    </InlineStack>
  );
}

export default function ManageBoxesPage() {
  const { boxes, currencyCode } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();

  const PAGE_SIZE = 10;
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [pendingCreateRoute, setPendingCreateRoute] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [manualPageLoading, setManualPageLoading] = useState(false);
  const isDeleteSubmitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "delete";
  const isReorderSubmitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "reorder";
  const isToggleSubmitting =
    toggleFetcher.state !== "idle" &&
    toggleFetcher.formData?.get("_action") === "toggle_status";
  const pendingToggleId = isToggleSubmitting ? parseInt(toggleFetcher.formData?.get("id"), 10) : null;
  const pendingToggleState = isToggleSubmitting ? toggleFetcher.formData?.get("isActive") === "true" : null;
  const isPageLoading =
    manualPageLoading ||
    navigation.state !== "idle" ||
    isDeleteSubmitting ||
    isReorderSubmitting ||
    isToggleSubmitting;

  function startPageLoading() {
    setManualPageLoading(true);
  }

  useEffect(() => {
    if (
      manualPageLoading &&
      navigation.state === "idle" &&
      !isDeleteSubmitting &&
      !isReorderSubmitting &&
      !isToggleSubmitting
    ) {
      setManualPageLoading(false);
    }
  }, [manualPageLoading, navigation.state, isDeleteSubmitting, isReorderSubmitting, isToggleSubmitting]);

  function navigateTo(path) {
    startPageLoading();
    navigate(withEmbeddedAppParams(path, location.search));
  }
  function openCreateBoxModal() {
    setShowCreateBoxModal(true);
  }
  function closeCreateBoxModal() {
    setShowCreateBoxModal(false);
    setPendingCreateRoute(null);
  }
  function goToCreateRoute(path) {
    setPendingCreateRoute(path);
    navigateTo(path);
  }

  function handleDelete(id, name) { setDeleteConfirm({ id, name }); }

  function confirmDelete() {
    if (deleteConfirm) {
      startPageLoading();
      fetcher.submit({ _action: "delete", id: String(deleteConfirm.id) }, { method: "POST" });
    }
    setDeleteConfirm(null);
  }

  function toggleStatus(id, nextState) {
    toggleFetcher.submit(
      { _action: "toggle_status", id: String(id), isActive: String(nextState) },
      { method: "POST" },
    );
  }

  const baseBoxes =
    fetcher.formData?.get("_action") === "delete"
      ? boxes.filter((b) => b.id !== parseInt(fetcher.formData.get("id")))
      : boxes;

  const boxesWithPendingToggle = useMemo(
    () => (
      pendingToggleId === null
        ? baseBoxes
        : baseBoxes.map((b) => (b.id === pendingToggleId ? { ...b, isActive: pendingToggleState } : b))
    ),
    [baseBoxes, pendingToggleId, pendingToggleState],
  );

  const filteredBoxes = useMemo(() => {
    let result = boxesWithPendingToggle;
    if (statusFilter === "active") result = result.filter((b) => b.isActive);
    if (statusFilter === "inactive") result = result.filter((b) => !b.isActive);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (b) => b.boxName.toLowerCase().includes(q) || (b.displayTitle && b.displayTitle.toLowerCase().includes(q))
      );
    }
    return result.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  }, [boxesWithPendingToggle, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredBoxes.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const displayBoxes = filteredBoxes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 when filter/search changes
  useEffect(() => { setCurrentPage(1); }, [statusFilter, search]);

  const totalOrders = baseBoxes.reduce((s, b) => s + b.orderCount, 0);
  const activeCount = boxesWithPendingToggle.filter((b) => b.isActive).length;
  const inactiveCount = boxesWithPendingToggle.length - activeCount;

  const statCards = [
    { label: "Total Bundle Boxes",  value: baseBoxes.length,  icon: "package",    iconBg: "#eff6ff", iconColor: "#2563eb" },
    { label: "Active Bundle Boxes", value: activeCount,        icon: "check",      iconBg: "#f0fdf4", iconColor: "#16a34a" },
    { label: "Inactive Bundle Boxes", value: inactiveCount,    icon: "hide",       iconBg: "#fafafa", iconColor: "#9ca3af" },
    { label: "Total Bundle Orders", value: totalOrders,        icon: "order",      iconBg: "#fdf4ff", iconColor: "#9333ea" },
  ];

  return (
    <Page
      title="Manage Bundle Boxes"
      primaryAction={{ content: "+ Create Bundle Box", onAction: openCreateBoxModal }}
    >
      {/* <ui-title-bar title="MixBox – Box & Bundle Builder">
        <button variant="primary" onClick={openCreateBoxModal}>
          + Create Box
        </button>
      </ui-title-bar> */}

      <BlockStack gap="400">
        {/* Stats row */}
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          {statCards.map((s) => (
            <Card key={s.label} padding="400">
              <InlineStack gap="300" blockAlign="center">
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "8px",
                    background: s.iconBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <AdminIcon type={s.icon} size="base" style={{ color: s.iconColor }} />
                </div>
                <BlockStack gap="050">
                  <Text variant="headingLg" as="p" fontWeight="bold">{s.value}</Text>
                  <Text variant="bodySm" as="p" tone="subdued">{s.label}</Text>
                </BlockStack>
              </InlineStack>
            </Card>
          ))}
        </InlineGrid>

        {/* Main content card */}
        <Card padding="0">
          {/* Toolbar */}
          <Box padding="300" borderBlockEndWidth="025" borderColor="border-secondary">
            <InlineStack gap="300" blockAlign="center" wrap>
              <Box minWidth="200px" flexGrow="1">
                <TextField
                  label=""
                  labelHidden
                  placeholder="Search bundle box by name..."
                  value={search}
                  onChange={(val) => setSearch(val)}
                  clearButton
                  onClearButtonClick={() => setSearch("")}
                  prefix={<AdminIcon type="search" size="small" style={{ color: "#9ca3af" }} />}
                  autoComplete="off"
                />
              </Box>
              <InlineStack gap="150" blockAlign="center">
                <Button
                  variant={statusFilter === "all" ? "primary" : "secondary"}
                  onClick={() => setStatusFilter("all")}
                  size="slim"
                >
                  All ({baseBoxes.length})
                </Button>
                <Button
                  variant={statusFilter === "active" ? "primary" : "secondary"}
                  tone={statusFilter === "active" ? "success" : undefined}
                  onClick={() => setStatusFilter("active")}
                  size="slim"
                >
                  Active ({activeCount})
                </Button>
                <Button
                  variant={statusFilter === "inactive" ? "primary" : "secondary"}
                  onClick={() => setStatusFilter("inactive")}
                  size="slim"
                >
                  Inactive ({inactiveCount})
                </Button>
              </InlineStack>
            </InlineStack>
          </Box>

          {baseBoxes.length === 0 ? (
            /* Empty state — no boxes at all */
            <EmptyState
              heading="No combo boxes yet"
              action={{ content: "Create Bundle Box", onAction: openCreateBoxModal }}
              secondaryAction={{ content: "Create Specific Combo Bundle", onAction: () => navigateTo("/app/boxes/specific-combo") }}
              image=""
            >
              <p>Create your first box to let customers build custom combos on your storefront.</p>
            </EmptyState>
          ) : filteredBoxes.length === 0 ? (
            /* No search/filter results */
            <Box padding="800">
              <BlockStack gap="200" align="center" inlineAlign="center">
                <AdminIcon type="search" size="large" style={{ color: "#d1d5db" }} />
                <Text as="p" tone="subdued">
                  No boxes match &ldquo;<strong>{search}</strong>&rdquo;
                </Text>
              </BlockStack>
            </Box>
          ) : (
            <>
              <IndexTable
                resourceName={{ singular: "box", plural: "boxes" }}
                itemCount={displayBoxes.length}
                headings={[
                  { title: "Bundle Name" },
                  { title: "Bundle Code" },
                  { title: "Bundle Price" },
                  { title: "Bundle Type" },
                  { title: "Bundle Orders" },
                  { title: "Live Status" },
                  { title: "Bundle Actions" },
                ]}
                selectable={false}
              >
                {displayBoxes.map((box, index) => {
                  const avatar = getAvatarColor(box.id);
                  const isRowTogglePending = isToggleSubmitting && pendingToggleId === box.id;
                  return (
                    <IndexTable.Row key={box.id} id={String(box.id)} position={index}>
                      {/* Bundle Name */}
                      <IndexTable.Cell>
                        <InlineStack gap="300" blockAlign="center">
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "8px",
                              background: avatar.bg,
                              color: avatar.color,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 800,
                              fontSize: "14px",
                              flexShrink: 0,
                              letterSpacing: "-0.5px",
                              overflow: "hidden",
                              border: "1px solid rgba(0,0,0,0.04)",
                            }}
                          >
                            {box.listImageSrc ? (
                              <img
                                src={box.listImageSrc}
                                alt={`${box.boxName} image`}
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                              />
                            ) : (
                              box.boxName.charAt(0).toUpperCase()
                            )}
                          </div>
                          <BlockStack gap="050">
                            <InlineStack gap="150" blockAlign="center">
                              <Text variant="bodyMd" fontWeight="semibold" as="span">{box.boxName}</Text>
                              <Badge tone={box.isActive ? "success" : "enabled"}>
                                {box.isActive ? "Live" : "Draft"}
                              </Badge>
                              {box.isGiftBox && (
                                <Badge tone="attention">Gift</Badge>
                              )}
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>
                      </IndexTable.Cell>

                      {/* Code */}
                      <IndexTable.Cell>
                        {box.boxCode ? (
                          <CopyCodeBtn code={box.boxCode} />
                        ) : (
                          <Text as="span" tone="disabled">—</Text>
                        )}
                      </IndexTable.Cell>

                      {/* Price */}
                      <IndexTable.Cell>
                        {box.bundlePriceType === "dynamic" ? (
                          <BlockStack gap="050">
                          <Text as="span" tone="subdued" variant="bodySm" fontStyle="italic">Dynamic</Text>
                            {box.discount && (
                              <Text as="span" variant="bodySm" tone="success" fontWeight="semibold">
                                {box.discount.discountType === "percent"
                                    ? `${box.discount.discountValue}% off`
                                    : box.discount.discountType === "fixed"
                                    ? `${getCurrencySymbol(currencyCode)}${box.discount.discountValue} off`
                                    : box.discount.discountType === "buy_x_get_y"
                                      ? `Buy ${box.discount.buyQuantity || 1} Get ${box.discount.getQuantity || 1} Free`
                                      : `${box.discount.discountValue} off`}
                              </Text>
                            )}
                          </BlockStack>
                        ) : (
                          <Text as="span" fontWeight="bold" variant="bodyMd">
                            {formatCurrencyAmount(Number(box.bundlePrice || 0), currencyCode)}
                          </Text>
                        )}
                      </IndexTable.Cell>

                      {/* Type */}
                      <IndexTable.Cell>
                        {(() => {
                          const isSpecific = box.comboConfig && box.comboConfig.comboType > 0;
                          return (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "6px 12px",
                                borderRadius: "8px",
                                border: `1px solid ${isSpecific ? "#c7d2fe" : "#bbf7d0"}`,
                                background: isSpecific ? "#eef2ff" : "#ecfdf3",
                                color: isSpecific ? "#4f46e5" : "#166534",
                                fontSize: "13px",
                                fontWeight: 600,
                                lineHeight: 1.1,
                              }}
                            >
                              {isSpecific ? "Specific Product" : "Simple Bundle"}
                            </span>
                          );
                        })()}
                      </IndexTable.Cell>

                      {/* Orders */}
                      <IndexTable.Cell>
                        {box.orderCount > 0 ? (
                          <InlineStack gap="100" blockAlign="center">
                            <AdminIcon type="orders" size="small" style={{ color: "#2A7A4F" }} />
                            <Text as="span" fontWeight="bold">{box.orderCount}</Text>
                          </InlineStack>
                        ) : (
                          <Text as="span" tone="disabled">No</Text>
                        )}
                      </IndexTable.Cell>

                      {/* Enabled toggle */}
                      <IndexTable.Cell>
                        <BlockStack gap="050">
                          <button
                            type="button"
                            style={{
                              position: "relative",
                              width: "42px",
                              height: "24px",
                              border: "none",
                              borderRadius: "999px",
                              background: box.isActive ? "#111827" : "#d1d5db",
                              padding: 0,
                              cursor: isToggleSubmitting ? "not-allowed" : "pointer",
                              transition: "background 0.16s",
                              opacity: isToggleSubmitting ? 0.7 : 1,
                            }}
                            disabled={isToggleSubmitting}
                            aria-label={box.isActive ? "Disable box" : "Enable box"}
                            title={box.isActive ? "Disable on storefront" : "Enable on storefront"}
                            onClick={() => toggleStatus(box.id, !box.isActive)}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: "3px",
                                left: box.isActive ? "21px" : "3px",
                                width: "18px",
                                height: "18px",
                                borderRadius: "50%",
                                background: "#ffffff",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.24)",
                                transition: "left 0.16s",
                              }}
                            />
                          </button>
                          {isRowTogglePending && (
                            <Text as="span" variant="bodySm" tone="subdued">Updating...</Text>
                          )}
                        </BlockStack>
                      </IndexTable.Cell>

                      {/* Actions */}
                      <IndexTable.Cell>
                        <InlineStack gap="100">
                          <Button
                            size="slim"
                            url={box.previewUrl || undefined}
                            target="_blank"
                            disabled={!box.previewUrl}
                            icon={<EyeIcon size={16} />}
                            accessibilityLabel="Preview on storefront"
                            tooltipContent={box.previewUrl ? "Preview on storefront" : "Preview unavailable"}
                          >
                          </Button>
                          <Button
                            size="slim"
                            onClick={() => navigateTo(box.comboConfig ? `/app/boxes/${box.id}/combo` : `/app/boxes/${box.id}`)}
                            icon={<AdminIcon type="edit" size="small" />}
                          >
                          </Button>
                          {box.orderCount === 0 && (
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => handleDelete(box.id, box.boxName)}
                              icon={<AdminIcon type="delete" size="small" />}
                            >
                            </Button>
                          )}
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>

              {/* Pagination */}
              {totalPages > 1 && (
                <Box padding="400" borderBlockStartWidth="025" borderColor="border-secondary">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredBoxes.length)} of {filteredBoxes.length} boxes
                    </Text>
                    <Pagination
                      hasPrevious={safePage > 1}
                      hasNext={safePage < totalPages}
                      onPrevious={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    />
                  </InlineStack>
                </Box>
              )}
            </>
          )}
        </Card>
      </BlockStack>

      {/* Loading overlay */}
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
          <Spinner accessibilityLabel="Loading page" size="large" />
        </div>
      )}

      {/* Create Box modal */}
      <Modal
        open={showCreateBoxModal}
        onClose={closeCreateBoxModal}
        title="Choose Bundle Type"
        size="medium"
      >
        <Modal.Section  style={{ borderRadius: "0px !important", maxWidth: "30rem !important" }}>
          <BlockStack gap="300">
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 0, padding: "16px" }}>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <AdminIcon type="package" size="base" />
                  <Text as="h3" variant="headingSm">Create Simple Bundle Product</Text>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  Preconfigured Shopify product bundle to increase average order value faster.
                </Text>
                <button
                  type="button"
                  disabled={pendingCreateRoute !== null}
                  onClick={() => goToCreateRoute("/app/boxes/new")}
                  style={{
                    width: "200px",
                    maxWidth: "100%",
                    border: "1px solid #000000",
                    borderRadius: 0,
                    background: "#000000",
                    color: "#ffffff",
                    padding: "9px 12px",
                    fontSize: "15px",
                    cursor: pendingCreateRoute !== null ? "not-allowed" : "pointer",
                    opacity: pendingCreateRoute !== null && pendingCreateRoute !== "/app/boxes/new" ? 0.65 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    minHeight: "40px",
                  }}
                >
                  {pendingCreateRoute === "/app/boxes/new" && <Spinner accessibilityLabel="Loading" size="small" />}
                  Create Bundle Box
                </button>
              </BlockStack>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 0, padding: "16px" }}>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <AdminIcon type="target" size="base" />
                  <Text as="h3" variant="headingSm">Create Build-Your-Own Bundle Box</Text>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  Step-by-step bundle builder that lets shoppers create a personalized product box.
                </Text>
                <button
                  type="button"
                  disabled={pendingCreateRoute !== null}
                  onClick={() => goToCreateRoute("/app/boxes/specific-combo")}
                  style={{
                    width: "200px",
                    maxWidth: "100%",
                    border: "1px solid #111827",
                    borderRadius: 0,
                    background: "#111827",
                    color: "#ffffff",
                    padding: "9px 12px",
                    fontSize: "14px",
                    cursor: pendingCreateRoute !== null ? "not-allowed" : "pointer",
                    opacity: pendingCreateRoute !== null && pendingCreateRoute !== "/app/boxes/specific-combo" ? 0.65 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    minHeight: "40px",
                  }}
                >
                  {pendingCreateRoute === "/app/boxes/specific-combo" && <Spinner accessibilityLabel="Loading" size="small" />}
                  Create Bundle Box
                </button>
              </BlockStack>
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete box?"
        primaryAction={{ content: "Delete", destructive: true, onAction: confirmDelete }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteConfirm(null) }]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete &ldquo;<strong>{deleteConfirm?.name}</strong>&rdquo;? Its Shopify product will be permanently removed.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
