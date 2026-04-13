(function () {
  'use strict';

  var DEFAULT_API_BASE = 'https://combo-product-ten.vercel.app';

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function generateSessionId() {
    return 'cb_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  }

  function formatPrice(amount, currencySymbol, currencyCode) {
    var numericAmount = Number(amount) || 0;
    var code = String(currencyCode || "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: code,
          currencyDisplay: "narrowSymbol",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(numericAmount);
      } catch (_err) {}
    }

    var symbol = currencySymbol || "$";
    return symbol + numericAmount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function isDynamicBundlePrice(box) {
    return String((box && box.bundlePriceType) || 'manual') === 'dynamic';
  }

  function normalizeProductCardsPerRow(value) {
    var parsed = parseInt(value, 10);
    return [3, 4, 5, 6].indexOf(parsed) !== -1 ? parsed : 4;
  }

  function parseBooleanSetting(value, fallback) {
    if (value == null || value === '') return !!fallback;
    if (typeof value === 'boolean') return value;
    var normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    return !!fallback;
  }

  function normalizeHexColor(value, fallback) {
    if (value == null) return fallback;
    var raw = String(value).trim();
    if (!raw) return fallback;
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      return '#' +
        raw.charAt(1) + raw.charAt(1) +
        raw.charAt(2) + raw.charAt(2) +
        raw.charAt(3) + raw.charAt(3);
    }
    return fallback;
  }

  function pickReadableTextColor(backgroundColor, darkText, lightText) {
    var fallbackDark = darkText || '#111827';
    var fallbackLight = lightText || '#ffffff';
    var hex = normalizeHexColor(backgroundColor, '');
    if (!hex) return fallbackLight;

    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var perceivedBrightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;

    return perceivedBrightness >= 160 ? fallbackDark : fallbackLight;
  }

  function getSelectedProductsTotal(slots) {
    var total = 0;
    (slots || []).forEach(function (p) {
      if (!p) return;
      if (p.productPrice != null && parseFloat(p.productPrice) > 0) {
        total += parseFloat(p.productPrice);
      }
    });
    return total;
  }

  function getBuyXGetYFreeUnits(totalQty, buyQty, getQty) {
    var safeQty = Math.max(0, parseInt(String(totalQty || 0), 10) || 0);
    var safeBuyQty = Math.max(1, parseInt(String(buyQty || 1), 10) || 1);
    var safeGetQty = Math.max(1, parseInt(String(getQty || 1), 10) || 1);
    var groupSize = safeBuyQty + safeGetQty;
    if (safeQty <= 0 || groupSize <= 0) return 0;
    var fullGroups = Math.floor(safeQty / groupSize);
    var remainder = safeQty % groupSize;
    var partialFree = Math.max(0, Math.min(safeGetQty, remainder - safeBuyQty));
    return (fullGroups * safeGetQty) + partialFree;
  }

  function getBuyXGetYDiscountAmount(totalPrice, comboConfig, selectedItems) {
    if (!(totalPrice > 0) || !comboConfig) return 0;

    var unitPrices = [];
    if (Array.isArray(selectedItems)) {
      selectedItems.forEach(function (item) {
        if (!item) return;
        var raw = item;
        if (typeof item === 'object') raw = item.productPrice != null ? item.productPrice : item.price;
        var parsed = parseFloat(raw);
        if (parsed > 0) unitPrices.push(parsed);
      });
    }

    var quantity = unitPrices.length;
    if (quantity <= 0) {
      quantity = Math.max(0, parseInt(String(comboConfig.type || 0), 10) || 0);
    }
    if (quantity <= 0) return 0;

    var freeUnits = getBuyXGetYFreeUnits(quantity, comboConfig.buyQuantity, comboConfig.getQuantity);
    if (freeUnits <= 0) return 0;

    var freeAmount = 0;
    if (unitPrices.length >= freeUnits) {
      unitPrices.sort(function (a, b) { return a - b; });
      for (var i = 0; i < freeUnits; i++) freeAmount += unitPrices[i] || 0;
    } else {
      freeAmount = (totalPrice / quantity) * freeUnits;
    }

    return Math.min(totalPrice, freeAmount);
  }

  function getComboDiscountBreakdown(totalPrice, comboConfig, selectedItems) {
    var baseTotal = parseFloat(totalPrice) || 0;
    if (baseTotal <= 0 || !comboConfig) {
      return { discountedTotal: Math.max(0, baseTotal), discountAmount: 0, freeUnits: 0 };
    }

    var discountType = comboConfig.discountType || 'none';
    var discountValue = parseFloat(comboConfig.discountValue) || 0;

    if (discountType === 'percent') {
      var percentDiscount = Math.min(baseTotal, Math.max(0, baseTotal * (discountValue / 100)));
      return { discountedTotal: Math.max(0, baseTotal - percentDiscount), discountAmount: percentDiscount, freeUnits: 0 };
    }
    if (discountType === 'fixed') {
      var fixedDiscount = Math.min(baseTotal, Math.max(0, discountValue));
      return { discountedTotal: Math.max(0, baseTotal - fixedDiscount), discountAmount: fixedDiscount, freeUnits: 0 };
    }
    if (discountType === 'buy_x_get_y') {
      var bxgyDiscount = getBuyXGetYDiscountAmount(baseTotal, comboConfig, selectedItems);
      var bxgyFreeUnits = 0;
      if (Array.isArray(selectedItems)) {
        var qty = 0;
        selectedItems.forEach(function (item) {
          if (!item) return;
          var raw = item;
          if (typeof item === 'object') raw = item.productPrice != null ? item.productPrice : item.price;
          if ((parseFloat(raw) || 0) > 0) qty += 1;
        });
        bxgyFreeUnits = getBuyXGetYFreeUnits(qty, comboConfig.buyQuantity, comboConfig.getQuantity);
      }
      return {
        discountedTotal: Math.max(0, baseTotal - bxgyDiscount),
        discountAmount: Math.max(0, bxgyDiscount),
        freeUnits: Math.max(0, bxgyFreeUnits),
      };
    }

    return { discountedTotal: Math.max(0, baseTotal), discountAmount: 0, freeUnits: 0 };
  }

  function applyComboDiscount(price, comboConfig, selectedItems) {
    return getComboDiscountBreakdown(price, comboConfig, selectedItems).discountedTotal;
  }

  function renderStickyTotal(totalEl, amount, currencySymbol) {
    if (!totalEl) return;
    var parsedAmount = parseFloat(amount);
    var hasAmount = !isNaN(parsedAmount);
    totalEl.innerHTML =
      'Total <span class="cb-sticky-price">' +
      (hasAmount ? (formatPrice(parsedAmount, currencySymbol, null) + '/-') : '') +
      '</span>';
  }

  function setBoxCardPrice(box, amount, currencySymbol) {
    if (!box || !box._priceTextEl) return;
    var parsedAmount = parseFloat(amount);
    if (isDynamicBundlePrice(box) && !(parsedAmount > 0)) {
      box._priceTextEl.textContent = '';
      box._priceTextEl.style.display = 'none';
      return;
    }
    box._priceTextEl.style.display = '';
    box._priceTextEl.textContent = formatPrice(parsedAmount || 0, currencySymbol, null);
  }

  function getDynamicDisplayPrice(amount) {
    var parsedAmount = parseFloat(amount);
    return parsedAmount > 0 ? parsedAmount : null;
  }

  function setWizardStep2Preview(ctx, slots) {
    // Indicator is styled via CSS class — no content insertion needed
  }

  function resolveAddToCartLabel(settings, ctxOverride) {
    if (ctxOverride && String(ctxOverride).trim()) return String(ctxOverride).trim();
    var label = settings && settings.addToCartLabel != null
      ? String(settings.addToCartLabel).trim()
      : '';
    if (!label || label.toUpperCase() === 'ADD TO CART') return 'Add To Cart';
    return label;
  }

  function resolveCtaButtonLabel(settings, boxOverride) {
    if (boxOverride && String(boxOverride).trim()) return String(boxOverride).trim();
    var label = settings && settings.ctaButtonLabel != null
      ? String(settings.ctaButtonLabel).trim()
      : '';
    if (!label) return 'BUILD YOUR OWN BOX';
    return label;
  }

  function resolveProductGridButtonLabel(box, settings) {
    var label = '';
    if (box && box.productButtonTitle != null) label = String(box.productButtonTitle).trim();
    if (box && box.addToCartLabel != null) label = String(box.addToCartLabel).trim();
    if (!label && box && box.comboConfig && box.comboConfig.productButtonTitle != null) {
      label = String(box.comboConfig.productButtonTitle).trim();
    }
    if (!label && box && box.comboConfig && box.comboConfig.addToCartLabel != null) {
      label = String(box.comboConfig.addToCartLabel).trim();
    }
    if (!label && settings && settings.addToCartLabel != null) {
      label = String(settings.addToCartLabel).trim();
    }
    return label || 'ADD TO BOX';
  }

  function resolveStepSelectionButtonLabel(stepCfg, box, settings) {
    var label = '';
    if (stepCfg && stepCfg.popup && stepCfg.popup.btn != null) {
      label = String(stepCfg.popup.btn).trim();
    }
    if (label) return label;
    return resolveProductGridButtonLabel(box, settings);
  }

  function resolveStepCartButtonLabel(box, ctx) {
    var label = resolveProductGridButtonLabel(box, ctx && ctx.settings);
    if (label && String(label).trim()) return String(label).trim();
    return resolveAddToCartLabel(ctx && ctx.settings, ctx && ctx.cartBtnLabel);
  }

  function setWizardSelectedPrice(ctx, box, amount) {
    if (!ctx || ctx.layoutMode !== 'steps' || !ctx._wizardSelectedPriceEl) return;
    var el = ctx._wizardSelectedPriceEl;
    var parsedAmount = parseFloat(amount);
    var shouldHide = isNaN(parsedAmount) || (isDynamicBundlePrice(box) && !(parsedAmount > 0));

    if (shouldHide) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    el.innerHTML = 'Selected Combo Price: <span class="cb-wizard-selected-price-value">' +
      formatPrice(parsedAmount, ctx.currencySymbol, ctx.currencyCode) +
      '</span>';
    el.style.display = 'flex';
  }

  // ─── Preset Theme Palettes ────────────────────────────────────────────────────

  var PRESET_THEMES = {
    'oh-so-minimal':     { primary: '#1a1a1a', bg: '#fafafa', text: '#111827', muted: '#000000', border: '#e5e7eb', idleNum: '#d1d5db', accentLt: '#f3f4f6', headingClr: '#1a1a1a' },
    'fresh-gradient':    { primary: '#7c3aed', bg: '#faf5ff', text: '#1e1b4b', muted: '#6d28d9', border: '#ede9fe', idleNum: '#c4b5fd', accentLt: '#ede9fe', headingClr: '#5b21b6' },
    'aqua':              { primary: '#0891b2', bg: '#ecfeff', text: '#0c4a6e', muted: '#0e7490', border: '#cffafe', idleNum: '#a5f3fc', accentLt: '#cffafe', headingClr: '#0e7490' },
    'golden-hour':       { primary: '#d97706', bg: '#fffbeb', text: '#1c1917', muted: '#b45309', border: '#fde68a', idleNum: '#fcd34d', accentLt: '#fef3c7', headingClr: '#92400e' },
    'sharp-edge':        { primary: '#000000', bg: '#ffffff', text: '#000000', muted: '#374151', border: '#000000', idleNum: '#9ca3af', accentLt: '#f3f4f6', headingClr: '#000000' },
    'poseidon':          { primary: '#38bdf8', bg: '#0c1445', text: '#e0f2fe', muted: '#93c5fd', border: '#1e3a8a', idleNum: '#475569', accentLt: '#1e3a8a', headingClr: '#7dd3fc' },
    'sand-dunes':        { primary: '#92400e', bg: '#fef9ee', text: '#1c1917', muted: '#78350f', border: '#fcd34d', idleNum: '#fbbf24', accentLt: '#fef3c7', headingClr: '#78350f' },
    'bubblegum':         { primary: '#db2777', bg: '#fdf2f8', text: '#831843', muted: '#be185d', border: '#fbcfe8', idleNum: '#f9a8d4', accentLt: '#fce7f3', headingClr: '#9d174d' },
    'cape-town':         { primary: '#dc2626', bg: '#f8fafc', text: '#0f172a', muted: '#64748b', border: '#fee2e2', idleNum: '#fca5a5', accentLt: '#fee2e2', headingClr: '#991b1b' },
    'blackout':          { primary: '#e5e7eb', bg: '#000000', text: '#f9fafb', muted: '#9ca3af', border: '#374151', idleNum: '#4b5563', accentLt: '#1f2937', headingClr: '#f3f4f6' },
    'urban-underground': { primary: '#a855f7', bg: '#1e1b4b', text: '#f5f3ff', muted: '#c084fc', border: '#312e81', idleNum: '#4c1d95', accentLt: '#2e1065', headingClr: '#d8b4fe' },
    'cyber-pink':        { primary: '#ec4899', bg: '#0f172a', text: '#fce7f3', muted: '#f472b6', border: '#1e1b4b', idleNum: '#4c1d95', accentLt: '#1e1b4b', headingClr: '#f9a8d4' },
    'key-lime-pie':      { primary: '#84cc16', bg: '#111827', text: '#f7fee7', muted: '#a3e635', border: '#1f2937', idleNum: '#374151', accentLt: '#1a2e05', headingClr: '#bef264' },
    'lemonade':          { primary: '#ca8a04', bg: '#fefce8', text: '#1c1917', muted: '#a16207', border: '#fef08a', idleNum: '#fde047', accentLt: '#fefce8', headingClr: '#854d0e' },
    'nile':              { primary: '#f59e0b', bg: '#0c1a0e', text: '#f0fdf4', muted: '#fbbf24', border: '#14532d', idleNum: '#166534', accentLt: '#052e16', headingClr: '#fcd34d' },
    'lavender':          { primary: '#8b5cf6', bg: '#f5f3ff', text: '#1e1b4b', muted: '#7c3aed', border: '#ddd6fe', idleNum: '#c4b5fd', accentLt: '#ede9fe', headingClr: '#5b21b6' },
    'magma-lake':        { primary: '#f97316', bg: '#1c0a00', text: '#fff7ed', muted: '#fb923c', border: '#431407', idleNum: '#7c2d12', accentLt: '#431407', headingClr: '#fed7aa' },
    'smooth-silk':       { primary: '#f43f5e', bg: '#fff1f2', text: '#1c0a0e', muted: '#be123c', border: '#fecdd3', idleNum: '#fda4af', accentLt: '#ffe4e6', headingClr: '#9f1239' },
  };

  function applyPresetTheme(rootEl, themeName) {
    if (!themeName || themeName === 'custom' || !PRESET_THEMES[themeName]) return;
    var t = PRESET_THEMES[themeName];
    var buttonTextColor = pickReadableTextColor(t.primary, '#111827', '#ffffff');
    var instance = rootEl.getAttribute('data-cb-instance') || rootEl.getAttribute('data-block-id');
    if (!instance) return;

    var styleId = 'cb-theme-override-' + instance;
    var existing = document.getElementById(styleId);
    if (existing) existing.parentNode.removeChild(existing);

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = '[data-cb-instance="' + instance + '"] {' +
      '--cb-primary:' + t.primary + ';' +
      '--cb-primary-hover:' + t.primary + ';' +
      '--cb-primary-light:' + t.accentLt + ';' +
      '--cb-primary-glow:' + t.primary + '33;' +
      '--cb-active-slot:' + t.primary + ';' +
      '--cb-bg:' + t.bg + ';' +
      '--cb-text:' + t.text + ';' +
      '--cb-text-muted:' + t.muted + ';' +
      '--cb-border:' + t.border + ';' +
      '--cb-border-dashed:' + t.border + ';' +
      '--cb-idle-num:' + t.idleNum + ';' +
      '--cb-product-card-bg:' + t.bg + ';' +
      '--cb-product-font-color:' + t.text + ';' +
      '--cb-product-btn-bg:' + t.primary + ';' +
      '--cb-product-btn-text:' + buttonTextColor + ';' +
    '}';
    // Append to body so this rule comes after the liquid block's <style> in
    // document order, winning the CSS cascade at equal specificity.
    document.body.appendChild(style);
  }

  function applyCustomColors(rootEl, settings) {
    if (!settings) return;
    var primaryColor = normalizeHexColor(settings.buttonColor, '#2A7A4F');
    var activeSlotColor = normalizeHexColor(settings.activeSlotColor, primaryColor);
    var cardBgColor = normalizeHexColor(
      settings.productCardBackgroundColor || settings.cardBackgroundColor || settings.cardBgColor || settings.backgroundColor,
      '#ffffff'
    );
    var fontColor = normalizeHexColor(
      settings.productCardFontColor || settings.fontColor || settings.textColor,
      pickReadableTextColor(cardBgColor, '#111827', '#ffffff')
    );
    var buttonTextColor = normalizeHexColor(
      settings.buttonTextColor || settings.buttonFontColor,
      pickReadableTextColor(primaryColor, '#111827', '#ffffff')
    );
    var instance = rootEl.getAttribute('data-cb-instance') || rootEl.getAttribute('data-block-id');
    if (!instance) return;

    var styleId = 'cb-custom-colors-' + instance;
    var existing = document.getElementById(styleId);
    if (existing) existing.parentNode.removeChild(existing);

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = '[data-cb-instance="' + instance + '"] {' +
      '--cb-primary:' + primaryColor + ';' +
      '--cb-primary-hover:' + primaryColor + ';' +
      '--cb-primary-glow:' + primaryColor + '33;' +
      '--cb-active-slot:' + activeSlotColor + ';' +
      '--cb-product-card-bg:' + cardBgColor + ';' +
      '--cb-product-font-color:' + fontColor + ';' +
      '--cb-product-btn-bg:' + primaryColor + ';' +
      '--cb-product-btn-text:' + buttonTextColor + ';' +
    '}';
    document.body.appendChild(style);
  }

  // ─── Variant Cache + Picker ───────────────────────────────────────────────────

  var productDataCache = {};
  var productDataPending = {};
  var _productDescriptionModal = null;
  var _productDescriptionModalTitle = null;
  var _productDescriptionModalBody = null;
  var _productDescriptionModalCloseBtn = null;
  var _productDescriptionModalLastFocus = null;
  var _productDescriptionModalBodyOverflow = '';
  var _productDescriptionModalRequestToken = 0;

  function sanitizeProductDescriptionHtml(html) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html || '';

    Array.prototype.forEach.call(
      wrapper.querySelectorAll('script, iframe, object, embed'),
      function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    );

    Array.prototype.forEach.call(wrapper.querySelectorAll('*'), function (node) {
      for (var i = node.attributes.length - 1; i >= 0; i--) {
        var attrName = node.attributes[i].name;
        if (/^on/i.test(attrName)) node.removeAttribute(attrName);
      }
    });

    return wrapper.innerHTML;
  }

  function fetchProductData(handle, cb) {
    if (!handle) {
      cb(new Error('Missing product handle'), null);
      return;
    }

    if (productDataCache[handle]) {
      cb(null, productDataCache[handle]);
      return;
    }

    if (productDataPending[handle]) {
      productDataPending[handle].push(cb);
      return;
    }

    productDataPending[handle] = [cb];

    fetch('/products/' + handle + '.js')
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load product details');
        return r.json();
      })
      .then(function (data) {
        var normalized = {
          descriptionHtml: sanitizeProductDescriptionHtml(data && data.description),
          variants: (data && data.variants ? data.variants : []).map(function (v) {
            return {
              id: String(v.id),
              title: v.title,
              available: v.available,
              // Shopify product JSON returns variant prices in the smallest unit.
              price: v.price != null ? (parseFloat(v.price) / 100) : null,
              compareAtPrice: v.compare_at_price != null ? (parseFloat(v.compare_at_price) / 100) : null,
            };
          }),
        };

        productDataCache[handle] = normalized;

        var queued = productDataPending[handle] || [];
        delete productDataPending[handle];
        queued.forEach(function (done) { done(null, normalized); });
      })
      .catch(function (err) {
        var queued = productDataPending[handle] || [];
        delete productDataPending[handle];
        queued.forEach(function (done) { done(err, null); });
      });
  }

  function ensureProductDescriptionModal() {
    if (_productDescriptionModal) return _productDescriptionModal;

    var overlay = document.createElement('div');
    overlay.className = 'cb-product-modal';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    var dialog = document.createElement('div');
    dialog.className = 'cb-product-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cb-product-modal-title');
    dialog.addEventListener('click', function (e) { e.stopPropagation(); });

    var header = document.createElement('div');
    header.className = 'cb-product-modal-header';

    var title = document.createElement('h3');
    title.className = 'cb-product-modal-title';
    title.id = 'cb-product-modal-title';
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cb-product-modal-close';
    closeBtn.setAttribute('aria-label', 'Close description popup');
    closeBtn.innerHTML = '&times;';
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'cb-product-modal-body';

    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', closeProductDescriptionModal);
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeProductDescriptionModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _productDescriptionModal && !_productDescriptionModal.hidden) {
        closeProductDescriptionModal();
      }
    });

    document.body.appendChild(overlay);

    _productDescriptionModal = overlay;
    _productDescriptionModalTitle = title;
    _productDescriptionModalBody = body;
    _productDescriptionModalCloseBtn = closeBtn;

    return _productDescriptionModal;
  }

  function closeProductDescriptionModal() {
    if (!_productDescriptionModal || _productDescriptionModal.hidden) return;

    _productDescriptionModal.hidden = true;
    _productDescriptionModal.setAttribute('aria-hidden', 'true');
    _productDescriptionModal.removeAttribute('data-cb-instance');
    document.body.style.overflow = _productDescriptionModalBodyOverflow;

    if (
      _productDescriptionModalLastFocus &&
      typeof _productDescriptionModalLastFocus.focus === 'function'
    ) {
      _productDescriptionModalLastFocus.focus();
    }
  }

  function openProductDescriptionModal(product, triggerEl, rootEl) {
    if (!product || !product.productHandle) return;

    var modal = ensureProductDescriptionModal();
    var blockId = rootEl &&
      (rootEl.getAttribute('data-cb-instance') || rootEl.getAttribute('data-block-id'));
    var requestToken = ++_productDescriptionModalRequestToken;

    _productDescriptionModalLastFocus = triggerEl || document.activeElement;
    _productDescriptionModalBodyOverflow = document.body.style.overflow;
    _productDescriptionModalTitle.textContent = product.productTitle || 'Product details';
    _productDescriptionModalBody.innerHTML =
      '<p class="cb-product-modal-loading">Loading description...</p>';

    if (blockId) modal.setAttribute('data-cb-instance', blockId);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    if (product.productDescriptionResolved) {
      _productDescriptionModalBody.innerHTML = product.productDescriptionHtml ||
        '<p class="cb-product-modal-empty">No description available for this product.</p>';
      if (_productDescriptionModalCloseBtn) _productDescriptionModalCloseBtn.focus();
      return;
    }

    fetchProductData(product.productHandle, function (err, data) {
      if (requestToken !== _productDescriptionModalRequestToken) return;

      product.productDescriptionResolved = !err;
      product.productDescriptionHtml =
        !err && data && data.descriptionHtml
          ? data.descriptionHtml
          : '';

      _productDescriptionModalBody.innerHTML = product.productDescriptionHtml ||
        '<p class="cb-product-modal-empty">No description available for this product.</p>';

      if (_productDescriptionModalCloseBtn) _productDescriptionModalCloseBtn.focus();
    });
  }

  function fetchVariants(handle, allowedVariantIds, cb) {
    function applyAllowedFilter(variants) {
      var all = Array.isArray(variants) ? variants.slice() : [];
      // Historical boxes may contain only one saved variant ID for multi-variant products.
      // Only enforce allow-list filtering when there is an explicit multi-variant allow-list.
      if (allowedVariantIds && allowedVariantIds.length > 1) {
        var allowed = allowedVariantIds.map(String);
        all = all.filter(function (v) { return allowed.indexOf(v.id) !== -1; });
      }
      return all;
    }

    fetchProductData(handle, function (err, productData) {
      if (err) {
        cb(err, null);
        return;
      }
      cb(null, applyAllowedFilter(productData.variants));
    });
  }

  function showVariantPicker(card, product, addBtn, blockedVariantIds, cb) {
    addBtn.style.display = 'none';

    var picker = document.createElement('div');
    picker.className = 'cb-variant-picker';
    card.insertBefore(picker, addBtn);
    card.classList.add('cb-product-card--picking');

    var titleEl = document.createElement('div');
    titleEl.className = 'cb-variant-picker-title';
    titleEl.textContent = 'Select option:';
    picker.appendChild(titleEl);

    var loadingEl = document.createElement('span');
    loadingEl.className = 'cb-variant-picker-loading';
    loadingEl.textContent = 'Loading…';
    picker.appendChild(loadingEl);

    function closePicker() {
      card.classList.remove('cb-product-card--picking');
      if (picker.parentNode) picker.parentNode.removeChild(picker);
      addBtn.style.display = '';
    }

    fetchVariants(product.productHandle, product.variantIds, function (err, variants) {
      if (picker.contains(loadingEl)) picker.removeChild(loadingEl);

      var blockedSet = {};
      (blockedVariantIds || []).forEach(function (id) {
        blockedSet[String(id)] = true;
      });

      if (err || !variants || variants.length === 0) {
        closePicker();
        cb(
          product.variantIds && product.variantIds[0] ? product.variantIds[0] : null,
          '',
          product.productPrice,
          product.productCompareAtPrice
        );
        return;
      }

      if (variants.length === 1) {
        var only = variants[0];
        var onlyBlocked = !!blockedSet[String(only.id)];
        if (!onlyBlocked && only.available) {
          closePicker();
          cb(
            only.id,
            only.title !== 'Default Title' ? only.title : '',
            only.price,
            only.compareAtPrice
          );
          return;
        }
      }

      var btnsDiv = document.createElement('div');
      btnsDiv.className = 'cb-variant-btns';
      var selectableCount = 0;
      variants.forEach(function (v) {
        var isBlocked = !!blockedSet[String(v.id)];
        var isUnavailable = !v.available;
        var isDisabled = isBlocked || isUnavailable;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cb-variant-btn' +
          (isUnavailable ? ' cb-variant-btn--oos' : '') +
          (isBlocked ? ' cb-variant-btn--selected' : '');
        btn.textContent = v.title;
        if (isDisabled) {
          btn.disabled = true;
          btn.title = isBlocked ? 'Already selected in this box' : 'Out of stock';
        } else {
          selectableCount++;
        }
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (isDisabled) return;
          closePicker();
          cb(
            v.id,
            v.title !== 'Default Title' ? v.title : '',
            v.price,
            v.compareAtPrice
          );
        });
        btnsDiv.appendChild(btn);
      });
      picker.appendChild(btnsDiv);

      if (selectableCount === 0) {
        var emptyEl = document.createElement('div');
        emptyEl.className = 'cb-variant-picker-loading';
        emptyEl.textContent = 'All variants are already selected.';
        picker.appendChild(emptyEl);
      }

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'cb-variant-cancel-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); closePicker(); });
      picker.appendChild(cancelBtn);
    });
  }

  // ─── Sticky Footer singleton ──────────────────────────────────────────────────
  var _stickyEl = null;
  var _stickyBtn = null;
  var _stickySavingsEl = null;
  var _stickyTotalEl = null;
  var _drawerScrollRecoveryBound = false;
  var _pageLoaderEl = null;
  var _pageLoaderActiveCount = 0;

  function removeStickyFooter() {
    if (_stickyEl && _stickyEl.parentNode) {
      _stickyEl.parentNode.removeChild(_stickyEl);
      document.body.style.paddingBottom = '';
    }
    _stickyEl = null;
    _stickyBtn = null;
    _stickySavingsEl = null;
    _stickyTotalEl = null;
  }

  function ensurePageLoader() {
    if (_pageLoaderEl) return _pageLoaderEl;

    var overlay = document.createElement('div');
    overlay.className = 'cb-page-loader';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    var panel = document.createElement('div');
    panel.className = 'cb-page-loader-panel';

    var spinner = document.createElement('span');
    spinner.className = 'combo-builder-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    panel.appendChild(spinner);

    var text = document.createElement('span');
    text.className = 'cb-page-loader-text';
    text.id = 'cb-page-loader-text';
    panel.appendChild(text);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    _pageLoaderEl = overlay;
    return _pageLoaderEl;
  }

  function showPageLoader(text) {
    var overlay = ensurePageLoader();
    var textEl = overlay.querySelector('#cb-page-loader-text');
    if (textEl) textEl.textContent = text || '';
    _pageLoaderActiveCount++;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hidePageLoader(force) {
    if (!_pageLoaderEl) return;
    if (force) _pageLoaderActiveCount = 0;
    else _pageLoaderActiveCount = Math.max(0, _pageLoaderActiveCount - 1);
    if (_pageLoaderActiveCount > 0) return;
    _pageLoaderEl.hidden = true;
    _pageLoaderEl.setAttribute('aria-hidden', 'true');
  }

  function createStickyFooter(box, ctx, onCartClick) {
    removeStickyFooter();

    var footer = document.createElement('div');
    footer.className = 'cb-sticky-footer';

    // Inherit the widget's CSS custom properties so the sticky footer
    // picks up the same dynamic theme set in combo-builder.liquid
    if (ctx.rootEl) {
      var blockId = ctx.rootEl.getAttribute('data-cb-instance') || ctx.rootEl.getAttribute('data-block-id');
      if (blockId) footer.setAttribute('data-cb-instance', blockId);
    }

    // Left: icon + box name
    var left = document.createElement('div');
    left.className = 'cb-sticky-left';
    var icon = document.createElement('span');
    icon.className = 'cb-sticky-icon';
    icon.textContent = box.isGiftBox ? '🎁' : '🛍️';
    left.appendChild(icon);
    var nameEl = document.createElement('div');
    nameEl.className = 'cb-sticky-name';
    nameEl.textContent = box.displayTitle;
    left.appendChild(nameEl);
    footer.appendChild(left);

    // Center: total price + MRP savings
    var center = document.createElement('div');
    center.className = 'cb-sticky-center';
    var totalRow = document.createElement('div');
    totalRow.className = 'cb-sticky-total';
    renderStickyTotal(
      totalRow,
      isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
      ctx.currencySymbol
    );
    center.appendChild(totalRow);
    var savingsRow = document.createElement('div');
    savingsRow.className = 'cb-sticky-savings-row';
    savingsRow.style.display = 'none';
    center.appendChild(savingsRow);
    footer.appendChild(center);
    _stickySavingsEl = savingsRow;

    // Right: action button
    var btn = document.createElement('button');
    btn.className = 'cb-sticky-btn';
    btn.type = 'button';
    btn.disabled = true;
    btn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel);
    btn.addEventListener('click', onCartClick);
    footer.appendChild(btn);

    document.body.appendChild(footer);
    document.body.style.paddingBottom = '72px';

    _stickyEl = footer;
    _stickyBtn = btn;
    _stickyTotalEl = totalRow;
    return btn;
  }

  // ─── Specific Combo: Collection Products Fetcher ──────────────────────────────
  var _collectionProductsCache = {};
  function fetchCollectionProducts(handle, cb) {
    if (_collectionProductsCache[handle]) { cb(null, _collectionProductsCache[handle]); return; }

    var allProds = [];
    var seenIds = {};

    function fetchPage(page) {
      fetch('/collections/' + encodeURIComponent(handle) + '/products.json?limit=250&page=' + page)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var batch = (data.products || []);
          batch.forEach(function (p) {
            if (seenIds[p.id]) return;
            seenIds[p.id] = true;
            var v0 = p.variants && p.variants[0] ? p.variants[0] : null;
            allProds.push({
              productId: p.id ? ('gid://shopify/Product/' + p.id) : null,
              productTitle: p.title,
              productHandle: p.handle,
              productImageUrl: p.images && p.images[0] ? p.images[0].src : null,
              productPrice: v0 ? parseFloat(v0.price) : 0,
              variantIds: (p.variants || []).map(function (v) { return String(v.id); }),
            });
          });
          // If we got a full page of 250, there may be more
          if (batch.length === 250) {
            fetchPage(page + 1);
          } else {
            _collectionProductsCache[handle] = allProds;
            cb(null, allProds);
          }
        })
        .catch(function (err) {
          if (allProds.length > 0) {
            _collectionProductsCache[handle] = allProds;
            cb(null, allProds);
          } else {
            cb(err, null);
          }
        });
    }

    fetchPage(1);
  }

  // ─── Main Widget Init ─────────────────────────────────────────────────────────

  function initWidget(config) {
    var root = document.getElementById(config.mountId);
    if (!root) return;

    var shop = root.dataset.shop || config.shop;
    var currencySymbol = root.dataset.currencySymbol || config.currencySymbol || "$";
    var currencyCode = root.dataset.currency || config.currency || "USD";
    var layout = root.dataset.layout || config.layout || 'grid';
    var layoutMode = root.dataset.layoutMode || config.layoutMode || 'grid';
    var enableStickyCart = parseBooleanSetting(
      root.dataset.enableStickyCart != null ? root.dataset.enableStickyCart : config.enableStickyCart,
      true
    );
    // Theme editor can re-render the block with updated settings while an older
    // sticky footer instance is still mounted. Clear it immediately when sticky
    // cart is disabled so stale CTA bars do not persist.
    if (enableStickyCart === false) {
      removeStickyFooter();
    }
    var apiBase = root.dataset.apiBase || config.apiBase || DEFAULT_API_BASE;
    var previewBoxToken = null;
    try {
      var previewParams = new URLSearchParams(window.location.search || '');
      previewBoxToken = (previewParams.get('cb_preview_box') || '').trim();
    } catch (_) {}

    var boxIdsFilter = null;
    var rawBoxIds = root.dataset.boxIds || config.boxIds || null;
    if (rawBoxIds) {
      boxIdsFilter = String(rawBoxIds).split(',').map(function (id) { return parseInt(id.trim(), 10); }).filter(Boolean);
    }

    // Per-box visibility filter from theme editor (box names, codes, or numeric IDs — comma/newline separated)
    var visibleBoxNames = null;
    var visibleBoxCodes = null;
    var rawVisible = root.dataset.visibleBoxes || config.visibleBoxes || null;
    if (rawVisible && String(rawVisible).trim()) {
      var visTokens = String(rawVisible).split(/[\n,]+/)
        .map(function (t) { return t.trim(); }).filter(Boolean);
      var visIdTokens = [], visNameTokens = [], visCodeTokens = [];
      visTokens.forEach(function (t) {
        var n = parseInt(t, 10);
        if (!isNaN(n) && String(n) === t) {
          visIdTokens.push(n);
        } else if (/^[A-Z0-9]{5}$/.test(t.toUpperCase()) && t.length === 5) {
          // 5-char alphanumeric → treat as boxCode
          visCodeTokens.push(t.toUpperCase());
        } else {
          visNameTokens.push(t.toLowerCase());
        }
      });
      if (visIdTokens.length > 0) {
        boxIdsFilter = (boxIdsFilter || []).concat(visIdTokens);
      }
      if (visNameTokens.length > 0) {
        visibleBoxNames = visNameTokens;
      }
      if (visCodeTokens.length > 0) {
        visibleBoxCodes = visCodeTokens;
      }
    }

    // Current page handle passed from Liquid
    var currentPageHandle = root.dataset.pageHandle || null;

    if (!shop) {
      root.innerHTML = '';
      return;
    }

    root.innerHTML = '<div class="cb-initial-loader"><span class="combo-builder-spinner" aria-hidden="true"></span><span>Loading\u2026</span></div>';

    fetchBoxes(shop, apiBase, function (err, boxes, settings) {
      root.innerHTML = '';
      if (err || !boxes || boxes.length === 0) { return; }
      if (boxIdsFilter && boxIdsFilter.length > 0) {
        boxes = boxes.filter(function (b) { return boxIdsFilter.indexOf(b.id) !== -1; });
      }
      // Filter by visible box names set in theme editor
      if (visibleBoxNames && visibleBoxNames.length > 0) {
        boxes = boxes.filter(function (b) {
          var name = String(b.boxName || b.displayTitle || '').trim().toLowerCase();
          return visibleBoxNames.indexOf(name) !== -1;
        });
      }
      // Filter by box code (5-char unique code)
      if (visibleBoxCodes && visibleBoxCodes.length > 0) {
        boxes = boxes.filter(function (b) {
          return b.boxCode && visibleBoxCodes.indexOf(String(b.boxCode).toUpperCase()) !== -1;
        });
      }
      // Filter by page assignment: show box if pageHandle is null (all pages) or matches current page
      if (currentPageHandle) {
        boxes = boxes.filter(function (b) {
          if (!b.pageHandle) return true; // null = show on all pages
          var ph = String(b.pageHandle).trim();
          if (ph === currentPageHandle) return true;
          // "product" matches any product page; "collection" matches any collection page
          if (ph === 'product' && String(currentPageHandle).indexOf('product:') === 0) return true;
          if (ph === 'collection' && String(currentPageHandle).indexOf('collection:') === 0) return true;
          return false;
        });
      }
      if (boxes.length === 0) { root.innerHTML = ''; return; }
      var previewBoxId = null;
      if (previewBoxToken) {
        var tokLower = String(previewBoxToken).toLowerCase();
        for (var bi = 0; bi < boxes.length; bi++) {
          var pb = boxes[bi] || {};
          var pbCode = pb.boxCode ? String(pb.boxCode).toLowerCase() : '';
          var pbId = pb.id != null ? String(pb.id) : '';
          var pbName = String(pb.boxName || pb.displayTitle || '').trim().toLowerCase();
          if (pbCode === tokLower || pbId === previewBoxToken || pbName === tokLower) {
            previewBoxId = pb.id;
            break;
          }
        }
      }

      var resolvedHeading = root.dataset.heading || config.heading || (settings && settings.widgetHeadingText) || 'Build Your Own Box!';
      if (settings && settings.presetTheme) applyPresetTheme(root, settings.presetTheme);
      if (settings && (!settings.presetTheme || settings.presetTheme === 'custom')) applyCustomColors(root, settings);
      root.style.setProperty(
        '--cb-products-per-row',
        String(normalizeProductCardsPerRow(settings && settings.productCardsPerRow))
      );

      // Apply dynamic max-width from admin settings
      if (settings && settings.widgetMaxWidth != null) {
        var mw = parseInt(settings.widgetMaxWidth, 10);
        if (mw === 0) {
          // Full width: break out of any theme container using viewport units
          root.style.width = '100vw';
          root.style.maxWidth = '100vw';
          root.style.marginLeft = 'calc(50% - 50vw)';
          root.style.marginRight = 'calc(50% - 50vw)';
          root.style.setProperty('--cb-max-width', '100%');
        } else {
          // Specific width: center with max-width on the root itself
          root.style.width = '100%';
          root.style.maxWidth = mw + 'px';
          root.style.marginLeft = 'auto';
          root.style.marginRight = 'auto';
          root.style.setProperty('--cb-max-width', mw + 'px');
        }
      }

      var step1Label = root.dataset.step1Label || config.step1Label || 'Select Box';
      var step2Label = root.dataset.step2Label || config.step2Label || 'Pick Items';
      var step3Label = root.dataset.step3Label || config.step3Label || 'Add to Cart';
      var cartBtnLabel = root.dataset.cartBtnLabel || config.cartBtnLabel || '';
      var checkoutBtnLabel = root.dataset.checkoutBtnLabel || config.checkoutBtnLabel || 'Checkout';
      var step1Heading = root.dataset.step1Heading || config.step1Heading || 'Step 1: Select your box';
      var step2Heading = root.dataset.step2Heading || config.step2Heading || 'Step 2: Select your products';
      var step3Heading = root.dataset.step3Heading || config.step3Heading || 'Step 3: Complete your order';
      var step3Buttons = root.dataset.step3Buttons || config.step3Buttons || 'both';
      renderWidget(root, { shop: shop, boxes: boxes, currencySymbol: currencySymbol, currencyCode: currencyCode, layout: layout, layoutMode: layoutMode, enableStickyCart: enableStickyCart, heading: resolvedHeading, apiBase: apiBase, settings: settings || {}, rootEl: root, step1Label: step1Label, step2Label: step2Label, step3Label: step3Label, cartBtnLabel: cartBtnLabel, checkoutBtnLabel: checkoutBtnLabel, step1Heading: step1Heading, step2Heading: step2Heading, step3Heading: step3Heading, step3Buttons: step3Buttons, previewBoxId: previewBoxId });
    });
  }

  function initLegacyWidget(el) {
    var shop = el.dataset.shop || (window.Shopify && window.Shopify.shop) || null;
    initWidget({
      mountId: el.id,
      shop: shop,
      apiBase: el.dataset.apiBase || DEFAULT_API_BASE,
      currencySymbol: el.dataset.currencySymbol || (window.Shopify && window.Shopify.currency && window.Shopify.currency.symbol) || "$",
      currency: el.dataset.currency || (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "USD",
      layout: el.dataset.layout || 'grid',
      layoutMode: el.dataset.layoutMode || 'grid',
      heading: el.dataset.heading || 'Build Your Own Box!',
      boxIds: el.dataset.boxIds || null,
    });
  }

  // ─── API ──────────────────────────────────────────────────────────────────────

  function fetchBoxes(shop, apiBase, cb) {
    fetch(apiBase + '/api/storefront/boxes?shop=' + encodeURIComponent(shop), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data && Array.isArray(data.boxes)) {
          cb(null, data.boxes.filter(function (b) { return b && b.isActive !== false; }), data.settings || {});
        }
        else if (Array.isArray(data)) cb(null, data.filter(function (b) { return b && b.isActive !== false; }), {});
        else cb(null, [], {});
      })
      .catch(function (e) { cb(e, null, {}); });
  }

  function normalizeShopifyProductId(value) {
    if (value == null) return null;
    var id = String(value).trim();
    if (!id) return null;
    if (id.indexOf('/') !== -1) return id.split('/').pop();
    return id;
  }

  function getInternalBundleProductIds(ctx) {
    var map = {};
    if (!ctx || !Array.isArray(ctx.boxes)) return map;
    ctx.boxes.forEach(function (box) {
      var pid = normalizeShopifyProductId(box && box.shopifyProductId);
      if (pid) map[pid] = true;
    });
    return map;
  }

  function hasInternalComboTag(tagsValue) {
    var tags = [];
    if (Array.isArray(tagsValue)) {
      tags = tagsValue;
    } else if (typeof tagsValue === 'string' && tagsValue.trim()) {
      tags = tagsValue.split(',');
    }
    for (var i = 0; i < tags.length; i++) {
      if (String(tags[i]).trim().toLowerCase() === 'combo-builder-internal') return true;
    }
    return false;
  }

  function shouldExcludeInternalComboProduct(product, internalBundleProductIds) {
    if (!product) return false;
    var pid = normalizeShopifyProductId(product.productId != null ? product.productId : product.id);
    if (pid && internalBundleProductIds && internalBundleProductIds[pid]) return true;

    var vendor = product.vendor != null ? String(product.vendor).trim().toLowerCase() : '';
    if (vendor === 'combobuilder') return true;

    if (hasInternalComboTag(product.tags)) return true;
    return false;
  }

  function filterInternalComboProducts(products, ctx) {
    if (!Array.isArray(products) || products.length === 0) return [];
    var internalBundleProductIds = getInternalBundleProductIds(ctx);
    return products.filter(function (product) {
      return !shouldExcludeInternalComboProduct(product, internalBundleProductIds);
    });
  }

  var _wholeStoreProductsCache = null;
  function fetchWholeStoreProducts(cb) {
    if (Array.isArray(_wholeStoreProductsCache)) { cb(null, _wholeStoreProductsCache); return; }

    var allProds = [];
    var seenIds = {};

    function fetchPage(page) {
      fetch('/products.json?limit=250&page=' + page, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var batch = (data.products || []);
          batch.forEach(function (p) {
            if (seenIds[p.id]) return;
            seenIds[p.id] = true;
            var v0 = p.variants && p.variants[0] ? p.variants[0] : null;
            allProds.push({
              productId: p.id ? ('gid://shopify/Product/' + p.id) : null,
              productTitle: p.title || '',
              productHandle: p.handle || '',
              productImageUrl: p.images && p.images[0] ? p.images[0].src : null,
              productPrice: v0 ? parseFloat(v0.price) : 0,
              variantIds: (p.variants || []).map(function (v) { return String(v.id); }),
              isCollection: false,
              vendor: p.vendor || '',
              tags: p.tags || '',
            });
          });
          if (batch.length === 250) {
            fetchPage(page + 1);
          } else {
            _wholeStoreProductsCache = allProds;
            cb(null, allProds);
          }
        })
        .catch(function (err) {
          if (allProds.length > 0) {
            _wholeStoreProductsCache = allProds;
            cb(null, allProds);
          } else {
            cb(err, null);
          }
        });
    }

    fetchPage(1);
  }

  function fetchProducts(boxId, shop, apiBase, scopeType, ctx, cb) {
    if (scopeType === 'wholestore') {
      fetchWholeStoreProducts(function (err, products) {
        if (err) {
          cb(err, null);
          return;
        }
        cb(null, filterInternalComboProducts(products, ctx));
      });
      return;
    }
    fetch(apiBase + '/api/storefront/boxes/' + boxId + '/products?shop=' + encodeURIComponent(shop), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { cb(null, filterInternalComboProducts(data, ctx)); })
      .catch(function (e) { cb(e, null); });
  }

  // ─── Render Widget ────────────────────────────────────────────────────────────

  function renderWidget(root, ctx) {
    root.innerHTML = '';
    root.className = 'combo-builder-root cb-loaded';

    var wrapper = document.createElement('div');
    wrapper.className = 'cb-wrapper';

    // ── Steps Mode: 3-stage wizard progress bar ──────────────────────────────
    if (ctx.layoutMode === 'steps') {
      var wizardEl = document.createElement('div');
      wizardEl.className = 'cb-wizard';
      wizardEl.setAttribute('aria-label', 'Build Your Box progress');

      // Header: title + change-box action
      var wizardHeader = document.createElement('div');
      wizardHeader.className = 'cb-wizard-header';

      var wizardTitle = document.createElement('div');
      wizardTitle.className = 'cb-wizard-title';
      wizardTitle.textContent = 'Build Your Box';
      wizardHeader.appendChild(wizardTitle);

      var wizardChangeBtn = document.createElement('button');
      wizardChangeBtn.type = 'button';
      wizardChangeBtn.className = 'cb-change-box-btn';
      wizardChangeBtn.innerHTML = '&#8592; Back';
      wizardChangeBtn.style.visibility = 'hidden';
      wizardHeader.insertBefore(wizardChangeBtn, wizardTitle);
      ctx._changeBoxBtn = wizardChangeBtn;

      wizardEl.appendChild(wizardHeader);

      // Steps row: [step-wrapper] [line] [step-wrapper] [line] [step-wrapper]
      var stepsRow = document.createElement('div');
      stepsRow.className = 'cb-wizard-steps-row';
      stepsRow.setAttribute('role', 'list');

      var WIZARD_STEP_DEFS = [
        { label: ctx.step1Label || 'Select Box',  description: 'Choose your box',      doneLabel: (ctx.step1Label || 'Select Box') + ' \u2713' },
        { label: ctx.step2Label || 'Pick Items',  description: 'Pick your products',   doneLabel: (ctx.step2Label || 'Pick Items') + ' \u2713' },
        { label: ctx.step3Label || 'Add to Cart', description: 'Add your box to cart', doneLabel: (ctx.step3Label || 'Add to Cart') + ' \u2713' }
      ];
      var wizardDots = [];
      var wizardLines = [];
      var wizardDotEls = [];
      var wizardLabelEls = [];

      WIZARD_STEP_DEFS.forEach(function (def, i) {
        if (i > 0) {
          var line = document.createElement('div');
          line.className = 'cb-wizard-line';
          stepsRow.appendChild(line);
          wizardLines.push(line);
        }

        var stepWrapper = document.createElement('div');
        stepWrapper.className = 'cb-wizard-step-wrapper';
        stepWrapper.setAttribute('role', 'listitem');
        stepWrapper.setAttribute('aria-label', def.description);
        stepWrapper.title = def.description;

        var stepEl = document.createElement('div');
        stepEl.className = 'cb-wizard-step' + (i === 0 ? ' cb-wizard-step--active' : '');
        stepWrapper.appendChild(stepEl);

        var stepLbl = document.createElement('div');
        stepLbl.className = 'cb-wizard-step-label';
        stepLbl.textContent = def.label;
        stepWrapper.appendChild(stepLbl);

        stepsRow.appendChild(stepWrapper);
        wizardDots.push(stepEl);
        wizardDotEls.push(stepEl);
        wizardLabelEls.push(stepLbl);
      });

      wizardEl.appendChild(stepsRow);

      var wizardSelectedPrice = document.createElement('div');
      wizardSelectedPrice.className = 'cb-wizard-selected-price';
      wizardSelectedPrice.style.display = 'none';
      wizardEl.appendChild(wizardSelectedPrice);

      wrapper.appendChild(wizardEl);
      ctx._wizardDots = wizardDots;
      ctx._wizardLines = wizardLines;
      ctx._wizardDotEls = wizardDotEls;
      ctx._wizardLabelEls = wizardLabelEls;
      ctx._wizardStepDefs = WIZARD_STEP_DEFS;
      ctx._wizardSelectedPriceEl = wizardSelectedPrice;
    }

    // Step 1 Heading
    var step1Head = document.createElement('h2');
    step1Head.className = 'cb-step-heading';
    step1Head.textContent = ctx.step1Heading || 'Step 1: Select your box';
    wrapper.appendChild(step1Head);

    // ── Box grid ─────────────────────────────────────────────────────────────────
    var boxGrid = document.createElement('div');
    boxGrid.className = 'cb-box-grid';
    ctx.boxes.forEach(function (box) { boxGrid.appendChild(createBoxCard(box, ctx)); });
    wrapper.appendChild(boxGrid);

    // Store refs so openBuilder can show/hide Step 1 in steps mode
    if (ctx.layoutMode === 'steps') {
      ctx._step1Head = step1Head;
      ctx._boxGrid = boxGrid;
    }

    // ── Builder area ──────────────────────────────────────────────────────────
    var builderArea = document.createElement('div');
    builderArea.className = 'cb-builder-area';
    builderArea.style.display = 'none';
    wrapper.appendChild(builderArea);

    root.appendChild(wrapper);

    // Single box visible: skip Step 1 entirely — hide heading + grid and auto-select
    if (ctx.boxes.length === 1) {
      step1Head.style.display = 'none';
      boxGrid.style.display = 'none';
      var onlyCard = boxGrid.firstElementChild;
      if (onlyCard) onlyCard.click();
      return;
    }

    // Preview mode from admin eye action: auto-open requested box in both grid and steps layouts
    if (tryAutoSelectPreviewBox(boxGrid, ctx)) {
      return;
    }

    // Multiple boxes: auto-select first in grid mode; steps mode waits for user click
    if (ctx.layoutMode !== 'steps') {
      var firstCard = boxGrid.firstElementChild;
      if (firstCard) firstCard.click();
    }
  }

  // ─── Box Card ─────────────────────────────────────────────────────────────────

  function getBoxCardBannerSrc(box, ctx) {
    if (box.bannerImageUrl) return box.bannerImageUrl;
    if (box.hasUploadedBanner) {
      return ctx.apiBase + '/api/storefront/boxes/' + box.id + '/banner';
    }

    var steps = box && box.comboConfig && Array.isArray(box.comboConfig.steps)
      ? box.comboConfig.steps
      : [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] && steps[i].stepImageUrl) return steps[i].stepImageUrl;
    }

    return null;
  }

  function createBoxCard(box, ctx) {
    var card = document.createElement('div');
    card.className = 'cb-box-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-box-id', String(box.id));

    // Banner image (no overlay title)
    var banner = document.createElement('div');
    banner.className = 'cb-box-banner';
    var bannerSrc = getBoxCardBannerSrc(box, ctx);
    if (bannerSrc) {
      banner.style.backgroundImage = 'url("' + bannerSrc + '")';
      banner.style.backgroundSize = 'cover';
      banner.style.backgroundPosition = 'center';
    }

    // Subtle dark scrim (no text)
    var overlay = document.createElement('div');
    overlay.className = 'cb-box-banner-overlay';
    banner.appendChild(overlay);

    card.appendChild(banner);

    // Gift badge — top-left corner of card
    if (box.isGiftBox) {
      var giftTag = document.createElement('span');
      giftTag.className = 'cb-gift-tag';
      giftTag.textContent = 'Gift Box';
      card.appendChild(giftTag);
    }

    // Discount badge — top-right corner of card banner
    var _discountCfg = box.comboConfig || {};
    var _discountType = _discountCfg.discountType || 'none';
    var _discountValue = parseFloat(_discountCfg.discountValue) || 0;
    var _hasDiscount = isDynamicBundlePrice(box) && (_discountType === 'buy_x_get_y' || (_discountType !== 'none' && _discountValue > 0));
    if (_hasDiscount) {
      var discountBadge = document.createElement('span');
      discountBadge.className = 'cb-discount-badge';
      if (_discountType === 'buy_x_get_y') {
        var _buyQty = Math.max(1, parseInt(String(_discountCfg.buyQuantity || 1), 10) || 1);
        var _getQty = Math.max(1, parseInt(String(_discountCfg.getQuantity || 1), 10) || 1);
        discountBadge.textContent = 'BUY ' + _buyQty + ' GET ' + _getQty;
      } else {
        discountBadge.textContent = _discountType === 'percent'
          ? _discountValue + '% OFF'
          : ctx.currencySymbol + _discountValue + ' OFF';
      }
      card.appendChild(discountBadge);
    }

    // Checkmark badge (shown when selected)
    var check = document.createElement('div');
    check.className = 'cb-box-check';
    check.innerHTML = '&#10003;';
    card.appendChild(check);

    // Body text
    var body = document.createElement('div');
    body.className = 'cb-box-body';

    // Display title moved from banner overlay to body
    var titleText = document.createElement('div');
    titleText.className = 'cb-box-display-title';
    titleText.textContent = box.displayTitle || box.boxName || ('Buy ' + box.itemCount);
    body.appendChild(titleText);

    var priceText = document.createElement('div');
    priceText.className = 'cb-box-price-text';
    box._priceTextEl = priceText;
    setBoxCardPrice(
      box,
      isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
      ctx.currencySymbol
    );
    body.appendChild(priceText);

    // CTA button
    var ctaBtn = document.createElement('button');
    ctaBtn.className = 'cb-box-cta-btn';
    ctaBtn.type = 'button';
    ctaBtn.textContent = resolveCtaButtonLabel(ctx.settings, box.ctaButtonLabel);
    body.appendChild(ctaBtn);

    card.appendChild(body);

    function onSelect() {
      document.querySelectorAll('.cb-box-card').forEach(function (c) { c.classList.remove('cb-box-card--active'); });
      card.classList.add('cb-box-card--active');
      openBuilder(box, ctx);
    }

    card.addEventListener('click', onSelect);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
    });

    return card;
  }

  function tryAutoSelectPreviewBox(boxGrid, ctx) {
    if (!ctx || !ctx.previewBoxId || !boxGrid) return false;
    var previewCard = boxGrid.querySelector('.cb-box-card[data-box-id="' + String(ctx.previewBoxId) + '"]');
    if (!previewCard) return false;
    previewCard.click();
    return true;
  }

  // ─── Open Builder ─────────────────────────────────────────────────────────────

  function openBuilder(box, ctx) {
    var wrapper = document.querySelector('.cb-wrapper');
    if (!wrapper) return;
    var builderArea = wrapper.querySelector('.cb-builder-area');
    if (!builderArea) return;

    // Steps mode: hide Step 1 (box grid) and advance wizard
    if (ctx.layoutMode === 'steps') {
      if (ctx._step1Head) ctx._step1Head.style.display = 'none';
      if (ctx._boxGrid) ctx._boxGrid.style.display = 'none';

      // Wire Change box button (pre-created in renderWidget wizard header)
      if (ctx._changeBoxBtn && !ctx._changeBoxBtnWired) {
        ctx._changeBoxBtnWired = true;
        var _cbBtn = ctx._changeBoxBtn;
        _cbBtn.addEventListener('click', function () {
          // Two-level back: if product grid is currently hidden (all slots filled),
          // first go back to showing the product grid. If product grid is already
          // visible, go all the way back to Step 1 (box selection).
          if (ctx._productSection && ctx._productSection.style.display === 'none') {
            ctx._productSection.style.display = '';
            return;
          }

          if (ctx._step1Head) ctx._step1Head.style.display = '';
          if (ctx._boxGrid) ctx._boxGrid.style.display = '';
          builderArea.style.display = 'none';
          builderArea.innerHTML = '';
          ctx._productSection = null;
          ctx._openBoxId = null;
          _cbBtn.style.visibility = 'hidden';
          setWizardSelectedPrice(ctx, null, null);
          if (ctx._wizardStep1Content) ctx._wizardStep1Content.style.display = 'none';
          if (ctx._wizardDots) {
            ctx._wizardDots[0].className = 'cb-wizard-step cb-wizard-step--active';
            ctx._wizardDots[1].className = 'cb-wizard-step';
            ctx._wizardDots[2].className = 'cb-wizard-step';
            if (ctx._wizardLines[0]) ctx._wizardLines[0].className = 'cb-wizard-line';
            if (ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line';
            if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
              ctx._wizardLabelEls.forEach(function (el, i) { el.textContent = ctx._wizardStepDefs[i].label; });
            }
          }
          document.querySelectorAll('.cb-box-card').forEach(function (c) { c.classList.remove('cb-box-card--active'); });
        });
      }
      if (ctx._changeBoxBtn) ctx._changeBoxBtn.style.visibility = 'visible';

      if (ctx._wizardDots) {
        ctx._wizardDots[0].className = 'cb-wizard-step cb-wizard-step--done';
        ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--active';
        ctx._wizardDots[2].className = 'cb-wizard-step';
        if (ctx._wizardLines[0]) ctx._wizardLines[0].className = 'cb-wizard-line cb-wizard-line--done';
        if (ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line';
        if (ctx._wizardLabelEls) {
          var boxTitle = (box.displayTitle || box.boxName || '').slice(0, 20);
          ctx._wizardLabelEls[0].textContent = boxTitle || (ctx._wizardStepDefs ? ctx._wizardStepDefs[0].doneLabel : 'Box Selected');
          if (ctx._wizardStepDefs) ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].label;
          if (ctx._wizardStepDefs) ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
        }
        // Show box image + name in Step 1 box
        if (ctx._wizardStep1Content) {
          var bSrc = getBoxCardBannerSrc(box, ctx);
          if (bSrc && ctx._wizardStep1Img) {
            ctx._wizardStep1Img.src = bSrc;
            ctx._wizardStep1Img.style.display = 'block';
          } else if (ctx._wizardStep1Img) {
            ctx._wizardStep1Img.style.display = 'none';
          }
          if (ctx._wizardStep1Name) {
            ctx._wizardStep1Name.textContent = box.displayTitle || box.boxName || '';
          }
          ctx._wizardStep1Content.style.display = 'flex';
        }
      }
      setWizardSelectedPrice(ctx, box, parseFloat(box.bundlePrice) || 0);
    }

    if (isDynamicBundlePrice(box)) {
      setBoxCardPrice(box, null, ctx.currencySymbol);
    }

    ctx._openBoxId = box.id;

    builderArea.style.display = 'block';
    builderArea.innerHTML = '';

    if (box.comboConfig && Array.isArray(box.comboConfig.steps) && box.comboConfig.steps.length > 0) {
      // Inline grid spinner shown by loadAndRenderGrid inside renderSpecificComboBuilder
      setTimeout(function () {
        renderSpecificComboBuilder(builderArea, box, ctx);
        builderArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } else {
      showPageLoader('Loading products…');
      fetchProducts(box.id, ctx.shop, ctx.apiBase, box.scopeType, ctx, function (err, products) {
        hidePageLoader(true);
        if (ctx._openBoxId !== box.id) return;
        if (err || !products || products.length === 0) {
          builderArea.innerHTML = '<p class="cb-error">Failed to load products. Please reload and try again.</p>';
          return;
        }
        renderBuilder(builderArea, box, products, ctx);
        builderArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // ─── Render Builder ───────────────────────────────────────────────────────────

  function renderBuilder(container, box, products, ctx) {
    container.innerHTML = '';

    var sessionId = generateSessionId();
    var slots = [];
    for (var s = 0; s < box.itemCount; s++) { slots.push(null); }
    var activeSlotIndex = 0;

    // ── Step 2 Heading ──
    var step2Head = document.createElement('h2');
    step2Head.className = 'cb-step-heading';
    step2Head.textContent = ctx.step2Heading || 'Step 2: Select your products';
    container.appendChild(step2Head);

    // ── Slot Steps Row ──
    var slotWrapper = document.createElement('div');
    slotWrapper.className = 'cb-slot-wrapper';

    var slotSteps = document.createElement('div');
    slotSteps.className = 'cb-slot-steps';

    // Inline action button (at end of slot row)
    var inlineCartBtn = document.createElement('button');
    inlineCartBtn.className = 'cb-inline-cart-btn';
    inlineCartBtn.type = 'button';
    inlineCartBtn.disabled = true;
    inlineCartBtn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel);

    function hydrateProductPricing(done) {
      var tasks = products.map(function (p) {
        if (!p || !p.productHandle) return Promise.resolve();
        return new Promise(function (resolve) {
          fetchVariants(p.productHandle, p.variantIds, function (err, variants) {
            if (!err && variants && variants.length > 0) {
              var first = variants[0];
              if ((p.productPrice == null || parseFloat(p.productPrice) <= 0) && first.price != null) {
                p.productPrice = parseFloat(first.price);
              }
              if ((p.productCompareAtPrice == null || parseFloat(p.productCompareAtPrice) <= 0) && first.compareAtPrice != null) {
                p.productCompareAtPrice = parseFloat(first.compareAtPrice);
              }
            }
            resolve();
          });
        });
      });

      Promise.all(tasks).then(function () {
        if (typeof done === 'function') done();
      });
    }

    function renderSlots() {
      slotSteps.innerHTML = '';
      slots.forEach(function (slotProduct, idx) {
        // Connector line between slots
        if (idx > 0) {
          var connector = document.createElement('div');
          connector.className = 'cb-slot-connector';
          slotSteps.appendChild(connector);
        }

        var step = document.createElement('div');
        step.className = 'cb-slot-step';

        if (slotProduct) {
          step.classList.add('cb-slot-step--filled');
        } else if (idx === activeSlotIndex) {
          step.classList.add('cb-slot-step--active');
        }

        // Number / thumbnail inside the step box
        var numEl = document.createElement('div');
        numEl.className = 'cb-slot-step-num';
        if (slotProduct) {
          if (slotProduct.productImageUrl) {
            var thumb = document.createElement('img');
            thumb.src = slotProduct.productImageUrl;
            thumb.alt = slotProduct.productTitle || '';
            thumb.className = 'cb-slot-step-thumb';
            numEl.appendChild(thumb);
          } else {
            numEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
          }
        } else {
          numEl.textContent = idx + 1;
        }
        step.appendChild(numEl);

        // Label below step box
        var labelEl = document.createElement('div');
        labelEl.className = 'cb-slot-step-label';
        var smallText = document.createElement('span');
        smallText.className = 'cb-slot-step-small';
        smallText.textContent = slotProduct ? 'Selected' : 'Select your';
        labelEl.appendChild(smallText);

        var itemLink = document.createElement('div');
        itemLink.className = 'cb-slot-step-item';
        if (slotProduct) {
          var shortTitle = slotProduct.productTitle || ('Item ' + (idx + 1));
          if (slotProduct.selectedVariantTitle) shortTitle += ' · ' + slotProduct.selectedVariantTitle;
          itemLink.textContent = shortTitle.length > 16 ? shortTitle.slice(0, 15) + '…' : shortTitle;
          itemLink.classList.add('cb-slot-step-item--filled');
          // Click to change slot
          ;(function (i) {
            step.style.cursor = 'pointer';
            step.addEventListener('click', function () {
              activeSlotIndex = i;
              renderSlots();
              renderProductGrid();
            });
          })(idx);

          // Remove (×) button
          var removeBtn = document.createElement('button');
          removeBtn.className = 'cb-slot-remove';
          removeBtn.type = 'button';
          removeBtn.setAttribute('aria-label', 'Remove');
          removeBtn.innerHTML = '&times;';
          ;(function (i) {
            removeBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              slots[i] = null;
              activeSlotIndex = i;
              renderSlots();
              renderProductGrid();
              updateCartButton();
            });
          })(idx);
          step.appendChild(removeBtn);
        } else {
          itemLink.textContent = 'Item ' + (idx + 1);
        }
        labelEl.appendChild(itemLink);
        step.appendChild(labelEl);

        slotSteps.appendChild(step);
      });
    }

    renderSlots();

    slotWrapper.appendChild(slotSteps);

    // In steps mode the inline cart button is always hidden — step3CartSection handles the action.
    if (ctx.layoutMode === 'steps') {
      inlineCartBtn.style.display = 'none';
    }
    slotWrapper.appendChild(inlineCartBtn);
    container.appendChild(slotWrapper);

    // ── Steps Mode: Step 3 cart section (hidden until all slots filled) ──
    var step3CartBtn = null;
    var step3CheckoutBtn = null;
    var step3CartSection = null;
    if (ctx.layoutMode === 'steps') {
      step3CartSection = document.createElement('div');
      step3CartSection.className = 'cb-step3-cart';
      step3CartSection.style.display = 'none';

      var step3Head = document.createElement('h2');
      step3Head.className = 'cb-step-heading cb-step3-heading';
      step3Head.textContent = ctx.step3Heading || 'Step 3: Complete your order';
      step3CartSection.appendChild(step3Head);

      var step3Btns = document.createElement('div');
      step3Btns.className = 'cb-step3-buttons';

      var showCart     = ctx.step3Buttons !== 'checkout_only';
      var showCheckout = ctx.step3Buttons !== 'cart_only';

      if (showCart) {
        step3CartBtn = document.createElement('button');
        step3CartBtn.type = 'button';
        step3CartBtn.className = 'cb-step3-cart-btn';
        step3CartBtn.textContent = resolveStepCartButtonLabel(box, ctx);
        step3Btns.appendChild(step3CartBtn);
      }

      if (showCheckout) {
        step3CheckoutBtn = document.createElement('button');
        step3CheckoutBtn.type = 'button';
        step3CheckoutBtn.className = 'cb-step3-checkout-btn';
        step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
        step3Btns.appendChild(step3CheckoutBtn);
      }

      step3CartSection.appendChild(step3Btns);
      slotWrapper.appendChild(step3CartSection);
    }

    // ── Gift Message ──

    // ─── Gift Message ─────────────────────────────────────────────────────────
    var giftInput = null;
    var giftSection = null;
    if (box.giftMessageEnabled) {
      giftSection = document.createElement('div');
      giftSection.className = 'cb-gift-section';
      giftSection.style.display = 'none';
      var giftLabel = document.createElement('label');
      giftLabel.className = 'cb-gift-label';
      giftLabel.textContent = 'Gift Message (optional)';
      giftInput = document.createElement('textarea');
      giftInput.className = 'cb-gift-input';
      giftInput.placeholder = 'Write a personal message...';
      giftInput.rows = 2;
      giftInput.maxLength = 100;
      giftSection.appendChild(giftLabel);
      giftSection.appendChild(giftInput);
      container.appendChild(giftSection);
    }

    // ── Product Section ──
    var productSection = document.createElement('div');
    productSection.className = 'cb-product-section';

    var productLabel = document.createElement('div');
    productLabel.className = 'cb-product-label';
    productSection.appendChild(productLabel);

    var productGrid = document.createElement('div');
    productGrid.className = ctx.layout === 'list' ? 'cb-product-list' : 'cb-product-grid';
    productSection.appendChild(productGrid);
    container.appendChild(productSection);
    ctx._productSection = productSection;

    // ── Update cart button state ──
    function updateCartButton() {
      var filled = slots.filter(Boolean).length;
      var remaining = box.itemCount - filled;
      var allFilled = remaining === 0;
      var addLabel = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel);
      var stepAddLabel = resolveStepCartButtonLabel(box, ctx);

      // Inline button
      inlineCartBtn.disabled = !allFilled;
      if (allFilled) {
        inlineCartBtn.classList.add('cb-inline-cart-btn--ready');
        inlineCartBtn.textContent = addLabel;
      } else {
        inlineCartBtn.classList.remove('cb-inline-cart-btn--ready');
        inlineCartBtn.textContent = addLabel;
      }

      // Sticky footer button
      if (_stickyBtn) {
        _stickyBtn.disabled = !allFilled;
        if (allFilled) {
          _stickyBtn.classList.add('cb-sticky-btn--ready');
          _stickyBtn.textContent = addLabel;
        } else {
          _stickyBtn.classList.remove('cb-sticky-btn--ready');
          _stickyBtn.textContent = addLabel;
        }
      }

      // Gift message visibility
      if (giftSection) giftSection.style.display = allFilled ? 'block' : 'none';

      var hasSelected = false;
      slots.forEach(function (p) {
        if (p) hasSelected = true;
      });
      var totalMrp = getSelectedProductsTotal(slots);
      var isDynamic = isDynamicBundlePrice(box);
      var dynamicBreakdown = isDynamic
        ? getComboDiscountBreakdown(totalMrp, box.comboConfig, slots)
        : { discountedTotal: 0, discountAmount: 0, freeUnits: 0 };
      var dynamicEffectivePrice = isDynamic ? dynamicBreakdown.discountedTotal : 0;

      if (_stickyTotalEl) {
        renderStickyTotal(
          _stickyTotalEl,
          isDynamic ? getDynamicDisplayPrice(dynamicEffectivePrice) : (parseFloat(box.bundlePrice) || 0),
          ctx.currencySymbol
        );
      }

      if (isDynamic) {
        setBoxCardPrice(box, getDynamicDisplayPrice(dynamicEffectivePrice), ctx.currencySymbol);
      }

      setWizardSelectedPrice(
        ctx,
        box,
        isDynamic ? getDynamicDisplayPrice(dynamicEffectivePrice) : (parseFloat(box.bundlePrice) || 0)
      );

      if (_stickySavingsEl) {
        if (isDynamic) {
          var dynSavings = dynamicBreakdown.discountAmount;
          if (hasSelected && dynSavings > 0.005) {
            var dynSavingsBadge = (ctx.settings && ctx.settings.showSavingsBadge)
              ? '<span class="cb-sticky-save">Save ' + formatPrice(dynSavings, ctx.currencySymbol, ctx.currencyCode) + '</span>'
              : '';
            var dynFreeUnitsBadge =
              box && box.comboConfig && box.comboConfig.discountType === 'buy_x_get_y' && dynamicBreakdown.freeUnits > 0
                ? '<span class="cb-sticky-save">Free items: ' + dynamicBreakdown.freeUnits + '</span>'
                : '';
            _stickySavingsEl.innerHTML =
              '<span class="cb-sticky-mrp">MRP: ' + formatPrice(totalMrp, ctx.currencySymbol, ctx.currencyCode) + '</span>' +
              dynSavingsBadge +
              dynFreeUnitsBadge;
            _stickySavingsEl.style.display = 'flex';
          } else {
            _stickySavingsEl.style.display = 'none';
          }
        } else if (hasSelected) {
          var bundlePrice = parseFloat(box.bundlePrice);
          var savingsAmt = totalMrp - bundlePrice;
          var savingsBadge = (ctx.settings && ctx.settings.showSavingsBadge && savingsAmt > 0)
            ? '<span class="cb-sticky-save">Save ' + formatPrice(savingsAmt, ctx.currencySymbol, ctx.currencyCode) + '</span>'
            : '';
          _stickySavingsEl.innerHTML =
            '<span class="cb-sticky-mrp">MRP: ' + formatPrice(totalMrp, ctx.currencySymbol, ctx.currencyCode) + '</span>' +
            savingsBadge;
          _stickySavingsEl.style.display = 'flex';
        } else {
          _stickySavingsEl.style.display = 'none';
        }
      }

      // Steps mode: hide product grid when all filled; enable/disable cart buttons; update wizard dot
      if (ctx.layoutMode === 'steps') {
        var savedScrollY = window.scrollY;
        productSection.style.display = allFilled ? 'none' : '';
        if (step3CartSection) step3CartSection.style.display = allFilled ? '' : 'none';
        if (allFilled) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { window.scrollTo(0, savedScrollY); });
          });
        }
        if (step3CartBtn) {
          step3CartBtn.disabled = !allFilled;
          if (!allFilled) {
            step3CartBtn.classList.remove('cb-step3-cart-btn--loading');
            step3CartBtn.textContent = stepAddLabel;
          }
        }
        if (step3CheckoutBtn) {
          step3CheckoutBtn.disabled = !allFilled;
          if (!allFilled) {
            step3CheckoutBtn.classList.remove('cb-step3-checkout-btn--loading');
            step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
          }
        }
        if (allFilled && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--done';
          setWizardStep2Preview(ctx, slots);
          ctx._wizardDots[2].className = 'cb-wizard-step cb-wizard-step--active';
          if (ctx._wizardLines && ctx._wizardLines[1]) {
            ctx._wizardLines[1].className = 'cb-wizard-line cb-wizard-line--done';
          }
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].doneLabel;
            ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
          }
        } else if (!allFilled && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--active';
                    ctx._wizardDots[2].className = 'cb-wizard-step';
          if (ctx._wizardLines && ctx._wizardLines[1]) {
            ctx._wizardLines[1].className = 'cb-wizard-line';
          }
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].label;
          }
        }
      }
    }

    // ── Product Grid ──
    function renderProductGrid() {
      productLabel.textContent = 'Choose your Item ' + (activeSlotIndex + 1);
      productGrid.innerHTML = '';

      var usedIds = [];
      var usedVariantIdsByProduct = {};
      if (!box.allowDuplicates) {
        slots.forEach(function (p) {
          if (!p) return;
          usedIds.push(p.productId);
          if (p.selectedVariantId) {
            var key = String(p.productId);
            if (!usedVariantIdsByProduct[key]) usedVariantIdsByProduct[key] = [];
            var selectedId = String(p.selectedVariantId);
            if (usedVariantIdsByProduct[key].indexOf(selectedId) === -1) {
              usedVariantIdsByProduct[key].push(selectedId);
            }
          }
        });
      }

      products.forEach(function (product) {
        var isCurrentSlot = slots[activeSlotIndex] && slots[activeSlotIndex].productId === product.productId;
        var variantCapable = !product.isCollection && !!product.productHandle;
        var productVariantIds = Array.isArray(product.variantIds)
          ? product.variantIds.map(function (id) { return String(id); }).filter(Boolean)
          : [];
        var blockedVariantIds = (!box.allowDuplicates && usedVariantIdsByProduct[String(product.productId)])
          ? usedVariantIdsByProduct[String(product.productId)].slice()
          : [];

        var productUsedById = !box.allowDuplicates &&
          usedIds.indexOf(product.productId) !== -1 &&
          !isCurrentSlot;
        var allKnownVariantsUsed = variantCapable &&
          productVariantIds.length > 0 &&
          blockedVariantIds.length >= productVariantIds.length &&
          !isCurrentSlot;

        // When duplicate products are disabled, block the whole product card once the
        // product is already selected in another slot. Variant selection still applies
        // for the initial add, but the same product cannot be added a second time.
        var isUsed = productUsedById || allKnownVariantsUsed;

        var card = document.createElement('div');
        card.className = 'cb-product-card';
        if (isCurrentSlot) {
          card.classList.add('cb-product-card--current');
        } else if (isUsed) {
          card.classList.add('cb-product-card--used');
        }
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        // Image wrap
        var imgWrap = document.createElement('div');
        imgWrap.className = 'cb-product-img-wrap';
        if (product.productImageUrl) {
          var img = document.createElement('img');
          img.src = product.productImageUrl;
          img.alt = product.productTitle || '';
          img.className = 'cb-product-img';
          img.loading = 'lazy';
          imgWrap.appendChild(img);
        } else {
          var ph = document.createElement('div');
          ph.className = 'cb-product-img-placeholder';
          ph.textContent = (product.productTitle || '?').charAt(0).toUpperCase();
          imgWrap.appendChild(ph);
        }

        // "Used" overlay when added
        if (isUsed) {
          var usedOverlay = document.createElement('div');
          usedOverlay.className = 'cb-product-used-overlay';
          usedOverlay.innerHTML = '<span>&#10003;</span>';
          imgWrap.appendChild(usedOverlay);
        }

        card.appendChild(imgWrap);

        // Mutable selected-variant state for this card (updated by inline select)
        var selVarId = null;
        var selVarTitle = null;
        var selVarPrice = product.productPrice != null ? parseFloat(product.productPrice) : null;
        var selVarCompare = product.productCompareAtPrice != null ? parseFloat(product.productCompareAtPrice) : null;

        // Product info area
        var infoEl = document.createElement('div');
        infoEl.className = 'cb-product-info';

        var titleRow = document.createElement('div');
        titleRow.className = 'cb-product-title-row';

        var titleEl = document.createElement('div');
        titleEl.className = 'cb-product-title';
        titleEl.textContent = product.productTitle || product.productId;
        titleRow.appendChild(titleEl);

        if (product.productHandle && !product.isCollection) {
          var learnBtn = document.createElement('button');
          learnBtn.type = 'button';
          learnBtn.className = 'cb-product-learn-link';
          learnBtn.innerHTML = '&#9432; Learn';
          learnBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openProductDescriptionModal(product, learnBtn, ctx.rootEl);
          });
          titleRow.appendChild(learnBtn);
        }

        infoEl.appendChild(titleRow);

        // Updatable price + variant row
        var metaRow = document.createElement('div');
        metaRow.className = 'cb-product-meta-row';
        var priceWrap = document.createElement('span');
        priceWrap.className = 'cb-product-price-wrap';
        if (ctx.settings && ctx.settings.showProductPrices === false) priceWrap.style.display = 'none';
        metaRow.appendChild(priceWrap);

        var metaActions = document.createElement('div');
        metaActions.className = 'cb-product-meta-actions';
        metaRow.appendChild(metaActions);

        function renderPriceWrap(price, compareAt) {
          priceWrap.innerHTML = '';
          var sp = price != null ? parseFloat(price) : null;
          var cp = compareAt != null ? parseFloat(compareAt) : null;
          if (sp && sp > 0) {
            var pEl = document.createElement('span');
            pEl.className = 'cb-product-price';
            pEl.textContent = formatPrice(sp, ctx.currencySymbol, ctx.currencyCode);
            priceWrap.appendChild(pEl);
            if (cp && cp > sp) {
              var cEl = document.createElement('span');
              cEl.className = 'cb-product-compare-price';
              cEl.textContent = formatPrice(cp, ctx.currencySymbol, ctx.currencyCode);
              priceWrap.appendChild(cEl);
            }
          }
        }

        renderPriceWrap(selVarPrice, selVarCompare);
        infoEl.appendChild(metaRow);
        card.appendChild(infoEl);

        // ── Inline variant select (shown directly on card, no popup) ──
        if (!product.isCollection && product.productHandle) {
          var selectWrap = document.createElement('div');
          selectWrap.className = 'cb-variant-select-wrap';
          selectWrap.style.display = 'none';

          var variantSelect = document.createElement('select');
          variantSelect.className = 'cb-variant-select';
          // Stop card click from firing when interacting with select
          variantSelect.addEventListener('click', function (e) { e.stopPropagation(); });
          variantSelect.addEventListener('change', function (e) {
            e.stopPropagation();
            var cachedVariants = variantSelect._cbVariants || [];
            for (var vi = 0; vi < cachedVariants.length; vi++) {
              if (String(cachedVariants[vi].id) === variantSelect.value) {
                selVarId    = cachedVariants[vi].id;
                selVarPrice = cachedVariants[vi].price;
                selVarCompare = cachedVariants[vi].compareAtPrice;
                selVarTitle = cachedVariants[vi].title !== 'Default Title' ? cachedVariants[vi].title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
                break;
              }
            }
          });

          selectWrap.appendChild(variantSelect);
          metaActions.appendChild(selectWrap);

          // Load variants and populate select asynchronously
          ;(function (sel, wrap, blockedForLoad) {
            fetchVariants(product.productHandle, product.variantIds, function (err, variants) {
              if (err || !variants || variants.length === 0) return;

              // Single variant — set state silently, no select needed
              if (variants.length === 1) {
                var v0 = variants[0];
                selVarId = v0.id;
                if (v0.price != null) { selVarPrice = v0.price; selVarCompare = v0.compareAtPrice; }
                selVarTitle = v0.title !== 'Default Title' ? v0.title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
                return;
              }

              // Multiple variants — build select options
              sel.innerHTML = '';
              sel._cbVariants = variants;
              var blockedSet = {};
              (blockedForLoad || []).forEach(function (id) { blockedSet[String(id)] = true; });

              var firstAvailable = null;
              variants.forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = v.id;
                var label = v.title;
                if (!v.available) { opt.disabled = true; label += ' — Out of stock'; }
                else if (blockedSet[String(v.id)]) { opt.disabled = true; label += ' — Already in box'; }
                opt.textContent = label;
                sel.appendChild(opt);
                if (!firstAvailable && v.available && !blockedSet[String(v.id)]) firstAvailable = v;
              });

              if (firstAvailable) {
                sel.value = firstAvailable.id;
                selVarId    = firstAvailable.id;
                selVarPrice = firstAvailable.price;
                selVarCompare = firstAvailable.compareAtPrice;
                selVarTitle = firstAvailable.title !== 'Default Title' ? firstAvailable.title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
              }

              wrap.style.display = '';
            });
          })(variantSelect, selectWrap, blockedVariantIds);
        }

        // ADD TO BOX / REMOVE FROM BOX button
        var addBtn = document.createElement('button');
        var stepCfg = box && box.comboConfig && Array.isArray(box.comboConfig.steps)
          ? (box.comboConfig.steps[activeSlotIndex] || null)
          : null;
        var productGridBtnLabel = resolveStepSelectionButtonLabel(stepCfg, box, ctx.settings);
        addBtn.type = 'button';
        if (isCurrentSlot || isUsed) {
          addBtn.className = 'cb-add-btn cb-add-btn--remove';
          addBtn.innerHTML = '&times; REMOVE FROM BOX';
        } else {
          addBtn.className = 'cb-add-btn';
          addBtn.textContent = productGridBtnLabel;
        }

        card.appendChild(addBtn);

        if (isCurrentSlot) {
          ;(function (aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              slots[activeSlotIndex] = null;
              renderSlots();
              renderProductGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(addBtn);
        } else if (isUsed) {
          ;(function (p, aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              for (var si = 0; si < slots.length; si++) {
                if (slots[si] && slots[si].productId === p.productId) {
                  slots[si] = null;
                  activeSlotIndex = si;
                  break;
                }
              }
              renderSlots();
              renderProductGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(product, addBtn);
        } else {
          ;(function (p, aBtn, blockedVariantIdsForProduct) {
            function doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice) {
              aBtn.textContent = '\u2713 ' + productGridBtnLabel;
              aBtn.classList.add('cb-add-btn--added');

              var resolvedPrice = p.productPrice;
              if (variantPrice != null && parseFloat(variantPrice) > 0) {
                resolvedPrice = parseFloat(variantPrice);
              }

              var resolvedCompareAtPrice = p.productCompareAtPrice;
              if (variantCompareAtPrice != null && parseFloat(variantCompareAtPrice) > 0) {
                resolvedCompareAtPrice = parseFloat(variantCompareAtPrice);
              }

              slots[activeSlotIndex] = {
                productId: p.productId,
                productTitle: p.productTitle,
                productImageUrl: p.productImageUrl,
                productHandle: p.productHandle,
                productPrice: resolvedPrice,
                productCompareAtPrice: resolvedCompareAtPrice,
                variantIds: p.variantIds,
                isCollection: p.isCollection,
                selectedVariantId: variantId || null,
                selectedVariantTitle: variantTitle || null,
              };

              var next = -1;
              for (var i = activeSlotIndex + 1; i < slots.length; i++) {
                if (!slots[i]) { next = i; break; }
              }
              if (next === -1) {
                for (var j = 0; j < activeSlotIndex; j++) {
                  if (!slots[j]) { next = j; break; }
                }
              }
              if (next !== -1) activeSlotIndex = next;

              renderSlots();
              renderProductGrid();
              updateCartButton();
            }

            function onProductClick() {
              if (p.isCollection || !p.productHandle) {
                // Collection or no handle — add directly with fallback variant
                var fallbackId = p.variantIds && p.variantIds[0] ? String(p.variantIds[0]) : null;
                if (!box.allowDuplicates && fallbackId && blockedVariantIdsForProduct && blockedVariantIdsForProduct.indexOf(fallbackId) !== -1) return;
                doAddToSlot(fallbackId, null, p.productPrice, p.productCompareAtPrice);
              } else if (selVarId) {
                // Use variant already selected in the inline dropdown
                if (!box.allowDuplicates && blockedVariantIdsForProduct && blockedVariantIdsForProduct.indexOf(String(selVarId)) !== -1) return;
                doAddToSlot(selVarId, selVarTitle, selVarPrice, selVarCompare);
              } else {
                // Variants still loading — fall back to popup picker
                showVariantPicker(card, p, aBtn, blockedVariantIdsForProduct, function (variantId, variantTitle, variantPrice, variantCompareAtPrice) {
                  if (!variantId) return;
                  doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice);
                });
              }
            }

            aBtn.addEventListener('click', function (e) { e.stopPropagation(); onProductClick(); });
            card.addEventListener('click', onProductClick);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProductClick(); }
            });
          })(product, addBtn, blockedVariantIds);
        }

        productGrid.appendChild(card);
      });
    }

    renderProductGrid();
    updateCartButton();
    hydrateProductPricing(function () {
      renderProductGrid();
      updateCartButton();
    });

    // ── Cart Action ──
    function resetBuilderSelection() {
      setTimeout(function () {
        for (var i = 0; i < slots.length; i++) {
          slots[i] = null;
        }
        activeSlotIndex = 0;

        if (giftInput) giftInput.value = '';

        setBoxCardPrice(
          box,
          isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
          ctx.currencySymbol
        );

        renderSlots();
        renderProductGrid();
        updateCartButton();
      }, 0);
    }

    function doAddToCart() {
      if (slots.filter(Boolean).length < box.itemCount) {
        // Flash empty slots
        var stepEls = slotSteps.querySelectorAll('.cb-slot-step');
        slots.forEach(function (p, idx) {
          if (!p && stepEls[idx * 2]) {
            stepEls[idx * 2].classList.add('cb-slot-step--error');
            setTimeout(function () { stepEls[idx * 2].classList.remove('cb-slot-step--error'); }, 700);
          }
        });
        return;
      }

      // Immediately show loading state on buttons before async resolve
      [inlineCartBtn, _stickyBtn].forEach(function (btn) {
        if (!btn) return;
        btn.disabled = true;
        btn.className = btn === _stickyBtn ? 'cb-sticky-btn cb-sticky-btn--loading' : 'cb-inline-cart-btn cb-inline-cart-btn--loading';
        btn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span class="cb-btn-label">Adding\u2026</span>';
      });
      showPageLoader('Adding products to cart\u2026');

      // Resolve missing variantIds (existing boxes created before the fix)
      var resolvePromises = slots.map(function (p) {
        if (!p || (p.variantIds && p.variantIds.length > 0)) return Promise.resolve();
        if (!p.productHandle) return Promise.resolve();
        return new Promise(function (resolve) {
          fetchProductData(p.productHandle, function (err, productData) {
            if (!err && productData && productData.variants && productData.variants.length > 0) {
              p.variantIds = [String(productData.variants[0].id)];
            }
            resolve();
          });
        });
      });

      Promise.all(resolvePromises).then(function () {
        addToCart(
          box,
          slots,
          sessionId,
          giftInput ? giftInput.value : null,
          inlineCartBtn,
          _stickyBtn,
          resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel),
          ctx.currencySymbol,
          ctx.apiBase,
          ctx.shop,
          resetBuilderSelection
        );
      });
    }

    function doCheckout() {
      if (slots.filter(Boolean).length < box.itemCount) {
        var stepEls = slotSteps.querySelectorAll('.cb-slot-step');
        slots.forEach(function (p, idx) {
          if (!p && stepEls[idx * 2]) {
            stepEls[idx * 2].classList.add('cb-slot-step--error');
            setTimeout(function () { stepEls[idx * 2].classList.remove('cb-slot-step--error'); }, 700);
          }
        });
        return;
      }
      if (step3CheckoutBtn) {
        step3CheckoutBtn.disabled = true;
        step3CheckoutBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span class="cb-btn-label">Processing\u2026</span>';
      }
      showPageLoader('Processing\u2026');
      var rp = slots.map(function (p) {
        if (!p || (p.variantIds && p.variantIds.length > 0)) return Promise.resolve();
        if (!p.productHandle) return Promise.resolve();
        return new Promise(function (resolve) {
          fetchProductData(p.productHandle, function (err, productData) {
            if (!err && productData && productData.variants && productData.variants.length > 0) {
              p.variantIds = [String(productData.variants[0].id)];
            }
            resolve();
          });
        });
      });
      Promise.all(rp).then(function () {
        addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, step3CheckoutBtn, null, 'Checkout \u2192', ctx.currencySymbol, ctx.apiBase, ctx.shop, null, '/checkout');
      });
    }

    inlineCartBtn.addEventListener('click', doAddToCart);

    // Steps mode: wire step3 buttons with immediate spinner
    if (ctx.layoutMode === 'steps') {
      if (step3CartBtn) {
        step3CartBtn.addEventListener('click', function () {
          if (slots.filter(Boolean).length < box.itemCount) return;
          step3CartBtn.disabled = true;
          step3CartBtn.classList.add('cb-step3-cart-btn--loading');
          step3CartBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Adding\u2026</span>';
          if (step3CheckoutBtn) step3CheckoutBtn.disabled = true;
          doAddToCart();
        });
      }
      if (step3CheckoutBtn) {
        step3CheckoutBtn.addEventListener('click', function () {
          if (slots.filter(Boolean).length < box.itemCount) return;
          step3CheckoutBtn.disabled = true;
          step3CheckoutBtn.classList.add('cb-step3-checkout-btn--loading');
          step3CheckoutBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Checkout\u2026</span>';
          if (step3CartBtn) step3CartBtn.disabled = true;
          doCheckout();
        });
      }
    }

    removeStickyFooter();
    if (ctx.enableStickyCart !== false) {
      createStickyFooter(box, ctx, doAddToCart);
    }
    updateCartButton();
  }

  // ─── Specific Combo Builder ────────────────────────────────────────────────────
  // Same slot-box + product-grid UI as standard combo, but each slot draws
  // products from its own step config (selectedProducts or collections).

  function renderSpecificComboBuilder(container, box, ctx) {
    container.innerHTML = '';

    var comboConfig = box.comboConfig;
    var numSteps = comboConfig.comboType || comboConfig.steps.length;
    var steps = comboConfig.steps.slice(0, numSteps);

    // Pad steps array to numSteps with safe defaults if the stored config has fewer entries
    // (can happen when a box was saved as 2-step and later changed to 3-step)
    while (steps.length < numSteps) {
      steps.push({ label: 'Item ' + (steps.length + 1), optional: false, scope: 'collection', collections: [], selectedProducts: [] });
    }

    var sessionId = generateSessionId();

    var slots = [];
    for (var si = 0; si < numSteps; si++) slots.push(null);
    var activeSlotIndex = 0;

    function isOptionalStep(stepCfg) {
      if (!stepCfg) return false;
      return stepCfg.optional === true || String(stepCfg.optional).toLowerCase() === 'true';
    }

    function getRequiredStepIndexes() {
      var required = [];
      for (var i = 0; i < numSteps; i++) {
        if (!isOptionalStep(steps[i])) required.push(i);
      }
      return required;
    }

    function areRequiredStepsFilled() {
      var required = getRequiredStepIndexes();
      if (required.length === 0) return slots.some(Boolean);
      for (var i = 0; i < required.length; i++) {
        if (!slots[required[i]]) return false;
      }
      return true;
    }

    // Specific combo should follow forward step flow only.
    // Do not wrap to previous empty steps (prevents jumping backwards after Skip).
    function findNextEmptySlot(currentIdx) {
      for (var i = currentIdx + 1; i < slots.length; i++) {
        if (!slots[i]) return i;
      }
      return -1;
    }

    // Per-step product cache (keyed by step index)
    var stepProductsCache = {};

    // ── Step 2 Heading ──
    var step2Head = document.createElement('h2');
    step2Head.className = 'cb-step-heading';
    step2Head.textContent = ctx.step2Heading || ('Step 2: ' + (comboConfig.title || 'Select your products'));
    container.appendChild(step2Head);

    if (comboConfig.highlightText) {
      var highlightEl = document.createElement('div');
      highlightEl.style.display = 'inline-flex';
      highlightEl.style.alignItems = 'center';
      highlightEl.style.padding = '4px 10px';
      highlightEl.style.marginBottom = '8px';
      highlightEl.style.borderRadius = '999px';
      highlightEl.style.fontSize = '11px';
      highlightEl.style.fontWeight = '700';
      highlightEl.style.letterSpacing = '0.03em';
      highlightEl.style.background = 'rgba(17,24,39,0.06)';
      highlightEl.style.color = '#111827';
      highlightEl.textContent = comboConfig.highlightText;
      container.appendChild(highlightEl);
    }

    if (comboConfig.subtitle) {
      var subEl = document.createElement('p');
      subEl.className = 'cb-combo-subtitle';
      subEl.textContent = comboConfig.subtitle;
      container.appendChild(subEl);
    }

    if (comboConfig.supportText) {
      var supportEl = document.createElement('p');
      supportEl.style.margin = '0 0 12px';
      supportEl.style.fontSize = '12px';
      supportEl.style.color = 'var(--cb-text-muted)';
      supportEl.textContent = comboConfig.supportText;
      container.appendChild(supportEl);
    }

    // ── Slot Steps Row (identical to renderBuilder) ──
    var slotWrapper = document.createElement('div');
    slotWrapper.className = 'cb-slot-wrapper';

    var slotSteps = document.createElement('div');
    slotSteps.className = 'cb-slot-steps';

    var inlineCartBtn = document.createElement('button');
    inlineCartBtn.className = 'cb-inline-cart-btn';
    inlineCartBtn.type = 'button';
    inlineCartBtn.disabled = true;
    inlineCartBtn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel);

    function renderSlots() {
      slotSteps.innerHTML = '';
      slots.forEach(function (slotProduct, idx) {
        if (idx > 0) {
          var connector = document.createElement('div');
          connector.className = 'cb-slot-connector';
          slotSteps.appendChild(connector);
        }

        var step = document.createElement('div');
        step.className = 'cb-slot-step';
        if (slotProduct) {
          step.classList.add('cb-slot-step--filled');
        } else if (idx === activeSlotIndex) {
          step.classList.add('cb-slot-step--active');
        }

        var numEl = document.createElement('div');
        numEl.className = 'cb-slot-step-num';
        if (slotProduct) {
          if (slotProduct.productImageUrl) {
            var thumb = document.createElement('img');
            thumb.src = slotProduct.productImageUrl;
            thumb.alt = slotProduct.productTitle || '';
            thumb.className = 'cb-slot-step-thumb';
            numEl.appendChild(thumb);
          } else {
            numEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
          }
        } else {
          numEl.textContent = idx + 1;
        }
        step.appendChild(numEl);

        var labelEl = document.createElement('div');
        labelEl.className = 'cb-slot-step-label';
        var smallText = document.createElement('span');
        smallText.className = 'cb-slot-step-small';
        smallText.textContent = slotProduct ? 'Selected' : (isOptionalStep(steps[idx]) ? 'Optional' : 'Select your');
        labelEl.appendChild(smallText);

        var itemLink = document.createElement('div');
        itemLink.className = 'cb-slot-step-item';
        if (slotProduct) {
          var shortTitle = slotProduct.productTitle || ('Item ' + (idx + 1));
          if (slotProduct.selectedVariantTitle) shortTitle += ' · ' + slotProduct.selectedVariantTitle;
          itemLink.textContent = shortTitle.length > 16 ? shortTitle.slice(0, 15) + '\u2026' : shortTitle;
          itemLink.classList.add('cb-slot-step-item--filled');
          ;(function (i) {
            step.style.cursor = 'pointer';
            step.addEventListener('click', function () {
              activeSlotIndex = i;
              renderSlots();
              loadAndRenderGrid();
            });
          })(idx);

          var removeBtn = document.createElement('button');
          removeBtn.className = 'cb-slot-remove';
          removeBtn.type = 'button';
          removeBtn.setAttribute('aria-label', 'Remove');
          removeBtn.innerHTML = '&times;';
          ;(function (i) {
            removeBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              slots[i] = null;
              activeSlotIndex = i;
              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            });
          })(idx);
          step.appendChild(removeBtn);
        } else {
          // Use step label if set
          var stepLabel = (steps[idx] && steps[idx].label) ? steps[idx].label : ('Item ' + (idx + 1));
          if (isOptionalStep(steps[idx])) stepLabel += ' (Optional)';
          itemLink.textContent = stepLabel;
          ;(function (i) {
            step.style.cursor = 'pointer';
            step.addEventListener('click', function () {
              activeSlotIndex = i;
              renderSlots();
              loadAndRenderGrid();
            });
          })(idx);
        }
        labelEl.appendChild(itemLink);
        step.appendChild(labelEl);
        slotSteps.appendChild(step);
      });
    }

    renderSlots();
    slotWrapper.appendChild(slotSteps);

    // In steps mode the inline cart button is always hidden — step3CartSection handles the action.
    if (ctx.layoutMode === 'steps') {
      inlineCartBtn.style.display = 'none';
    }
    slotWrapper.appendChild(inlineCartBtn);
    container.appendChild(slotWrapper);

    // ── Step 3: Cart section (steps mode only, hidden until all slots filled) ──
    // Placed immediately after slotWrapper so buttons appear below selected products
    var step3CartSection = null;
    var step3CartBtn = null;
    var step3CheckoutBtn = null;
    if (ctx.layoutMode === 'steps') {
      step3CartSection = document.createElement('div');
      step3CartSection.className = 'cb-step3-cart';
      step3CartSection.style.display = 'none';

      var step3Head = document.createElement('h2');
      step3Head.className = 'cb-step-heading cb-step3-heading';
      step3Head.textContent = ctx.step3Heading || 'Step 3: Complete your order';
      step3CartSection.appendChild(step3Head);

      var step3Btns = document.createElement('div');
      step3Btns.className = 'cb-step3-buttons';

      var showCart     = ctx.step3Buttons !== 'checkout_only';
      var showCheckout = ctx.step3Buttons !== 'cart_only';

      if (showCart) {
        step3CartBtn = document.createElement('button');
        step3CartBtn.type = 'button';
        step3CartBtn.className = 'cb-step3-cart-btn';
        step3CartBtn.textContent = resolveStepCartButtonLabel(box, ctx);
        step3Btns.appendChild(step3CartBtn);
      }

      if (showCheckout) {
        step3CheckoutBtn = document.createElement('button');
        step3CheckoutBtn.type = 'button';
        step3CheckoutBtn.className = 'cb-step3-checkout-btn';
        step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
        step3Btns.appendChild(step3CheckoutBtn);
      }

      step3CartSection.appendChild(step3Btns);
      slotWrapper.appendChild(step3CartSection);
    }

    // ── Product Section ──
    var giftInput = null;
    var giftSection = null;
    if (box.giftMessageEnabled) {
      giftSection = document.createElement('div');
      giftSection.className = 'cb-gift-section';
      giftSection.style.display = 'none';
      var giftLabel = document.createElement('label');
      giftLabel.className = 'cb-gift-label';
      giftLabel.textContent = 'Gift Message (optional)';
      giftInput = document.createElement('textarea');
      giftInput.className = 'cb-gift-input';
      giftInput.placeholder = 'Write a personal message...';
      giftInput.rows = 2;
      giftInput.maxLength = 100;
      giftSection.appendChild(giftLabel);
      giftSection.appendChild(giftInput);
      container.appendChild(giftSection);
    }

    var productSection = document.createElement('div');
    productSection.className = 'cb-product-section';

    var productLabel = document.createElement('div');
    productLabel.className = 'cb-product-label';
    var productLabelContent = document.createElement('div');
    productLabelContent.className = 'cb-product-label-content';
    var productLabelText = document.createElement('span');
    productLabelText.className = 'cb-product-label-text';
    var productLabelDesc = document.createElement('div');
    productLabelDesc.className = 'cb-product-label-desc';
    productLabelDesc.style.display = 'none';
    productLabelContent.appendChild(productLabelText);
    productLabelContent.appendChild(productLabelDesc);
    productLabel.appendChild(productLabelContent);

    var skipStepBtn = document.createElement('button');
    skipStepBtn.type = 'button';
    skipStepBtn.className = 'cb-step-skip-btn';
    skipStepBtn.textContent = 'Skip';
    skipStepBtn.style.display = 'none';
    skipStepBtn.addEventListener('click', function () {
      var stepCfg = steps[activeSlotIndex] || {};
      if (!isOptionalStep(stepCfg)) return;
      slots[activeSlotIndex] = null;
      var next = findNextEmptySlot(activeSlotIndex);
      if (next !== -1) activeSlotIndex = next;
      renderSlots();
      loadAndRenderGrid();
      updateCartButton();
    });
    productLabel.appendChild(skipStepBtn);
    productSection.appendChild(productLabel);

    var productGrid = document.createElement('div');
    productGrid.className = 'cb-product-grid';
    var cols = normalizeProductCardsPerRow(ctx.settings && ctx.settings.productCardsPerRow);
    productGrid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    productSection.appendChild(productGrid);
    container.appendChild(productSection);
    ctx._productSection = productSection;

    // ── Cart button state ──
    function updateCartButton() {
      var filled = slots.filter(Boolean).length;
      var allFilled = filled === numSteps;
      var cartReady = areRequiredStepsFilled();
      var addLabel = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel);
      var stepAddLabel = resolveStepCartButtonLabel(box, ctx);

      inlineCartBtn.disabled = !cartReady;
      if (cartReady) inlineCartBtn.classList.add('cb-inline-cart-btn--ready');
      else inlineCartBtn.classList.remove('cb-inline-cart-btn--ready');
      inlineCartBtn.textContent = addLabel;

      if (_stickyBtn) {
        _stickyBtn.disabled = !cartReady;
        if (cartReady) _stickyBtn.classList.add('cb-sticky-btn--ready');
        else _stickyBtn.classList.remove('cb-sticky-btn--ready');
        _stickyBtn.textContent = addLabel;
      }

      if (giftSection) giftSection.style.display = cartReady ? 'block' : 'none';

      var totalMrp = getSelectedProductsTotal(slots);
      var isDynamic = isDynamicBundlePrice(box);
      var bundlePriceRaw = parseFloat(box.bundlePrice) || 0;
      var dynamicBreakdown = getComboDiscountBreakdown(totalMrp, box.comboConfig, slots);
      var effectivePrice = isDynamic
        ? dynamicBreakdown.discountedTotal
        : bundlePriceRaw;
      if (_stickyTotalEl) {
        renderStickyTotal(
          _stickyTotalEl,
          isDynamic ? getDynamicDisplayPrice(effectivePrice) : effectivePrice,
          ctx.currencySymbol
        );
      }
      setBoxCardPrice(
        box,
        isDynamic ? getDynamicDisplayPrice(effectivePrice) : effectivePrice,
        ctx.currencySymbol
      );
      setWizardSelectedPrice(
        ctx,
        box,
        isDynamic ? getDynamicDisplayPrice(effectivePrice) : effectivePrice
      );

      // Savings / MRP row for specific combo
      if (_stickySavingsEl) {
        var hasAnyProduct = slots.some(Boolean);
        var originalPrice = isDynamic ? totalMrp : bundlePriceRaw;
        var savings = isDynamic ? dynamicBreakdown.discountAmount : Math.max(0, totalMrp - bundlePriceRaw);
        if (hasAnyProduct && savings > 0.005) {
          var savingsBadge = (ctx.settings && ctx.settings.showSavingsBadge)
            ? '<span class="cb-sticky-save">Save ' + formatPrice(savings, ctx.currencySymbol, ctx.currencyCode) + '</span>'
            : '';
          var freeUnitsBadge =
            box && box.comboConfig && box.comboConfig.discountType === 'buy_x_get_y' && dynamicBreakdown.freeUnits > 0
              ? '<span class="cb-sticky-save">Free items: ' + dynamicBreakdown.freeUnits + '</span>'
              : '';
          _stickySavingsEl.innerHTML =
            '<span class="cb-sticky-mrp">MRP: ' + formatPrice(originalPrice, ctx.currencySymbol, ctx.currencyCode) + '</span>' +
            savingsBadge +
            (isDynamic ? freeUnitsBadge : '');
          _stickySavingsEl.style.display = 'flex';
        } else {
          _stickySavingsEl.style.display = 'none';
        }
      }

      // Steps mode: hide product grid when done; enable/disable cart buttons; update wizard
      if (ctx.layoutMode === 'steps') {
        var savedScrollY = window.scrollY;
        productSection.style.display = allFilled ? 'none' : '';
        if (step3CartSection) step3CartSection.style.display = cartReady ? '' : 'none';
        if (allFilled) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { window.scrollTo(0, savedScrollY); });
          });
        }
        if (step3CartBtn) {
          step3CartBtn.disabled = !cartReady;
          if (!cartReady) {
            step3CartBtn.classList.remove('cb-step3-cart-btn--loading');
            step3CartBtn.textContent = stepAddLabel;
          }
        }
        if (step3CheckoutBtn) {
          step3CheckoutBtn.disabled = !cartReady;
          if (!cartReady) {
            step3CheckoutBtn.classList.remove('cb-step3-checkout-btn--loading');
            step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
          }
        }
        if (cartReady && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--done';
          setWizardStep2Preview(ctx, slots);
          ctx._wizardDots[2].className = 'cb-wizard-step cb-wizard-step--active';
          if (ctx._wizardLines && ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line cb-wizard-line--done';
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].doneLabel;
            ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
          }
        } else if (!cartReady && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--active';
                    ctx._wizardDots[2].className = 'cb-wizard-step';
          if (ctx._wizardLines && ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line';
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].label;
          }
        }
      }
    }

    // ── Resolve products for a step ──
    function normalizeProduct(p) {
      var rawVarId = p.variantId || null;
      var numericVarId = rawVarId && String(rawVarId).indexOf('/') !== -1
        ? String(rawVarId).split('/').pop()
        : (rawVarId ? String(rawVarId) : null);
      return {
        productId: p.id || p.productId,
        productTitle: p.title || p.productTitle || '',
        productHandle: p.handle || p.productHandle || '',
        productImageUrl: p.imageUrl || p.productImageUrl || null,
        productPrice: parseFloat(p.price || p.productPrice) || 0,
        variantIds: numericVarId ? [numericVarId] : (Array.isArray(p.variantIds) ? p.variantIds : []),
        isCollection: false,
      };
    }

    function getStepProducts(stepIdx, cb) {
      if (stepProductsCache[stepIdx]) { cb(null, stepProductsCache[stepIdx]); return; }
      var stepCfg = steps[stepIdx];
      if (!stepCfg) { cb(null, []); return; }

      // Primary source: admin-expanded resolvedProducts (Admin API → no storefront dependency)
      if (Array.isArray(stepCfg.resolvedProducts) && stepCfg.resolvedProducts.length > 0) {
        var resolved = filterInternalComboProducts(
          stepCfg.resolvedProducts.map(normalizeProduct),
          ctx
        );
        stepProductsCache[stepIdx] = resolved;
        cb(null, resolved);
        return;
      }

      var scope = stepCfg.scope || 'collection';

      if (scope === 'product' || scope === 'wholestore') {
        var prods = filterInternalComboProducts(
          (stepCfg.selectedProducts || []).map(normalizeProduct),
          ctx
        );
        stepProductsCache[stepIdx] = prods;
        cb(null, prods);
      } else {
        // Collection scope — fetch ALL configured collections and merge results
        var colls = (stepCfg.collections || []).filter(function (c) { return c && c.handle; });
        if (!colls.length) { cb(null, []); return; }

        var remaining = colls.length;
        var allProds = [];
        var seenIds = {};
        var firstErr = null;

        colls.forEach(function (coll) {
          fetchCollectionProducts(coll.handle, function (err, prods) {
            if (err) firstErr = err;
            if (prods) {
              var filteredProds = filterInternalComboProducts(prods, ctx);
              filteredProds.forEach(function (p) {
                if (!seenIds[p.productId]) {
                  seenIds[p.productId] = true;
                  allProds.push(p);
                }
              });
            }
            remaining--;
            if (remaining === 0) {
              if (allProds.length > 0) stepProductsCache[stepIdx] = allProds;
              cb(allProds.length === 0 ? firstErr : null, allProds);
            }
          });
        });
      }
    }

    // ── Product Grid rendering ──
    function renderProductGrid(products) {
      var stepCfg = steps[activeSlotIndex] || {};
      var stepLabelText = stepCfg.label || ('Item ' + (activeSlotIndex + 1));
      if (isOptionalStep(stepCfg)) stepLabelText += ' (Optional)';
      var popupCfg = stepCfg.popup || {};
      var stepHeading = typeof popupCfg.title === 'string' && popupCfg.title.trim()
        ? popupCfg.title.trim()
        : ('Choose your ' + stepLabelText);
      var stepDescription = typeof popupCfg.desc === 'string' ? popupCfg.desc.trim() : '';
      productLabelText.textContent = stepHeading;
      if (stepDescription) {
        productLabelDesc.textContent = stepDescription;
        productLabelDesc.style.display = 'block';
      } else {
        productLabelDesc.textContent = '';
        productLabelDesc.style.display = 'none';
      }
      skipStepBtn.style.display = isOptionalStep(stepCfg) && !slots[activeSlotIndex] ? 'inline-flex' : 'none';
      productGrid.innerHTML = '';

      if (!products) {
        productGrid.innerHTML = '';
        return;
      }
      if (products.length === 0) {
        productGrid.innerHTML = '<p style="color:var(--cb-text-muted);font-family:var(--cb-font);padding:24px 0;text-align:center;">No products available for this step.</p>';
        return;
      }

      // Build used-product tracking from all OTHER slots (for allowDuplicates = false)
      var usedIds = [];
      var usedVariantIdsByProduct = {};
      if (!box.allowDuplicates) {
        slots.forEach(function (p, si) {
          if (!p || si === activeSlotIndex) return;
          usedIds.push(p.productId);
          if (p.selectedVariantId) {
            var key = String(p.productId);
            if (!usedVariantIdsByProduct[key]) usedVariantIdsByProduct[key] = [];
            var sid = String(p.selectedVariantId);
            if (usedVariantIdsByProduct[key].indexOf(sid) === -1) usedVariantIdsByProduct[key].push(sid);
          }
        });
      }

      products.forEach(function (product) {
        var isCurrentSlot = slots[activeSlotIndex] && slots[activeSlotIndex].productId === product.productId;
        var isUsed = !box.allowDuplicates && usedIds.indexOf(product.productId) !== -1 && !isCurrentSlot;

        var card = document.createElement('div');
        card.className = 'cb-product-card';
        if (isCurrentSlot) {
          card.classList.add('cb-product-card--current');
        } else if (isUsed) {
          card.classList.add('cb-product-card--used');
        }
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        // Image
        var imgWrap = document.createElement('div');
        imgWrap.className = 'cb-product-img-wrap';
        if (product.productImageUrl) {
          var img = document.createElement('img');
          img.src = product.productImageUrl;
          img.alt = product.productTitle || '';
          img.className = 'cb-product-img';
          img.loading = 'lazy';
          imgWrap.appendChild(img);
        } else {
          var ph = document.createElement('div');
          ph.className = 'cb-product-img-placeholder';
          ph.textContent = (product.productTitle || '?').charAt(0).toUpperCase();
          imgWrap.appendChild(ph);
        }
        card.appendChild(imgWrap);

        var selVarId = null;
        var selVarTitle = null;
        var selVarPrice = product.productPrice != null ? parseFloat(product.productPrice) : null;
        var selVarCompare = null;

        var infoEl = document.createElement('div');
        infoEl.className = 'cb-product-info';

        var titleRow = document.createElement('div');
        titleRow.className = 'cb-product-title-row';
        var titleEl = document.createElement('div');
        titleEl.className = 'cb-product-title';
        titleEl.textContent = product.productTitle || product.productId;
        titleRow.appendChild(titleEl);

        if (product.productHandle && !product.isCollection) {
          var learnBtn = document.createElement('button');
          learnBtn.type = 'button';
          learnBtn.className = 'cb-product-learn-link';
          learnBtn.innerHTML = '&#9432; Learn';
          learnBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            openProductDescriptionModal(product, learnBtn, ctx.rootEl);
          });
          titleRow.appendChild(learnBtn);
        }
        infoEl.appendChild(titleRow);

        var metaRow = document.createElement('div');
        metaRow.className = 'cb-product-meta-row';
        var priceWrap = document.createElement('span');
        priceWrap.className = 'cb-product-price-wrap';
        if (ctx.settings && ctx.settings.showProductPrices === false) priceWrap.style.display = 'none';
        metaRow.appendChild(priceWrap);

        var metaActions = document.createElement('div');
        metaActions.className = 'cb-product-meta-actions';
        metaRow.appendChild(metaActions);

        function renderPriceWrap(price, compareAt) {
          priceWrap.innerHTML = '';
          var sp = price != null ? parseFloat(price) : null;
          var cp = compareAt != null ? parseFloat(compareAt) : null;
          if (sp && sp > 0) {
            var pEl = document.createElement('span');
            pEl.className = 'cb-product-price';
            pEl.textContent = formatPrice(sp, ctx.currencySymbol, ctx.currencyCode);
            priceWrap.appendChild(pEl);
            if (cp && cp > sp) {
              var cEl = document.createElement('span');
              cEl.className = 'cb-product-compare-price';
              cEl.textContent = formatPrice(cp, ctx.currencySymbol, ctx.currencyCode);
              priceWrap.appendChild(cEl);
            }
          }
        }
        renderPriceWrap(selVarPrice, selVarCompare);
        infoEl.appendChild(metaRow);
        card.appendChild(infoEl);

        // Variant select (inline on card)
        if (!product.isCollection && product.productHandle) {
          var selectWrap = document.createElement('div');
          selectWrap.className = 'cb-variant-select-wrap';
          selectWrap.style.display = 'none';
          var variantSelect = document.createElement('select');
          variantSelect.className = 'cb-variant-select';
          variantSelect.addEventListener('click', function (e) { e.stopPropagation(); });
          variantSelect.addEventListener('change', function (e) {
            e.stopPropagation();
            var cached = variantSelect._cbVariants || [];
            for (var vi = 0; vi < cached.length; vi++) {
              if (String(cached[vi].id) === variantSelect.value) {
                selVarId    = cached[vi].id;
                selVarPrice = cached[vi].price;
                selVarCompare = cached[vi].compareAtPrice;
                selVarTitle = cached[vi].title !== 'Default Title' ? cached[vi].title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
                break;
              }
            }
          });
          selectWrap.appendChild(variantSelect);
          metaActions.appendChild(selectWrap);

          ;(function (sel, wrap) {
            fetchVariants(product.productHandle, product.variantIds, function (err, variants) {
              if (err || !variants || variants.length === 0) return;
              if (variants.length === 1) {
                var v0 = variants[0];
                selVarId = v0.id;
                if (v0.price != null) { selVarPrice = v0.price; selVarCompare = v0.compareAtPrice; }
                selVarTitle = v0.title !== 'Default Title' ? v0.title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
                return;
              }
              sel.innerHTML = '';
              sel._cbVariants = variants;
              var firstAvailable = null;
              variants.forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = v.id;
                var lbl = v.title;
                if (!v.available) { opt.disabled = true; lbl += ' \u2014 Out of stock'; }
                opt.textContent = lbl;
                sel.appendChild(opt);
                if (!firstAvailable && v.available) firstAvailable = v;
              });
              if (firstAvailable) {
                sel.value = firstAvailable.id;
                selVarId    = firstAvailable.id;
                selVarPrice = firstAvailable.price;
                selVarCompare = firstAvailable.compareAtPrice;
                selVarTitle = firstAvailable.title !== 'Default Title' ? firstAvailable.title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
              }
              wrap.style.display = '';
            });
          })(variantSelect, selectWrap);
        }

        // ADD TO BOX / REMOVE FROM BOX button
        var addBtn = document.createElement('button');
        var stepCfg = steps[activeSlotIndex] || null;
        var productGridBtnLabel = resolveStepSelectionButtonLabel(stepCfg, box, ctx.settings);
        addBtn.type = 'button';
        if (isCurrentSlot || isUsed) {
          addBtn.className = 'cb-add-btn cb-add-btn--remove';
          addBtn.innerHTML = '&times; REMOVE FROM BOX';
        } else {
          addBtn.className = 'cb-add-btn';
          addBtn.textContent = productGridBtnLabel;
        }
        card.appendChild(addBtn);

        if (isCurrentSlot) {
          ;(function (aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              slots[activeSlotIndex] = null;
              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(addBtn);
        } else if (isUsed) {
          ;(function (p, aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              for (var si = 0; si < slots.length; si++) {
                if (slots[si] && slots[si].productId === p.productId) {
                  slots[si] = null;
                  break;
                }
              }
              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(product, addBtn);
        } else {
          ;(function (p, aBtn) {
            function doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice) {
              aBtn.textContent = '\u2713 ' + productGridBtnLabel;
              aBtn.classList.add('cb-add-btn--added');

              var resolvedPrice = p.productPrice;
              if (variantPrice != null && parseFloat(variantPrice) > 0) resolvedPrice = parseFloat(variantPrice);

              slots[activeSlotIndex] = {
                productId: p.productId,
                productTitle: p.productTitle,
                productImageUrl: p.productImageUrl,
                productHandle: p.productHandle,
                productPrice: resolvedPrice,
                variantIds: p.variantIds,
                isCollection: p.isCollection,
                selectedVariantId: variantId || null,
                selectedVariantTitle: variantTitle || null,
              };

              // Advance to next empty slot
              var next = findNextEmptySlot(activeSlotIndex);
              if (next !== -1) activeSlotIndex = next;

              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            }

            function onProductClick() {
              if (p.isCollection || !p.productHandle) {
                var fallbackId = p.variantIds && p.variantIds[0] ? String(p.variantIds[0]) : null;
                doAddToSlot(fallbackId, null, p.productPrice, null);
              } else if (selVarId) {
                doAddToSlot(selVarId, selVarTitle, selVarPrice, selVarCompare);
              } else {
                showVariantPicker(card, p, aBtn, [], function (variantId, variantTitle, variantPrice, variantCompareAtPrice) {
                  if (!variantId) return;
                  doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice);
                });
              }
            }

            aBtn.addEventListener('click', function (e) { e.stopPropagation(); onProductClick(); });
            card.addEventListener('click', onProductClick);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProductClick(); }
            });
          })(product, addBtn);
        }


        productGrid.appendChild(card);
      });
    }

    var gridLoadToken = 0;

    // Load products for active slot then render grid
    function loadAndRenderGrid() {
      renderProductGrid(null);
      var previousOverlays = productSection.querySelectorAll('.cb-grid-overlay');
      previousOverlays.forEach(function (node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      });
      // Show inline spinner overlay on the product section
      var gridOverlay = document.createElement('div');
      gridOverlay.className = 'cb-grid-overlay';
      gridOverlay.innerHTML =
        '<span class="combo-builder-spinner" aria-hidden="true"></span>' +
        '<span class="cb-grid-overlay-text">Loading products\u2026</span>';
      productSection.appendChild(gridOverlay);
      var token = ++gridLoadToken;
      var startedAt = Date.now();
      var minVisibleMs = 220;

      getStepProducts(activeSlotIndex, function (err, products) {
        var elapsed = Date.now() - startedAt;
        var waitMs = Math.max(0, minVisibleMs - elapsed);
        setTimeout(function () {
          if (token !== gridLoadToken) return;
          if (gridOverlay.parentNode) gridOverlay.parentNode.removeChild(gridOverlay);
          renderProductGrid(err ? [] : products);
        }, waitMs);
      });
    }

    // ── Cart Action ──
    function resetSpecificCombo() {
      setTimeout(function () {
        for (var i = 0; i < slots.length; i++) slots[i] = null;
        activeSlotIndex = 0;
        if (giftInput) giftInput.value = '';
        setBoxCardPrice(
          box,
          isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
          ctx.currencySymbol
        );
        renderSlots();
        loadAndRenderGrid();
        updateCartButton();
      }, 0);
    }

    function doCart() {
      if (!areRequiredStepsFilled()) {
        var stepEls = slotSteps.querySelectorAll('.cb-slot-step');
        var missingRequired = getRequiredStepIndexes().filter(function (idx) { return !slots[idx]; });
        if (missingRequired.length === 0 && !slots.some(Boolean)) {
          missingRequired = [activeSlotIndex];
        }
        missingRequired.forEach(function (idx) {
          if (stepEls[idx * 2]) {
            stepEls[idx * 2].classList.add('cb-slot-step--error');
            setTimeout(function () { stepEls[idx * 2].classList.remove('cb-slot-step--error'); }, 700);
          }
        });
        return;
      }
      // Show spinner on cart buttons immediately
      [inlineCartBtn, _stickyBtn].forEach(function (btn) {
        if (!btn) return;
        btn.disabled = true;
        btn.className = btn === _stickyBtn
          ? 'cb-sticky-btn cb-sticky-btn--loading'
          : 'cb-inline-cart-btn cb-inline-cart-btn--loading';
        btn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span class="cb-btn-label">Adding\u2026</span>';
      });
      showPageLoader('Adding products to cart\u2026');
      addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, inlineCartBtn, _stickyBtn, resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel), ctx.currencySymbol, ctx.apiBase, ctx.shop, resetSpecificCombo);
    }

    inlineCartBtn.addEventListener('click', doCart);
    if (ctx.layoutMode === 'steps') {
      if (step3CartBtn) {
        step3CartBtn.addEventListener('click', function () {
          if (!areRequiredStepsFilled()) return;
          step3CartBtn.disabled = true;
          step3CartBtn.classList.add('cb-step3-cart-btn--loading');
          step3CartBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Adding\u2026</span>';
          if (step3CheckoutBtn) step3CheckoutBtn.disabled = true;
          showPageLoader('Adding products to cart\u2026');
          addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, inlineCartBtn, _stickyBtn, resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel), ctx.currencySymbol, ctx.apiBase, ctx.shop, resetSpecificCombo);
        });
      }
      if (step3CheckoutBtn) {
        step3CheckoutBtn.addEventListener('click', function () {
          if (!areRequiredStepsFilled()) return;
          step3CheckoutBtn.disabled = true;
          step3CheckoutBtn.classList.add('cb-step3-checkout-btn--loading');
          step3CheckoutBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Checkout\u2026</span>';
          if (step3CartBtn) step3CartBtn.disabled = true;
          showPageLoader('Processing your order\u2026');
          addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, null, null, 'Checkout \u2192', ctx.currencySymbol, ctx.apiBase, ctx.shop, resetSpecificCombo, '/checkout');
        });
      }
    }
    removeStickyFooter();
    if (ctx.enableStickyCart !== false) {
      createStickyFooter(box, ctx, doCart);
    }

    loadAndRenderGrid();
    updateCartButton();
  }

  function cleanupComboCartPresentation(root) {
    if (!root) return;

    var comboLineItems = [];
    var propNodes = root.querySelectorAll('li, p, dd, div, span');
    propNodes.forEach(function (node) {
      if (node.children && node.children.length > 0) return;

      var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      var lower = text.toLowerCase();

      // Safety cleanup for previously-created visible properties.
      if (
        lower.indexOf('bundle:') === 0 ||
        lower.indexOf('combo price:') === 0 ||
        lower.indexOf('selected items total:') === 0 ||
        lower.indexOf('mrp:') === 0
      ) {
        node.style.display = 'none';
      }

      if (lower.indexOf('item 1:') === 0 || lower.indexOf('item1:') === 0) {
        var lineItem = node.closest('[data-cart-item], .cart-item, .drawer__cart-item, .cart-drawer-item, .line-item, tr, li');
        if (lineItem && comboLineItems.indexOf(lineItem) === -1) {
          comboLineItems.push(lineItem);
        }
      }
    });

    comboLineItems.forEach(function (lineItem) {
      lineItem.classList.add('cb-combo-line-item');
    });

    if (!document.getElementById('cb-combo-cart-hide-qty')) {
      var style = document.createElement('style');
      style.id = 'cb-combo-cart-hide-qty';
      style.textContent =
        '.cb-combo-line-item quantity-input,' +
        '.cb-combo-line-item .quantity,' +
        '.cb-combo-line-item .cart-item__quantity,' +
        '.cb-combo-line-item .cart-item__quantity-wrapper,' +
        '.cb-combo-line-item .cart-drawer__quantity,' +
        '.cb-combo-line-item .quantity-popover-container,' +
        '.cb-combo-line-item .js-qty,' +
        '.cb-combo-line-item .js-qty__wrapper,' +
        '.cb-combo-line-item [data-quantity-selector],' +
        '.cb-combo-line-item button.quantity__button,' +
        '.cb-combo-line-item [name=\"plus\"],' +
        '.cb-combo-line-item [name=\"minus\"],' +
        '.cb-combo-line-item input[name=\"updates[]\"],' +
        '.cb-combo-line-item input[name^=\"updates[\"]' +
        '{display:none !important;}';
      document.head.appendChild(style);
    }
  }

  function waitForComboCartPresentation(expectedItemsCount) {
    return new Promise(function (resolve) {
      var attempts = 0;
      var minimumVisibleItems = expectedItemsCount && expectedItemsCount > 0 ? expectedItemsCount : 1;

      function check() {
        cleanupComboCartPresentation(document);

        var comboLine = document.querySelector('.cb-combo-line-item');
        var visibleItemCount = 0;

        if (comboLine) {
          comboLine.querySelectorAll('li, p, dd, div, span').forEach(function (node) {
            if (node.children && node.children.length > 0) return;
            var text = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (/^item\s*\d+\s*:/.test(text)) visibleItemCount++;
          });
        }

        attempts++;
        if ((comboLine && visibleItemCount >= minimumVisibleItems) || attempts >= 12) {
          resolve();
          return;
        }

        setTimeout(check, 120);
      }

      setTimeout(check, 60);
    });
  }

  function isCartDrawerOpen() {
    var webComponentDrawer = document.querySelector('cart-drawer');
    if (webComponentDrawer) {
      var drawerDetails = webComponentDrawer.querySelector('details');
      if (drawerDetails && drawerDetails.hasAttribute('open')) return true;
      if (webComponentDrawer.getAttribute('aria-hidden') === 'false') return true;
      if (
        webComponentDrawer.classList.contains('active') ||
        webComponentDrawer.classList.contains('is-active') ||
        webComponentDrawer.classList.contains('open') ||
        webComponentDrawer.classList.contains('is-open')
      ) return true;
    }

    var genericDrawer = document.querySelector(
      '#CartDrawer, .cart-drawer, [data-cart-drawer], #AjaxCartDrawer, #mini-cart, .mini-cart-drawer'
    );
    if (!genericDrawer) return false;
    if (genericDrawer.getAttribute('aria-hidden') === 'false') return true;
    if (
      genericDrawer.classList.contains('active') ||
      genericDrawer.classList.contains('is-active') ||
      genericDrawer.classList.contains('open') ||
      genericDrawer.classList.contains('is-open')
    ) return true;
    return false;
  }

  function releasePageScrollIfDrawerClosed() {
    if (isCartDrawerOpen()) return;
    document.body.classList.remove('overflow-hidden');
    document.documentElement.classList.remove('overflow-hidden');
  }

  function bindDrawerScrollRecovery() {
    if (_drawerScrollRecoveryBound) return;
    _drawerScrollRecoveryBound = true;

    function scheduleUnlockCheck() {
      setTimeout(releasePageScrollIfDrawerClosed, 40);
      setTimeout(releasePageScrollIfDrawerClosed, 220);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') scheduleUnlockCheck();
    });

    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      if (
        target.closest('#CartDrawer-Overlay, .cart-drawer__overlay') ||
        target.closest('.drawer__close, .cart-drawer__close, [data-drawer-close], [data-cart-close]') ||
        target.closest('summary[aria-label*="Close"], button[aria-label*="Close"]')
      ) {
        scheduleUnlockCheck();
      }
    }, true);

    document.addEventListener('cart:refresh', scheduleUnlockCheck);
    document.addEventListener('cart:updated', scheduleUnlockCheck);
  }

  // ─── Add to Cart ──────────────────────────────────────────────────────────────

  function addToCart(box, slots, sessionId, giftMessage, inlineBtn, stickyBtn, readyLabel, currencySymbol, apiBase, shop, onSuccess, checkoutUrl) {
    var resolvedReadyLabel = readyLabel || 'Add To Cart';
    var resolvedCurrencySymbol = currencySymbol || "$";
    var resolvedApiBase = String(apiBase || DEFAULT_API_BASE || '').replace(/\/+$/, '');
    var sectionIds = ['cart-drawer', 'cart-icon-bubble', 'cart-notification-button', 'cart-notification'];
    var selectedItemsCount = slots.filter(Boolean).length;
    var normalizedGiftMessage = '';
    if (typeof giftMessage === 'string') {
      normalizedGiftMessage = giftMessage.trim();
      if (normalizedGiftMessage.length > 100) {
        normalizedGiftMessage = normalizedGiftMessage.slice(0, 100);
      }
    }

    function setBtnContent(btn, state, text) {
      if (!btn) return;
      btn.innerHTML = '';

      if (state === 'loading') {
        var spinner = document.createElement('span');
        spinner.className = 'cb-btn-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        btn.appendChild(spinner);
      }

      var label = document.createElement('span');
      label.className = 'cb-btn-label';
      label.textContent = text;
      btn.appendChild(label);
    }

    function setBtns(state, text) {
      var displayText = state === 'loading'
        ? 'Adding...'
        : state === 'success'
          ? 'Added to Cart!'
          : text;

      [inlineBtn, stickyBtn].forEach(function (btn) {
        if (!btn) return;
        btn.disabled = state !== 'ready';
        btn.className = btn === stickyBtn ? 'cb-sticky-btn' : 'cb-inline-cart-btn';
        if (state === 'loading') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--loading' : 'cb-inline-cart-btn--loading');
        } else if (state === 'success') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--success' : 'cb-inline-cart-btn--success');
        } else if (state === 'error') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--error' : 'cb-inline-cart-btn--error');
          btn.disabled = false;
        } else if (state === 'ready') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--ready' : 'cb-inline-cart-btn--ready');
        }
        setBtnContent(btn, state, displayText);
      });
    }

    setBtns('loading', 'Adding…');

    showPageLoader('Adding products to cart…');

    function postCartItems(items) {
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          items: items,
          sections: sectionIds,
          sections_url: window.location.pathname + window.location.search,
        }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          console.error('[ComboBuilder] Cart 422 details:', d);
          throw new Error(d.description || d.message || 'Cart error');
        });
        return r.json();
      });
    }

    function fetchCartState() {
      return fetch('/cart.js', {
        headers: { 'Accept': 'application/json' },
      }).then(function (r) {
        if (!r.ok) throw new Error('Failed to load cart');
        return r.json();
      });
    }

    function postCartChange(payload) {
      var body = {
        line: payload.line,
        quantity: payload.quantity,
        sections: sectionIds,
        sections_url: window.location.pathname + window.location.search,
      };
      if (payload.properties) body.properties = payload.properties;

      return fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          throw new Error((d && (d.description || d.message || d.error)) || 'Cart change error');
        });
        return r.json();
      });
    }

    function findExistingComboLine(cart, comboBoxId) {
      if (!cart || !Array.isArray(cart.items)) return null;
      var targetBoxId = String(comboBoxId);

      for (var i = 0; i < cart.items.length; i++) {
        var item = cart.items[i] || {};
        var props = item.properties || {};
        var bundleFlag = String(props._bundle_price_item || '').toLowerCase();
        var itemBoxId = String(props._combo_box_id || '');
        if ((bundleFlag === 'true' || bundleFlag === '1') && itemBoxId === targetBoxId) {
          return { line: i + 1, item: item };
        }
      }
      return null;
    }

    function normalizeVariantId(rawId) {
      if (rawId == null) return null;
      var id = String(rawId);
      return id.indexOf('/') !== -1 ? id.split('/').pop() : id;
    }

    function upsertComboLine(item) {
      return fetchCartState().then(function (cart) {
        var existing = findExistingComboLine(cart, box.id);
        if (!existing) {
          return postCartItems([item]);
        }

        var existingVariantId = normalizeVariantId(
          existing.item && (existing.item.id != null ? existing.item.id : existing.item.variant_id)
        );
        var targetVariantId = normalizeVariantId(item.id);

        // If variant changed, replace old line item so the cart uses the current combo variant.
        if (existingVariantId && targetVariantId && existingVariantId !== targetVariantId) {
          return postCartChange({ line: existing.line, quantity: 0 }).then(function () {
            return postCartItems([item]);
          });
        }

        // Same combo box exists in cart: overwrite its properties instead of adding duplicate.
        return postCartChange({
          line: existing.line,
          quantity: 1,
          properties: item.properties || {},
        });
      });
    }

    function resolveBundleVariantId() {
      if (!box || !box.id || !shop || !box.shopifyProductId || !resolvedApiBase) {
        return Promise.reject(new Error('Cannot resolve combo variant'));
      }

      return fetch(
        resolvedApiBase +
          '/api/storefront/boxes/' +
          encodeURIComponent(String(box.id)) +
          '/variant?shop=' +
          encodeURIComponent(shop),
        { headers: { 'Accept': 'application/json' } }
      )
        .then(function (r) {
          if (!r.ok) throw new Error('Variant repair failed');
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.shopifyVariantId) {
            throw new Error('Variant repair failed');
          }
          box.shopifyVariantId = String(data.shopifyVariantId);
          return box.shopifyVariantId;
        });
    }

    function syncThemeCartUI(cartResponse) {
      var sections = cartResponse && cartResponse.sections;
      var drawerExist = document.querySelector('cart-drawer');
      var notifExist = document.querySelector('cart-notification');
      var renderedByTheme = false;

      if (drawerExist) drawerExist.classList.remove('is-empty');
      document.querySelectorAll('#CartDrawer, .cart-drawer, [data-cart-drawer]').forEach(function (el) {
        el.classList.remove('is-empty');
      });

      if (sections && drawerExist && typeof drawerExist.renderContents === 'function') {
        try {
          drawerExist.renderContents(cartResponse);
          renderedByTheme = true;
        } catch (e) {
          console.warn('[ComboBuilder] cart-drawer.renderContents() failed:', e);
        }
      }

      if (sections && notifExist && typeof notifExist.renderContents === 'function') {
        try {
          notifExist.renderContents(cartResponse);
          renderedByTheme = true;
        } catch (e) {
          console.warn('[ComboBuilder] cart-notification.renderContents() failed:', e);
        }
      }

      if (!sections || renderedByTheme) return;

      var parser = new DOMParser();
      Object.keys(sections).forEach(function (key) {
        var markup = sections[key];
        if (!markup) return;
        var doc = parser.parseFromString(markup, 'text/html');

        if (key === 'cart-drawer') {
          var drawerSectionExist = document.querySelector('#shopify-section-cart-drawer');
          var drawerSectionFresh = doc.querySelector('#shopify-section-cart-drawer');
          if (drawerSectionExist && drawerSectionFresh) {
            drawerSectionExist.innerHTML = drawerSectionFresh.innerHTML;
          } else {
            var drawerFresh = doc.querySelector('cart-drawer');
            if (drawerExist && drawerFresh) drawerExist.innerHTML = drawerFresh.innerHTML;
          }
        }

        if (key === 'cart-notification') {
          var notifSectionExist = document.querySelector('#shopify-section-cart-notification');
          var notifSectionFresh = doc.querySelector('#shopify-section-cart-notification');
          if (notifSectionExist && notifSectionFresh) {
            notifSectionExist.innerHTML = notifSectionFresh.innerHTML;
          } else {
            var notifFresh = doc.querySelector('cart-notification');
            if (notifExist && notifFresh) notifExist.innerHTML = notifFresh.innerHTML;
          }
        }

        if (key === 'cart-icon-bubble') {
          var bubbleSectionExist = document.querySelector('#shopify-section-cart-icon-bubble');
          var bubbleSectionFresh = doc.querySelector('#shopify-section-cart-icon-bubble');
          if (bubbleSectionExist && bubbleSectionFresh) {
            bubbleSectionExist.innerHTML = bubbleSectionFresh.innerHTML;
          }

          var countFresh = doc.querySelector('.cart-count-bubble');
          if (countFresh) {
            document.querySelectorAll('.cart-count-bubble').forEach(function (el) {
              el.innerHTML = countFresh.innerHTML;
            });
          }
        }
      });
    }

    var items = [];
    var isDynamic = String(box.bundlePriceType || 'manual') === 'dynamic';

    if (box.shopifyVariantId) {
      var totalMrp = 0;
      slots.forEach(function (p) {
        if (p && p.productPrice != null && parseFloat(p.productPrice) > 0) {
          totalMrp += parseFloat(p.productPrice);
        }
      });

      // For dynamic mode, effective cart price = sum of selected products minus any discount.
      // For manual mode, it is the fixed bundlePrice set by the merchant.
      var dynamicBreakdown = getComboDiscountBreakdown(totalMrp, box.comboConfig, slots);
      var effectivePrice = isDynamic ? dynamicBreakdown.discountedTotal : (parseFloat(box.bundlePrice) || 0);

      var bundleProps = {
        '_bundle_price_item': 'true',
        '_combo_session_id': sessionId,
        '_combo_box_id': String(box.id),
        '_combo_shopify_variant_id': String(box.shopifyVariantId),
        '_combo_bundle_name': box.displayTitle,
        '_combo_price_type': isDynamic ? 'dynamic' : 'manual',
      };
      if (box.shopifyProductId) {
        bundleProps['_combo_shopify_product_id'] = String(box.shopifyProductId);
      }
      var bundleImageSrc = getBoxCardBannerSrc(box, { apiBase: apiBase });
      if (bundleImageSrc) bundleProps['_combo_box_image'] = bundleImageSrc;

      slots.forEach(function (p, idx) {
        if (p) {
          var label = p.productTitle || ('Item ' + (idx + 1));
          if (p.selectedVariantTitle) label += ' (' + p.selectedVariantTitle + ')';
          bundleProps['Item ' + (idx + 1)] = label;
        }
      });

      if (totalMrp > 0) {
        bundleProps['_combo_selected_total'] = totalMrp.toFixed(2);
        bundleProps['_combo_bundle_price'] = effectivePrice.toFixed(2);
      }

      // Show savings for both manual and dynamic modes when there's a discount
      if (totalMrp > effectivePrice && totalMrp > 0) {
        var savingsAmt = totalMrp - effectivePrice;
        var savingsPct = Math.round((savingsAmt / totalMrp) * 100);
        bundleProps['_combo_savings_amount'] = savingsAmt.toFixed(2);
        bundleProps['_combo_discount_pct'] = String(savingsPct);
      }

      if (isDynamic && dynamicBreakdown.discountAmount > 0) {
        // Product discount and order discount are the same monetary impact in this
        // bundle model, but we persist both keys for storefront/cart presentation.
        bundleProps['_combo_product_discount'] = dynamicBreakdown.discountAmount.toFixed(2);
        bundleProps['_combo_order_discount'] = dynamicBreakdown.discountAmount.toFixed(2);
        if (dynamicBreakdown.freeUnits > 0) {
          bundleProps['_combo_free_items'] = String(dynamicBreakdown.freeUnits);
        }
      }

      if (normalizedGiftMessage) bundleProps['Gift Message'] = normalizedGiftMessage;
      items.push({ id: box.shopifyVariantId, quantity: 1, properties: bundleProps });
    } else {
      hidePageLoader(true);
      setBtns('error', 'MixBox – Box & Bundle Builder not linked');
      setTimeout(function () { setBtns('ready', resolvedReadyLabel); }, 2500);
      return;
    }

    // For dynamic pricing: keep variant price at the selected products total (pre-discount),
    // so Shopify automatic discounts can allocate discount lines visible in Admin/checkout.
    function updateDynamicPriceThenCart() {
      var dynamicTotal = 0;
      slots.forEach(function (p) {
        if (p && p.productPrice != null && parseFloat(p.productPrice) > 0) {
          dynamicTotal += parseFloat(p.productPrice);
        }
      });
      if (dynamicTotal <= 0) {
        return Promise.reject(new Error('No product prices available for dynamic pricing'));
      }

      var updateUrl = resolvedApiBase +
        '/api/storefront/boxes/' + encodeURIComponent(String(box.id)) +
        '/update-price?shop=' + encodeURIComponent(shop);

      return fetch(updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ price: dynamicTotal }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          throw new Error(d.error || 'Price update failed');
        });
        return r.json();
      }).then(function () {
        return upsertComboLine(items[0]);
      });
    }

    // For manual mode: call the variant endpoint first so the product is guaranteed
    // to be ACTIVE + published on the Online Store before /cart/add.js is called.
    // For dynamic mode: updateDynamicPriceThenCart already activates + publishes.
    function ensurePublishedThenCart() {
      return resolveBundleVariantId()
        .then(function (variantId) {
          console.log('[ComboBuilder] resolveBundleVariantId resolved:', variantId);
          items[0].id = variantId;
          if (items[0].properties) {
            items[0].properties['_combo_shopify_variant_id'] = String(variantId);
          }
        })
        .catch(function (e) {
          console.warn('[ComboBuilder] resolveBundleVariantId failed (using stored id):', e && e.message, '| stored shopifyVariantId:', box.shopifyVariantId, '| box.shopifyProductId:', box.shopifyProductId);
        })
        // Brief pause so Shopify can propagate the publish/activate from the variant endpoint
        .then(function () { return new Promise(function (r) { setTimeout(r, 800); }); })
        .then(function () { return upsertComboLine(items[0]); });
    }

    var cartPromise = isDynamic ? updateDynamicPriceThenCart() : ensurePublishedThenCart();

    cartPromise
      .catch(function (err) {
        var msg = err && err.message ? String(err.message).toLowerCase() : '';
        if (msg.indexOf('cannot find variant') === -1) throw err;

        // Repair: fetch fresh variant ID (endpoint also re-activates + re-publishes product)
        return resolveBundleVariantId().then(function (variantId) {
          items[0].id = variantId;
          if (items[0].properties) {
            items[0].properties['_combo_shopify_variant_id'] = String(variantId);
          }
          // 1500ms delay so Shopify can propagate the publication change
          return new Promise(function (resolve) { setTimeout(resolve, 1500); })
            .then(function () {
              return isDynamic ? updateDynamicPriceThenCart() : upsertComboLine(items[0]);
            });
        });
      })
      .then(function (cartResponse) {
        setBtns('success', 'Added to Cart! ✓');

        // cart/add.js returns sections HTML when requested — use it to refresh drawer content
        syncThemeCartUI(cartResponse);
        cleanupComboCartPresentation(document);

        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));

        if (checkoutUrl) {
          hidePageLoader(true);
          if (typeof onSuccess === 'function') onSuccess();
          setTimeout(function () { window.location.href = checkoutUrl; }, 600);
          return;
        }

        var opened = tryOpenThemeCartDrawer();
        if (!opened) {
          hidePageLoader(true);
          if (typeof onSuccess === 'function') onSuccess();
          setTimeout(function () { window.location.href = '/cart'; }, 1200);
          return;
        }

        setBtns('loading', 'Adding...');
        return waitForComboCartPresentation(selectedItemsCount).then(function () {
          hidePageLoader(true);
          if (typeof onSuccess === 'function') onSuccess();
          setBtns('success', 'Added to Cart! âœ”');
        });
      })
      .catch(function (err) {
        hidePageLoader(true);
        console.error('[ComboBuilder] Add to cart error:', err);
        setBtns('error', 'Error — Try Again');
        setTimeout(function () { setBtns('ready', resolvedReadyLabel); }, 2500);
      });
  }

  function tryOpenThemeCartDrawer() {
    var opened = false;

    var openEvents = [
      'cart:open',
      'drawer:open',
      'cart-drawer:open',
      'theme:cart:open',
      'cartdrawer:open',
    ];

    openEvents.forEach(function (eventName) {
      try {
        document.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
      } catch (e) {
        console.warn('[ComboBuilder] Failed to dispatch drawer event', eventName, e);
      }
    });

    var webComponentDrawer = document.querySelector('cart-drawer');
    if (webComponentDrawer) {
      webComponentDrawer.classList.remove('is-empty');

      if (typeof webComponentDrawer.open === 'function') {
        try {
          webComponentDrawer.open();
          opened = true;
        } catch (e) {
          console.warn('[ComboBuilder] cart-drawer.open() failed:', e);
        }
      }

      var drawerDetails = webComponentDrawer.querySelector('details');
      if (drawerDetails) {
        drawerDetails.setAttribute('open', 'open');
        opened = true;
      }

      webComponentDrawer.classList.add('active');
      webComponentDrawer.setAttribute('aria-hidden', 'false');

      var drawerOverlay = webComponentDrawer.querySelector('#CartDrawer-Overlay, .cart-drawer__overlay');
      if (drawerOverlay) drawerOverlay.classList.add('active');

      var drawerDetailsForToggle = webComponentDrawer.querySelector('details');
      if (drawerDetailsForToggle && !drawerDetailsForToggle.__cbToggleBound) {
        drawerDetailsForToggle.__cbToggleBound = true;
        drawerDetailsForToggle.addEventListener('toggle', function () {
          setTimeout(releasePageScrollIfDrawerClosed, 20);
        });
      }
    }

    var cartTrigger = !opened ? document.querySelector(
      '[data-cart-drawer-trigger], [aria-controls="CartDrawer"], button[name="cart"], .header__icon--cart'
    ) : null;
    if (cartTrigger && !opened) {
      try {
        cartTrigger.click();
        opened = true;
      } catch (e) {
        console.warn('[ComboBuilder] Cart trigger click failed:', e);
      }
    }

    var genericDrawer = !opened ? document.querySelector(
      '#CartDrawer, .cart-drawer, [data-cart-drawer], #AjaxCartDrawer, #mini-cart, .mini-cart-drawer'
    ) : null;
    if (genericDrawer) {
      genericDrawer.classList.remove('is-empty');
      genericDrawer.classList.add('active', 'is-active', 'open', 'is-open');
      genericDrawer.setAttribute('aria-hidden', 'false');
      opened = true;
    }

    setTimeout(function () { cleanupComboCartPresentation(document); }, 50);
    bindDrawerScrollRecovery();
    setTimeout(releasePageScrollIfDrawerClosed, 250);
    return opened;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────────

  function bootstrap() {
    var widgetCount = 0;
    var queue = window.__COMBO_BUILDER__;
    if (Array.isArray(queue)) {
      queue.forEach(function (config) {
        try { initWidget(config); widgetCount++; } catch (e) { console.error('[ComboBuilder]', e); }
      });
    }
    window.__COMBO_BUILDER__ = {
      push: function (config) {
        try { initWidget(config); } catch (e) { console.error('[ComboBuilder]', e); }
      },
    };

    var legacyEl = document.getElementById('combo-builder-widget');
    if (legacyEl) { try { initLegacyWidget(legacyEl); widgetCount++; } catch (e) { console.error('[ComboBuilder]', e); } }

    var legacyEls = document.querySelectorAll('[id^="combo-builder-widget-legacy"]');
    for (var i = 0; i < legacyEls.length; i++) {
      try { initLegacyWidget(legacyEls[i]); widgetCount++; } catch (e) { console.error('[ComboBuilder]', e); }
    }

    cleanupComboCartPresentation(document);
    bindDrawerScrollRecovery();
    document.addEventListener('cart:refresh', function () { setTimeout(function () { cleanupComboCartPresentation(document); }, 20); });
    document.addEventListener('cart:updated', function () { setTimeout(function () { cleanupComboCartPresentation(document); }, 20); });

    document.dispatchEvent(new CustomEvent('comboBuildReady', { bubbles: true, detail: { widgetCount: widgetCount } }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
