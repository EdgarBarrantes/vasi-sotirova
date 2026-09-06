/* Vasilka Sotirova — portfolio behaviour.
   Three small pieces, no dependencies: blur-up image reveal, an accessible
   lightbox for the artwork grids, and progressive enhancement for the
   contact form. */
(function () {
  'use strict';

  document.documentElement.classList.remove('no-js');

  /* ---------------------------------------------------------- blur-up */

  function revealImages() {
    document.querySelectorAll('.blur-up > img').forEach(function (img) {
      if (img.complete && img.naturalWidth > 0) {
        img.classList.add('is-loaded');
      } else {
        img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
        img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
      }
    });
  }

  /* --------------------------------------------------------- lightbox */

  function initLightbox() {
    var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
    if (!triggers.length) return;

    var items = triggers.map(function (el) {
      return {
        src: el.getAttribute('data-full'),
        srcset: el.getAttribute('data-fullset') || '',
        alt: el.getAttribute('data-alt') || '',
        width: el.getAttribute('data-width'),
        height: el.getAttribute('data-height')
      };
    });

    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Artwork viewer');
    box.hidden = true;
    box.innerHTML =
      '<button class="lightbox__btn lightbox__close" type="button" aria-label="Close viewer">✕</button>' +
      '<div class="lightbox__stage"><img class="lightbox__img" alt=""></div>' +
      '<div class="lightbox__bar">' +
      '<button class="lightbox__btn" type="button" data-nav="prev" aria-label="Previous artwork">‹</button>' +
      '<span class="lightbox__count" aria-live="polite"></span>' +
      '<button class="lightbox__btn" type="button" data-nav="next" aria-label="Next artwork">›</button>' +
      '</div>';
    document.body.appendChild(box);

    var stageImg = box.querySelector('.lightbox__img');
    var closeBtn = box.querySelector('.lightbox__close');
    var prevBtn = box.querySelector('[data-nav="prev"]');
    var nextBtn = box.querySelector('[data-nav="next"]');
    var counter = box.querySelector('.lightbox__count');
    var index = 0;
    var lastFocus = null;

    function render(i) {
      index = (i + items.length) % items.length;
      var item = items[index];
      stageImg.src = item.src;
      if (item.srcset) stageImg.srcset = item.srcset; else stageImg.removeAttribute('srcset');
      stageImg.sizes = '100vw';
      stageImg.alt = item.alt;
      if (item.width) stageImg.width = item.width;
      if (item.height) stageImg.height = item.height;
      counter.textContent = (index + 1) + ' / ' + items.length;
      var single = items.length < 2;
      prevBtn.disabled = single;
      nextBtn.disabled = single;
      // Warm the neighbours so arrow-key browsing feels instant.
      [items[(index + 1) % items.length], items[(index - 1 + items.length) % items.length]]
        .forEach(function (n) { if (n) { var p = new Image(); p.src = n.src; } });
    }

    function open(i, origin) {
      lastFocus = origin || document.activeElement;
      box.hidden = false;
      render(i);
      // Next frame, so the transition has a starting state to animate from.
      requestAnimationFrame(function () { box.classList.add('is-open'); });
      document.body.classList.add('is-locked');
      closeBtn.focus();
    }

    function close() {
      box.classList.remove('is-open');
      document.body.classList.remove('is-locked');
      window.setTimeout(function () { box.hidden = true; stageImg.removeAttribute('src'); }, 200);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    triggers.forEach(function (el, i) {
      el.addEventListener('click', function (event) {
        event.preventDefault();
        open(i, el);
      });
    });

    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', function () { render(index - 1); });
    nextBtn.addEventListener('click', function () { render(index + 1); });

    box.addEventListener('click', function (event) {
      if (event.target === box || event.target.classList.contains('lightbox__stage')) close();
    });

    document.addEventListener('keydown', function (event) {
      if (box.hidden) return;
      if (event.key === 'Escape') { close(); return; }
      if (event.key === 'ArrowRight') { render(index + 1); return; }
      if (event.key === 'ArrowLeft') { render(index - 1); return; }
      if (event.key !== 'Tab') return;
      // Keep focus inside the dialog while it is open.
      var focusable = [closeBtn, prevBtn, nextBtn].filter(function (b) { return !b.disabled; });
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    // Swipe between works on touch devices.
    var startX = null;
    box.addEventListener('touchstart', function (e) { startX = e.changedTouches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 45) render(index + (dx < 0 ? 1 : -1));
      startX = null;
    }, { passive: true });
  }

  /* ------------------------------------------------------ contact form */

  function initForm() {
    var form = document.querySelector('[data-contact-form]');
    if (!form) return;
    var status = form.querySelector('.form__status');
    var endpoint = form.getAttribute('data-endpoint');

    form.addEventListener('submit', function (event) {
      if (!endpoint) return; // no endpoint configured: fall through to mailto
      event.preventDefault();
      status.textContent = 'Sending…';
      fetch(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form)
      }).then(function (res) {
        if (!res.ok) throw new Error('Request failed');
        form.reset();
        status.textContent = 'Thanks for your message — I will be in touch soon.';
      }).catch(function () {
        status.textContent = 'Sorry, that did not send. Please email me directly.';
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { revealImages(); initLightbox(); initForm(); });
  } else {
    revealImages();
    initLightbox();
    initForm();
  }
})();
