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
  };
  const closeAllDrawers = () => {
    setDrawer(cartDrawer, false);
    setDrawer(qs('#wishlist-drawer'), false);
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
  function refreshCart() {
    const revision = ++cartRevision;
    const routes = window.ShopifyRoutes || {};
    return cartRequest(routes.cartJson || '/cart.js').then((cart) => {
      if (revision !== cartRevision) return cart;
      qsa('[data-cart-count]').forEach((element) => { element.textContent = cart.item_count; });
      qsa('[data-cart-open]').forEach((element) => { element.setAttribute('aria-label', `Cart (${cart.item_count} items)`); });
      const body = qs('[data-cart-drawer-body]');
      if (body) {
        body.innerHTML = cart.items.length ? cart.items.map((item) => `<article class="drawer-line" data-cart-line="${escapeHtml(item.key)}"><img src="${escapeHtml(item.image || '')}" alt="${escapeHtml(item.product_title)}"><div><h3>${escapeHtml(item.product_title)}</h3><p>${escapeHtml(item.variant_title || '')}</p><p>${money(item.final_line_price)}</p><div class="drawer-quantity"><button type="button" data-cart-quantity="-1" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button type="button" data-cart-quantity="1" aria-label="Increase quantity">+</button></div><button class="drawer-remove" type="button" data-remove-line>Remove</button></div></article>`).join('') : '<p class="empty-state">Your bag is empty.</p>';
      }
      const total = qs('[data-cart-total]');
      if (total) total.textContent = money(cart.total_price);
      const buyButton = qs('[data-cart-checkout]');
      if (buyButton) {
        buyButton.textContent = cart.item_count ? 'Buy now' : 'Shop now';
        buyButton.href = cart.item_count ? (window.ShopifyRoutes || {}).checkoutUrl || '/checkout' : (window.ShopifyRoutes || {}).allProductsUrl || '/collections/all';
      }
      return cart;
    });
  }
  const openCart = async () => {
    setDrawer(cartDrawer, true);
    const body = qs('[data-cart-drawer-body]');
    if (body) body.innerHTML = '<p class="empty-state">Loading your bag…</p>';
    try { await cartQueue; await refreshCart(); }
    catch (error) {
      if (body) body.innerHTML = '<p class="empty-state">Your bag could not be loaded. Please use View bag below to try again.</p>';
      showCartFeedback(error.message, true);
    }
  };
  qsa('[data-cart-open]').forEach((button) => button.addEventListener('click', openCart));
  qsa('[data-cart-close]').forEach((button) => button.addEventListener('click', () => setDrawer(cartDrawer, false)));
  qs('[data-cart-drawer-body]')?.addEventListener('click', (event) => {
    const line = event.target.closest('[data-cart-line]');
    if (!line) return;
    if (event.target.closest('[data-remove-line]')) return changeLine(line.dataset.cartLine, 0);
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
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-quick-add]');
    if (!button) return;
    event.preventDefault();
    addToCart(button.dataset.variantId, 1, button);
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
