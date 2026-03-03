(function () {
  'use strict';

  var DEFAULT_API_BASE = '/apps/combo-builder';

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

  // ─── Sticky Footer singleton ──────────────────────────────────────────────────
  var _stickyEl = null;
  var _stickyBtn = null;

  function removeStickyFooter() {
    if (_stickyEl && _stickyEl.parentNode) {
      _stickyEl.parentNode.removeChild(_stickyEl);
      document.body.style.paddingBottom = '';
    }
    _stickyEl = null;
    _stickyBtn = null;
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

    // Center: total price
    var center = document.createElement('div');
    center.className = 'cb-sticky-total';
    center.innerHTML = 'Total <span class="cb-sticky-price">' + formatPrice(box.bundlePrice, ctx.currencySymbol) + '/-</span>';
    footer.appendChild(center);

    // Right: ADD TO CART button
    var btn = document.createElement('button');
    btn.className = 'cb-sticky-btn';
    btn.type = 'button';
    btn.disabled = true;
    btn.textContent = 'ADD TO CART';
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

    // Builder area (hidden until a box is picked)
    var builderArea = document.createElement('div');
    builderArea.className = 'cb-builder-area';
    builderArea.style.display = 'none';
    wrapper.appendChild(builderArea);

    root.appendChild(wrapper);
  }

  // ─── Box Card ─────────────────────────────────────────────────────────────────

  function createBoxCard(box, ctx) {
    var card = document.createElement('div');
    card.className = 'cb-box-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    // Banner image
    var banner = document.createElement('div');
    banner.className = 'cb-box-banner';
    if (box.bannerImageUrl) {
      banner.style.backgroundImage = 'url(' + box.bannerImageUrl + ')';
      banner.style.backgroundSize = 'cover';
      banner.style.backgroundPosition = 'center';
    }
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
    buyText.textContent = 'Buy ' + box.itemCount + ' products';
    body.appendChild(buyText);

    var priceText = document.createElement('div');
    priceText.className = 'cb-box-price-text';
    priceText.textContent = '@ ' + formatPrice(box.bundlePrice, ctx.currencySymbol);
    body.appendChild(priceText);

    if (box.isGiftBox) {
      var giftTag = document.createElement('span');
      giftTag.className = 'cb-gift-tag';
      giftTag.textContent = '🎁 Gift Box';
      body.appendChild(giftTag);
    }

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

    // Inline ADD TO CART button (at end of slot row)
    var inlineCartBtn = document.createElement('button');
    inlineCartBtn.className = 'cb-inline-cart-btn';
    inlineCartBtn.type = 'button';
    inlineCartBtn.disabled = true;
    inlineCartBtn.textContent = 'ADD TO CART';

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
        if (slotProduct && slotProduct.productImageUrl) {
          var thumb = document.createElement('img');
          thumb.src = slotProduct.productImageUrl;
          thumb.alt = slotProduct.productTitle || '';
          thumb.className = 'cb-slot-step-thumb';
          numEl.appendChild(thumb);
        } else {
          numEl.textContent = idx + 1;
        }
        step.appendChild(numEl);

        // Label below step box
        var labelEl = document.createElement('div');
        labelEl.className = 'cb-slot-step-label';
        var smallText = document.createElement('span');
        smallText.className = 'cb-slot-step-small';
        smallText.textContent = 'Select your';
        labelEl.appendChild(smallText);

        var itemLink = document.createElement('div');
        itemLink.className = 'cb-slot-step-item';
        if (slotProduct) {
          var shortTitle = slotProduct.productTitle || ('Item ' + (idx + 1));
          itemLink.textContent = shortTitle.length > 14 ? shortTitle.slice(0, 13) + '…' : shortTitle;
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
      var addLabel = (ctx.settings && ctx.settings.addToCartLabel) || 'ADD TO CART';

      // Inline button
      inlineCartBtn.disabled = !allFilled;
      if (allFilled) {
        inlineCartBtn.classList.add('cb-inline-cart-btn--ready');
        inlineCartBtn.textContent = addLabel;
      } else {
        inlineCartBtn.classList.remove('cb-inline-cart-btn--ready');
        inlineCartBtn.textContent = 'ADD TO CART';
      }

      // Sticky footer button
      if (_stickyBtn) {
        _stickyBtn.disabled = !allFilled;
        if (allFilled) {
          _stickyBtn.classList.add('cb-sticky-btn--ready');
          _stickyBtn.textContent = addLabel;
        } else {
          _stickyBtn.classList.remove('cb-sticky-btn--ready');
          _stickyBtn.textContent = 'ADD TO CART';
        }
      }

      // Gift message visibility
      if (giftSection) giftSection.style.display = allFilled ? 'block' : 'none';
    }

    // ── Product Grid ──
    function renderProductGrid() {
      productLabel.textContent = 'Choose a product for slot ' + (activeSlotIndex + 1);
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

        // Learn link
        if (product.productHandle && !product.isCollection) {
          var learnRow = document.createElement('div');
          learnRow.className = 'cb-product-learn-row';
          var learnLink = document.createElement('a');
          learnLink.href = '/products/' + product.productHandle;
          learnLink.target = '_blank';
          learnLink.className = 'cb-product-learn-link';
          learnLink.innerHTML = '&#9432; Learn';
          learnLink.addEventListener('click', function (e) { e.stopPropagation(); });
          learnRow.appendChild(learnLink);
          infoEl.appendChild(learnRow);
        }

        card.appendChild(infoEl);

        // ADD TO BOX button
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        if (isUsed) {
          addBtn.className = 'cb-add-btn cb-add-btn--used';
          addBtn.innerHTML = '&#10003; Added';
          addBtn.disabled = true;
        } else {
          addBtn.className = 'cb-add-btn';
          addBtn.innerHTML = '+ ADD TO BOX';
        }

        card.appendChild(addBtn);

        if (!isUsed) {
          ;(function (p, aBtn) {
            function onProductClick() {
              slots[activeSlotIndex] = p;

              aBtn.innerHTML = '&#10003; Added';
              aBtn.classList.add('cb-add-btn--added');

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
      addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, inlineCartBtn, _stickyBtn);
    }

    inlineCartBtn.addEventListener('click', doAddToCart);

    // Create sticky footer
    createStickyFooter(box, ctx, doAddToCart);
    updateCartButton();
  }

  // ─── Add to Cart ──────────────────────────────────────────────────────────────

  function addToCart(box, slots, sessionId, giftMessage, inlineBtn, stickyBtn) {
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

    var items = [];
    slots.forEach(function (product, idx) {
      var variantId = getFirstVariantId(product);
      if (!variantId) return;
      var props = {
        '_combo_box_id': String(box.id),
        '_combo_session_id': sessionId,
        'Bundle': box.displayTitle,
      };
      props['_item_' + (idx + 1)] = product.productId;
      if (giftMessage) props['Gift Message'] = giftMessage;
      items.push({ id: variantId, quantity: 1, properties: props });
    });

    if (box.shopifyVariantId) {
      items.push({
        id: box.shopifyVariantId,
        quantity: 1,
        properties: {
          '_bundle_price_item': 'true',
          '_combo_session_id': sessionId,
          '_combo_box_id': String(box.id),
          'Bundle': box.displayTitle,
        },
      });
    }

    if (items.length === 0) {
      setBtns('error', 'Error — Try Again');
      setTimeout(function () { setBtns('ready', 'ADD TO CART'); }, 2500);
      return;
    }

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ items: items }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.description || 'Cart error'); });
        return r.json();
      })
      .then(function () {
        setBtns('success', 'Added to Cart! ✓');
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));
        setTimeout(function () { window.location.href = '/cart'; }, 1200);
      })
      .catch(function (err) {
        console.error('[ComboBuilder] Add to cart error:', err);
        setBtns('error', 'Error — Try Again');
        setTimeout(function () { setBtns('ready', 'ADD TO CART'); }, 2500);
      });
  }

  function getFirstVariantId(product) {
    if (!product) return null;
    if (product.variantIds && Array.isArray(product.variantIds) && product.variantIds.length > 0) {
      return product.variantIds[0];
    }
    return null;
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
