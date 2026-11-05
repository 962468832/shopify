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

  const isRecover = toggle.matches('[data-toggle-recover]');
  const recoverForm = document.querySelector('[data-recover-form]');
  const signInForm = document.querySelector('.auth-card:not([data-recover-form])');
  recoverForm.hidden = !isRecover;
  signInForm.hidden = isRecover;
});

if (window.Shopify && window.Shopify.CountryProvinceSelector) {
  new window.Shopify.CountryProvinceSelector('AddressCountryNew', 'AddressProvinceNew', { hideElement: 'AddressProvinceContainerNew' });
  document.querySelectorAll('.address-card').forEach((card, index) => {
    new window.Shopify.CountryProvinceSelector(`AddressCountry${index + 1}`, `AddressProvince${index + 1}`, { hideElement: `AddressProvinceContainer${index + 1}` });
  });
}
