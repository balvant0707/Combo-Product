import { useId, useState } from "react";

export function ToggleSwitch({
  checked,
  defaultChecked = false,
  onChange,
  disabled = false,
  id,
  name,
  value = "true",
  label,
  showStateText = true,
  enabledText = "Enable",
  disabledText = "Disable",
}) {
  const generatedId = useId();
  const inputId = id || `toggle-${generatedId}`;
  const isControlled = typeof checked === "boolean";
  const [localChecked, setLocalChecked] = useState(Boolean(defaultChecked));
  const isOn = isControlled ? checked : localChecked;

  function handleChange(event) {
    if (!isControlled) setLocalChecked(event.target.checked);
    if (onChange) onChange(event);
  }

  return (
    <label
      htmlFor={inputId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ position: "relative", width: "38px", height: "22px", flexShrink: 0 }}>
        <input
          id={inputId}
          name={name}
          value={value}
          type="checkbox"
          disabled={disabled}
          checked={isControlled ? checked : undefined}
          defaultChecked={!isControlled ? defaultChecked : undefined}
          onChange={handleChange}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            margin: 0,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "999px",
            background: isOn ? "#111827" : "#d1d5db",
            border: `1px solid ${isOn ? "#111827" : "#cbd5e1"}`,
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
        />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "2px",
            left: isOn ? "18px" : "2px",
            width: "16px",
            height: "16px",
            borderRadius: "999px",
            background: "#ffffff",
            boxShadow: "0 1px 2px rgba(0, 0, 0, 0.28)",
            transition: "left 0.15s ease",
          }}
        />
      </span>

      {label ? (
        <span style={{ fontSize: "12px", color: "#374151", fontWeight: "600" }}>{label}</span>
      ) : showStateText ? (
        <span style={{ fontSize: "12px", color: "#374151", fontWeight: "600" }}>
          {isOn ? enabledText : disabledText}
        </span>
      ) : null}
    </label>
  );
}

