/* eslint-disable react/prop-types */

export function AdminIcon({ type, size = "base", tone = "base", style }) {
  return (
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
