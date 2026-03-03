(function () {
  'use strict';

  var DEFAULT_API_BASE = '/apps/combo-builder';

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function generateSessionId() {
    return 'cb_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  }

  function formatPrice(amount, currencySymbol) {
    return currencySymbol + Number(amount).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  // ─── Main Widget Init ─────────────────────────────────────────────────────────
  // Supports two mount modes:
  //   1. App Block:  <div id="combo-builder-widget-{blockId}"> via __COMBO_BUILDER__ queue
  //   2. Legacy div: <div id="combo-builder-widget" data-page="all" data-box-ids="1,2">

  function initWidget(config) {
    var root = document.getElementById(config.mountId);
    if (!root) return;

    var shop = root.dataset.shop || config.shop;
    var currencySymbol = root.dataset.currencySymbol || config.currencySymbol || '\u20B9';
    var layout = root.dataset.layout || config.layout || 'grid';
    var heading = root.dataset.heading || config.heading || 'Build Your Own Box!';
    var apiBase = root.dataset.apiBase || config.apiBase || DEFAULT_API_BASE;

    // Optional box ID filter (for data-box-ids="1,3,5" or config.boxIds)
    var boxIdsFilter = null;
    var rawBoxIds = root.dataset.boxIds || config.boxIds || null;
    if (rawBoxIds) {
      boxIdsFilter = String(rawBoxIds).split(',').map(function (id) { return parseInt(id.trim(), 10); }).filter(Boolean);
    }

    if (!shop) {
      console.warn('[ComboBuilder] No shop specified — widget cannot load.');
      root.innerHTML = '';
      return;
    }

    fetchBoxes(shop, apiBase, function (err, boxes) {
      if (err || !boxes || boxes.length === 0) {
        root.innerHTML = '';
        return;
      }

      // Apply box ID filter if specified
      if (boxIdsFilter && boxIdsFilter.length > 0) {
        boxes = boxes.filter(function (b) { return boxIdsFilter.indexOf(b.id) !== -1; });
      }

      if (boxes.length === 0) {
        root.innerHTML = '';
        return;
      }

      renderWidget(root, { shop: shop, boxes: boxes, currencySymbol: currencySymbol, layout: layout, heading: heading, apiBase: apiBase });
    });
  }

  // ─── Legacy Div Init ─────────────────────────────────────────────────────────
  // Handles: <div id="combo-builder-widget" data-page="all" data-box-ids="1,2">

  function initLegacyWidget(el) {
    var shop = el.dataset.shop || (window.Shopify && window.Shopify.shop) || null;
    var apiBase = el.dataset.apiBase || DEFAULT_API_BASE;
    var currencySymbol = el.dataset.currencySymbol || (window.Shopify && window.Shopify.currency && window.Shopify.currency.symbol) || '\u20B9';
    var layout = el.dataset.layout || 'grid';
    var heading = el.dataset.heading || 'Build Your Own Box!';
    var boxIds = el.dataset.boxIds || null;

    initWidget({
      mountId: el.id,
      shop: shop,
      apiBase: apiBase,
      currencySymbol: currencySymbol,
      layout: layout,
      heading: heading,
      boxIds: boxIds,
    });
  }

  // ─── API Calls ────────────────────────────────────────────────────────────────

  function fetchBoxes(shop, apiBase, cb) {
    var url = apiBase + '/api/storefront/boxes?shop=' + encodeURIComponent(shop);
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { cb(null, data); })
      .catch(function (e) {
        console.error('[ComboBuilder] Failed to fetch boxes:', e);
        cb(e, null);
      });
  }

  function fetchProducts(boxId, shop, apiBase, cb) {
    var url = apiBase + '/api/storefront/boxes/' + boxId + '/products?shop=' + encodeURIComponent(shop);
    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { cb(null, data); })
      .catch(function (e) {
        console.error('[ComboBuilder] Failed to fetch products:', e);
        cb(e, null);
      });
  }

  // ─── Render Widget ────────────────────────────────────────────────────────────

  function renderWidget(root, ctx) {
    root.innerHTML = '';
    root.className = 'combo-builder-root cb-loaded';

    var wrapper = document.createElement('div');
    wrapper.className = 'cb-wrapper';

    if (ctx.heading) {
      var h = document.createElement('h2');
      h.className = 'cb-heading';
      h.textContent = ctx.heading;
      wrapper.appendChild(h);
    }

    var boxGrid = document.createElement('div');
    boxGrid.className = 'cb-box-grid';
    ctx.boxes.forEach(function (box) {
      boxGrid.appendChild(createBoxCard(box, ctx));
    });
    wrapper.appendChild(boxGrid);

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
    card.setAttribute('data-box-id', box.id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', 'Select ' + box.displayTitle + ' — ' + formatPrice(box.bundlePrice, ctx.currencySymbol));

    var banner = document.createElement('div');
    banner.className = 'cb-box-banner';
    if (box.bannerImageUrl) {
      banner.style.backgroundImage = 'url(' + box.bannerImageUrl + ')';
      banner.style.backgroundSize = 'cover';
      banner.style.backgroundPosition = 'center';
    }
    var badge = document.createElement('span');
    badge.className = 'cb-box-badge';
    badge.textContent = box.itemCount + ' items';
    banner.appendChild(badge);
    card.appendChild(banner);

    var body = document.createElement('div');
    body.className = 'cb-box-body';

    var title = document.createElement('div');
    title.className = 'cb-box-title';
    title.textContent = box.displayTitle;
    body.appendChild(title);

    if (box.isGiftBox) {
      var giftTag = document.createElement('span');
      giftTag.className = 'cb-gift-tag';
      giftTag.textContent = 'Gift Box';
      body.appendChild(giftTag);
    }

    var price = document.createElement('div');
    price.className = 'cb-box-price';
    price.textContent = formatPrice(box.bundlePrice, ctx.currencySymbol);
    body.appendChild(price);

    var btn = document.createElement('button');
    btn.className = 'cb-box-cta-btn';
    btn.type = 'button';
    btn.textContent = 'BUILD YOUR OWN BOX';
    body.appendChild(btn);

    card.appendChild(body);

    function onSelect() {
      // Deselect all other cards
      var allCards = document.querySelectorAll('.cb-box-card');
      for (var i = 0; i < allCards.length; i++) {
        allCards[i].classList.remove('cb-box-card--active');
      }
      card.classList.add('cb-box-card--active');
      openBuilder(box, ctx);
    }

    card.addEventListener('click', onSelect);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
    });

    return card;
  }

  // ─── Builder Area ─────────────────────────────────────────────────────────────

  function openBuilder(box, ctx) {
    // Find the builder area relative to the closest .cb-wrapper ancestor
    var wrapper = document.querySelector('.cb-wrapper');
    if (!wrapper) return;
    var builderArea = wrapper.querySelector('.cb-builder-area');
    if (!builderArea) return;

    builderArea.style.display = 'block';
    builderArea.innerHTML = '<div class="cb-section-loading">Loading products...</div>';

    fetchProducts(box.id, ctx.shop, ctx.apiBase, function (err, products) {
      if (err || !products || products.length === 0) {
        builderArea.innerHTML = '<p class="cb-error">Failed to load products. Please reload and try again.</p>';
        return;
      }
      renderBuilder(builderArea, box, products, ctx);
      builderArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function renderBuilder(container, box, products, ctx) {
    container.innerHTML = '';

    var sessionId = generateSessionId();
    var slots = [];
    for (var s = 0; s < box.itemCount; s++) { slots.push(null); }
    var activeSlotIndex = 0;

    // ── Slot Row ──
    var slotSection = document.createElement('div');
    slotSection.className = 'cb-slot-section';

    var slotLabel = document.createElement('div');
    slotLabel.className = 'cb-slot-label';
    slotLabel.textContent = 'Your Selections (' + box.itemCount + ' items)';
    slotSection.appendChild(slotLabel);

    var slotRow = document.createElement('div');
    slotRow.className = 'cb-slot-row';

    function renderSlots() {
      slotRow.innerHTML = '';
      slots.forEach(function (slotProduct, idx) {
        var slot = document.createElement('div');
        slot.className = 'cb-slot';

        if (slotProduct) {
          slot.classList.add('cb-slot--filled');
          slot.title = 'Click to change: ' + slotProduct.productTitle;

          if (slotProduct.productImageUrl) {
            var img = document.createElement('img');
            img.src = slotProduct.productImageUrl;
            img.alt = slotProduct.productTitle || '';
            img.className = 'cb-slot-img';
            slot.appendChild(img);
          } else {
            var phEl = document.createElement('div');
            phEl.className = 'cb-slot-placeholder-img';
            phEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
            slot.appendChild(phEl);
          }

          var slotName = document.createElement('div');
          slotName.className = 'cb-slot-name';
          slotName.textContent = slotProduct.productTitle || '';
          slot.appendChild(slotName);

          var removeBtn = document.createElement('button');
          removeBtn.className = 'cb-slot-remove';
          removeBtn.type = 'button';
          removeBtn.setAttribute('aria-label', 'Remove ' + (slotProduct.productTitle || 'item'));
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
          slot.appendChild(removeBtn);

          ;(function (i) {
            slot.addEventListener('click', function () {
              activeSlotIndex = i;
              renderSlots();
            });
          })(idx);

        } else if (idx === activeSlotIndex) {
          slot.classList.add('cb-slot--active');
          var activeLabel = document.createElement('div');
          activeLabel.className = 'cb-slot-active-label';
          activeLabel.textContent = 'Pick a product';
          slot.appendChild(activeLabel);
        } else {
          slot.classList.add('cb-slot--idle');
          var numLabel = document.createElement('div');
          numLabel.className = 'cb-slot-num';
          numLabel.textContent = idx + 1;
          slot.appendChild(numLabel);
        }

        slotRow.appendChild(slot);
      });
    }

    renderSlots();
    slotSection.appendChild(slotRow);
    container.appendChild(slotSection);

    // ── Gift Message ──
    var giftInput = null;
    if (box.giftMessageEnabled) {
      var giftSection = document.createElement('div');
      giftSection.className = 'cb-gift-section';
      var giftLabel = document.createElement('label');
      giftLabel.className = 'cb-gift-label';
      giftLabel.textContent = 'Gift Message (optional)';
      giftInput = document.createElement('textarea');
      giftInput.className = 'cb-gift-input';
      giftInput.placeholder = 'Add a personal message...';
      giftInput.rows = 2;
      giftSection.appendChild(giftLabel);
      giftSection.appendChild(giftInput);
      container.appendChild(giftSection);
    }

    // ── Product Grid ──
    var productSection = document.createElement('div');
    productSection.className = 'cb-product-section';

    var productLabel = document.createElement('div');
    productLabel.className = 'cb-product-label';
    productSection.appendChild(productLabel);

    var productGrid = document.createElement('div');
    productGrid.className = ctx.layout === 'list' ? 'cb-product-list' : 'cb-product-grid';

    function renderProductGrid() {
      productLabel.textContent = 'Choose a product for slot ' + (activeSlotIndex + 1);
      productGrid.innerHTML = '';

      var usedIds = [];
      if (!box.allowDuplicates) {
        slots.forEach(function (p) { if (p) usedIds.push(p.productId); });
      }

      products.forEach(function (product) {
        var card = document.createElement('div');
        card.className = 'cb-product-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', product.productTitle || product.productId);

        var currentSlotProduct = slots[activeSlotIndex];
        var isCurrentSlot = currentSlotProduct && currentSlotProduct.productId === product.productId;
        var isUsed = !box.allowDuplicates && usedIds.indexOf(product.productId) !== -1 && !isCurrentSlot;

        if (isUsed) {
          card.classList.add('cb-product-card--used');
          card.setAttribute('aria-disabled', 'true');
        }

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

        var titleEl = document.createElement('div');
        titleEl.className = 'cb-product-title';
        titleEl.textContent = product.productTitle || product.productId;
        card.appendChild(titleEl);

        if (!isUsed) {
          ;(function (p) {
            function onProductClick() {
              // Fill active slot with this product
              slots[activeSlotIndex] = p;

              // Flash animation
              card.classList.add('cb-product-card--selected');
              setTimeout(function () { card.classList.remove('cb-product-card--selected'); }, 300);

              // Advance to next empty slot
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

            card.addEventListener('click', onProductClick);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProductClick(); }
            });
          })(product);
        }

        productGrid.appendChild(card);
      });
    }

    renderProductGrid();
    productSection.appendChild(productGrid);
    container.appendChild(productSection);

    // ── Cart Section ──
    var cartSection = document.createElement('div');
    cartSection.className = 'cb-cart-section';

    var progressText = document.createElement('div');
    progressText.className = 'cb-progress-text';

    var cartBtn = document.createElement('button');
    cartBtn.className = 'cb-cart-btn';
    cartBtn.type = 'button';
    cartBtn.disabled = true;
    cartBtn.setAttribute('title', 'Please select all items to continue');

    function updateCartButton() {
      var filled = slots.filter(Boolean).length;
      var remaining = box.itemCount - filled;

      if (remaining > 0) {
        cartBtn.disabled = true;
        cartBtn.classList.remove('cb-cart-btn--ready');
        cartBtn.textContent = remaining + ' more item' + (remaining !== 1 ? 's' : '') + ' needed';
        progressText.textContent = filled + ' / ' + box.itemCount + ' selected';
        cartBtn.setAttribute('title', 'Please select all items to continue');
      } else {
        cartBtn.disabled = false;
        cartBtn.classList.add('cb-cart-btn--ready');
        cartBtn.textContent = 'ADD TO CART — ' + formatPrice(box.bundlePrice, ctx.currencySymbol);
        progressText.textContent = 'All ' + box.itemCount + ' items selected!';
        cartBtn.removeAttribute('title');
      }
    }

    updateCartButton();

    cartBtn.addEventListener('click', function () {
      if (slots.filter(Boolean).length < box.itemCount) return;
      addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, ctx, cartBtn);
    });

    cartSection.appendChild(progressText);
    cartSection.appendChild(cartBtn);
    container.appendChild(cartSection);
  }

  // ─── Add to Cart ──────────────────────────────────────────────────────────────

  function addToCart(box, slots, sessionId, giftMessage, ctx, btn) {
    btn.disabled = true;
    btn.classList.remove('cb-cart-btn--ready');
    btn.classList.add('cb-cart-btn--loading');
    btn.textContent = 'Adding...';

    var items = [];

    // Each selected product at price ₹0 with bundle metadata
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

    // Hidden bundle price product
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
      console.error('[ComboBuilder] No valid variant IDs found for selected products.');
      btn.disabled = false;
      btn.classList.remove('cb-cart-btn--loading');
      btn.classList.add('cb-cart-btn--error');
      btn.textContent = 'Error — Try Again';
      setTimeout(function () {
        btn.classList.remove('cb-cart-btn--error');
        btn.classList.add('cb-cart-btn--ready');
        btn.disabled = false;
        btn.textContent = 'ADD TO CART — ' + formatPrice(box.bundlePrice, ctx.currencySymbol);
      }, 2000);
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
        btn.classList.remove('cb-cart-btn--loading');
        btn.classList.add('cb-cart-btn--success');
        btn.textContent = 'Added to Cart!';

        // Notify theme mini-cart
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));

        setTimeout(function () { window.location.href = '/cart'; }, 1200);
      })
      .catch(function (err) {
        console.error('[ComboBuilder] Add to cart error:', err);
        btn.disabled = false;
        btn.classList.remove('cb-cart-btn--loading');
        btn.classList.add('cb-cart-btn--error');
        btn.textContent = 'Error — Try Again';
        setTimeout(function () {
          btn.classList.remove('cb-cart-btn--error');
          btn.classList.add('cb-cart-btn--ready');
          btn.disabled = false;
          btn.textContent = 'ADD TO CART — ' + formatPrice(box.bundlePrice, ctx.currencySymbol);
        }, 2500);
      });
  }

  function getFirstVariantId(product) {
    if (!product) return null;
    if (product.variantIds && Array.isArray(product.variantIds) && product.variantIds.length > 0) {
      return product.variantIds[0];
    }
    console.warn('[ComboBuilder] No variant ID stored for product:', product.productId, '— assign variants in the box configuration.');
    return null;
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────────

  function bootstrap() {
    // 1. Process __COMBO_BUILDER__ queue (app block approach)
    var queue = window.__COMBO_BUILDER__;
    if (Array.isArray(queue)) {
      queue.forEach(function (config) {
        try { initWidget(config); } catch (e) { console.error('[ComboBuilder]', e); }
      });
    }

    // Override push so future configs are handled immediately
    window.__COMBO_BUILDER__ = {
      push: function (config) {
        try { initWidget(config); } catch (e) { console.error('[ComboBuilder]', e); }
      },
    };

    // 2. Legacy div support (Section 8.2/8.3 of docs)
    //    <div id="combo-builder-widget" data-page="all" data-box-ids="1,3">
    var legacyEl = document.getElementById('combo-builder-widget');
    if (legacyEl) {
      try { initLegacyWidget(legacyEl); } catch (e) { console.error('[ComboBuilder]', e); }
    }

    // Also pick up any numbered legacy widgets: combo-builder-widget-1, -2, etc.
    var legacyEls = document.querySelectorAll('[id^="combo-builder-widget-legacy"]');
    for (var i = 0; i < legacyEls.length; i++) {
      try { initLegacyWidget(legacyEls[i]); } catch (e) { console.error('[ComboBuilder]', e); }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
