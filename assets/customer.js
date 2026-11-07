document.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-address-toggle], [data-toggle-recover], [data-toggle-login]');
  if (!toggle) return;
  event.preventDefault();

  if (toggle.matches('[data-address-toggle]')) {
    const card = toggle.closest('.address-card');
    const form = card ? card.querySelector('[data-address-form]') : document.querySelector('[data-address-form]');
    if (!form) return;
    const isOpen = !form.hidden;
    form.hidden = isOpen;
    toggle.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  showRecover(toggle.matches('[data-toggle-recover]'));
});

function showRecover(isRecover) {
  const recoverForm = document.querySelector('[data-recover-form]');
  const signInForm = document.querySelector('[data-login-form]');
  if (!recoverForm || !signInForm) return;
  recoverForm.hidden = !isRecover;
  signInForm.hidden = isRecover;
  (isRecover ? recoverForm : signInForm).querySelector('input:not([type="hidden"])')?.focus({ preventScroll: true });
}

// Shopify re-renders the login page after a recover post; reopen the recover card so its message is visible.
if (window.location.hash === '#recover' || document.querySelector('[data-recover-posted]')) showRecover(true);

// Keep address forms open when Shopify returns validation errors.
document.querySelectorAll('[data-address-form]').forEach((form) => {
  if (!form.querySelector('.errors')) return;
  form.hidden = false;
  const card = form.closest('.address-card');
  (card || document).querySelector('[data-address-toggle]')?.setAttribute('aria-expanded', 'true');
});

if (window.Shopify && window.Shopify.CountryProvinceSelector) {
  new window.Shopify.CountryProvinceSelector('AddressCountryNew', 'AddressProvinceNew', { hideElement: 'AddressProvinceContainerNew' });
  document.querySelectorAll('.address-card').forEach((card, index) => {
    new window.Shopify.CountryProvinceSelector(`AddressCountry${index + 1}`, `AddressProvince${index + 1}`, { hideElement: `AddressProvinceContainer${index + 1}` });
  });
}
