(function () {
  const qs = (selector, context = document) => context.querySelector(selector);
  const qsa = (selector, context = document) => [...context.querySelectorAll(selector)];
  const money = (cents) => window.Shopify && Shopify.formatMoney ? Shopify.formatMoney(cents) : (Number(cents) / 100).toFixed(2);
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

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

  function renderCartItems(cart) {
    const items = qs('[data-cart-items]');
    if (!items) return '';
    if (!cart.items.length) {
      items.innerHTML = '<p class="empty-state">Your bag is empty.</p>';
      return '';
    }
    items.innerHTML = cart.items.map((item) => `
      <article class="drawer-line" data-cart-line="${escapeHtml(item.key)}" data-product-handle="${escapeHtml(item.handle)}" data-product-id="${item.product_id}" data-variant-id="${item.variant_id}" data-quantity="${item.quantity}">
        <a class="drawer-line__media" href="${escapeHtml(item.url)}"><img src="${escapeHtml(item.image || '')}" alt="${escapeHtml(item.product_title)}"></a>
        <div class="drawer-line__details">
          <p class="drawer-line__vendor">${escapeHtml(item.vendor || 'Nuage')}</p>
          <h3><a href="${escapeHtml(item.url)}">${escapeHtml(item.product_title)}</a></h3>
          ${item.variant_title && item.variant_title !== 'Default Title' ? `<p>${escapeHtml(item.variant_title)}</p>` : ''}
          <div class="drawer-line__controls">
            <div class="drawer-quantity"><button type="button" data-cart-quantity="-1" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-cart-quantity="1" aria-label="Increase quantity">+</button></div>
            <button class="drawer-edit" type="button" data-cart-edit>Edit</button>
            <button class="drawer-remove" type="button" data-remove-line>Remove</button>
          </div>
        </div>
        <div class="drawer-line__price"><strong>${formatMoney(item.final_line_price)}</strong>${item.original_line_price > item.final_line_price ? `<s>${formatMoney(item.original_line_price)}</s>` : ''}</div>
      </article>
    `).join('');
    return items.innerHTML;
  }

  function updateCartSummary(cart) {
    const subtotal = qs('[data-cart-subtotal]');
    if (subtotal) subtotal.textContent = formatMoney(cart.items_subtotal_price);
    const total = qs('[data-cart-total]');
    if (total) total.textContent = formatMoney(cart.total_price);
    const discountRow = qs('[data-cart-discount-row]');
    const discountTotal = qs('[data-cart-discount-total]');
    if (discountRow) discountRow.hidden = !cart.total_discount;
    if (discountTotal && cart.total_discount) discountTotal.textContent = `–${formatMoney(cart.total_discount)}`;
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
    return `
      <article class="cart-recommendation" data-product-handle="${escapeHtml(product.handle)}">
        <a href="${escapeHtml(product.url)}"><img src="${escapeHtml(product.featured_image || '')}" alt="${escapeHtml(product.title)}"></a>
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

  function refreshCart() {
    const revision = ++cartRevision;
    const routes = window.ShopifyRoutes || {};
    return cartRequest(routes.cartJson || '/cart.js').then((cart) => {
      if (revision !== cartRevision) return cart;
      qsa('[data-cart-count]').forEach((element) => { element.textContent = cart.item_count; });
      qsa('[data-cart-open]').forEach((element) => { element.setAttribute('aria-label', `Cart (${cart.item_count} items)`); });
      renderCartItems(cart);
      updateCartSummary(cart);
      updateCartProgress(cart);
      const firstItem = cart.items.find((item) => item.product_id);
      loadRecommendations(firstItem?.product_id);
      return cart;
    });
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
    const compare = variant?.compare_at_price || product.compare_at_price || 0;
    const price = variant?.price ?? product.price;
    const savings = compare > price ? Math.round(((compare - price) / compare) * 100) : 0;
    quickShopBody.innerHTML = `
      <div class="quick-shop-product">
        <div class="quick-shop-product__media">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.title)}">` : '<span class="media-placeholder"></span>'}</div>
        <div class="quick-shop-product__info">
          <p class="quick-shop-product__vendor">${escapeHtml(product.vendor || 'Nuage')}</p>
          <h2 id="QuickShopTitle">${escapeHtml(product.title)}</h2>
          <div class="quick-shop-product__price"><strong>${formatMoney(price)}</strong>${compare > price ? `<s>${formatMoney(compare)}</s><span>Save ${savings}%</span>` : ''}</div>
          ${product.options.length ? product.options.map((name, index) => `
            <fieldset class="quick-option-group"><legend>Select ${escapeHtml(name)}</legend><div>${product.variants.map((variant) => variant.options[index]).filter((value, index, values) => value && values.indexOf(value) === index).map((value) => optionButton(product, name, value, index)).join('')}</div></fieldset>
          `).join('') : ''}
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
  qsa('[data-product-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); addToCart(qs('[data-variant-id]', form).value, Number(qs('[name="quantity"]', form).value || 1), qs('button[type="submit"]', form)); }));
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
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeAllDrawers(); closeFilters(); setMenuOpen(false); qsa('[data-nav-mega]').forEach((item) => { item.classList.remove('is-open'); qs('.nav-mega__trigger', item)?.setAttribute('aria-expanded', 'false'); }); } });
})();
