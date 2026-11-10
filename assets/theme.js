(function () {
  const qs = (selector, context = document) => context.querySelector(selector);
  const qsa = (selector, context = document) => [...context.querySelectorAll(selector)];
  const moneySettings = window.NuageMoney || {};
  const money = (cents) => {
    const value = Number(cents || 0);
    const format = moneySettings.format;
    if (moneySettings.currency && moneySettings.baseCurrency && moneySettings.currency !== moneySettings.baseCurrency) {
      return new Intl.NumberFormat(moneySettings.locale || undefined, { style: 'currency', currency: moneySettings.currency }).format(value / 100);
    }
    if (!format) return new Intl.NumberFormat(undefined, { style: 'currency', currency: moneySettings.currency || 'USD' }).format(value / 100);
    const formatWithDelimiters = (amount, precision, thousands = ',', decimal = '.') => {
      const [whole, fraction] = (amount / 100).toFixed(precision).split('.');
      return whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) + (fraction ? decimal + fraction : '');
    };
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, (match, key) => ({
      amount: formatWithDelimiters(value, 2),
      amount_no_decimals: formatWithDelimiters(value, 0),
      amount_with_comma_separator: formatWithDelimiters(value, 2, '.', ','),
      amount_no_decimals_with_comma_separator: formatWithDelimiters(value, 0, '.', ','),
      amount_with_apostrophe_separator: formatWithDelimiters(value, 2, "'", '.'),
      amount_no_decimals_with_space_separator: formatWithDelimiters(value, 0, ' ', ','),
      amount_with_space_separator: formatWithDelimiters(value, 2, ' ', ','),
      amount_with_period_and_space_separator: formatWithDelimiters(value, 2, ' ', '.')
    }[key] ?? formatWithDelimiters(value, 2)));
  };
  window.NuageFormatMoney = money;
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const mediaSource = (value) => typeof value === 'string' ? value : value?.src || value?.url || value?.originalSrc || value?.original_src || '';
  const mediaUrl = (value) => String(mediaSource(value)).replace(/^\/\//, 'https://');
  const pricing = window.NuagePricing || {
    details(source) {
      const price = Number(source?.price || 0);
      const compareAtPrice = Number(source?.compare_at_price || 0);
      const hasDiscount = compareAtPrice > price;
      return { price, compareAtPrice: hasDiscount ? compareAtPrice : 0, hasDiscount, discountPercent: hasDiscount ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100) : 0 };
    },
    variant(product, variantId) {
      return product?.variants?.find((candidate) => String(candidate.id) === String(variantId)) || product?.variants?.find((candidate) => candidate.available) || product?.variants?.[0] || product;
    },
    product(product, variantId) {
      return this.details(this.variant(product, variantId));
    }
  };
  window.NuagePricing = pricing;

  const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusReturn = new Map();
  const trapFocus = (container, event) => {
    if (event.key !== 'Tab') return;
    const focusable = qsa(focusableSelector, container).filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const openFocus = (container) => {
    if (!container || focusReturn.has(container)) return;
    focusReturn.set(container, document.activeElement);
    requestAnimationFrame(() => qs(focusableSelector, container)?.focus({ preventScroll: true }));
  };
  const closeFocus = (container) => {
    if (!container || !focusReturn.has(container)) return;
    const previous = focusReturn.get(container);
    focusReturn.delete(container);
    if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
  };
  const cartDrawer = qs('#cart-drawer');
  let lockedScrollY = 0;
  const setDrawer = (drawer, open) => {
    if (!drawer) return;
    const wasOpen = drawer.classList.contains('is-open');
    if (open && !wasOpen && drawer.matches('.cart-drawer')) lockedScrollY = window.scrollY;
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    if (drawer.matches('.cart-drawer')) {
      document.documentElement.classList.toggle('cart-drawer-lock', open);
      document.body.classList.toggle('cart-drawer-lock', open);
    }
    if (open && !wasOpen) openFocus(qs('[role="dialog"]', drawer));
    if (!open && wasOpen) {
      closeFocus(qs('[role="dialog"]', drawer));
      if (drawer.matches('.cart-drawer')) window.requestAnimationFrame(() => window.scrollTo(0, lockedScrollY));
    }
  };
  qsa('#cart-drawer, #wishlist-drawer, #quick-shop').forEach((drawer) => drawer.addEventListener('keydown', (event) => trapFocus(qs('[role="dialog"]', drawer) || drawer, event)));
  const closeAllDrawers = () => {
    setDrawer(cartDrawer, false);
    if (typeof closeWishlist === 'function') closeWishlist();
    else setDrawer(qs('#wishlist-drawer'), false);
    closeQuickShop();
  };

  const cartFeedback = qs('[data-cart-feedback]');
  function showCartFeedback(message, error = false) {
    const text = qs('[data-cart-feedback-message]');
    if (text) text.textContent = message;
    cartFeedback?.classList.toggle('is-error', error);
    if (cartFeedback) cartFeedback.hidden = false;
  }
  qs('[data-cart-feedback-close]')?.addEventListener('click', () => { cartFeedback.hidden = true; });
  let cartRevision = 0;
  let cartQueue = Promise.resolve();
  const cartEndpoint = (route, fallback) => `${(route || fallback).replace(/\.js$/, '')}.js`;
  async function cartRequest(url, options = {}) {
    const response = await fetch(url, { ...options, cache: 'no-store', headers: { Accept: 'application/json', ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.description || data.message || 'Unable to update your bag. Please try again.');
    return data;
  }

  async function applyDiscount(code) {
    const copy = window.NuageCopy || {};
    const message = qs('[data-cart-discount-message]');
    const routes = window.ShopifyRoutes || {};
    const current = await cartRequest(routes.cartJson || '/cart.js');
    const existing = (current.discount_codes || []).map((discount) => String(discount.code || '')).filter((existingCode) => existingCode && existingCode.toLowerCase() !== code.toLowerCase());
    const cart = await queueCartUpdate(() => cartRequest(cartEndpoint(routes.cartUpdate, '/cart/update'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ discount: [...existing, code].join(',') }) }));
    const applied = (cart.discount_codes || []).find((discount) => String(discount.code || '').toLowerCase() === code.toLowerCase());
    await refreshCart();
    if (!applied) throw new Error(copy.discountInvalid || 'That discount code is not valid.');
    if (!applied.applicable) throw new Error('This code is valid but does not apply to the items in your bag yet.');
    if (message) message.textContent = copy.discountApplied || 'Discount code applied.';
  }

  qs('[data-cart-discount]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = qs('input[name="code"]', form);
    const message = qs('[data-cart-discount-message]');
    const button = qs('button[type="submit"]', form);
    const code = input?.value.trim();
    if (!code) { if (message) message.textContent = 'Enter a discount code.'; return; }
    if (button) { button.disabled = true; button.textContent = '…'; }
    if (message) message.textContent = '';
    applyDiscount(code).catch((error) => { if (message) message.textContent = error.message || 'That discount code is not valid.'; }).finally(() => { if (button) { button.disabled = false; button.textContent = 'Apply'; } });
  });

  const quickShopModal = qs('#quick-shop');
  const quickShopBody = qs('[data-quick-shop-body]');
  const quickShopSettings = window.NuageThemeSettings || {};
  const progressThreshold = Math.round(Number(quickShopSettings.cartProgressThreshold ?? 0) * 100 * (moneySettings.rate || 1));
  function formatMoney(cents) {
    return money(cents);
  }

  function resolveVariant(variants, values, changedIndex = null) {
    const exact = variants.find((variant) => variant.options.every((value, index) => value === values[index]));
    if (exact) return exact;
    if (changedIndex === null) return null;
    const candidates = variants.filter((variant) => variant.options.every((value, index) => index > changedIndex || value === values[index]));
    return candidates.find((variant) => variant.available) || candidates[0] || null;
  }

  function progressMessage(subtotal) {
    if (!progressThreshold) return { label: quickShopSettings.cartProgressLabel || 'Unlock free shipping', remaining: '', percent: 0 };
    const percent = Math.min(100, Math.round((subtotal / progressThreshold) * 100));
    if (subtotal >= progressThreshold) return { label: quickShopSettings.cartProgressCompleteLabel || 'Free shipping unlocked', remaining: 'Unlocked', percent };
    return { label: quickShopSettings.cartProgressLabel || 'Unlock free shipping', remaining: `${formatMoney(progressThreshold - subtotal)} away`, percent };
  }

  function fallbackCartLinePricing(item) {
    const originalLinePrice = Number(item.original_line_price || (Number(item.price || 0) * Number(item.quantity || 0)));
    const finalLinePrice = Number(item.final_line_price || originalLinePrice);
    return {
      referenceLinePrice: originalLinePrice,
      merchandiseSavings: 0,
      savePercent: 0,
      finalLinePrice
    };
  }

  // Line-level discounts are already deducted from items_subtotal_price, so only cart-level ones go in the Discount row.
  const cartLevelDiscount = (cart) => (cart.cart_level_discount_applications || []).reduce((sum, discount) => sum + Number(discount.total_allocated_amount || 0), 0);
  async function getCartPricing(cart) {
    const lines = new Map();
    if (!cart.items.length) return { lines, merchandiseSavings: 0, totalDiscount: cartLevelDiscount(cart) };
    const handles = [...new Set(cart.items.map((item) => item.handle).filter(Boolean))];
    const products = await Promise.allSettled(handles.map((handle) => fetchProduct(handle)));
    const productsByHandle = new Map();
    products.forEach((result, index) => {
      if (result.status === 'fulfilled') productsByHandle.set(handles[index], result.value);
    });
    let merchandiseSavings = 0;
    cart.items.forEach((item) => {
      const fallback = fallbackCartLinePricing(item);
      const product = productsByHandle.get(item.handle);
      const variant = product?.variants?.find((candidate) => String(candidate.id) === String(item.variant_id));
      const variantPricing = pricing.details(variant || item);
      const originalLinePrice = fallback.referenceLinePrice;
      const itemUnitPrice = Number(item.original_price || item.price || 0);
      const variantUnitPrice = Number(variant?.price || 0);
      const presentmentRatio = variantUnitPrice > 0 && itemUnitPrice > 0 ? itemUnitPrice / variantUnitPrice : 1;
      const compareAtUnitPrice = variantPricing.hasDiscount ? Math.round(variantPricing.compareAtPrice * presentmentRatio) : 0;
      const compareAtLinePrice = compareAtUnitPrice * Number(item.quantity || 0);
      const referenceLinePrice = Math.max(originalLinePrice, compareAtLinePrice);
      const lineMerchandiseSavings = Math.max(0, referenceLinePrice - originalLinePrice);
      merchandiseSavings += lineMerchandiseSavings;
      lines.set(item.key, {
        referenceLinePrice,
        merchandiseSavings: lineMerchandiseSavings,
        savePercent: referenceLinePrice > 0 ? Math.round((lineMerchandiseSavings / referenceLinePrice) * 100) : 0,
        finalLinePrice: fallback.finalLinePrice
      });
    });
    return { lines, merchandiseSavings, totalDiscount: cartLevelDiscount(cart) };
  }

  function renderCartItems(cart, pricing = { lines: new Map() }) {
    const items = qs('[data-cart-items]');
    if (!items) return '';
    if (!cart.items.length) {
      items.innerHTML = '<p class="empty-state">Your bag is empty.</p>';
      return '';
    }
    items.innerHTML = cart.items.map((item) => {
      const linePricing = pricing.lines.get(item.key) || fallbackCartLinePricing(item);
      const showReferencePrice = linePricing.referenceLinePrice > linePricing.finalLinePrice;
      return `
      <article class="drawer-line" data-cart-line="${escapeHtml(item.key)}" data-product-handle="${escapeHtml(item.handle)}" data-product-id="${item.product_id}" data-variant-id="${item.variant_id}" data-quantity="${item.quantity}">
        <a class="drawer-line__media" href="${escapeHtml(item.url)}"><img src="${escapeHtml(item.image || '')}" alt="${escapeHtml(item.product_title)}"></a>
        <div class="drawer-line__details">
          <p class="drawer-line__vendor">${escapeHtml(item.vendor || 'Nuage')}</p>
          <h3><a href="${escapeHtml(item.url)}">${escapeHtml(item.product_title)}</a></h3>
          ${item.variant_title && item.variant_title !== 'Default Title' ? `<p>${escapeHtml(item.variant_title)}</p>` : ''}
          <div class="drawer-line__controls">
            <div class="drawer-quantity"><button type="button" data-cart-quantity="-1" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-cart-quantity="1" aria-label="Increase quantity">+</button></div>
            <button class="drawer-edit" type="button" data-cart-edit>Edit</button>
            ${item.options_with_values?.some((option) => /size/i.test(option.name)) ? `<button class="drawer-size-guide" type="button" data-size-guide-open data-product-handle="${escapeHtml(item.handle)}">Size guide</button>` : ''}
            <button class="drawer-remove" type="button" data-remove-line>Remove</button>
          </div>
        </div>
        <div class="drawer-line__price"><strong>${formatMoney(item.final_line_price)}</strong>${showReferencePrice ? `<s>${formatMoney(linePricing.referenceLinePrice)}</s>` : ''}${linePricing.savePercent ? `<span class="cart-price__save">Save ${linePricing.savePercent}%</span>` : ''}</div>
      </article>
    `;
    }).join('');
    return items.innerHTML;
  }

  function updateCartSummary(cart, pricing = { totalDiscount: cartLevelDiscount(cart), merchandiseSavings: 0 }) {
    const subtotal = qs('[data-cart-subtotal]');
    if (subtotal) subtotal.textContent = formatMoney(cart.items_subtotal_price);
    const total = qs('[data-cart-total]');
    if (total) total.textContent = formatMoney(cart.total_price);
    const discountRow = qs('[data-cart-discount-row]');
    const discountTotal = qs('[data-cart-discount-total]');
    const totalDiscount = Number(pricing.totalDiscount || 0);
    if (discountRow) discountRow.hidden = !totalDiscount;
    if (discountTotal) discountTotal.textContent = `–${formatMoney(totalDiscount)}`;
    const savingsRow = qs('[data-cart-savings-row]');
    const savingsTotal = qs('[data-cart-savings-total]');
    const merchandiseSavings = Number(pricing.merchandiseSavings || 0);
    if (savingsRow) savingsRow.hidden = !merchandiseSavings;
    if (savingsTotal) savingsTotal.textContent = formatMoney(merchandiseSavings);
    const summary = qs('[data-cart-summary]');
    if (summary) summary.classList.toggle('is-empty', !cart.items.length);
    const discount = qs('[data-cart-discount]');
    if (discount) discount.classList.toggle('is-empty', !cart.items.length);
    const checkout = qs('[data-cart-checkout]');
    if (checkout) {
      checkout.textContent = cart.items.length ? 'Checkout' : 'Shop now';
      checkout.href = cart.items.length ? (window.ShopifyRoutes || {}).checkoutUrl || '/checkout' : (window.ShopifyRoutes || {}).allProductsUrl || '/collections/all';
    }
  }

  function updateCartProgress(cart) {
    const progress = qs('[data-cart-progress]');
    if (!progress) return;
    const data = progressMessage(cart.items_subtotal_price);
    progress.hidden = !progressThreshold;
    const label = qs('[data-cart-progress-label]');
    if (label) label.textContent = data.label;
    const remaining = qs('[data-cart-progress-remaining]');
    if (remaining) remaining.textContent = data.remaining;
    const bar = qs('[data-cart-progress-bar]');
    if (bar) bar.style.width = `${data.percent}%`;
    qs('[data-cart-progress] [role="progressbar"]')?.setAttribute('aria-valuenow', String(data.percent));
  }

  function recommendationCard(product) {
    const image = mediaUrl(product.featured_image || product.images?.[0] || '');
    const productPricing = pricing.product(product);
    return `
      <article class="cart-recommendation" data-product-handle="${escapeHtml(product.handle)}">
        <a href="${escapeHtml(product.url)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}"></a>
        <div><p>${escapeHtml(product.vendor || 'Nuage')}</p><h4><a href="${escapeHtml(product.url)}">${escapeHtml(product.title)}</a></h4><strong>${formatMoney(productPricing.price)}</strong>${productPricing.hasDiscount ? `<s>${formatMoney(productPricing.compareAtPrice)}</s><span class="product-card__save">Save ${productPricing.discountPercent}%</span>` : ''}</div>
        <button type="button" data-quick-open data-product-handle="${escapeHtml(product.handle)}">Add</button>
      </article>
    `;
  }

  let recommendationRequestId = 0;
  async function loadRecommendations(productId) {
    const section = qs('[data-cart-recommendations]');
    const grid = qs('[data-cart-recommendation-items]');
    if (!section || !grid || !productId) { if (section) section.hidden = true; return; }
    const requestId = ++recommendationRequestId;
    section.hidden = false;
    grid.innerHTML = '<p class="empty-state">Loading recommendations…</p>';
    try {
      const root = (window.ShopifyRoutes.rootUrl || '').replace(/\/$/, '');
      const response = await fetch(`${root}/recommendations/products.json?product_id=${encodeURIComponent(productId)}&limit=4&_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Recommendations unavailable');
      const data = await response.json();
      if (requestId !== recommendationRequestId) return;
      const products = (data.products || []).filter((product) => product.available).slice(0, 4);
      section.hidden = !products.length;
      grid.innerHTML = products.map(recommendationCard).join('');
    } catch (error) {
      section.hidden = true;
    }
  }

  function productRecommendationCard(product) {
    const image = mediaUrl(product.featured_image || product.images?.[0] || '');
    const secondaryImage = mediaUrl(product.images?.[1] || '');
    const productPricing = pricing.product(product);
    const price = productPricing.price;
    const compareAtPrice = productPricing.compareAtPrice;
    const savePercent = productPricing.discountPercent;
    const variant = product.variants?.find((candidate) => candidate.available) || product.variants?.[0] || product;
    const variantTitle = variant?.title && variant.title !== 'Default Title' ? variant.title : '';
    const colorOption = (product.options_with_values || []).find((option) => /color|colour/i.test(option.name));
    const colorValues = colorOption?.values || [];
    const colorMarkup = colorValues.length ? `<div class="product-card__colors" aria-label="${colorValues.length} color options">${colorValues.slice(0, 5).map((value) => `<span class="color-dot" data-color="${escapeHtml(String(value).toLowerCase().replace(/\s+/g, '-'))}" title="${escapeHtml(value)}"></span>`).join('')}${colorValues.length > 5 ? `<span class="color-more">+${colorValues.length - 5}</span>` : ''}<span class="color-count">${colorValues.length} colors</span></div>` : '';
    return `
      <article class="product-card${secondaryImage ? ' product-card--has-secondary' : ''}">
        <div class="product-card__media">
          ${savePercent ? '<span class="badge">Sale</span>' : ''}
          <a href="${escapeHtml(product.url || `/products/${product.handle}`)}">${image ? `<img class="product-card__image product-card__image--primary" src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}" loading="lazy">${secondaryImage ? `<img class="product-card__image product-card__image--secondary" src="${escapeHtml(secondaryImage)}" alt="${escapeHtml(product.title)}" loading="lazy">` : ''}` : '<div class="media-placeholder"></div>'}</a>
          <button class="wishlist-card" type="button" data-wishlist data-wishlist-handle="${escapeHtml(product.handle)}" data-wishlist-url="${escapeHtml(product.url || `/products/${product.handle}`)}" data-wishlist-title="${escapeHtml(product.title)}" data-wishlist-image="${escapeHtml(image)}" data-wishlist-price="${escapeHtml(formatMoney(price))}" data-wishlist-compare-price="${escapeHtml(compareAtPrice ? formatMoney(compareAtPrice) : '')}" data-wishlist-variant-id="${escapeHtml(variant?.id || '')}" data-wishlist-variant-title="${escapeHtml(variantTitle)}" aria-label="Add ${escapeHtml(product.title)} to favorites"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 3A5.5 5.5 0 0 0 2 8.5c0 1.085.136 1.99.527 2.851.386.849.984 1.574 1.766 2.356L10.586 20a2 2 0 0 0 2.828 0l6.293-6.293c.782-.782 1.38-1.507 1.766-2.356.391-.86.527-1.766.527-2.851A5.5 5.5 0 0 0 16.5 3c-1.805 0-3.265.776-4.221 1.807L12 5.086l-.279-.28C10.765 3.777 9.305 3 7.5 3Z"></path></svg></button>
          <button class="quick-shop" type="button" data-quick-open data-product-handle="${escapeHtml(product.handle)}"${product.available === false ? ' disabled' : ''}>Quick shop</button>
        </div>
        <div class="product-card__meta"><a class="product-card__vendor" href="${escapeHtml(product.url || `/products/${product.handle}`)}">${escapeHtml(product.vendor || 'Nuage')}</a><a class="product-card__title" href="${escapeHtml(product.url || `/products/${product.handle}`)}">${escapeHtml(product.title)}</a>${product.type ? `<p class="product-card__subtitle">${escapeHtml(product.type)}</p>` : ''}${colorMarkup}<div class="product-card__price">${formatMoney(price)}${savePercent ? `<s>${formatMoney(compareAtPrice)}</s><span class="product-card__save">Save ${savePercent}%</span>` : ''}</div></div>
      </article>
    `;
  }

  async function loadProductRecommendations() {
    const section = qs('[data-product-recommendations]');
    const grid = qs('[data-product-recommendation-items]');
    if (!section || !grid) return;
    const productId = section.dataset.productId;
    if (!productId) return;
    try {
      const root = (window.ShopifyRoutes.rootUrl || '').replace(/\/$/, '');
      const response = await fetch(`${root}/recommendations/products.json?product_id=${encodeURIComponent(productId)}&limit=8&_=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Recommendations unavailable');
      const data = await response.json();
      const products = (data.products || []).filter((product) => String(product.id) !== String(productId) && product.available !== false).slice(0, 4);
      if (!products.length) { section.hidden = true; return; }
      grid.innerHTML = products.map(productRecommendationCard).join('');
      section.hidden = false;
      updateWishlist();
    } catch (error) {
      section.hidden = true;
    }
  }

  loadProductRecommendations();

  async function refreshCart() {
    const revision = ++cartRevision;
    const routes = window.ShopifyRoutes || {};
    const cart = await cartRequest(routes.cartJson || '/cart.js');
    const pricing = await getCartPricing(cart);
    if (revision !== cartRevision) return cart;
    qsa('[data-cart-count]').forEach((element) => { element.textContent = cart.item_count; });
    qsa('[data-cart-open]').forEach((element) => { element.setAttribute('aria-label', `Cart (${cart.item_count} items)`); });
    renderCartItems(cart, pricing);
    updateCartSummary(cart, pricing);
    updateCartProgress(cart);
    const firstItem = cart.items.find((item) => item.product_id);
    loadRecommendations(firstItem?.product_id);
    return cart;
  }
  const openCart = async () => {
    setDrawer(cartDrawer, true);
    const items = qs('[data-cart-items]');
    if (items) items.innerHTML = '<p class="empty-state">Loading your bag…</p>';
    try { await cartQueue; await refreshCart(); }
    catch (error) {
      if (items) items.innerHTML = '<p class="empty-state">Your bag could not be loaded. Please use View bag below to try again.</p>';
      showCartFeedback(error.message, true);
    }
  };
  qsa('[data-cart-open]').forEach((button) => button.addEventListener('click', openCart));
  qsa('[data-cart-close]').forEach((button) => button.addEventListener('click', () => setDrawer(cartDrawer, false)));
  qs('[data-cart-drawer-body]')?.addEventListener('click', (event) => {
    const line = event.target.closest('[data-cart-line]');
    if (!line) return;
    if (event.target.closest('[data-remove-line]')) return changeLine(line.dataset.cartLine, 0);
    if (event.target.closest('[data-cart-edit]')) {
      openQuickShop(line.dataset.productHandle, { lineKey: line.dataset.cartLine, quantity: Number(line.dataset.quantity || 1), variantId: Number(line.dataset.variantId) });
      return;
    }
    const delta = event.target.closest('[data-cart-quantity]')?.dataset.cartQuantity;
    if (!delta) return;
    const current = Number(line.querySelector('.drawer-quantity span')?.textContent || 0);
    changeLine(line.dataset.cartLine, Math.max(0, current + Number(delta)));
  });
  function queueCartUpdate(task) {
    const pending = cartQueue.then(() => { cartRevision += 1; return task(); });
    cartQueue = pending.catch(() => {});
    return pending;
  }
  async function changeLine(key, quantity) {
    const controls = qsa('[data-cart-drawer-body] button');
    controls.forEach((button) => { button.disabled = true; });
    try {
      await queueCartUpdate(async () => {
        await cartRequest(cartEndpoint((window.ShopifyRoutes || {}).cartChange, '/cart/change'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key, quantity }) });
        await refreshCart();
      });
      if (qs('.cart-page')) window.location.reload();
    } catch (error) { showCartFeedback(error.message, true); }
    finally { controls.forEach((button) => { button.disabled = false; }); }
  }
  // Resolves true when the item was added; shows the error and resolves false otherwise.
  async function addToCart(item, quantity = 1, button, { openDrawer = true } = {}) {
    const payload = typeof item === 'object' ? { ...item } : { id: Number(item), quantity };
    payload.id = Number(payload.id);
    payload.quantity = Math.max(1, Number(payload.quantity || quantity || 1));
    if (button?.getAttribute('aria-busy') === 'true') return false;
    const label = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Adding…'; button.setAttribute('aria-busy', 'true'); }
    try {
      await queueCartUpdate(async () => {
        await cartRequest(cartEndpoint((window.ShopifyRoutes || {}).cartAdd, '/cart/add'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [payload] }) });
        if (!openDrawer) return;
        showCartFeedback(`✓ ${window.NuageCopy?.cartAdded || 'Added to your bag'}`);
        if (button) button.textContent = 'Added ✓';
        try {
          await refreshCart();
          setDrawer(cartDrawer, true);
        } catch (error) {
          showCartFeedback('Added to your bag. The bag preview could not refresh — select View bag to see your items.');
        }
      });
      return true;
    } catch (error) {
      showCartFeedback(error.message, true);
      return false;
    } finally {
      if (button) { button.disabled = false; button.textContent = label; button.removeAttribute('aria-busy'); }
      document.dispatchEvent(new CustomEvent('nuage:cart-add-finished', { detail: { button } }));
    }
  }
  // Adds the new variant first so the original line survives if the new one is out of stock.
  async function replaceCartLine(lineKey, variantId, quantity) {
    await queueCartUpdate(async () => {
      const routes = window.ShopifyRoutes || {};
      const cart = await cartRequest(routes.cartJson || '/cart.js');
      const line = cart.items.find((item) => item.key === lineKey);
      if (line && Number(line.variant_id) === Number(variantId)) {
        await cartRequest(cartEndpoint(routes.cartChange, '/cart/change'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lineKey, quantity }) });
      } else {
        const item = { id: Number(variantId), quantity };
        if (line?.properties && Object.keys(line.properties).length) item.properties = line.properties;
        if (line?.selling_plan_allocation?.selling_plan?.id) item.selling_plan = line.selling_plan_allocation.selling_plan.id;
        await cartRequest(cartEndpoint(routes.cartAdd, '/cart/add'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [item] }) });
        if (line) await cartRequest(cartEndpoint(routes.cartChange, '/cart/change'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lineKey, quantity: 0 }) });
      }
      await refreshCart();
    });
  }

  async function fetchProduct(handle) {
    const root = (window.ShopifyRoutes.rootUrl || '').replace(/\/$/, '');
    const response = await fetch(`${root}/products/${encodeURIComponent(handle)}.js?_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('This product is no longer available.');
    const product = await response.json();
    return product;
  }

  function variantImage(product, variant) {
    const image = variant?.featured_image || product.featured_image || product.images?.[0];
    if (!image) return '';
    if (typeof image === 'string') return image;
    return image.src || image.url || image.originalSrc || image.original_src || '';
  }

  function optionButton(product, option, value, index) {
    const selected = quickShopState?.selected[index] === value;
    const available = product.variants.some((variant) => variant.options[index] === value && variant.available);
    return `<button type="button" class="quick-option${selected ? ' is-selected' : ''}${available ? '' : ' is-unavailable'}" data-quick-option="${index}" data-value="${escapeHtml(value)}" ${selected ? 'aria-pressed="true"' : 'aria-pressed="false"'}${available ? '' : ' disabled'}>${escapeHtml(value)}</button>`;
  }

  let quickShopState = null;

  function renderQuickShop(product, options = {}) {
    const initialVariant = product.variants.find((variant) => variant.id === options.variantId) || product.variants.find((variant) => variant.available) || product.variants[0];
    quickShopState = { product, lineKey: options.lineKey || null, selected: initialVariant ? [...initialVariant.options] : [], quantity: options.quantity || 1, changedIndex: null };
    renderQuickShopSelection();
  }

  function renderQuickShopSelection() {
    if (!quickShopState || !quickShopBody) return;
    const { product, selected, quantity, lineKey } = quickShopState;
    const variant = resolveVariant(product.variants, selected, quickShopState.changedIndex);
    quickShopState.changedIndex = null;
    if (variant) quickShopState.selected = [...variant.options];
    const image = variantImage(product, variant);
    const selectedPricing = pricing.details(variant || product);
    const compare = selectedPricing.compareAtPrice;
    const price = selectedPricing.price;
    const savings = selectedPricing.discountPercent;
    quickShopBody.innerHTML = `
      <div class="quick-shop-product">
        <div class="quick-shop-product__media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}">` : '<span class="media-placeholder"></span>'}</div>
        <div class="quick-shop-product__info">
          <p class="quick-shop-product__vendor">${escapeHtml(product.vendor || 'Nuage')}</p>
          <h2 id="QuickShopTitle">${escapeHtml(product.title)}</h2>
          <div class="quick-shop-product__price"><strong>${formatMoney(price)}</strong>${savings ? `<s>${formatMoney(compare)}</s><span class="product-price__save">Save ${savings}%</span>` : ''}</div>
          ${product.options.length && !(product.variants.length === 1 && /^default title$/i.test(product.variants[0].title || '')) ? product.options.map((option, index) => { const name = typeof option === 'string' ? option : option.name; return `
            <fieldset class="quick-option-group"><legend><span>Select ${escapeHtml(name)}</span>${/size/i.test(name) ? '<button class="size-guide-trigger" type="button" data-size-guide-open aria-haspopup="dialog"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m14.5 4.5 5 5L8 21H3v-5Z"></path><path d="m13 6 5 5M11 8l2 2M8 11l2 2M5 14l2 2"></path></svg>Fit &amp; Size Guide</button>' : ''}</legend><div>${product.variants.map((variant) => variant.options[index]).filter((value, index, values) => value && values.indexOf(value) === index).map((value) => optionButton(product, name, value, index)).join('')}</div></fieldset>
          `; }).join('') : ''}
          <label class="quick-quantity">Qty<span><button type="button" data-quick-quantity="-1" aria-label="Decrease quantity">−</button><input type="number" min="1" value="${quantity}" data-quick-quantity-input aria-label="Quantity"><button type="button" data-quick-quantity="1" aria-label="Increase quantity">+</button></span></label>
          <div class="quick-shop-product__actions"><button class="button button--dark" type="button" data-quick-submit${variant?.available ? '' : ' disabled'}>${lineKey ? 'Update bag' : variant?.available ? 'Add to bag' : 'Sold out'}</button><button class="button button--danger" type="button" data-quick-buy${variant?.available ? '' : ' disabled'}>Buy now</button></div>
          <p class="quick-shop-product__availability" role="status">${variant ? (variant.available ? 'In stock.' : 'This option is currently sold out.') : 'This combination is unavailable.'}</p>
        </div>
      </div>
    `;
  }

  async function openQuickShop(handle, options = {}) {
    if (!quickShopModal || !quickShopBody) return;
    setDrawer(cartDrawer, false);
    if (typeof closeWishlist === 'function') closeWishlist();
    else setDrawer(qs('#wishlist-drawer'), false);
    if (!quickShopModal.classList.contains('is-open')) focusReturn.set(quickShopModal, document.activeElement);
    quickShopModal.classList.add('is-open');
    quickShopModal.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('quick-shop-lock');
    document.body.classList.add('quick-shop-lock');
    quickShopBody.innerHTML = '<p class="empty-state">Loading product options…</p>';
    try {
      const product = await fetchProduct(handle);
      renderQuickShop(product, options);
      (qs('.quick-option:not([disabled])', quickShopBody) || qs(focusableSelector, quickShopModal))?.focus();
    } catch (error) {
      quickShopBody.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
  }

  function closeQuickShop() {
    if (!quickShopModal?.classList.contains('is-open')) return;
    quickShopModal.classList.remove('is-open');
    quickShopModal.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('quick-shop-lock');
    document.body.classList.remove('quick-shop-lock');
    quickShopState = null;
    closeFocus(quickShopModal);
  }

  document.addEventListener('click', (event) => {
    const quickOpen = event.target.closest('[data-quick-open]');
    if (quickOpen) {
      event.preventDefault();
      openQuickShop(quickOpen.dataset.productHandle);
      return;
    }
    if (event.target.closest('[data-quick-close]')) {
      closeQuickShop();
      return;
    }
    const option = event.target.closest('[data-quick-option]');
    if (option && quickShopState) {
      const index = Number(option.dataset.quickOption);
      quickShopState.selected[index] = option.dataset.value;
      quickShopState.changedIndex = index;
      renderQuickShopSelection();
      return;
    }
    const quantityButton = event.target.closest('[data-quick-quantity]');
    if (quantityButton && quickShopState) {
      const input = qs('[data-quick-quantity-input]', quickShopBody);
      const value = Math.max(1, Number(input?.value || 1) + Number(quantityButton.dataset.quickQuantity));
      if (input) input.value = value;
      quickShopState.quantity = value;
      return;
    }
    const submit = event.target.closest('[data-quick-submit]');
    if (submit && quickShopState) {
      const variant = resolveVariant(quickShopState.product.variants, quickShopState.selected);
      if (!variant?.available) return;
      if (quickShopState.lineKey) {
        replaceCartLine(quickShopState.lineKey, variant.id, quickShopState.quantity).then(() => { closeQuickShop(); setDrawer(cartDrawer, true); showCartFeedback('✓ Updated your bag'); }).catch((error) => showCartFeedback(error.message, true));
      } else {
        addToCart(variant.id, quickShopState.quantity, submit).then((added) => { if (added) closeQuickShop(); });
      }
      return;
    }
    const buy = event.target.closest('[data-quick-buy]');
    if (buy && quickShopState) {
      const variant = resolveVariant(quickShopState.product.variants, quickShopState.selected);
      if (!variant?.available) return;
      addToCart(variant.id, quickShopState.quantity, buy, { openDrawer: false }).then((added) => {
        if (!added) return;
        buy.disabled = true;
        buy.textContent = 'Loading…';
        window.location.href = (window.ShopifyRoutes || {}).checkoutUrl || '/checkout';
      });
    }
  });
  quickShopBody?.addEventListener('input', (event) => {
    if (!event.target.matches('[data-quick-quantity-input]') || !quickShopState) return;
    quickShopState.quantity = Math.max(1, Number(event.target.value || 1));
  });
  const sizeGuide = qs('#fit-size-guide');
  let sizeGuideTrigger = null;
  let sizeGuideScrollY = 0;
  const sizeGuideRanges = [
    { size: 'XS', in: [35, 36], cm: [89, 91] },
    { size: 'S', in: [37, 38], cm: [94, 97] },
    { size: 'M', in: [39, 40], cm: [99, 102] },
    { size: 'L', in: [41, 43], cm: [104, 109] },
    { size: 'XL', in: [44, 47], cm: [112, 119] },
    { size: '2XL', in: [48, 51], cm: [122, 130] },
    { size: '3XL', in: [52, 54], cm: [132, 137] },
    { size: '4XL', in: [55, 57], cm: [140, 145] }
  ];
  const sizeAliases = { XS: ['XS'], S: ['S'], M: ['M'], L: ['L'], XL: ['XL'], '2XL': ['2XL', 'XXL'], '3XL': ['3XL', 'XXXL'], '4XL': ['4XL', 'XXXXL'] };
  let sizeGuideUnit = 'in';
  let sizeGuidePreference = 0;
  let sizeGuideSuggestion = null;
  let sizeGuideLineProduct = null;
  function sizeGuideProduct() {
    if (sizeGuideLineProduct) return sizeGuideLineProduct;
    if (quickShopState?.product) return quickShopState.product;
    const data = qs('[data-product-json]');
    if (!data) return null;
    try { return JSON.parse(data.textContent); } catch { return null; }
  }
  function sizeGuideAvailableSizes(product) {
    if (!product) return [];
    const index = product.options.findIndex((option) => /size/i.test(typeof option === 'string' ? option : option.name));
    if (index < 0) return [];
    return [...new Set(product.variants.filter((variant) => variant.available).map((variant) => variant.options[index]))];
  }
  function updateSizeGuideSuggestion() {
    const measurement = Number(qs('[data-size-guide-measurement]', sizeGuide)?.value);
    const available = sizeGuideAvailableSizes(sizeGuideProduct());
    let closest = -1;
    let distance = Infinity;
    if (measurement > 0) sizeGuideRanges.forEach((range, index) => {
      const [min, max] = range[sizeGuideUnit];
      const gap = measurement < min ? min - measurement : measurement > max ? measurement - max : 0;
      if (gap < distance) { distance = gap; closest = index; }
    });
    const range = sizeGuideRanges[Math.max(0, Math.min(sizeGuideRanges.length - 1, closest + sizeGuidePreference))];
    const suggested = closest >= 0 && range && (sizeAliases[range.size] || [range.size]).find((size) => available.includes(size));
    sizeGuideSuggestion = suggested || null;
    const output = qs('[data-size-guide-suggestion]', sizeGuide);
    const status = qs('[data-size-guide-suggestion-status]', sizeGuide);
    const apply = qs('[data-size-guide-apply]', sizeGuide);
    if (output) output.textContent = sizeGuideSuggestion || '—';
    if (status) status.textContent = !measurement ? 'Enter your hip measurement to find your size.' : sizeGuideSuggestion ? (sizeGuideUnit === 'cm' ? `Based on ${measurement} cm hips.` : `Based on ${measurement} in hips.`) : 'This size is unavailable for the selected product. Please choose another option.';
    if (apply) apply.disabled = !sizeGuideSuggestion;
  }
  function applySizeGuideSuggestion() {
    if (!sizeGuideSuggestion) return;
    if (sizeGuideLineProduct) { closeSizeGuide(); return; }
    const product = sizeGuideProduct();
    const index = product?.options.findIndex((option) => /size/i.test(typeof option === 'string' ? option : option.name));
    if (index == null || index < 0) return;
    if (quickShopState?.product === product) {
      quickShopState.selected[index] = sizeGuideSuggestion;
      renderQuickShopSelection();
    } else {
      const group = qs(`[data-option-group][data-option-index="${index}"]`);
      const input = qsa('[data-product-option]', group).find((option) => option.value === sizeGuideSuggestion && !option.disabled);
      if (!input) return;
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeSizeGuide();
    if (quickShopState?.product === product) qs(`[data-quick-option="${index}"][data-value="${sizeGuideSuggestion}"]`, quickShopBody)?.focus({ preventScroll: true });
  }
  function openSizeGuide(trigger) {
    if (!sizeGuide || sizeGuide.classList.contains('is-open')) return;
    sizeGuideTrigger = trigger || document.activeElement;
    const handle = trigger?.closest('[data-cart-line]') ? trigger.dataset.productHandle : null;
    sizeGuideLineProduct = null;
    if (handle) fetchProduct(handle).then((product) => { sizeGuideLineProduct = product; updateSizeGuideSuggestion(); }).catch(() => {});
    sizeGuideScrollY = window.scrollY;
    document.body.style.top = `-${sizeGuideScrollY}px`;
    sizeGuide.classList.add('is-open');
    sizeGuide.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('size-guide-lock');
    document.body.classList.add('size-guide-lock');
    updateSizeGuideSuggestion();
    qs('.size-guide__panel', sizeGuide)?.focus({ preventScroll: true });
  }
  function closeSizeGuide() {
    if (!sizeGuide?.classList.contains('is-open')) return;
    sizeGuide.classList.remove('is-open');
    sizeGuide.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('size-guide-lock');
    document.body.classList.remove('size-guide-lock');
    document.body.style.removeProperty('top');
    window.scrollTo({ top: sizeGuideScrollY, left: 0, behavior: 'instant' });
    sizeGuideTrigger?.focus({ preventScroll: true });
    sizeGuideTrigger = null;
    sizeGuideLineProduct = null;
  }
  function selectSizeGuideTab(name) {
    qsa('[data-size-guide-tab]', sizeGuide).forEach((tab) => {
      const selected = tab.dataset.sizeGuideTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    qsa('[data-size-guide-panel]', sizeGuide).forEach((panel) => { panel.hidden = panel.dataset.sizeGuidePanel !== name; });
  }
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-size-guide-open]');
    if (trigger) { event.preventDefault(); openSizeGuide(trigger); return; }
    if (event.target.closest('[data-size-guide-close]')) { closeSizeGuide(); return; }
    const tab = event.target.closest('[data-size-guide-tab]');
    if (tab) { selectSizeGuideTab(tab.dataset.sizeGuideTab); return; }
    const fitUnit = event.target.closest('[data-size-guide-fit-unit]');
    if (fitUnit) {
      const nextUnit = fitUnit.dataset.sizeGuideFitUnit;
      const input = qs('[data-size-guide-measurement]', sizeGuide);
      if (input?.value && nextUnit !== sizeGuideUnit) input.value = (Math.round(Number(input.value) * (nextUnit === 'cm' ? 2.54 : 1 / 2.54) * 100) / 100).toString();
      sizeGuideUnit = nextUnit;
      qsa('[data-size-guide-fit-unit]', sizeGuide).forEach((button) => button.setAttribute('aria-pressed', String(button === fitUnit)));
      const label = qs('[data-size-guide-fit-unit-label]', sizeGuide);
      if (label) label.textContent = `(${sizeGuideUnit})`;
      if (input) input.placeholder = sizeGuideUnit === 'cm' ? 'e.g. 96.52' : 'e.g. 38';
      updateSizeGuideSuggestion();
      return;
    }
    if (event.target.closest('[data-size-guide-apply]')) { applySizeGuideSuggestion(); return; }
    const unit = event.target.closest('[data-size-guide-unit]');
    if (!unit) return;
    const measurement = unit.dataset.sizeGuideUnit;
    qsa('[data-size-guide-unit]', sizeGuide).forEach((button) => button.setAttribute('aria-pressed', String(button === unit)));
    qsa('[data-size-guide-unit-label]', sizeGuide).forEach((label) => { label.textContent = `(${measurement})`; });
    qsa('[data-size-in]', sizeGuide).forEach((value) => { value.textContent = value.dataset[measurement === 'cm' ? 'sizeCm' : 'sizeIn']; });
  });
  sizeGuide?.addEventListener('input', (event) => { if (event.target.matches('[data-size-guide-measurement]')) updateSizeGuideSuggestion(); });
  sizeGuide?.addEventListener('change', (event) => { if (event.target.matches('[data-size-guide-preference]')) { sizeGuidePreference = Number(event.target.value); updateSizeGuideSuggestion(); } });
  sizeGuide?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSizeGuide(); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const tab = event.target.closest('[data-size-guide-tab]');
      if (!tab) return;
      event.preventDefault();
      const tabs = qsa('[data-size-guide-tab]', sizeGuide);
      const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      selectSizeGuideTab(next.dataset.sizeGuideTab);
      next.focus();
    }
    if (event.key !== 'Tab') return;
    const focusable = qsa('button:not([disabled]), summary, a[href], input, [tabindex="0"]', sizeGuide).filter((element) => !element.closest('[hidden]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === qs('.size-guide__panel', sizeGuide))) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  const productFormItem = (form) => {
    const data = new FormData(form);
    const item = { id: Number(data.get('id')), quantity: Math.max(1, Number(data.get('quantity') || 1)) };
    if (data.get('selling_plan')) item.selling_plan = data.get('selling_plan');
    const properties = {};
    for (const [key, value] of data.entries()) {
      const match = key.match(/^properties\[(.+)\]$/);
      if (match && value !== '') properties[match[1]] = value;
    }
    if (Object.keys(properties).length) item.properties = properties;
    return item;
  };
  window.NuageCart = { addToCart, productFormItem };
  qsa('[data-product-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); const item = productFormItem(form); if (!item.id) return; addToCart(item, item.quantity, qs('button[type="submit"]', form)); }));
  qsa('[data-cart-page-quantity]').forEach((button) => button.addEventListener('click', () => {
    const input = qs('input', button.parentElement);
    const form = button.closest('form');
    const update = qs('[name="update"]', form);
    if (!input || !form || !update) return;
    input.value = Math.max(0, (Number(input.value) || 0) + Number(button.dataset.cartPageQuantity));
    form.requestSubmit(update);
  }));
  const syncCart = () => { cartQueue.then(refreshCart).catch(() => {}); };
  syncCart();
  window.addEventListener('pageshow', (event) => { if (event.persisted) syncCart(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncCart(); });

  const mobileQuery = window.matchMedia('(max-width: 900px)');
  const getHeader = () => qs('[data-header]');
  const getMenuToggle = () => qs('[data-menu-toggle]');
  const getNav = () => qs('[data-mobile-nav]');
  const closeMegaMenus = () => qsa('[data-nav-mega]').forEach((item) => { item.classList.remove('is-open'); qs('.nav-mega__trigger', item)?.setAttribute('aria-expanded', 'false'); });
  const setMenuOpen = (open) => {
    const nav = getNav();
    const menu = getMenuToggle();
    const wasOpen = nav?.classList.contains('is-open');
    nav?.classList.toggle('is-open', open);
    menu?.setAttribute('aria-expanded', String(open));
    menu?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    getHeader()?.classList.toggle('menu-open', open);
    document.documentElement.classList.toggle('menu-lock', open);
    document.body.classList.toggle('menu-lock', open);
    if (open && !wasOpen) requestAnimationFrame(() => qs('a[href], button', nav)?.focus({ preventScroll: true }));
    if (!open && wasOpen && nav?.contains(document.activeElement)) menu?.focus({ preventScroll: true });
  };
  const setPanel = (panel, toggle, open) => {
    if (!panel) return;
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    toggle?.setAttribute('aria-expanded', String(open));
  };
  const closeHeaderPanels = () => {
    setPanel(qs('[data-search-panel]'), qs('[data-search-toggle]'), false);
    setPanel(qs('[data-currency-panel]'), qs('[data-currency-toggle]'), false);
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-menu-toggle]')) { setMenuOpen(!getNav()?.classList.contains('is-open')); return; }
    const trigger = event.target.closest('.nav-mega__trigger');
    const item = trigger?.closest('[data-nav-mega]');
    if (item && mobileQuery.matches && !item.classList.contains('is-open')) {
      event.preventDefault();
      closeMegaMenus();
      item.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      return;
    }
    const navLink = event.target.closest('[data-mobile-nav] a');
    if (navLink && mobileQuery.matches && !navLink.classList.contains('nav-mega__trigger')) { setMenuOpen(false); closeMegaMenus(); }
    const submenuToggle = event.target.closest('[data-mobile-submenu-toggle]');
    if (submenuToggle) {
      const panel = submenuToggle.parentElement?.querySelector('[data-mobile-submenu]');
      if (!panel) return;
      const open = panel.classList.toggle('is-open');
      if (open) {
        qsa('[data-mobile-submenu]').forEach((other) => { if (other !== panel) other.classList.remove('is-open'); });
        qsa('[data-mobile-submenu-toggle]').forEach((other) => { if (other !== submenuToggle) { other.setAttribute('aria-expanded', 'false'); const otherIcon = other.querySelector('span'); if (otherIcon) otherIcon.textContent = '⌄'; } });
      }
      submenuToggle.setAttribute('aria-expanded', String(open));
      const icon = submenuToggle.querySelector('span');
      if (icon) icon.textContent = open ? '⌃' : '⌄';
      return;
    }
    const searchToggle = event.target.closest('[data-search-toggle]');
    if (searchToggle) {
      const searchPanel = qs('[data-search-panel]');
      const open = !searchPanel?.classList.contains('is-open');
      setPanel(qs('[data-currency-panel]'), qs('[data-currency-toggle]'), false);
      setPanel(searchPanel, searchToggle, open);
      if (open) qs('[data-predictive-search-input]')?.focus();
      return;
    }
    const currencyToggle = event.target.closest('[data-currency-toggle]');
    if (currencyToggle) {
      const currencyPanel = qs('[data-currency-panel]');
      const open = !currencyPanel?.classList.contains('is-open');
      setPanel(qs('[data-search-panel]'), qs('[data-search-toggle]'), false);
      setPanel(currencyPanel, currencyToggle, open);
      if (open) qs('select', currencyPanel)?.focus();
      return;
    }
    const currencyPanel = qs('[data-currency-panel]');
    if (currencyPanel?.classList.contains('is-open') && !event.target.closest('[data-currency-panel]')) setPanel(currencyPanel, qs('[data-currency-toggle]'), false);
  });
  const megaHover = (event, expanded) => {
    const item = event.target.closest?.('[data-nav-mega]');
    if (!item || mobileQuery.matches || item.contains(event.relatedTarget)) return;
    qs('.nav-mega__trigger', item)?.setAttribute('aria-expanded', String(expanded));
  };
  document.addEventListener('mouseover', (event) => megaHover(event, true));
  document.addEventListener('mouseout', (event) => megaHover(event, false));
  document.addEventListener('focusin', (event) => { const item = event.target.closest('[data-nav-mega]'); if (item) qs('.nav-mega__trigger', item)?.setAttribute('aria-expanded', 'true'); });
  document.addEventListener('focusout', (event) => {
    const item = event.target.closest('[data-nav-mega]');
    if (item && !item.contains(event.relatedTarget)) { item.classList.remove('is-open'); qs('.nav-mega__trigger', item)?.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', (event) => { const nav = getNav(); if (nav?.classList.contains('is-open') && mobileQuery.matches && (nav.contains(event.target) || event.target.closest('[data-menu-toggle]'))) trapFocus(getHeader() || nav, event); });

  const syncHeader = () => getHeader()?.classList.toggle('is-scrolled', window.scrollY > 40);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  let searchTimer;
  let searchController = null;
  document.addEventListener('input', (event) => {
    const searchInput = event.target.closest('[data-predictive-search-input]');
    if (!searchInput) return;
    const predictiveResults = qs('[data-predictive-results]');
    clearTimeout(searchTimer);
    searchController?.abort();
    const query = searchInput.value.trim();
    if (query.length < 2) { if (predictiveResults) predictiveResults.innerHTML = ''; return; }
    searchTimer = setTimeout(() => {
      searchController = new AbortController();
      const routes = window.ShopifyRoutes || {};
      const endpoint = `${routes.predictiveSearchUrl || '/search/suggest'}.json`.replace(/\.json\.json$/, '.json');
      fetch(`${endpoint}?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=5&resources[options][unavailable_products]=hide`, { signal: searchController.signal }).then((response) => response.json()).then((data) => {
        const products = data.resources?.results?.products || [];
        if (!predictiveResults) return;
        const priceText = (price) => { const cents = Math.round(Number(price) * 100); return Number.isFinite(cents) ? formatMoney(cents) : ''; };
        const thumb = (url) => { if (!url) return ''; const imageUrl = new URL(mediaUrl(url), window.location.href); imageUrl.searchParams.set('width', '120'); return imageUrl.toString(); };
        predictiveResults.innerHTML = products.length ? products.map((product) => `<a class="predictive-result" href="${escapeHtml(product.url)}">${product.featured_image?.url ? `<img src="${escapeHtml(thumb(product.featured_image.url))}" width="60" height="80" alt="" loading="lazy">` : ''}<span>${escapeHtml(product.title)}<small>${escapeHtml(priceText(product.price))}</small></span></a>`).join('') : '<p class="empty-state">No products found.</p>';
      }).catch((error) => { if (error.name !== 'AbortError' && predictiveResults) predictiveResults.innerHTML = ''; });
    }, 220);
  });
  document.addEventListener('change', (event) => { if (event.target.matches('[data-currency-select]')) event.target.form.submit(); });

  const announcements = qs('[data-announcements]');
  let announcementDismissed = false;
  try { announcementDismissed = sessionStorage.getItem('nuage-announcement-dismissed') === '1'; } catch (error) { /* ignore */ }
  if (announcementDismissed && !window.Shopify?.designMode) qs('[data-announcement]')?.remove();
  else if (announcements) {
    let list = [];
    try { list = JSON.parse(announcements.textContent); } catch (error) { list = []; }
    let index = 0;
    const text = qs('[data-announcement-text]');
    const render = () => { if (text && list.length) text.textContent = list[index]; };
    qs('[data-announcement-prev]')?.addEventListener('click', () => { index = (index - 1 + list.length) % list.length; render(); });
    qs('[data-announcement-next]')?.addEventListener('click', () => { index = (index + 1) % list.length; render(); });
    qs('[data-announcement-close]')?.addEventListener('click', (event) => {
      event.currentTarget.closest('.announcement')?.remove();
      try { sessionStorage.setItem('nuage-announcement-dismissed', '1'); } catch (error) { /* Storage can be unavailable in private mode. */ }
    });
  }

  const wishlistKey = 'nuage-wishlist';
  const wishlistHeartSvg = () => '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 3A5.5 5.5 0 0 0 2 8.5c0 1.085.136 1.99.527 2.851.386.849.984 1.574 1.766 2.356L10.586 20a2 2 0 0 0 2.828 0l6.293-6.293c.782-.782 1.38-1.507 1.766-2.356.391-.86.527-1.766.527-2.851A5.5 5.5 0 0 0 16.5 3c-1.805 0-3.265.776-4.221 1.807L12 5.086l-.279-.28C10.765 3.777 9.305 3 7.5 3Z"></path></svg>';
  const normalizeWishlistItem = (item) => ({ handle: String(item?.handle || ''), url: item?.url || (item?.handle ? `/products/${item.handle}` : ''), title: item?.title || item?.handle || 'Favorite item', image: item?.image || '', price: item?.price || '', comparePrice: item?.comparePrice || '', variantId: item?.variantId || '', variantTitle: item?.variantTitle || '', rating: item?.rating || '', ratingCount: item?.ratingCount || '' });
  const readWishlist = () => { try { const items = JSON.parse(localStorage.getItem(wishlistKey) || '[]'); return Array.isArray(items) ? items.map(normalizeWishlistItem).filter((item) => item.handle) : []; } catch (error) { return []; } };
  const writeWishlist = (items) => { try { localStorage.setItem(wishlistKey, JSON.stringify(items.map(normalizeWishlistItem))); } catch (error) { /* Storage can be unavailable in private mode. */ } updateWishlist(); };
  const wishlistItemMarkup = (item) => `<article class="wishlist-item" data-wishlist-item="${escapeHtml(item.handle)}"><div class="wishlist-item__media">${item.image ? `<a href="${escapeHtml(item.url)}"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy"></a>` : `<a href="${escapeHtml(item.url)}" class="media-placeholder" aria-label="${escapeHtml(item.title)}"></a>`}<button class="wishlist-item__heart wishlist-card" type="button" data-wishlist data-wishlist-handle="${escapeHtml(item.handle)}" data-wishlist-url="${escapeHtml(item.url)}" data-wishlist-title="${escapeHtml(item.title)}" data-wishlist-image="${escapeHtml(item.image)}" data-wishlist-price="${escapeHtml(item.price)}" data-wishlist-compare-price="${escapeHtml(item.comparePrice)}" data-wishlist-variant-id="${escapeHtml(item.variantId)}" data-wishlist-variant-title="${escapeHtml(item.variantTitle)}" data-wishlist-rating="${escapeHtml(item.rating)}" data-wishlist-rating-count="${escapeHtml(item.ratingCount)}" aria-label="Remove ${escapeHtml(item.title)} from favorites">${wishlistHeartSvg()}</button></div><div class="wishlist-item__details"><a class="wishlist-item__title" href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>${item.rating ? `<p class="wishlist-item__rating"><span aria-hidden="true">★★★★★</span> <b>${escapeHtml(item.rating)}</b>${item.ratingCount ? ` <span>(${escapeHtml(item.ratingCount)})</span>` : ''}</p>` : ''}<p class="wishlist-item__price"><strong>${escapeHtml(item.price)}</strong>${item.comparePrice ? ` <s>${escapeHtml(item.comparePrice)}</s>` : ''}</p>${item.variantTitle ? `<p class="wishlist-item__variant">${escapeHtml(item.variantTitle)}</p>` : ''}<button class="wishlist-item__add" type="button" data-wishlist-add data-wishlist-handle="${escapeHtml(item.handle)}" data-wishlist-variant-id="${escapeHtml(item.variantId)}">Add to cart</button></div></article>`;
  function updateWishlist() {
    const items = readWishlist();
    qsa('[data-wishlist-count]').forEach((element) => { element.textContent = items.length; });
    qsa('[data-wishlist]').forEach((button) => { const saved = items.some((item) => item.handle === button.dataset.wishlistHandle); button.classList.toggle('is-saved', saved); button.setAttribute('aria-label', `${saved ? 'Remove' : 'Add'} ${button.dataset.wishlistTitle || 'item'} ${saved ? 'from' : 'to'} favorites`); });
    const body = qs('[data-wishlist-body]');
    if (body) body.innerHTML = `<button class="wishlist-drawer__share" type="button" data-wishlist-share>Share list</button>${items.length ? items.map(wishlistItemMarkup).join('') : '<p class="empty-state">Keep pieces here while you browse.</p>'}`;
  }
  const openWishlist = () => { updateWishlist(); setDrawer(qs('#wishlist-drawer'), true); qs('[data-wishlist-open]')?.classList.add('is-hidden'); };
  const closeWishlist = () => { setDrawer(qs('#wishlist-drawer'), false); qs('[data-wishlist-open]')?.classList.remove('is-hidden'); };
  async function shareWishlist() {
    const items = readWishlist();
    if (!items.length) return;
    const url = new URL(window.location.href);
    url.searchParams.set('favorites', items.map((item) => item.handle).join(','));
    const shareData = { title: 'Favorite items', text: 'My favorite items', url: url.toString() };
    try { if (navigator.share) await navigator.share(shareData); else throw new Error('share unavailable'); }
    catch (error) {
      if (error?.name === 'AbortError') return;
      try { await navigator.clipboard.writeText(url.toString()); showCartFeedback('Favorite list link copied.'); }
      catch (copyError) { const input = document.createElement('textarea'); input.value = url.toString(); document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove(); showCartFeedback('Favorite list link copied.'); }
    }
  }
  async function addWishlistItem(button) {
    const item = readWishlist().find((candidate) => candidate.handle === button.dataset.wishlistHandle);
    if (!item) return;
    const label = button.textContent || 'Add to cart';
    button.disabled = true;
    button.textContent = 'Adding…';
    try {
      let variantId = button.dataset.wishlistVariantId || item.variantId;
      if (!variantId) { const product = await fetchProduct(item.handle); variantId = (product.variants || []).find((variant) => variant.available)?.id || product.variants?.[0]?.id; }
      if (!variantId) throw new Error('This item is currently unavailable.');
      const added = await addToCart({ id: Number(variantId), quantity: 1 }, 1, button, { openDrawer: false });
      if (added !== false) { button.textContent = 'Added to cart'; window.setTimeout(() => { if (document.contains(button)) { button.disabled = false; button.textContent = label || 'Add to cart'; } }, 1400); }
      else button.textContent = label || 'Add to cart';
    } catch (error) { showCartFeedback(error.message, true); button.disabled = false; button.textContent = label || 'Add to cart'; }
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-wishlist]');
    if (button) {
      event.preventDefault();
      const items = readWishlist();
      const index = items.findIndex((item) => item.handle === button.dataset.wishlistHandle);
      if (index >= 0) items.splice(index, 1);
      else items.push(normalizeWishlistItem({ handle: button.dataset.wishlistHandle, url: button.dataset.wishlistUrl, title: button.dataset.wishlistTitle, image: button.dataset.wishlistImage, price: button.dataset.wishlistPrice, comparePrice: button.dataset.wishlistComparePrice, variantId: button.dataset.wishlistVariantId, variantTitle: button.dataset.wishlistVariantTitle, rating: button.dataset.wishlistRating, ratingCount: button.dataset.wishlistRatingCount }));
      writeWishlist(items);
      return;
    }
    const addButton = event.target.closest('[data-wishlist-add]');
    if (addButton) { event.preventDefault(); addWishlistItem(addButton); return; }
    const shareButton = event.target.closest('[data-wishlist-share]');
    if (shareButton) { event.preventDefault(); shareWishlist(); return; }
    if (event.target.closest('[data-wishlist-open]')) { event.preventDefault(); openWishlist(); return; }
    if (event.target.closest('[data-wishlist-close]')) { event.preventDefault(); closeWishlist(); }
  });
  updateWishlist();

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cookie-preferences]');
    if (!button) return;
    const privacyManager = window.Shopify?.customerPrivacy || window.privacyBanner;
    if (privacyManager?.showPreferences) privacyManager.showPreferences();
    else window.location.href = button.dataset.fallbackUrl || window.NuageThemeSettings?.cookiePreferencesUrl || '/policies/privacy-policy';
  });

  const filterToggle = qs('[data-filter-toggle]');
  const filters = qs('[data-filters]');
  const closeFilters = () => { filters?.classList.remove('is-open'); filterToggle?.setAttribute('aria-expanded', 'false'); };
  filterToggle?.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      const open = filters.classList.toggle('is-open');
      filterToggle.setAttribute('aria-expanded', String(open));
    } else {
      const hidden = filters.classList.toggle('is-hidden');
      filterToggle.setAttribute('aria-expanded', String(!hidden));
    }
  });
  qsa('[data-filter-close]').forEach((button) => button.addEventListener('click', closeFilters));
  filters?.addEventListener('click', (event) => { if (event.target === filters && window.matchMedia('(max-width: 900px)').matches) closeFilters(); });
  qs('.collection-filter-form')?.addEventListener('change', (event) => { if (event.target.matches('select[name="sort_by"]')) event.currentTarget.requestSubmit(); });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || sizeGuide?.classList.contains('is-open')) return;
    const returnTo = qs('[data-search-panel].is-open') ? qs('[data-search-toggle]') : qs('[data-currency-panel].is-open') ? qs('[data-currency-toggle]') : null;
    closeAllDrawers();
    closeFilters();
    closeHeaderPanels();
    setMenuOpen(false);
    closeMegaMenus();
    returnTo?.focus();
  });
  document.addEventListener('shopify:section:load', () => { syncHeader(); updateWishlist(); });
})();
