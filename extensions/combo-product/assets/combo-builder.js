(function () {
  'use strict';

  var DEFAULT_API_BASE = 'https://combo-products.vercel.app';

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function generateSessionId() {
    return 'cb_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  }

  function formatPrice(amount, currencySymbol) {
    return currencySymbol + Number(amount).toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  function resolveAddToCartLabel(settings) {
    var label = settings && settings.addToCartLabel != null
      ? String(settings.addToCartLabel).trim()
      : '';
    if (!label || label.toUpperCase() === 'ADD TO CART') return 'Add To Cart';
    return label;
  }

  // ─── Preset Theme Palettes ────────────────────────────────────────────────────

  var PRESET_THEMES = {
    'oh-so-minimal':     { primary: '#1a1a1a', bg: '#fafafa', text: '#111827', muted: '#6b7280', border: '#e5e7eb', idleNum: '#d1d5db', accentLt: '#f3f4f6', headingClr: '#1a1a1a' },
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
      '--cb-bg:' + t.bg + ';' +
      '--cb-text:' + t.text + ';' +
      '--cb-text-muted:' + t.muted + ';' +
      '--cb-border:' + t.border + ';' +
      '--cb-border-dashed:' + t.border + ';' +
      '--cb-idle-num:' + t.idleNum + ';' +
    '}';
    // Append to body so this rule comes after the liquid block's <style> in
    // document order, winning the CSS cascade at equal specificity.
    document.body.appendChild(style);
  }

  // ─── Variant Cache + Picker ───────────────────────────────────────────────────

  var variantCache = {};

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

    if (variantCache[handle]) {
      cb(null, applyAllowedFilter(variantCache[handle]));
      return;
    }
    fetch('/products/' + handle + '.js')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var all = (data.variants || []).map(function (v) {
          return { id: String(v.id), title: v.title, available: v.available };
        });
        variantCache[handle] = all;
        cb(null, applyAllowedFilter(all));
      })
      .catch(function (e) { cb(e, null); });
  }

  function showVariantPicker(card, product, addBtn, cb) {
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

      if (err || !variants || variants.length === 0) {
        closePicker();
        cb(product.variantIds && product.variantIds[0] ? product.variantIds[0] : null, '');
        return;
      }

      if (variants.length === 1) {
        closePicker();
        cb(variants[0].id, variants[0].title !== 'Default Title' ? variants[0].title : '');
        return;
      }

      var btnsDiv = document.createElement('div');
      btnsDiv.className = 'cb-variant-btns';
      variants.forEach(function (v) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cb-variant-btn' + (!v.available ? ' cb-variant-btn--oos' : '');
        btn.textContent = v.title;
        if (!v.available) { btn.disabled = true; btn.title = 'Out of stock'; }
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          closePicker();
          cb(v.id, v.title !== 'Default Title' ? v.title : '');
        });
        btnsDiv.appendChild(btn);
      });
      picker.appendChild(btnsDiv);

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
    totalRow.innerHTML = 'Total <span class="cb-sticky-price">' + formatPrice(box.bundlePrice, ctx.currencySymbol) + '/-</span>';
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
    btn.textContent = resolveAddToCartLabel(ctx.settings);
    btn.addEventListener('click', onCartClick);
    footer.appendChild(btn);

    document.body.appendChild(footer);
    document.body.style.paddingBottom = '72px';

    _stickyEl = footer;
    _stickyBtn = btn;
    return btn;
  }

  // ─── Main Widget Init ─────────────────────────────────────────────────────────

  function initWidget(config) {
    var root = document.getElementById(config.mountId);
    if (!root) return;

    var shop = root.dataset.shop || config.shop;
    var currencySymbol = root.dataset.currencySymbol || config.currencySymbol || '\u20B9';
    var layout = root.dataset.layout || config.layout || 'grid';
    var apiBase = root.dataset.apiBase || config.apiBase || DEFAULT_API_BASE;

    var boxIdsFilter = null;
    var rawBoxIds = root.dataset.boxIds || config.boxIds || null;
    if (rawBoxIds) {
      boxIdsFilter = String(rawBoxIds).split(',').map(function (id) { return parseInt(id.trim(), 10); }).filter(Boolean);
    }

    if (!shop) {
      root.innerHTML = '';
      return;
    }

    fetchBoxes(shop, apiBase, function (err, boxes, settings) {
      if (err || !boxes || boxes.length === 0) { root.innerHTML = ''; return; }
      if (boxIdsFilter && boxIdsFilter.length > 0) {
        boxes = boxes.filter(function (b) { return boxIdsFilter.indexOf(b.id) !== -1; });
      }
      if (boxes.length === 0) { root.innerHTML = ''; return; }

      var resolvedHeading = root.dataset.heading || config.heading || (settings && settings.widgetHeadingText) || 'Build Your Own Box!';
      if (settings && settings.presetTheme) applyPresetTheme(root, settings.presetTheme);

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

      renderWidget(root, { shop: shop, boxes: boxes, currencySymbol: currencySymbol, layout: layout, heading: resolvedHeading, apiBase: apiBase, settings: settings || {}, rootEl: root });
    });
  }

  function initLegacyWidget(el) {
    var shop = el.dataset.shop || (window.Shopify && window.Shopify.shop) || null;
    initWidget({
      mountId: el.id,
      shop: shop,
      apiBase: el.dataset.apiBase || DEFAULT_API_BASE,
      currencySymbol: el.dataset.currencySymbol || (window.Shopify && window.Shopify.currency && window.Shopify.currency.symbol) || '\u20B9',
      layout: el.dataset.layout || 'grid',
      heading: el.dataset.heading || 'Build Your Own Box!',
      boxIds: el.dataset.boxIds || null,
    });
  }

  // ─── API ──────────────────────────────────────────────────────────────────────

  function fetchBoxes(shop, apiBase, cb) {
    fetch(apiBase + '/api/storefront/boxes?shop=' + encodeURIComponent(shop))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data && Array.isArray(data.boxes)) cb(null, data.boxes, data.settings || {});
        else if (Array.isArray(data)) cb(null, data, {});
        else cb(null, [], {});
      })
      .catch(function (e) { cb(e, null, {}); });
  }

  function fetchProducts(boxId, shop, apiBase, cb) {
    fetch(apiBase + '/api/storefront/boxes/' + boxId + '/products?shop=' + encodeURIComponent(shop))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) { cb(null, data); })
      .catch(function (e) { cb(e, null); });
  }

  // ─── Render Widget ────────────────────────────────────────────────────────────

  function renderWidget(root, ctx) {
    root.innerHTML = '';
    root.className = 'combo-builder-root cb-loaded';

    var wrapper = document.createElement('div');
    wrapper.className = 'cb-wrapper';

    // Step 1 Heading
    var step1Head = document.createElement('h2');
    step1Head.className = 'cb-step-heading';
    step1Head.textContent = 'Step 1: Select your box';
    wrapper.appendChild(step1Head);

    // Box grid
    var boxGrid = document.createElement('div');
    boxGrid.className = 'cb-box-grid';
    ctx.boxes.forEach(function (box) { boxGrid.appendChild(createBoxCard(box, ctx)); });
    wrapper.appendChild(boxGrid);

    // Builder area
    var builderArea = document.createElement('div');
    builderArea.className = 'cb-builder-area';
    builderArea.style.display = 'none';
    wrapper.appendChild(builderArea);

    root.appendChild(wrapper);

    // Auto-select the first box so products show immediately on load
    var firstCard = boxGrid.firstElementChild;
    if (firstCard) firstCard.click();
  }

  // ─── Box Card ─────────────────────────────────────────────────────────────────

  function createBoxCard(box, ctx) {
    var card = document.createElement('div');
    card.className = 'cb-box-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    // Banner image with overlay title
    var banner = document.createElement('div');
    banner.className = 'cb-box-banner';
    var bannerSrc = box.bannerImageUrl ||
      (box.hasUploadedBanner ? ctx.apiBase + '/api/storefront/boxes/' + box.id + '/banner' : null);
    if (bannerSrc) {
      banner.style.backgroundImage = 'url("' + bannerSrc + '")';
      banner.style.backgroundSize = 'cover';
      banner.style.backgroundPosition = 'center';
    }

    // Overlay: big title text on top of the banner
    var overlay = document.createElement('div');
    overlay.className = 'cb-box-banner-overlay';
    var bannerTitle = document.createElement('div');
    bannerTitle.className = 'cb-box-banner-title';
    bannerTitle.textContent = box.displayTitle || ((box.isGiftBox ? 'Gift ' : 'Buy ') + box.itemCount);
    overlay.appendChild(bannerTitle);
    banner.appendChild(overlay);

    card.appendChild(banner);

    // Checkmark badge (shown when selected)
    var check = document.createElement('div');
    check.className = 'cb-box-check';
    check.innerHTML = '&#10003;';
    card.appendChild(check);

    // Body text
    var body = document.createElement('div');
    body.className = 'cb-box-body';

    var buyText = document.createElement('div');
    buyText.className = 'cb-box-buy-text';
    buyText.textContent = box.boxName || ('Buy ' + box.itemCount + ' products');
    body.appendChild(buyText);

    var priceText = document.createElement('div');
    priceText.className = 'cb-box-price-text';
    priceText.textContent = formatPrice(box.bundlePrice, ctx.currencySymbol);
    body.appendChild(priceText);

    if (box.isGiftBox) {
      var giftTag = document.createElement('span');
      giftTag.className = 'cb-gift-tag';
      giftTag.textContent = 'Gift Box';
      body.appendChild(giftTag);
    }

    // CTA button
    var ctaBtn = document.createElement('button');
    ctaBtn.className = 'cb-box-cta-btn';
    ctaBtn.type = 'button';
    ctaBtn.textContent = (ctx.settings && ctx.settings.ctaButtonLabel) || 'BUILD YOUR BOX';
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

  // ─── Open Builder ─────────────────────────────────────────────────────────────

  function openBuilder(box, ctx) {
    var wrapper = document.querySelector('.cb-wrapper');
    if (!wrapper) return;
    var builderArea = wrapper.querySelector('.cb-builder-area');
    if (!builderArea) return;

    builderArea.style.display = 'block';
    builderArea.innerHTML = '<div class="cb-section-loading"><div class="combo-builder-spinner"></div> Loading products…</div>';

    fetchProducts(box.id, ctx.shop, ctx.apiBase, function (err, products) {
      if (err || !products || products.length === 0) {
        builderArea.innerHTML = '<p class="cb-error">Failed to load products. Please reload and try again.</p>';
        return;
      }
      renderBuilder(builderArea, box, products, ctx);
      builderArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
    step2Head.textContent = 'Step 2: Select your products';
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
    inlineCartBtn.textContent = resolveAddToCartLabel(ctx.settings);

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
              // Shift remaining products left to fill the gap
              for (var j = i; j < slots.length - 1; j++) {
                slots[j] = slots[j + 1];
              }
              slots[slots.length - 1] = null;
              // Active slot becomes the first empty slot
              activeSlotIndex = slots.indexOf(null);
              if (activeSlotIndex === -1) activeSlotIndex = slots.length - 1;
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

    // Arrow separator
    var arrow = document.createElement('div');
    arrow.className = 'cb-slot-arrow';
    arrow.innerHTML = '&#8594;';
    slotWrapper.appendChild(arrow);

    slotWrapper.appendChild(inlineCartBtn);
    container.appendChild(slotWrapper);

    // ── Gift Message ──
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
      giftInput.placeholder = 'Write a personal message…';
      giftInput.rows = 2;
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

    // ── Update cart button state ──
    function updateCartButton() {
      var filled = slots.filter(Boolean).length;
      var remaining = box.itemCount - filled;
      var allFilled = remaining === 0;
      var addLabel = resolveAddToCartLabel(ctx.settings);

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

      // Sticky savings row — dynamic MRP (updates with each product selection)
      if (_stickySavingsEl) {
        var totalMrp = 0;
        var hasSelected = false;
        slots.forEach(function (p) {
          if (p) {
            hasSelected = true;
            totalMrp += (p.productPrice != null && parseFloat(p.productPrice) > 0)
              ? parseFloat(p.productPrice) : 0;
          }
        });
        if (hasSelected) {
          var bundlePrice = parseFloat(box.bundlePrice);
          var savingsAmt = totalMrp - bundlePrice;
          var savingsBadge = (ctx.settings && ctx.settings.showSavingsBadge && savingsAmt > 0)
            ? '<span class="cb-sticky-save">Save ' + formatPrice(savingsAmt, ctx.currencySymbol) + '</span>'
            : '';
          _stickySavingsEl.innerHTML =
            '<span class="cb-sticky-mrp">MRP: ' + formatPrice(totalMrp, ctx.currencySymbol) + '</span>' +
            savingsBadge;
          _stickySavingsEl.style.display = 'flex';
        } else {
          _stickySavingsEl.style.display = 'none';
        }
      }
    }

    // ── Product Grid ──
    function renderProductGrid() {
      productLabel.textContent = 'Choose your Item ' + (activeSlotIndex + 1);
      productGrid.innerHTML = '';

      var usedIds = [];
      if (!box.allowDuplicates) {
        slots.forEach(function (p) { if (p) usedIds.push(p.productId); });
      }

      products.forEach(function (product) {
        var isCurrentSlot = slots[activeSlotIndex] && slots[activeSlotIndex].productId === product.productId;
        var isUsed = !box.allowDuplicates && usedIds.indexOf(product.productId) !== -1 && !isCurrentSlot;

        var card = document.createElement('div');
        card.className = 'cb-product-card';
        if (isUsed) {
          card.classList.add('cb-product-card--used');
          card.setAttribute('aria-disabled', 'true');
        }
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', isUsed ? '-1' : '0');

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

        // Product info area
        var infoEl = document.createElement('div');
        infoEl.className = 'cb-product-info';

        var titleEl = document.createElement('div');
        titleEl.className = 'cb-product-title';
        titleEl.textContent = product.productTitle || product.productId;
        infoEl.appendChild(titleEl);

        // Price + Learn row
        var showPrices = ctx.settings && ctx.settings.showProductPrices;
        var hasPrice = product.productPrice != null && product.productPrice > 0;

        if (hasPrice || (product.productHandle && !product.isCollection)) {
          var metaRow = document.createElement('div');
          metaRow.className = 'cb-product-meta-row';

          if (hasPrice && showPrices) {
            var priceEl = document.createElement('span');
            priceEl.className = 'cb-product-price';
            priceEl.textContent = formatPrice(product.productPrice, ctx.currencySymbol);
            metaRow.appendChild(priceEl);
          }

          if (product.productHandle && !product.isCollection) {
            var learnLink = document.createElement('a');
            learnLink.href = '/products/' + product.productHandle;
            learnLink.target = '_blank';
            learnLink.className = 'cb-product-learn-link';
            learnLink.innerHTML = '&#9432; Learn';
            learnLink.addEventListener('click', function (e) { e.stopPropagation(); });
            metaRow.appendChild(learnLink);
          }

          infoEl.appendChild(metaRow);
        }

        card.appendChild(infoEl);

        // ADD TO BOX / REMOVE FROM BOX button
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        if (isUsed) {
          addBtn.className = 'cb-add-btn cb-add-btn--used';
          addBtn.innerHTML = '&#10003; Added';
          addBtn.disabled = true;
        } else if (isCurrentSlot) {
          addBtn.className = 'cb-add-btn cb-add-btn--remove';
          addBtn.innerHTML = '&times; REMOVE FROM BOX';
        } else {
          addBtn.className = 'cb-add-btn';
          addBtn.innerHTML = '+ ADD TO BOX';
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
        } else if (!isUsed) {
          ;(function (p, aBtn) {
            function doAddToSlot(variantId, variantTitle) {
              aBtn.innerHTML = '&#10003; Added';
              aBtn.classList.add('cb-add-btn--added');

              slots[activeSlotIndex] = {
                productId: p.productId,
                productTitle: p.productTitle,
                productImageUrl: p.productImageUrl,
                productHandle: p.productHandle,
                productPrice: p.productPrice,
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
              var needsPicker = !p.isCollection && !!p.productHandle;
              if (needsPicker) {
                showVariantPicker(card, p, aBtn, function (variantId, variantTitle) {
                  doAddToSlot(variantId, variantTitle);
                });
              } else {
                doAddToSlot(p.variantIds[0] || null, null);
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

    renderProductGrid();
    updateCartButton();

    // ── Cart Action ──
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

      // Resolve missing variantIds (existing boxes created before the fix)
      var resolvePromises = slots.map(function (p) {
        if (!p || (p.variantIds && p.variantIds.length > 0)) return Promise.resolve();
        if (!p.productHandle) return Promise.resolve();
        return fetch('/products/' + p.productHandle + '.js')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.variants && data.variants.length > 0) {
              p.variantIds = [String(data.variants[0].id)];
            }
          })
          .catch(function () {});
      });

      Promise.all(resolvePromises).then(function () {
        addToCart(
          box,
          slots,
          sessionId,
          giftInput ? giftInput.value : null,
          inlineCartBtn,
          _stickyBtn,
          resolveAddToCartLabel(ctx.settings),
          ctx.currencySymbol,
          ctx.apiBase,
          ctx.shop
        );
      });
    }

    inlineCartBtn.addEventListener('click', doAddToCart);

    // Create sticky footer
    createStickyFooter(box, ctx, doAddToCart);
    updateCartButton();
  }

  // ─── Add to Cart ──────────────────────────────────────────────────────────────

  function addToCart(box, slots, sessionId, giftMessage, inlineBtn, stickyBtn, readyLabel, currencySymbol, apiBase, shop) {
    var resolvedReadyLabel = readyLabel || 'Add To Cart';
    var resolvedCurrencySymbol = currencySymbol || '\u20B9';
    var resolvedApiBase = String(apiBase || DEFAULT_API_BASE || '').replace(/\/+$/, '');
    var sectionIds = ['cart-drawer', 'cart-icon-bubble', 'cart-notification-button', 'cart-notification'];

    function setBtns(state, text) {
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
        btn.textContent = text;
      });
    }

    setBtns('loading', 'Adding…');

    function postCartItems(items) {
      console.log('[ComboBuilder] postCartItems — sending variant id:', items[0] && items[0].id, '| full item:', JSON.stringify(items[0]));
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

      // For dynamic mode, the effective cart price = sum of selected product prices.
      // For manual mode, it is the fixed bundlePrice set by the merchant.
      var effectivePrice = isDynamic ? totalMrp : (parseFloat(box.bundlePrice) || 0);

      var bundleProps = {
        '_bundle_price_item': 'true',
        '_combo_session_id': sessionId,
        '_combo_box_id': String(box.id),
        '_combo_shopify_variant_id': String(box.shopifyVariantId),
        'Bundle': box.displayTitle,
        'Combo Price': formatPrice(effectivePrice, resolvedCurrencySymbol),
        '_combo_price_type': isDynamic ? 'dynamic' : 'manual',
      };
      if (box.shopifyProductId) {
        bundleProps['_combo_shopify_product_id'] = String(box.shopifyProductId);
      }
      if (box.bannerImageUrl) bundleProps['_combo_box_image'] = box.bannerImageUrl;

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
        bundleProps['Selected Items Total'] = formatPrice(totalMrp, resolvedCurrencySymbol);
        bundleProps['MRP'] = formatPrice(totalMrp, resolvedCurrencySymbol);
      }

      // Show savings only for manual mode (dynamic price = MRP, no discount)
      if (!isDynamic && totalMrp > effectivePrice && totalMrp > 0) {
        var savingsAmt = totalMrp - effectivePrice;
        var savingsPct = Math.round((savingsAmt / totalMrp) * 100);
        bundleProps['_combo_savings_amount'] = savingsAmt.toFixed(2);
        bundleProps['_combo_discount_pct'] = String(savingsPct);
        bundleProps['You Save'] = formatPrice(savingsAmt, resolvedCurrencySymbol) + ' (' + savingsPct + '% OFF)';
        bundleProps['Discount'] = savingsPct + '% OFF';
      }

      if (giftMessage) bundleProps['Gift Message'] = giftMessage;
      items.push({ id: box.shopifyVariantId, quantity: 1, properties: bundleProps });
    } else {
      setBtns('error', 'Combo product not linked');
      setTimeout(function () { setBtns('ready', resolvedReadyLabel); }, 2500);
      return;
    }

    // For dynamic pricing: update the Shopify variant price to match selected products total,
    // then add to cart so the cart reflects the correct price.
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
        return postCartItems(items);
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
        .then(function () { return postCartItems(items); });
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
              return isDynamic ? updateDynamicPriceThenCart() : postCartItems(items);
            });
        });
      })
      .then(function (cartResponse) {
        setBtns('success', 'Added to Cart! ✓');

        // cart/add.js returns sections HTML when requested — use it to refresh drawer content
        syncThemeCartUI(cartResponse);

        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));

        var opened = tryOpenThemeCartDrawer();
        if (!opened) setTimeout(function () { window.location.href = '/cart'; }, 1200);
      })
      .catch(function (err) {
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

      document.body.classList.add('overflow-hidden');
      document.documentElement.classList.add('overflow-hidden');
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

    document.dispatchEvent(new CustomEvent('comboBuildReady', { bubbles: true, detail: { widgetCount: widgetCount } }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
