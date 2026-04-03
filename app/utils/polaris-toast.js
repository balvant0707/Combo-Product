export function showPolarisToast(message, { isError = false, duration = 3500 } = {}) {
  if (typeof window === "undefined" || !message) return;

  const safeMessage = String(message);
  const toastApi = window.shopify?.toast;
  if (toastApi && typeof toastApi.show === "function") {
    toastApi.show(safeMessage, { isError: Boolean(isError), duration });
    return;
  }

  // Fallback for environments where App Bridge toast API is unavailable.
  const el = document.createElement("ui-toast");
  el.setAttribute("message", safeMessage);
  if (isError) el.setAttribute("tone", "critical");
  document.body.appendChild(el);
  window.setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, duration);
}
