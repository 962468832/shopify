(function () {
  const qs = (selector, context = document) => context.querySelector(selector);
  const qsa = (selector, context = document) => [...context.querySelectorAll(selector)];
  const money = (cents) => {
    if (window.Shopify && Shopify.formatMoney) return Shopify.formatMoney(cents);
    const currency = document.querySelector('[data-product-detail]')?.dataset.currency || 'USD';
    return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : undefined, { style: 'currency', currency }).format(Number(cents || 0) / 100);
  };
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const mediaUrl = (value) => String(value || '').replace(/^\/\//, 'https://');

  const cartDrawer = qs('#cart-drawer');
  const setDrawer = (drawer, open) => {
    if (!drawer) return;
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    if (drawer === cartDrawer) {
      document.documentElement.classList.toggle('cart-drawer-lock', open);
      document.body.classList.toggle('cart-drawer-lock', open);
    }
  };
  const closeAllDrawers = () => {
    setDrawer(cartDrawer, false);
    setDrawer(qs('#wishlist-drawer'), false);
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
    const data = await response.json();
    if (!response.ok) throw new Error(data.description || data.message || 'Unable to update your bag. Please try again.');
    return data;
  }

  async function applyDiscount(code) {
    const message = qs('[data-cart-discount-message]');
    const root = (window.ShopifyRoutes.rootUrl || '').replace(/\/$/, '');
    const response = await fetch(`${root}/discount/${encodeURIComponent(code)}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('That discount code is not valid.');
    await refreshCart();
    if (message) message.textContent = 'Discount code applied.';
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
    applyDiscount(code).catch(() => { if (message) message.textContent = 'That discount code is not valid.'; }).finally(() => { if (button) { button.disabled = false; button.textContent = 'Apply'; } });
  });

  const quickShopModal = qs('#quick-shop');
  const quickShopBody = qs('[data-quick-shop-body]');
  const quickShopSettings = window.NuageThemeSettings || {};
  const progressThreshold = Number(quickShopSettings.cartProgressThreshold || 75) * 100;
  const productCache = new Map();
  const recommendationCache = new Map();

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

  async function getCartPricing(cart) {
    const lines = new Map();
    if (!cart.items.length) return { lines, merchandiseSavings: 0, totalDiscount: Number(cart.total_discount || 0) };
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
      const compareAtPrice = Number(variant?.compare_at_price || 0);
      const originalLinePrice = fallback.referenceLinePrice;
      const compareAtLinePrice = compareAtPrice * Number(item.quantity || 0);
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
    return { lines, merchandiseSavings, totalDiscount: merchandiseSavings + Number(cart.total_discount || 0) };
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
            ${item.options_with_values?.some((option) => /size/i.test(option.name)) ? '<button class="drawer-size-guide" type="button" data-size-guide-open>Size guide</button>' : ''}
            <button class="drawer-remove" type="button" data-remove-line>Remove</button>
          </div>
        </div>
        <div class="drawer-line__price"><strong>${formatMoney(item.final_line_price)}</strong>${showReferencePrice ? `<s>${formatMoney(linePricing.referenceLinePrice)}</s>` : ''}${linePricing.savePercent ? `<span class="cart-price__save">Save ${linePricing.savePercent}%</span>` : ''}</div>
      </article>
    `;
    }).join('');
    return items.innerHTML;
  }

  function updateCartSummary(cart, pricing = { totalDiscount: Number(cart.total_discount || 0) }) {
    const subtotal = qs('[data-cart-subtotal]');
    if (subtotal) subtotal.textContent = formatMoney(cart.items_subtotal_price);
    const total = qs('[data-cart-total]');
    if (total) total.textContent = formatMoney(cart.total_price);
    const discountRow = qs('[data-cart-discount-row]');
    const discountTotal = qs('[data-cart-discount-total]');
    const totalDiscount = Number(pricing.totalDiscount || 0);
    if (discountRow) discountRow.hidden = !totalDiscount;
    if (discountTotal) discountTotal.textContent = `–${formatMoney(totalDiscount)}`;
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
    return `
      <article class="cart-recommendation" data-product-handle="${escapeHtml(product.handle)}">
        <a href="${escapeHtml(product.url)}"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}"></a>
        <div><p>${escapeHtml(product.vendor || 'Nuage')}</p><h4><a href="${escapeHtml(product.url)}">${escapeHtml(product.title)}</a></h4><strong>${formatMoney(product.price)}</strong>${product.compare_at_price > product.price ? `<s>${formatMoney(product.compare_at_price)}</s>` : ''}</div>
        <button type="button" data-quick-open data-product-handle="${escapeHtml(product.handle)}">Add</button>
      </article>
    `;
  }

  let recommendationTimer = null;
  async function loadRecommendations(productId) {
    const section = qs('[data-cart-recommendations]');
    const grid = qs('[data-cart-recommendation-items]');
    if (!section || !grid || !productId) { if (section) section.hidden = true; return; }
    clearTimeout(recommendationTimer);
    recommendationTimer = setTimeout(() => {
      if (recommendationCache.has(productId)) {
        const cached = recommendationCache.get(productId).filter((product) => product.available).slice(0, 4);
        section.hidden = !cached.length;
        grid.innerHTML = cached.map(recommendationCard).join('');
      }
    }, 0);
    section.hidden = false;
    grid.innerHTML = '<p class="empty-state">Loading recommendations…</p>';
    try {
      if (!recommendationCache.has(productId)) {
        const root = (window.ShopifyRoutes.rootUrl || '').replace(/\/$/, '');
        const response = await fetch(`${root}/recommendations/products.json?product_id=${encodeURIComponent(productId)}&limit=4`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Recommendations unavailable');
        const data = await response.json();
        recommendationCache.set(productId, data.products || []);
      }
      const products = recommendationCache.get(productId).filter((product) => product.available).slice(0, 4);
      section.hidden = !products.length;
      grid.innerHTML = products.map(recommendationCard).join('');
    } catch (error) {
      section.hidden = true;
    }
  }

  function productRecommendationCard(product) {
    const image = mediaUrl(product.featured_image || product.images?.[0] || '');
    const price = Number(product.price || 0);
    const compareAtPrice = Number(product.compare_at_price || 0);
    const savePercent = compareAtPrice > price ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100) : 0;
    const colorOption = (product.options_with_values || []).find((option) => /color|colour/i.test(option.name));
    const colorValues = colorOption?.values || [];
    const colorMarkup = colorValues.length ? `<div class="product-card__colors" aria-label="${colorValues.length} color options">${colorValues.slice(0, 5).map((value) => `<span class="color-dot" data-color="${escapeHtml(String(value).toLowerCase().replace(/\s+/g, '-'))}" title="${escapeHtml(value)}"></span>`).join('')}${colorValues.length > 5 ? `<span class="color-more">+${colorValues.length - 5}</span>` : ''}<span class="color-count">${colorValues.length} colors</span></div>` : '';
    return `
      <article class="product-card">
        <div class="product-card__media">
          ${savePercent ? '<span class="badge">Bundle &amp; save</span>' : ''}
          <a href="${escapeHtml(product.url || `/products/${product.handle}`)}">${image ? `<img class="product-card__image product-card__image--primary" src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}" loading="lazy">` : '<div class="media-placeholder"></div>'}</a>
          <button class="wishlist-card" type="button" data-wishlist data-wishlist-handle="${escapeHtml(product.handle)}" data-wishlist-url="${escapeHtml(product.url || `/products/${product.handle}`)}" data-wishlist-title="${escapeHtml(product.title)}" data-wishlist-image="${escapeHtml(image)}" data-wishlist-price="${escapeHtml(formatMoney(price))}" aria-label="Add ${escapeHtml(product.title)} to wishlist"><span aria-hidden="true">♡</span></button>
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
      if (!recommendationCache.has(productId)) {
        const root = (window.ShopifyRoutes.rootUrl || '').replace(/\/$/, '');
        const response = await fetch(`${root}/recommendations/products.json?product_id=${encodeURIComponent(productId)}&limit=8`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Recommendations unavailable');
        const data = await response.json();
        recommendationCache.set(productId, data.products || []);
      }
      const products = recommendationCache.get(productId).filter((product) => String(product.id) !== String(productId) && product.available !== false).slice(0, 4);
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
    } catch (error) { showCartFeedback(error.message, true); }
    finally { controls.forEach((button) => { button.disabled = false; }); }
  }
  async function addToCart(id, quantity = 1, button) {
    if (button?.disabled) return;
    const label = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Adding…'; button.setAttribute('aria-busy', 'true'); }
    try {
      await queueCartUpdate(async () => {
        await cartRequest(cartEndpoint((window.ShopifyRoutes || {}).cartAdd, '/cart/add'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: Number(id), quantity }] }) });
        showCartFeedback('✓ Added to your bag');
        if (button) button.textContent = 'Added ✓';
        try {
          await refreshCart();
          setDrawer(cartDrawer, true);
        } catch (error) {
          showCartFeedback('Added to your bag. The bag preview could not refresh — select View bag to see your items.');
        }
      });
    } catch (error) { showCartFeedback(error.message, true); }
    finally {
      if (button) { button.disabled = false; button.textContent = label; button.removeAttribute('aria-busy'); }
    }
  }
  async function replaceCartLine(lineKey, variantId, quantity) {
    await queueCartUpdate(async () => {
      await cartRequest(cartEndpoint((window.ShopifyRoutes || {}).cartChange, '/cart/change'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: lineKey, quantity: 0 }) });
      await cartRequest(cartEndpoint((window.ShopifyRoutes || {}).cartAdd, '/cart/add'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: Number(variantId), quantity }] }) });
      await refreshCart();
    });
  }

  async function fetchProduct(handle) {
    if (productCache.has(handle)) return productCache.get(handle);
    const root = (window.ShopifyRoutes.rootUrl || '').replace(/\/$/, '');
    const response = await fetch(`${root}/products/${encodeURIComponent(handle)}.js`, { cache: 'no-store' });
    if (!response.ok) throw new Error('This product is no longer available.');
    const product = await response.json();
    productCache.set(handle, product);
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
    quickShopState = { product, lineKey: options.lineKey || null, selected: initialVariant ? [...initialVariant.options] : [], quantity: options.quantity || 1 };
    renderQuickShopSelection();
  }

  function renderQuickShopSelection() {
    if (!quickShopState || !quickShopBody) return;
    const { product, selected, quantity, lineKey } = quickShopState;
    const changedIndex = selected.length ? selected.length - 1 : null;
    const variant = resolveVariant(product.variants, selected, changedIndex);
    if (variant) quickShopState.selected = [...variant.options];
    const image = variantImage(product, variant);
    const compare = variant?.compare_at_price ?? (variant ? 0 : product.compare_at_price ?? 0);
    const price = variant?.price ?? product.price;
    const savings = compare > price ? Math.round(((compare - price) / compare) * 100) : 0;
    quickShopBody.innerHTML = `
      <div class="quick-shop-product">
        <div class="quick-shop-product__media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}">` : '<span class="media-placeholder"></span>'}</div>
        <div class="quick-shop-product__info">
          <p class="quick-shop-product__vendor">${escapeHtml(product.vendor || 'Nuage')}</p>
          <h2 id="QuickShopTitle">${escapeHtml(product.title)}</h2>
          <div class="quick-shop-product__price"><strong>${formatMoney(price)}</strong>${savings ? `<s>${formatMoney(compare)}</s><span class="product-price__save">Save ${savings}%</span>` : ''}</div>
          ${product.options.length ? product.options.map((option, index) => { const name = typeof option === 'string' ? option : option.name; return `
            <fieldset class="quick-option-group"><legend><span>Select ${escapeHtml(name)}</span>${/size/i.test(name) ? '<button class="size-guide-trigger" type="button" data-size-guide-open aria-haspopup="dialog"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m14.5 4.5 5 5L8 21H3v-5Z"></path><path d="m13 6 5 5M11 8l2 2M8 11l2 2M5 14l2 2"></path></svg>Fit &amp; Size Guide</button>' : ''}</legend><div>${product.variants.map((variant) => variant.options[index]).filter((value, index, values) => value && values.indexOf(value) === index).map((value) => optionButton(product, name, value, index)).join('')}</div></fieldset>
          `; }).join('') : ''}
          <label class="quick-quantity">Qty<span><button type="button" data-quick-quantity="-1" aria-label="Decrease quantity">−</button><input type="number" min="1" value="${quantity}" data-quick-quantity-input aria-label="Quantity"><button type="button" data-quick-quantity="1" aria-label="Increase quantity">+</button></span></label>
          <div class="quick-shop-product__actions"><button class="button button--dark" type="button" data-quick-submit${variant?.available ? '' : ' disabled'}>${lineKey ? 'Update bag' : variant?.available ? 'Add to bag' : 'Sold out'}</button><button class="button button--danger" type="button" data-quick-buy${variant?.available ? '' : ' disabled'}>Buy now</button></div>
          <p class="quick-shop-product__availability" role="status">${variant ? (variant.available ? 'In stock and ready to ship.' : 'This option is currently sold out.') : 'This combination is unavailable.'}</p>
        </div>
      </div>
    `;
  }

  async function openQuickShop(handle, options = {}) {
    if (!quickShopModal || !quickShopBody) return;
    setDrawer(cartDrawer, false);
    setDrawer(qs('#wishlist-drawer'), false);
    quickShopModal.classList.add('is-open');
    quickShopModal.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('quick-shop-lock');
    document.body.classList.add('quick-shop-lock');
    quickShopBody.innerHTML = '<p class="empty-state">Loading product options…</p>';
    try {
      const product = await fetchProduct(handle);
      renderQuickShop(product, options);
      qs('.quick-option:not([disabled])', quickShopBody)?.focus();
    } catch (error) {
      quickShopBody.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    }
  }

  function closeQuickShop() {
    if (!quickShopModal) return;
    quickShopModal.classList.remove('is-open');
    quickShopModal.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('quick-shop-lock');
    document.body.classList.remove('quick-shop-lock');
    quickShopState = null;
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
      for (let next = index + 1; next < quickShopState.selected.length; next += 1) quickShopState.selected[next] = '';
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
      const variant = resolveVariant(quickShopState.product.variants, quickShopState.selected, quickShopState.selected.length - 1);
      if (!variant?.available) return;
      if (quickShopState.lineKey) {
        replaceCartLine(quickShopState.lineKey, variant.id, quickShopState.quantity).then(() => { closeQuickShop(); setDrawer(cartDrawer, true); showCartFeedback('✓ Updated your bag'); }).catch((error) => showCartFeedback(error.message, true));
      } else {
        addToCart(variant.id, quickShopState.quantity, submit).then(() => closeQuickShop()).catch((error) => showCartFeedback(error.message, true));
      }
      return;
    }
    const buy = event.target.closest('[data-quick-buy]');
    if (buy && quickShopState) {
      const variant = resolveVariant(quickShopState.product.variants, quickShopState.selected, quickShopState.selected.length - 1);
      if (!variant?.available) return;
      buy.disabled = true;
      buy.textContent = 'Loading…';
      addToCart(variant.id, quickShopState.quantity, buy).then(() => { window.location.href = (window.ShopifyRoutes || {}).checkoutUrl || '/checkout'; }).catch((error) => { buy.disabled = false; buy.textContent = 'Buy now'; showCartFeedback(error.message, true); });
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
  function sizeGuideProduct() {
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
  qsa('[data-product-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); addToCart(qs('[data-variant-id]', form).value, Number(qs('[name="quantity"]', form).value || 1), qs('button[type="submit"]', form)); }));
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

  const header = qs('[data-header]');
  const menu = qs('[data-menu-toggle]');
  const nav = qs('[data-mobile-nav]');
  const setMenuOpen = (open) => { nav?.classList.toggle('is-open', open); menu?.setAttribute('aria-expanded', String(open)); menu?.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); header?.classList.toggle('menu-open', open); document.documentElement.classList.toggle('menu-lock', open); document.body.classList.toggle('menu-lock', open); };
  menu?.addEventListener('click', () => setMenuOpen(!nav?.classList.contains('is-open')));
  qsa('[data-nav-mega]').forEach((item) => {
    const trigger = qs('.nav-mega__trigger', item);
    trigger?.addEventListener('click', (event) => {
      if (window.matchMedia('(max-width: 900px)').matches && !item.classList.contains('is-open')) { event.preventDefault(); qsa('[data-nav-mega].is-open').forEach((other) => { other.classList.remove('is-open'); qs('.nav-mega__trigger', other)?.setAttribute('aria-expanded', 'false'); }); item.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true'); }
    });
    item.addEventListener('mouseenter', () => { if (!window.matchMedia('(max-width: 900px)').matches) trigger?.setAttribute('aria-expanded', 'true'); });
    item.addEventListener('mouseleave', () => { if (!window.matchMedia('(max-width: 900px)').matches) trigger?.setAttribute('aria-expanded', 'false'); });
    item.addEventListener('focusin', () => trigger?.setAttribute('aria-expanded', 'true'));
    item.addEventListener('focusout', (event) => { if (!item.contains(event.relatedTarget)) { item.classList.remove('is-open'); trigger?.setAttribute('aria-expanded', 'false'); } });
  });
  qsa('[data-mobile-nav] a').forEach((link) => link.addEventListener('click', () => { if (window.matchMedia('(max-width: 900px)').matches && !link.classList.contains('nav-mega__trigger')) { setMenuOpen(false); qsa('[data-nav-mega].is-open').forEach((item) => item.classList.remove('is-open')); } }));
  qsa('[data-mobile-submenu-toggle]').forEach((button) => button.addEventListener('click', () => {
    const panel = button.parentElement?.querySelector('[data-mobile-submenu]');
    if (!panel) return;
    const open = panel.classList.toggle('is-open');
    if (open) {
      qsa('[data-mobile-submenu]').forEach((other) => { if (other !== panel) other.classList.remove('is-open'); });
      qsa('[data-mobile-submenu-toggle]').forEach((other) => { if (other !== button) other.setAttribute('aria-expanded', 'false'); });
    }
    button.setAttribute('aria-expanded', String(open));
    const icon = button.querySelector('span');
    if (icon) icon.textContent = open ? '⌃' : '⌄';
  }));

  const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 40);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  const searchToggle = qs('[data-search-toggle]');
  const searchPanel = qs('[data-search-panel]');
  const searchInput = qs('[data-predictive-search-input]');
  const predictiveResults = qs('[data-predictive-results]');
  searchToggle?.addEventListener('click', () => { const open = searchPanel.classList.toggle('is-open'); searchPanel.setAttribute('aria-hidden', String(!open)); searchToggle.setAttribute('aria-expanded', String(open)); if (open) searchInput?.focus(); });
  let searchTimer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    if (query.length < 2) { if (predictiveResults) predictiveResults.innerHTML = ''; return; }
    searchTimer = setTimeout(() => {
      fetch(`/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=5&resources[options][unavailable_products]=hide`).then((response) => response.json()).then((data) => {
        const products = data.resources?.results?.products || [];
        if (!predictiveResults) return;
        predictiveResults.innerHTML = products.length ? products.map((product) => `<a class="predictive-result" href="${escapeHtml(product.url)}">${product.featured_image?.url ? `<img src="${escapeHtml(product.featured_image.url)}" alt="">` : ''}<span>${escapeHtml(product.title)}<small>${escapeHtml(product.price)}</small></span></a>`).join('') : '<p class="empty-state">No products found.</p>';
      }).catch(() => { if (predictiveResults) predictiveResults.innerHTML = ''; });
    }, 220);
  });
  qs('[data-currency-select]')?.addEventListener('change', (event) => event.target.form.submit());
  const currencyToggle = qs('[data-currency-toggle]');
  const currencyPanel = qs('[data-currency-panel]');
  currencyToggle?.addEventListener('click', () => {
    const open = currencyPanel?.classList.toggle('is-open');
    currencyPanel?.setAttribute('aria-hidden', String(!open));
  });
  document.addEventListener('click', (event) => {
    if (!currencyPanel?.classList.contains('is-open') || event.target.closest('[data-currency-panel],[data-currency-toggle]')) return;
    currencyPanel.classList.remove('is-open');
    currencyPanel.setAttribute('aria-hidden', 'true');
  });

  const announcements = qs('[data-announcements]');
  if (announcements) {
    let list = [];
    try { list = JSON.parse(announcements.textContent); } catch (error) { list = []; }
    let index = 0;
    const text = qs('[data-announcement-text]');
    const render = () => { if (text && list.length) text.textContent = list[index]; };
    qs('[data-announcement-prev]')?.addEventListener('click', () => { index = (index - 1 + list.length) % list.length; render(); });
    qs('[data-announcement-next]')?.addEventListener('click', () => { index = (index + 1) % list.length; render(); });
    qs('[data-announcement-close]')?.addEventListener('click', (event) => event.currentTarget.closest('.announcement')?.remove());
  }

  const wishlistKey = 'nuage-wishlist';
  const readWishlist = () => { try { return JSON.parse(localStorage.getItem(wishlistKey) || '[]'); } catch (error) { return []; } };
  const writeWishlist = (items) => { localStorage.setItem(wishlistKey, JSON.stringify(items)); updateWishlist(); };
  function updateWishlist() {
    const items = readWishlist();
    qsa('[data-wishlist-count]').forEach((element) => { element.textContent = items.length; });
    qsa('[data-wishlist]').forEach((button) => { const saved = items.some((item) => item.handle === button.dataset.wishlistHandle); button.classList.toggle('is-saved', saved); button.setAttribute('aria-label', `${saved ? 'Remove' : 'Add'} ${button.dataset.wishlistTitle} ${saved ? 'from' : 'to'} wishlist`); });
    const body = qs('[data-wishlist-body]');
    if (body) body.innerHTML = items.length ? items.map((item) => `<article class="wishlist-line"><a href="${escapeHtml(item.url)}">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : ''}<span>${escapeHtml(item.title)}<small>${escapeHtml(item.price)}</small></span></a><button type="button" data-wishlist-remove="${escapeHtml(item.handle)}" aria-label="Remove ${escapeHtml(item.title)}">×</button></article>`).join('') : '<p class="empty-state">Save pieces here while you browse.</p>';
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-wishlist]');
    if (!button) return;
    const items = readWishlist();
    const index = items.findIndex((item) => item.handle === button.dataset.wishlistHandle);
    if (index >= 0) items.splice(index, 1);
    else items.push({ handle: button.dataset.wishlistHandle, url: button.dataset.wishlistUrl, title: button.dataset.wishlistTitle, image: button.dataset.wishlistImage, price: button.dataset.wishlistPrice });
    writeWishlist(items);
  });
  document.addEventListener('shopify:section:load', updateWishlist);
  qs('[data-wishlist-body]')?.addEventListener('click', (event) => { const remove = event.target.closest('[data-wishlist-remove]'); if (!remove) return; writeWishlist(readWishlist().filter((item) => item.handle !== remove.dataset.wishlistRemove)); });
  qs('[data-wishlist-open]')?.addEventListener('click', () => { updateWishlist(); setDrawer(qs('#wishlist-drawer'), true); });
  qsa('[data-wishlist-close]').forEach((button) => button.addEventListener('click', () => setDrawer(qs('#wishlist-drawer'), false)));
  updateWishlist();

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
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !sizeGuide?.classList.contains('is-open')) { closeAllDrawers(); closeFilters(); setMenuOpen(false); qsa('[data-nav-mega]').forEach((item) => { item.classList.remove('is-open'); qs('.nav-mega__trigger', item)?.setAttribute('aria-expanded', 'false'); }); } });
})();
