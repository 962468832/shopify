(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canHover = window.matchMedia('(hover: hover)');
  const controllers = new Map();
  const globalEvents = new AbortController();
  window.NuageHome?.destroy();
  const init = (root) => {
    // Shopify replaces section HTML without reloading scripts.
    for (const [node, controller] of controllers) {
      if (node === root || (root.id && node.id === root.id)) { controller.destroy(); controllers.delete(node); }
    }
    if (!root.querySelector('[data-home-video], [data-home-rail], .home-journal-grid')) return;
    const events = new AbortController();
    const cleanups = [];
    const listen = (target, name, handler, options = {}) => target.addEventListener(name, handler, { ...(typeof options === 'boolean' ? { capture:options } : options), signal:events.signal });
    const videos = [...root.querySelectorAll('[data-home-video]')];
    const pause = (wrapper) => {
      wrapper.querySelector('video').pause();
    };
    const load = (video) => {
      if (!video.getAttribute('src') && video.dataset.src) { video.src = video.dataset.src; video.load(); }
    };
    const play = (wrapper) => {
      const video = wrapper.querySelector('video');
      load(video);
      video.play().catch(() => { wrapper.classList.add('is-paused'); });
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        target.dataset.visible = String(isIntersecting);
        if (!isIntersecting) { pause(target); return; }
        const video = target.querySelector('video');
        load(video);
        if (target.dataset.videoMode !== 'hover' && !document.hidden && !reduceMotion.matches && !target.hasAttribute('data-user-paused')) play(target);
      });
    }, { threshold: 0.15 });
    cleanups.push(() => observer.disconnect());
    videos.forEach((wrapper) => {
      const video = wrapper.querySelector('video');
      const button = wrapper.querySelector('[data-video-toggle]');
      const title = video.getAttribute('aria-label');
      video.muted = true;
      const update = () => {
        button.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} ${title}`);
        button.setAttribute('aria-pressed', String(!video.paused));
        button.querySelector('span').textContent = video.paused ? '▶' : 'Ⅱ';
      };
      listen(video, 'play', update);
      listen(video, 'pause', update);
      listen(button, 'click', () => {
        if (video.paused) { wrapper.removeAttribute('data-user-paused'); play(wrapper); }
        else { wrapper.setAttribute('data-user-paused', ''); pause(wrapper); }
      });
      if (wrapper.dataset.videoMode === 'hover') {
        listen(wrapper, 'pointerenter', () => { if (canHover.matches && !reduceMotion.matches && !wrapper.hasAttribute('data-user-paused')) play(wrapper); });
        listen(wrapper, 'pointerleave', () => { if (canHover.matches) pause(wrapper); });
        listen(wrapper, 'focusin', (event) => { if (event.target.matches(':focus-visible') && !reduceMotion.matches) play(wrapper); });
        listen(wrapper, 'focusout', () => pause(wrapper));
      }
      observer.observe(wrapper);
    });
    root.querySelectorAll('[data-home-rail], .home-journal-grid').forEach((rail) => {
      const carousel = rail.closest('[data-home-carousel]');
      const buttons = [...(carousel?.querySelectorAll('[data-rail-direction]') || [])];
      const update = () => buttons.forEach((button) => { button.disabled = Number(button.dataset.railDirection) < 0 ? rail.scrollLeft < 2 : rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2; });
      buttons.forEach((button) => listen(button, 'click', () => rail.scrollBy({ left: Number(button.dataset.railDirection) * rail.clientWidth * .85, behavior: reduceMotion.matches ? 'auto' : 'smooth' })));
      listen(rail, 'scroll', update, { passive:true });
      listen(rail, 'keydown', (event) => { if (event.target === rail && ['ArrowRight', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); rail.scrollBy({ left: (event.key === 'ArrowRight' ? 1 : -1) * rail.clientWidth * .8, behavior:reduceMotion.matches ? 'auto' : 'smooth' }); } });
      listen(rail, 'wheel', (event) => {
        if (event.defaultPrevented || event.ctrlKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const max = rail.scrollWidth - rail.clientWidth;
        if (max <= 1) return;
        const lockVerticalWheel = rail.classList.contains('home-product-rail') || rail.classList.contains('home-community-rail');
        // Product and community rails must not turn a normal vertical page scroll into horizontal movement.
        // Keep real horizontal trackpad gestures available by requiring deltaX to dominate.
        if (lockVerticalWheel && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        const delta = lockVerticalWheel ? event.deltaX : (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY);
        const distance = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1);
        if (!distance || (distance < 0 && rail.scrollLeft <= 1) || (distance > 0 && rail.scrollLeft >= max - 1)) return;
        event.preventDefault();
        rail.scrollLeft = Math.max(0, Math.min(max, rail.scrollLeft + distance));
      }, { passive:false });
      let drag = null;
      let suppressClick = false;
      let clickTimer;
      listen(rail, 'pointerdown', (event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button')) return;
        suppressClick = false;
        drag = { x:event.clientX, scroll:rail.scrollLeft, id:event.pointerId, moved:false };
      });
      listen(rail, 'pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        if (Math.abs(event.clientX - drag.x) > 8) {
          if (!drag.moved) rail.setPointerCapture(event.pointerId);
          drag.moved = true;
          suppressClick = true;
          rail.classList.add('is-dragging');
          rail.scrollLeft = drag.scroll - (event.clientX - drag.x);
          event.preventDefault();
        }
      });
      listen(rail, 'click', (event) => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } }, true);
      const finishDrag = () => {
        if (!drag) return;
        if (rail.hasPointerCapture(drag.id)) rail.releasePointerCapture(drag.id);
        rail.classList.remove('is-dragging');
        drag = null;
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { suppressClick = false; }, 0);
      };
      listen(window, 'pointerup', finishDrag);
      listen(window, 'pointercancel', finishDrag);
      listen(window, 'blur', finishDrag);
      listen(rail, 'dragstart', (event) => event.preventDefault());
      const resize = new ResizeObserver(update);
      resize.observe(rail);
      cleanups.push(() => { resize.disconnect(); finishDrag(); clearTimeout(clickTimer); });
      update();
    });
    root.querySelectorAll('[data-guide-open]').forEach((button) => listen(button, 'click', () => root.querySelector(`[id="${CSS.escape(button.dataset.guideOpen)}"]`)?.showModal()));
    root.querySelectorAll('.home-guide').forEach((dialog) => {
      listen(dialog.querySelector('[data-guide-close]'), 'click', () => dialog.close());
      listen(dialog, 'click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    });

    controllers.set(root, {
      destroy() {
        events.abort();
        cleanups.forEach((cleanup) => cleanup());
        videos.forEach(pause);
        root.querySelectorAll('.home-guide[open]').forEach((dialog) => dialog.close());
      },
      resume() {
        videos.forEach((wrapper) => {
          if (document.hidden) pause(wrapper);
          else if (wrapper.dataset.visible === 'true' && wrapper.dataset.videoMode !== 'hover' && !reduceMotion.matches && !wrapper.hasAttribute('data-user-paused')) play(wrapper);
        });
      },
    });
  };
  document.querySelectorAll('.shopify-section').forEach(init);
  document.addEventListener('visibilitychange', () => controllers.forEach((controller) => controller.resume()), { signal:globalEvents.signal });
  document.addEventListener('shopify:section:load', (event) => init(event.target), { signal:globalEvents.signal });
  document.addEventListener('shopify:section:unload', (event) => {
    const controller = controllers.get(event.target);
    controller?.destroy();
    controllers.delete(event.target);
  }, { signal:globalEvents.signal });
  document.addEventListener('shopify:block:select', (event) => {
    const rail = event.target.closest('[data-home-rail], .home-journal-grid');
    if (rail) event.target.scrollIntoView({ block:'nearest', inline:'center', behavior:'instant' });
  }, { signal:globalEvents.signal });
  window.NuageHome = {
    destroy() {
      globalEvents.abort();
      controllers.forEach((controller) => controller.destroy());
      controllers.clear();
    },
  };
})();
