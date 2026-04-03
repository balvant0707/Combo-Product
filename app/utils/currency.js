function normalizeCurrencyCode(code) {
  const value = String(code || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : "USD";
}

export function getCurrencySymbol(currencyCode, locale = "en") {
  const code = normalizeCurrencyCode(currencyCode);
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);
    const currencyPart = parts.find((part) => part.type === "currency");
    return currencyPart?.value || code;
  } catch {
    return code;
  }
}

export function formatCurrencyAmount(
  amount,
  currencyCode,
  { locale = "en", minimumFractionDigits = 2, maximumFractionDigits = 2 } = {},
) {
  const code = normalizeCurrencyCode(currencyCode);
  const numericAmount = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(numericAmount);
  } catch {
    return `${getCurrencySymbol(code, locale)}${numericAmount.toFixed(maximumFractionDigits)}`;
  }
}
