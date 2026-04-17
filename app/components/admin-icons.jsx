/* eslint-disable react/prop-types */
import { Tooltip } from "@shopify/polaris";

function iconTypeToLabel(type) {
  const raw = String(type || "").trim();
  if (!raw) return "Icon";
  return raw
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AdminIcon({
  type,
  size = "base",
  tone = "base",
  style,
  tooltip = true,
  tooltipContent,
}) {
  const iconNode = (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
        flexShrink: 0,
        ...style,
      }}
    >
      <s-icon type={type} size={size} tone={tone} />
    </span>
  );

  if (!tooltip) return iconNode;

  return (
    <Tooltip content={tooltipContent || iconTypeToLabel(type)}>
      {iconNode}
    </Tooltip>
  );
}

export function AdminIconLabel({
  type,
  children,
  size = "base",
  tone = "base",
  gap = "6px",
  style,
  iconStyle,
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap, ...style }}>
      <AdminIcon type={type} size={size} tone={tone} style={iconStyle} />
      {children}
    </span>
  );
}
