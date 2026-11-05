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
  const data = JSON.parse(root.querySelector('[data-product-json]').textContent);
  const groups = [...root.querySelectorAll('[data-option-group]')];
  const mainImage = root.querySelector('[data-product-main]');
  const thumbs = [...root.querySelectorAll('[data-product-thumb]')];
  const id = root.querySelector('[data-variant-id]');
  const submit = root.querySelector('[data-product-submit]');
  const paymentButton = root.querySelector('[data-product-buy-now]');
  const availability = root.querySelector('[data-product-availability]');
  const currency = root.dataset.currency || 'USD';
  const formatMoney = (cents) => new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency }).format(cents / 100);
  const selectedValues = () => groups.map((group) => group.querySelector('input:checked')?.value);
  function showImage(src, imageId, alt) {
    if (!mainImage || !src) return;
    mainImage.src = src;
    mainImage.alt = alt || data.title;
    thumbs.forEach((thumb) => thumb.setAttribute('aria-pressed', String(String(imageId) === thumb.dataset.imageId)));
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
      root.querySelector('[data-product-price]').textContent = formatMoney(variant.price);
      const compare = root.querySelector('[data-product-compare]');
      compare.hidden = !(variant.compare_at_price > variant.price);
      compare.textContent = compare.hidden ? '' : formatMoney(variant.compare_at_price);
      if (variant.featured_image) showImage(variant.featured_image.src, variant.featured_image.id, variant.featured_image.alt);
      if (updateUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set('variant', variant.id);
        groups.forEach((group, index) => url.searchParams.set(group.dataset.optionName, variant.options[index]));
        window.history.replaceState({}, '', url);
      }
    } else {
      id.value = '';
      id.disabled = true;
    }
    submit.disabled = !variant?.available;
    submit.textContent = variant ? (variant.available ? 'Add to bag' : 'Sold out') : 'Unavailable';
    if (paymentButton) paymentButton.disabled = !variant?.available;
    availability.textContent = variant?.available ? '' : (variant ? 'This option is currently sold out.' : 'This combination is not available. Please choose another option.');
    const current = selectedValues();
    groups.forEach((group, index) => {
      group.querySelector('[data-option-label]').textContent = current[index] || '';
      group.querySelectorAll('[data-product-option]').forEach((input) => {
        const possible = data.variants.filter((candidate) => candidate.options[index] === input.value && candidate.options.every((value, position) => position >= index || value === current[position]));
        input.disabled = !possible.length;
        input.closest('label').classList.toggle('is-unavailable', !possible.some((candidate) => candidate.available));
      });
    });
  }
  groups.forEach((group, index) => group.addEventListener('change', () => syncVariant(index)));
  const params = new URL(window.location.href).searchParams;
  groups.forEach((group) => {
    const requested = params.get(group.dataset.optionName);
    if (requested) {
      const input = [...group.querySelectorAll('input')].find((radio) => radio.value === requested);
      if (input) input.checked = true;
    }
  });
  syncVariant(null, false);
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
    const label = paymentButton.textContent;
    paymentButton.disabled = true;
    paymentButton.textContent = 'Loading…';
    try {
      const routes = window.ShopifyRoutes || {};
      const endpoint = (routes.cartAdd || '/cart/add.js').replace(/\.js$/, '') + '.js';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(id.value), quantity: Math.max(1, Number(quantity?.value || 1)) }] })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.description || error.message || 'Unable to start checkout. Please try again.');
      }
      window.location.href = routes.cartUrl || '/cart';
    } catch (error) {
      availability.textContent = error.message;
      paymentButton.disabled = false;
      paymentButton.textContent = label;
    }
  });
})();
