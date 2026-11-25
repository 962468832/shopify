(function () {
  function resolveVariant(variants, values, changedIndex) {
    const exact = variants.find((variant) => variant.options.every((value, index) => value === values[index]));
    if (exact) return exact;
    if (changedIndex == null || changedIndex === values.length - 1) return null;
    const candidates = variants.filter((variant) => variant.options.every((value, index) => index > changedIndex || value === values[index]));
    return candidates.find((variant) => variant.available) || candidates[0] || null;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { resolveVariant };
    return;
  }
  const root = document.querySelector('[data-product-detail]');
  if (!root) return;
  let data = JSON.parse(root.querySelector('[data-product-json]').textContent);
  const groups = [...root.querySelectorAll('[data-option-group]')];
  const mainImage = root.querySelector('[data-product-main]');
  const thumbs = [...root.querySelectorAll('[data-product-thumb]')];
  const id = root.querySelector('[data-variant-id]');
  const submit = root.querySelector('[data-product-submit]');
  const paymentButton = root.querySelector('[data-product-buy-now]');
  const availability = root.querySelector('[data-product-availability]');
  const productForm = root.querySelector('[data-product-installments]');
  const sticky = root.querySelector('[data-product-sticky-atc]');
  const stickyImage = root.querySelector('[data-product-sticky-image]');
  const stickyVariant = root.querySelector('[data-product-sticky-variant]');
  const stickyPrice = root.querySelector('[data-product-sticky-price]');
  const stickyCompare = root.querySelector('[data-product-sticky-compare]');
  const stickySavings = root.querySelector('[data-product-sticky-savings]');
  const stickyButton = root.querySelector('[data-product-sticky-button]');
  const purchaseBlock = root.querySelector('[data-product-purchase]');
  const optionsTarget = root.querySelector('[data-product-options-target]');
  const productTitle = root.querySelector('[data-product-title]');
  const stickyTitle = root.querySelector('[data-product-sticky-title]');
  const packIncludes = root.querySelector('[data-pack-includes]');
  const baseTitle = productTitle?.dataset.baseTitle || data.title || '';
  const PACK_INCLUDES = {
    'essential trio': [['Black', '#1f1f1f'], ['White', '#f7f7f7'], ['Nude', '#e7cfbc']],
    'black trio': [['3× Black', '#1f1f1f']],
    'nude trio': [['3× Nude', '#e7cfbc']],
    'white trio': [['3× White', '#f7f7f7']],
    'neutral trio': [['Nude', '#e7cfbc'], ['White', '#f7f7f7'], ['Khaki', '#c8bba9']],
    'monochrome trio': [['2× Black', '#1f1f1f'], ['1× White', '#f7f7f7']],
    'pastel trio': [['Pink', '#f0cfd3'], ['Blue', '#c9d5df'], ['Khaki', '#c8bba9']],
    'classic 5-pack': [['Black', '#1f1f1f'], ['Nude', '#e7cfbc'], ['Khaki', '#c8bba9'], ['White', '#f7f7f7'], ['Pink', '#f0cfd3']],
    'black 5-pack': [['5× Black', '#1f1f1f']],
    'white 5-pack': [['5× White', '#f7f7f7']],
    'everyday 5-pack': [['2× Black', '#1f1f1f'], ['3× Nude', '#e7cfbc']],
    'soft mood 5-pack': [['Black', '#1f1f1f'], ['Nude', '#e7cfbc'], ['White', '#f7f7f7'], ['Pink', '#f0cfd3'], ['Blue', '#c9d5df']],
    'pastel 5-pack': [['Nude', '#e7cfbc'], ['White', '#f7f7f7'], ['Pink', '#f0cfd3'], ['Blue', '#c9d5df'], ['Khaki', '#c8bba9']]
  };
  function syncPackPresentation(variant, current) {
    const packIndex = groups.findIndex((g) => /package|pack/i.test(g.dataset.optionName || ''));
    if (packIndex < 0) return;
    const packVal = variant?.options?.[packIndex] || current[packIndex] || '';
    const isMultiPack = Boolean(packVal) && !/^single$/i.test(packVal.trim());
    const nextTitle = isMultiPack ? `${baseTitle} (${packVal})` : baseTitle;
    if (productTitle) productTitle.textContent = nextTitle;
    if (stickyTitle) stickyTitle.textContent = nextTitle;
    if (packIncludes) {
      const colorIndex = groups.findIndex((g) => /color|colour/i.test(g.dataset.optionName || ''));
      const colorVal = colorIndex >= 0 ? (variant?.options?.[colorIndex] || current[colorIndex] || '') : '';
      const items = isMultiPack ? PACK_INCLUDES[colorVal.trim().toLowerCase()] : null;
      if (items?.length) {
        packIncludes.innerHTML = `<span class="product-pack-includes__label">Includes</span><span class="product-pack-includes__items">${items.map(([label, hex]) => `<span class="product-pack-includes__item"><i style="background:${hex}"></i>${label}</span>`).join('')}</span>`;
        packIncludes.hidden = false;
      } else {
        packIncludes.hidden = true;
        packIncludes.innerHTML = '';
      }
    }
    if (packVal && thumbs.length) {
      const activeIds = new Set(data.variants.filter((v) => v.options?.[packIndex] === packVal && v.featured_image?.id).map((v) => String(v.featured_image.id)));
      if (activeIds.size) {
        thumbs.forEach((thumb) => { thumb.hidden = !activeIds.has(String(thumb.dataset.imageId)); });
      }
    }
  }
  const currency = root.dataset.currency || 'USD';
  const formatMoney = (cents) => (window.PielikFormatMoney ? window.PielikFormatMoney(cents) : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100));
  const pricing = window.PielikPricing || {
    details(source) {
      const price = Number(source?.price || 0);
      const compareAtPrice = Number(source?.compare_at_price || 0);
      const hasDiscount = compareAtPrice > price;
      return { price, compareAtPrice: hasDiscount ? compareAtPrice : 0, hasDiscount, discountPercent: hasDiscount ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100) : 0 };
    }
  };
  function syncPrice(variant) {
    const compare = root.querySelector('[data-product-compare]');
    const savings = root.querySelector('[data-product-savings]');
    const variantPricing = pricing.details(variant);
    root.querySelector('[data-product-price]').textContent = formatMoney(variantPricing.price);
    compare.hidden = !variantPricing.hasDiscount;
    compare.textContent = variantPricing.hasDiscount ? formatMoney(variantPricing.compareAtPrice) : '';
    savings.hidden = !variantPricing.hasDiscount;
    savings.textContent = variantPricing.hasDiscount ? `Save ${variantPricing.discountPercent}%` : '';
  }
  function getVariantLabel(variant) {
    if (!variant || variant.title === 'Default Title') return '';
    return variant.title || (variant.options || []).filter(Boolean).join(' / ');
  }
  function getVariantImage(variant) {
    const source = variant?.featured_image?.src || data.featured_image?.src || data.images?.[0]?.src;
    if (!source) return '';
    const imageUrl = new URL(String(source).replace(/^\/\//, 'https://'), window.location.href);
    imageUrl.searchParams.set('width', '180');
    return imageUrl.toString();
  }
  function syncSticky(variant) {
    if (!sticky) return;
    const variantPricing = pricing.details(variant || data);
    if (stickyImage) {
      const imageUrl = getVariantImage(variant);
      if (imageUrl) {
        stickyImage.src = imageUrl;
        stickyImage.alt = variant?.featured_image?.alt || data.title || '';
      }
    }
    if (stickyVariant) stickyVariant.textContent = getVariantLabel(variant);
    if (stickyPrice) stickyPrice.textContent = formatMoney(variantPricing.price);
    if (stickyCompare) {
      stickyCompare.hidden = !variantPricing.hasDiscount;
      stickyCompare.textContent = variantPricing.hasDiscount ? formatMoney(variantPricing.compareAtPrice) : '';
    }
    if (stickySavings) {
      stickySavings.hidden = !variantPricing.hasDiscount;
      stickySavings.textContent = variantPricing.hasDiscount ? `Save ${variantPricing.discountPercent}%` : '';
    }
  }
  const selectedValues = () => groups.map((group) => group.querySelector('input:checked')?.value);
  function syncInstallmentsVisibility(element = root.querySelector('.product-installments')) {
    if (!element) return;
    element.hidden = !element.textContent.trim();
  }
  syncInstallmentsVisibility();
  function showImage(src, imageId, alt) {
    if (!mainImage || !src) return;
    mainImage.src = src;
    mainImage.alt = alt || data.title;
    const opener = mainImage.closest('[data-product-gallery-open]');
    if (opener) {
      opener.dataset.src = src;
      opener.dataset.imageId = imageId || '';
      opener.dataset.alt = alt || data.title;
    }
    syncZoomSource(src);
    thumbs.forEach((thumb) => thumb.setAttribute('aria-pressed', String(String(imageId) === thumb.dataset.imageId)));
    thumbs.find((thumb) => String(imageId) === thumb.dataset.imageId)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  const galleryRoot = root.querySelector('.product-gallery');
  const zoomStage = root.querySelector('[data-product-zoom-stage]');
  const zoomLens = root.querySelector('[data-product-zoom-lens]');
  const zoomPane = root.querySelector('[data-product-zoom-pane]');
  const ZOOM_FACTOR = 2.5;
  function highResUrl(src) {
    if (!src) return '';
    try {
      const url = new URL(String(src).replace(/^\/\//, 'https://'), window.location.href);
      if (url.searchParams.has('width')) url.searchParams.set('width', '2400');
      return url.toString();
    } catch { return src; }
  }
  function syncZoomSource(src) {
    if (!zoomPane || !src) return;
    zoomPane.style.backgroundImage = `url("${highResUrl(src)}")`;
  }
  if (mainImage?.src) syncZoomSource(mainImage.src);
  if (galleryRoot && zoomStage && zoomLens && zoomPane && mainImage) {
    const canHoverZoom = () => window.innerWidth > 960 && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
    const stopZoom = () => galleryRoot.classList.remove('is-zooming');
    const updateZoom = (event) => {
      if (!canHoverZoom() || !mainImage.naturalWidth || !mainImage.naturalHeight) { stopZoom(); return; }
      const rect = zoomStage.getBoundingClientRect();
      const paneRect = zoomPane.getBoundingClientRect();
      if (!rect.width || !rect.height || !paneRect.width || !paneRect.height) return;
      const scale = Math.min(rect.width / mainImage.naturalWidth, rect.height / mainImage.naturalHeight);
      const imgW = mainImage.naturalWidth * scale;
      const imgH = mainImage.naturalHeight * scale;
      const imgLeft = (rect.width - imgW) / 2;
      const imgTop = (rect.height - imgH) / 2;
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      if (mx < imgLeft || mx > imgLeft + imgW || my < imgTop || my > imgTop + imgH) { stopZoom(); return; }
      const lensW = Math.min(imgW, paneRect.width / ZOOM_FACTOR);
      const lensH = Math.min(imgH, paneRect.height / ZOOM_FACTOR);
      const lx = Math.max(imgLeft, Math.min(mx - lensW / 2, imgLeft + imgW - lensW));
      const ly = Math.max(imgTop, Math.min(my - lensH / 2, imgTop + imgH - lensH));
      const ix = lx - imgLeft;
      const iy = ly - imgTop;
      zoomLens.style.width = `${lensW}px`;
      zoomLens.style.height = `${lensH}px`;
      zoomLens.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
      zoomPane.style.backgroundSize = `${imgW * ZOOM_FACTOR}px ${imgH * ZOOM_FACTOR}px`;
      zoomPane.style.backgroundPosition = `${-ix * ZOOM_FACTOR}px ${-iy * ZOOM_FACTOR}px`;
      galleryRoot.classList.add('is-zooming');
    };
    zoomStage.addEventListener('pointerenter', updateZoom);
    zoomStage.addEventListener('pointermove', updateZoom);
    zoomStage.addEventListener('pointerleave', stopZoom);
    zoomStage.addEventListener('click', stopZoom);
    window.addEventListener('scroll', stopZoom, { passive: true });
  }
  thumbs.forEach((thumb) => thumb.addEventListener('click', () => showImage(thumb.dataset.src, thumb.dataset.imageId, thumb.dataset.alt)));
  function syncVariant(changedIndex, updateUrl = true) {
    const values = selectedValues();
    const variant = groups.length ? resolveVariant(data.variants, values, changedIndex) : data.variants[0];
    if (variant) {
      groups.forEach((group, index) => {
        group.querySelectorAll('[data-product-option]').forEach((input) => { input.checked = input.value === variant.options[index]; });
      });
      id.value = variant.id;
      id.disabled = false;
      syncPrice(variant);
      syncSticky(variant);
      if (variant.featured_image) {
        const imageUrl = new URL(String(variant.featured_image.src).replace(/^\/\//, 'https://'), window.location.href);
        imageUrl.searchParams.set('width', '1400');
        showImage(imageUrl.toString(), variant.featured_image.id, variant.featured_image.alt);
      }
      if (updateUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set('variant', variant.id);
        groups.forEach((group, index) => url.searchParams.set(group.dataset.optionName, variant.options[index]));
        window.history.replaceState({}, '', url);
      }
      const refreshInstallments = async () => {
        if (!productForm || id.value !== String(variant.id)) return;
        const params = new URLSearchParams({ variant: String(variant.id) });
        try {
          const response = await fetch(`${window.location.pathname}?${params.toString()}`, { headers: { Accept: 'text/html' } });
          if (!response.ok || id.value !== String(variant.id)) return;
          const html = new DOMParser().parseFromString(await response.text(), 'text/html');
          const terms = html.querySelector('.product-installments');
          const currentTerms = root.querySelector('.product-installments');
          if (terms && currentTerms && id.value === String(variant.id)) {
            currentTerms.replaceWith(terms);
            syncInstallmentsVisibility(terms);
          }
        } catch { /* The selected variant and purchase flow still work without refreshed terms. */ }
      };
      refreshInstallments();
    } else {
      id.value = '';
      id.disabled = true;
      syncSticky(null);
    }
    syncSubmit(variant);
    if (paymentButton) paymentButton.disabled = !variant?.available;
    availability.textContent = variant?.available ? '' : (variant ? 'This option is currently sold out.' : 'This combination is not available. Please choose another option.');
    const current = selectedValues();
    groups.forEach((group, index) => {
      group.querySelector('[data-option-label]').textContent = current[index] || '';
      group.querySelectorAll('[data-product-option]').forEach((input) => {
        const possible = data.variants.filter((candidate) => candidate.options[index] === input.value && candidate.options.every((value, position) => position >= index || value === current[position]));
        const label = input.closest('label');
        input.disabled = !possible.length;
        if (label) {
          label.hidden = index > 0 && !possible.length;
          label.classList.toggle('is-unavailable', possible.length > 0 && !possible.some((candidate) => candidate.available));
        }
      });
    });
    syncPackPresentation(variant, current);
  }
  function syncSubmit(variant = data.variants.find((candidate) => String(candidate.id) === id.value)) {
    if (submit.getAttribute('aria-busy') === 'true') return;
    const available = Boolean(variant?.available) && !id.disabled;
    submit.disabled = !available;
    submit.textContent = variant ? (available ? 'Add to bag' : 'Sold out') : 'Unavailable';
  }
  document.addEventListener('nuage:cart-add-finished', (event) => { if (event.detail?.button === submit) syncSubmit(); });
  groups.forEach((group, index) => group.addEventListener('change', () => syncVariant(index)));
  function focusProductOption() {
    const sizeGroup = groups.find((group) => /size/i.test(group.dataset.optionName || ''));
    return sizeGroup?.querySelector('[data-product-option]:not(:disabled)') || submit;
  }
  stickyButton?.addEventListener('click', () => {
    const target = optionsTarget || purchaseBlock;
    if (!target) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    window.setTimeout(() => focusProductOption()?.focus({ preventScroll: true }), reducedMotion ? 0 : 450);
  });
  function setStickyVisible(visible) {
    if (!sticky) return;
    sticky.classList.toggle('is-visible', visible);
    sticky.setAttribute('aria-hidden', String(!visible));
    document.body.classList.toggle('product-sticky-active', visible);
  }
  if (sticky && purchaseBlock && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => setStickyVisible(!entry.isIntersecting), { threshold: 0.05, rootMargin: '-80px 0px 0px' });
    observer.observe(purchaseBlock);
  } else if (sticky && purchaseBlock) {
    const updateStickyVisibility = () => {
      const rect = purchaseBlock.getBoundingClientRect();
      setStickyVisible(rect.bottom < 80 || rect.top > window.innerHeight);
    };
    window.addEventListener('scroll', updateStickyVisibility, { passive: true });
    updateStickyVisibility();
  }
  const scene = root.parentElement?.querySelector('[data-product-scene]') || document.querySelector('[data-product-scene]');
  const sceneTabs = scene ? [...scene.querySelectorAll('[data-product-scene-tab]')] : [];
  const sceneImages = scene ? [...scene.querySelectorAll('[data-product-scene-image]')] : [];
  const sceneStatus = scene?.querySelector('[data-product-scene-status]');
  function setScene(index) {
    if (!sceneTabs.length) return;
    const nextIndex = Math.max(0, Math.min(Number(index) || 0, sceneTabs.length - 1));
    sceneTabs.forEach((tab, tabIndex) => {
      const active = tabIndex === nextIndex;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    sceneImages.forEach((image) => {
      const active = Number(image.dataset.sceneIndex) === nextIndex;
      image.classList.toggle('is-active', active);
      image.setAttribute('aria-hidden', String(!active));
    });
    if (sceneStatus) sceneStatus.textContent = sceneTabs[nextIndex].textContent.trim();
  }
  sceneTabs.forEach((tab) => tab.addEventListener('click', () => setScene(tab.dataset.sceneIndex)));
  if (sceneTabs.length) setScene(0);
  async function refreshProductData() {
    const latestUrl = new URL(window.location.href);
    latestUrl.pathname = `${latestUrl.pathname.replace(/\/$/, '')}.js`;
    latestUrl.search = '';
    latestUrl.searchParams.set('_', String(Date.now()));
    const response = await fetch(latestUrl.toString(), { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Latest product data unavailable');
    const latest = await response.json();
    if (latest?.id && String(latest.id) === String(data.id) && latest.variants?.length) data = latest;
  }
  async function initializeProduct() {
    const params = new URL(window.location.href).searchParams;
    groups.forEach((group) => {
      const requested = params.get(group.dataset.optionName);
      if (requested) {
        const input = [...group.querySelectorAll('input')].find((radio) => radio.value === requested);
        if (input) input.checked = true;
      }
    });
    const requestedVariant = data.variants.find((candidate) => String(candidate.id) === params.get('variant'));
    if (requestedVariant) groups.forEach((group, index) => group.querySelectorAll('input').forEach((input) => { input.checked = input.value === requestedVariant.options[index]; }));
    syncVariant(null, false);
    try {
      await refreshProductData();
      syncVariant(null, false);
    } catch { /* Embedded Liquid data remains the fallback when the fresh product endpoint is unavailable. */ }
  }
  initializeProduct();
  window.addEventListener('popstate', () => {
    const url = new URL(window.location.href);
    const variant = data.variants.find((candidate) => String(candidate.id) === url.searchParams.get('variant'));
    if (!variant) return;
    groups.forEach((group, index) => group.querySelectorAll('input').forEach((input) => { input.checked = input.value === variant.options[index]; }));
    syncVariant(null, false);
  });
  const quantity = root.querySelector('[name="quantity"]');
  root.querySelectorAll('[data-product-quantity]').forEach((button) => button.addEventListener('click', () => {
    quantity.value = Math.max(1, (Number(quantity.value) || 1) + Number(button.dataset.productQuantity));
    quantity.dispatchEvent(new Event('change', { bubbles: true }));
  }));
  paymentButton?.addEventListener('click', async () => {
    if (paymentButton.disabled || id.disabled || !id.value) return;
    const routes = window.ShopifyRoutes || {};
    const form = id.form;
    const item = window.PielikCart?.productFormItem ? window.PielikCart.productFormItem(form) : { id: Number(id.value), quantity: Math.max(1, Number(quantity?.value || 1)) };
    const added = window.PielikCart?.addToCart ? await window.PielikCart.addToCart(item, item.quantity, paymentButton, { openDrawer: false }) : false;
    if (!added) return;
    paymentButton.disabled = true;
    paymentButton.textContent = 'Loading…';
    window.location.href = routes.checkoutUrl || '/checkout';
  });

  const gallery = [...root.querySelectorAll('.product-photo-gallery__card')];
  const mainGalleryOpener = root.querySelector('.product-gallery__main [data-product-gallery-open]');
  const rail = root.querySelector('[data-product-gallery-rail]');
  const lightbox = root.querySelector('[data-product-lightbox]');
  const lightboxViewport = root.querySelector('[data-product-lightbox-viewport]');
  const lightboxImage = root.querySelector('[data-product-lightbox-image]');
  let lightboxIndex = 0;
  let previousBodyOverflow = '';
  let lbScale = 1;
  let lbTx = 0;
  let lbTy = 0;
  const LB_MIN_SCALE = 1;
  const LB_MAX_SCALE = 4;
  function clampLightboxPan(scale, tx, ty) {
    if (!lightboxViewport || !lightboxImage || scale <= 1) return { tx: 0, ty: 0 };
    const vRect = lightboxViewport.getBoundingClientRect();
    const baseW = lightboxImage.offsetWidth || vRect.width;
    const baseH = lightboxImage.offsetHeight || vRect.height;
    const maxX = Math.max(0, (baseW * scale - vRect.width) / 2);
    const maxY = Math.max(0, (baseH * scale - vRect.height) / 2);
    return {
      tx: Math.max(-maxX, Math.min(maxX, tx)),
      ty: Math.max(-maxY, Math.min(maxY, ty))
    };
  }
  function applyLightboxTransform(animate = false) {
    if (!lightboxImage) return;
    lightboxViewport?.classList.toggle('is-animating', animate);
    const clamped = clampLightboxPan(lbScale, lbTx, lbTy);
    lbTx = clamped.tx;
    lbTy = clamped.ty;
    lightboxImage.style.transform = lbScale === 1 && lbTx === 0 && lbTy === 0 ? '' : `translate3d(${lbTx}px, ${lbTy}px, 0) scale(${lbScale})`;
    lightbox?.classList.toggle('is-zoomed', lbScale > 1.02);
  }
  function resetLightboxZoom(animate = false) {
    lbScale = 1;
    lbTx = 0;
    lbTy = 0;
    applyLightboxTransform(animate);
  }
  function renderLightbox(index) {
    if (!gallery.length || !lightboxImage) return;
    lightboxIndex = (index + gallery.length) % gallery.length;
    const item = gallery[lightboxIndex];
    resetLightboxZoom(false);
    lightboxImage.src = item.dataset.src;
    lightboxImage.alt = item.dataset.alt || data.title;
    root.querySelector('[data-product-lightbox-count]').textContent = `${lightboxIndex + 1} / ${gallery.length}`;
  }
  function closeLightbox() {
    if (!lightbox?.open) return;
    resetLightboxZoom(false);
    lightbox.close();
    document.body.style.overflow = previousBodyOverflow;
  }
  function openGalleryItem(item, fallbackIndex = 0) {
    if (!lightbox) return;
    const index = gallery.findIndex((card) => card.dataset.imageId === item?.dataset.imageId);
    renderLightbox(index >= 0 ? index : fallbackIndex);
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    lightbox.showModal();
  }
  if (lightboxViewport && lightboxImage) {
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchStartTx = 0;
    let pinchStartTy = 0;
    let pinchMidX = 0;
    let pinchMidY = 0;
    let panStartX = 0;
    let panStartY = 0;
    let panStartTx = 0;
    let panStartTy = 0;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let touchMoved = false;
    let lastTapTime = 0;
    const touchDist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    lightboxViewport.addEventListener('touchstart', (event) => {
      touchMoved = false;
      if (event.touches.length === 2) {
        event.preventDefault();
        const [t1, t2] = event.touches;
        const vRect = lightboxViewport.getBoundingClientRect();
        pinchStartDist = touchDist(t1, t2) || 1;
        pinchStartScale = lbScale;
        pinchStartTx = lbTx;
        pinchStartTy = lbTy;
        pinchMidX = (t1.clientX + t2.clientX) / 2 - (vRect.left + vRect.width / 2);
        pinchMidY = (t1.clientY + t2.clientY) / 2 - (vRect.top + vRect.height / 2);
      } else if (event.touches.length === 1) {
        const t = event.touches[0];
        panStartX = t.clientX;
        panStartY = t.clientY;
        panStartTx = lbTx;
        panStartTy = lbTy;
        swipeStartX = t.clientX;
        swipeStartY = t.clientY;
      }
    }, { passive: false });
    lightboxViewport.addEventListener('touchmove', (event) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        touchMoved = true;
        const [t1, t2] = event.touches;
        const vRect = lightboxViewport.getBoundingClientRect();
        const dist = touchDist(t1, t2);
        const nextScale = Math.max(LB_MIN_SCALE, Math.min(LB_MAX_SCALE, pinchStartScale * (dist / pinchStartDist)));
        const curMidX = (t1.clientX + t2.clientX) / 2 - (vRect.left + vRect.width / 2);
        const curMidY = (t1.clientY + t2.clientY) / 2 - (vRect.top + vRect.height / 2);
        const ratio = nextScale / pinchStartScale;
        lbScale = nextScale;
        lbTx = curMidX - (pinchMidX - pinchStartTx) * ratio;
        lbTy = curMidY - (pinchMidY - pinchStartTy) * ratio;
        applyLightboxTransform(false);
      } else if (event.touches.length === 1 && lbScale > 1) {
        event.preventDefault();
        touchMoved = true;
        const t = event.touches[0];
        lbTx = panStartTx + (t.clientX - panStartX);
        lbTy = panStartTy + (t.clientY - panStartY);
        applyLightboxTransform(false);
      } else if (event.touches.length === 1) {
        const t = event.touches[0];
        if (Math.hypot(t.clientX - swipeStartX, t.clientY - swipeStartY) > 10) touchMoved = true;
      }
    }, { passive: false });
    lightboxViewport.addEventListener('touchend', (event) => {
      if (event.touches.length === 1 && lbScale > 1) {
        const t = event.touches[0];
        panStartX = t.clientX;
        panStartY = t.clientY;
        panStartTx = lbTx;
        panStartTy = lbTy;
        return;
      }
      if (event.touches.length === 0) {
        if (lbScale < 1.05) {
          if (lbScale !== 1) resetLightboxZoom(true);
          if (touchMoved && event.changedTouches.length === 1) {
            const t = event.changedTouches[0];
            const dx = t.clientX - swipeStartX;
            const dy = t.clientY - swipeStartY;
            if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
              renderLightbox(lightboxIndex + (dx < 0 ? 1 : -1));
            }
          } else if (!touchMoved && event.changedTouches.length === 1) {
            const now = Date.now();
            if (now - lastTapTime < 280) {
              const t = event.changedTouches[0];
              const vRect = lightboxViewport.getBoundingClientRect();
              const tapX = t.clientX - (vRect.left + vRect.width / 2);
              const tapY = t.clientY - (vRect.top + vRect.height / 2);
              lbScale = 2.5;
              lbTx = -tapX * (lbScale - 1);
              lbTy = -tapY * (lbScale - 1);
              applyLightboxTransform(true);
              lastTapTime = 0;
            } else {
              lastTapTime = now;
            }
          }
        } else if (!touchMoved && event.changedTouches.length === 1) {
          const now = Date.now();
          if (now - lastTapTime < 280) {
            resetLightboxZoom(true);
            lastTapTime = 0;
          } else {
            lastTapTime = now;
          }
        }
      }
    });
  }
  gallery.forEach((item, index) => item.addEventListener('click', () => openGalleryItem(item, index)));
  mainGalleryOpener?.addEventListener('click', () => openGalleryItem(mainGalleryOpener));
  root.querySelector('[data-product-lightbox-close]')?.addEventListener('click', closeLightbox);
  root.querySelectorAll('[data-product-lightbox-nav]').forEach((button) => button.addEventListener('click', () => renderLightbox(lightboxIndex + Number(button.dataset.productLightboxNav))));
  lightbox?.addEventListener('click', (event) => { if (event.target === lightbox) closeLightbox(); });
  lightbox?.addEventListener('close', () => { document.body.style.overflow = previousBodyOverflow; });
  lightbox?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); renderLightbox(lightboxIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); renderLightbox(lightboxIndex + 1); }
  });
  const scrollButtons = [...root.querySelectorAll('[data-product-gallery-scroll]')];
  function syncGalleryControls() {
    if (!rail) return;
    scrollButtons.forEach((button) => {
      button.disabled = Number(button.dataset.productGalleryScroll) < 0 ? rail.scrollLeft <= 2 : rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2;
    });
  }
  scrollButtons.forEach((button) => button.addEventListener('click', () => {
    const card = rail?.querySelector('.product-photo-gallery__card');
    rail?.scrollBy({ left: Number(button.dataset.productGalleryScroll) * ((card?.getBoundingClientRect().width || 320) + 16) * 2, behavior: 'smooth' });
  }));
  rail?.addEventListener('scroll', syncGalleryControls, { passive: true });
  window.addEventListener('resize', syncGalleryControls);
  syncGalleryControls();
})();
