// script.js — full drop-in replacement (final attempt — robust single-source add path for touch)
// Key strategy:
// - For touch devices, only pointerdown/pointerup path performs Add-to-Cart. pointerup will mark the element
//   to suppress the following click event. Click handler still exists for non-touch devices.
// - Adds use normalized ids, an in-flight Set, and timestamp debounce map to absolutely avoid duplicates.
// - Element-level suppression (dataset._suppressClick) prevents pointerup->click double-add races on iPhone.
// - Defensive: script guards against double-loading and preserves original app features.
(function(){
  'use strict';

  // avoid loading script twice
  if (window.__shopScriptLoaded) {
    console.warn('[app] script already loaded - skipping duplicate load.');
    return;
  }
  window.__shopScriptLoaded = true;

  const LOG = false;
  const BAG_KEY = 'bag';
  const UPDATE_KEY = '__bag_updated_at';
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from((root || document).querySelectorAll(sel));

  // detect touch-capable environment
  const IS_TOUCH = (('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0));

  /* -------------------------
     Mobile vh (debounced)
  -------------------------*/
  function setVh(){ document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`); }
  setVh();
  let _vhTimer = null;
  window.addEventListener('resize', () => { clearTimeout(_vhTimer); _vhTimer = setTimeout(setVh, 180); });

  /* -------------------------
     I18N (kept minimal)
  -------------------------*/
  const I18N = {
    en: {
      nav: { home:'Home', products:'Products', contact:'Contact', cart:'Cart' },
      page: {
        productsHeading: 'Products',
        contactHeading: 'Contact US',
        reviewHeading: 'Feedbacks',
        comingSoon: 'Coming soon',
        yourCart: 'Your Cart',
        bagEmpty: 'Your bag is empty',
        subtotalLabel: 'Subtotal',
        checkoutBtn: 'Check Out',
        acceptLabel: 'We Accept:',
        feeds: 'Feeds',
        phoneHeader: 'Phone Number:'
      },
      cta: { add: 'Add to Cart', addedToast: 'added' }
    },
    kh: {
      nav: { home:'ទំព័រដើម', products:'ផលិតផល', contact:'ទំនាក់ទំនង', cart:'កាបូប' },
      page: {
        productsHeading: 'ផលិតផល',
        contactHeading: 'ទំនាក់ទំនង',
        reviewHeading: 'មតិយោបល់ពីអតិថិជន',
        comingSoon: 'ឆាប់តែកើតមាន',
        yourCart: 'កាបូបរបស់អ្នក',
        bagEmpty: 'កាបូបរបស់អ្នកទទេ',
        subtotalLabel: 'សរុបរង',
        checkoutBtn: 'ចូលទិញ',
        acceptLabel: 'យើងទទួល៖',
        feeds: 'ចូលទិញ',
        phoneHeader: 'លេខទូរស័ព្ទ:'
      },
      cta: { add: 'បន្ថែមទៅកាបូប', addedToast: 'បានបន្ថែម' }
    }
  };

  function getLang(){ return localStorage.getItem('siteLang') || 'en'; }
  function setLang(l){ localStorage.setItem('siteLang', l); document.documentElement.lang = l; document.body.classList.toggle('lang-kh', l === 'kh'); translatePage(l); renderProductControls(); }

  function translatePage(lang){
    const i18 = I18N[lang] || I18N.en;
    $$('#site-nav a').forEach(a => {
      const txt = a.textContent.trim().toLowerCase();
      if (txt.includes('home') || txt.includes('ទំព័រ')) a.textContent = i18.nav.home;
      else if (txt.includes('product') || txt.includes('ផលិត')) a.textContent = i18.nav.products;
      else if (txt.includes('contact') || txt.includes('ទំន')) a.textContent = i18.nav.contact;
      else if (txt.includes('cart') || txt.includes('កាបូប')) a.textContent = i18.nav.cart;
    });
    const langSel = $('#lang-switcher'); if (langSel) langSel.value = lang;
    const productsHeading = $('.product-title-main'); if (productsHeading) productsHeading.textContent = i18.page.productsHeading;
    const contactHeading = $('.contact-heading'); if (contactHeading) contactHeading.textContent = i18.page.contactHeading;
    const reviewHeading = $('.reviewtext'); if (reviewHeading) reviewHeading.textContent = i18.page.reviewHeading;
    const acceptLabel = document.querySelector('.accept-label'); if (acceptLabel) acceptLabel.textContent = i18.page.acceptLabel;
    const phoneHeader = document.querySelector('.phone-header'); if (phoneHeader) phoneHeader.innerHTML = `<span class="phone-icon">📞</span> ${i18.page.phoneHeader}`;
    $$('.product-card.placeholder .cta.disabled').forEach(el => { el.textContent = i18.page.comingSoon; });
    const miniTitle = document.querySelector('#mini-cart .mini-cart-header strong'); if (miniTitle) miniTitle.textContent = i18.page.yourCart;
    $$('#mini-cart .mini-cart-footer .actions a.btn, .mini-cart .actions a.btn').forEach(a => { a.textContent = i18.page.checkoutBtn; });
    // product titles: intentionally do not override unless data-title-kh present
    $$('.product-card').forEach(card => {
      const pTitleEl = card.querySelector('.product-title, .product-titlea') || card.querySelector('h3');
      if (!pTitleEl) return;
      if (lang !== 'en' && card.dataset.titleKh) pTitleEl.textContent = card.dataset.titleKh;
    });
  }

  /* -------------------------
     Storage helpers
  -------------------------*/
  function loadBag(){
    try {
      const raw = localStorage.getItem(BAG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { localStorage.removeItem(BAG_KEY); return []; }
      return parsed;
    } catch(err){
      console.warn('[app] malformed bag — clearing', err);
      try { localStorage.removeItem(BAG_KEY); } catch(e){}
      return [];
    }
  }

  function formatPrice(n){ return '$' + (Number(n)||0).toFixed(2); }

  function saveBag(bag){
    try { localStorage.setItem(BAG_KEY, JSON.stringify(bag || [])); }
    catch(err){ console.error('[app] saveBag error', err); }
    try { localStorage.setItem(UPDATE_KEY, Date.now().toString()); } catch(e){}
    renderBadges();
    updateMiniCartUI();
    renderProductControls();
    syncSubtotalDisplays();
    updateCheckoutButtonState();
  }

  /* -------------------------
     Badges & subtotal
  -------------------------*/
  function renderBadges(){
    const bag = loadBag();
    const totalQty = bag.reduce((s,i) => s + Number(i.qty || 0), 0);
    const els = ['#cart-quantity', '#floating-cart-qty', '#nav-cart-qty'];
    els.forEach(sel => { const el = document.querySelector(sel); if (el) el.textContent = totalQty; });
  }

  function syncSubtotalDisplays(){
    const bag = loadBag();
    const subtotal = bag.reduce((s,i) => s + (Number(i.price||0) * Number(i.qty||0)), 0);
    const selectors = ['#mini-cart-sub','#mini-cart-subtotal','#subtotal','#checkout-subtotal','#bag-total'];
    selectors.forEach(sel => document.querySelectorAll(sel).forEach(el => { if (el) el.textContent = formatPrice(subtotal); }));
  }

  /* -------------------------
     Toast
  -------------------------*/
  function showToast(msg, d=1400){
    const existing = document.querySelector('.add-toast');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.className = 'add-toast';
    t.textContent = msg;
    Object.assign(t.style, { position:'fixed', left:'50%', transform:'translateX(-50%)', bottom:'22px', background:'rgba(0,0,0,0.88)', color:'#fff', padding:'8px 12px', borderRadius:'8px', zIndex:99999, fontWeight:700 });
    document.body.appendChild(t);
    setTimeout(()=> t.remove(), d);
  }

  /* -------------------------
     Debounce / anti-double-add helpers
     - timestamp map + in-flight set
     - element-level suppression for click after pointerup
  -------------------------*/
  const _lastAddAt = new Map(); // id -> timestamp
  const _inFlight = new Set();  // id currently being processed (prevents concurrent adds)
  const ADD_DEBOUNCE_MS = 800; // ms

  function normalizeId(id){ return id == null ? null : String(id); }

  function shouldIgnoreAdd(id){
    if (!id) return false;
    const now = Date.now();
    const prev = _lastAddAt.get(id) || 0;
    if (now - prev < ADD_DEBOUNCE_MS) return true;
    _lastAddAt.set(id, now);
    setTimeout(()=>{ if (Date.now() - (_lastAddAt.get(id) || 0) > ADD_DEBOUNCE_MS) _lastAddAt.delete(id); }, ADD_DEBOUNCE_MS + 300);
    return false;
  }

  function getCtaIdFromEl(el){
    if (!el) return null;
    const attrId = el.dataset.id || el.getAttribute('data-id') || el.closest('.product-card')?.dataset?.id;
    return normalizeId(attrId);
  }

  function markElementAdded(el, id){
    try {
      const t = Date.now();
      if (el && el.dataset) el.dataset._lastAdd = String(t);
      // set suppression so subsequent click is ignored
      if (el && el.dataset) { el.dataset._suppressClick = String(t); }
      if (id) _lastAddAt.set(normalizeId(id), t);
      setTimeout(()=>{ try {
        if (el && el.dataset && el.dataset._lastAdd && (Date.now() - Number(el.dataset._lastAdd) > ADD_DEBOUNCE_MS)) delete el.dataset._lastAdd;
        if (el && el.dataset && el.dataset._suppressClick && (Date.now() - Number(el.dataset._suppressClick) > ADD_DEBOUNCE_MS)) delete el.dataset._suppressClick;
      } catch(_) {} }, ADD_DEBOUNCE_MS + 350);
    } catch(_) {}
  }

  function recentlyAddedForElementOrId(el, id){
    const now = Date.now();
    try {
      if (el && el.dataset && el.dataset._lastAdd) {
        if (now - Number(el.dataset._lastAdd) < ADD_DEBOUNCE_MS) return true;
      }
    } catch(_) {}
    if (id) {
      const prev = _lastAddAt.get(normalizeId(id)) || 0;
      if (now - prev < ADD_DEBOUNCE_MS) return true;
    }
    return false;
  }

  /* -------------------------
     Cart logic
     - addToCart uses inFlight guard and strict normalization
  -------------------------*/
  function addToCart(rawId, qty=1){
    const id = normalizeId(rawId);
    if (!id) return;
    if (_inFlight.has(id)) {
      if (LOG) console.log('[app] addToCart skipped (in-flight)', id);
      return;
    }
    if (shouldIgnoreAdd(id)) {
      if (LOG) console.log('[app] addToCart ignored (debounce)', id);
      return;
    }
    _inFlight.add(id);
    setTimeout(()=>{ try { _inFlight.delete(id); } catch(_) {} }, ADD_DEBOUNCE_MS + 400);

    const bag = loadBag();
    const idx = bag.findIndex(x => String(x.id) === String(id));
    const card = document.querySelector(`.product-card[data-id="${id}"]`);
    const title = card?.dataset?.title || card?.querySelector('.product-title')?.textContent || id;
    const price = Number(card?.dataset?.price) || 0;
    const img = card?.querySelector('img')?.src || '';
    if (idx === -1){
      bag.push({ id, title, price, qty, img });
    } else {
      bag[idx].qty = (Number(bag[idx].qty) || 0) + qty;
    }
    saveBag(bag);

    // mark element+id to suppress duplicate handlers
    try { markElementAdded(card?.querySelector('.cta') || document.querySelector(`.product-card[data-id="${id}"] .cta`), id); } catch(_) {}

    const lang = getLang();
    const toastAdded = (I18N[lang] && I18N[lang].cta && I18N[lang].cta.addedToast) || 'added';
    showToast(`${title} ×${qty} ${toastAdded}`);
    const flo = document.getElementById('floating-cart');
    if (flo) { flo.classList.add('pulse'); setTimeout(()=> flo.classList.remove('pulse'), 420); }
  }

  function changeQtyById(id, delta){
    if (!id) return;
    const bag = loadBag();
    const idx = bag.findIndex(x => String(x.id) === String(id));
    if (idx === -1){
      if (delta > 0){
        const card = document.querySelector(`.product-card[data-id="${id}"]`);
        const title = card?.dataset?.title || id;
        const price = Number(card?.dataset?.price) || 0;
        bag.push({ id, title, price, qty: delta, img: card?.querySelector('img')?.src || '' });
      } else return;
    } else {
      bag[idx].qty = Math.max(0, (Number(bag[idx].qty) || 0) + delta);
      if (bag[idx].qty <= 0) bag.splice(idx,1);
    }
    saveBag(bag);
  }

  function removeById(id){
    if (!id) return;
    const bag = loadBag().filter(x => String(x.id) !== String(id));
    saveBag(bag);
  }

  /* -------------------------
     Product controls (in-place updates)
  -------------------------*/
  function replaceCtaAnchorWithButton(card){
    if (!card) return;
    const cta = card.querySelector('.cta');
    if (!cta) return;
    if (cta.tagName.toLowerCase() === 'button') return;
    const btn = document.createElement('button');
    btn.className = cta.className;
    btn.type = 'button';
    Array.from(cta.attributes || []).forEach(attr => {
      if (attr.name === 'href') return;
      btn.setAttribute(attr.name, attr.value);
    });
    Object.keys(cta.dataset || {}).forEach(k => btn.dataset[k] = cta.dataset[k]);
    if (cta.hasAttribute('aria-label')) btn.setAttribute('aria-label', cta.getAttribute('aria-label'));
    btn.style.fontFamily = 'inherit';
    btn.innerHTML = cta.innerHTML;
    if (cta.hasAttribute('href')){
      let href = cta.getAttribute('href') || '';
      href = href.replace(/([?&])add=[^&]*/g, '').replace(/[?&]$/,'') || 'cart.html';
      btn.dataset.href = href;
    }
    cta.replaceWith(btn);
  }

  function createQtyControls(qty){
    const wrap = document.createElement('div');
    wrap.className = 'qty-controls';
    const minus = document.createElement('button'); minus.className = 'qty-btn'; minus.type='button'; minus.textContent='−';
    const num = document.createElement('span'); num.className = 'qty-number'; num.textContent = qty;
    const plus = document.createElement('button'); plus.className = 'qty-btn'; plus.type='button'; plus.textContent = '+';
    wrap.append(minus, num, plus);
    return wrap;
  }

  function updateProductControl(card){
    if (!card) return;
    replaceCtaAnchorWithButton(card);
    const id = card.dataset.id;
    const bag = loadBag();
    const item = bag.find(x => String(x.id) === String(id));
    const cta = card.querySelector('.cta');
    if (!cta) return;
    cta.innerHTML = '';
    if (item && item.qty > 0){
      const qc = createQtyControls(item.qty);
      cta.appendChild(qc);
    } else {
      const lang = getLang();
      const addText = (I18N[lang] && I18N[lang].cta && I18N[lang].cta.add) || 'Add to Cart';
      cta.textContent = addText;
      cta.setAttribute('data-id', id);
    }
  }

  function renderProductControls(){
    $$('.product-card').forEach(c => { if (!c.classList.contains('placeholder')) updateProductControl(c); });
  }

  /* -------------------------
     Mini-cart build and delegation
  -------------------------*/
  function buildMiniCartHTML(){
    const miniList = document.getElementById('mini-cart-list');
    if (!miniList) return;
    const bag = loadBag();
    if (!bag.length){
      const lang = getLang();
      miniList.innerHTML = `<div class="mini-cart-empty">${(I18N[lang] && I18N[lang].page && I18N[lang].page.bagEmpty) || 'Your bag is empty'}</div>`;
      const miniSubtotal = document.getElementById('mini-cart-sub') || document.getElementById('mini-cart-subtotal');
      if (miniSubtotal) miniSubtotal.textContent = formatPrice(0);
      updateCheckoutButtonState();
      return;
    }

    const frag = document.createDocumentFragment();
    let subtotal = 0;
    bag.forEach(item => {
      const row = document.createElement('div');
      row.className = 'mini-cart-item';
      row.dataset.id = item.id;
      row.innerHTML = `
        <img class="mini-thumb" src="${escapeHtml(item.img||'')}" alt="${escapeHtml(item.title||'')}" />
        <div class="meta">
          <div class="title">${escapeHtml(item.title)}</div>
          <div class="price">${formatPrice(item.price)}</div>
        </div>
        <div class="controls">
          <div class="qty-controls">
            <button class="qty-btn" data-action="dec">−</button>
            <div class="qty-num">${item.qty}</div>
            <button class="qty-btn" data-action="inc">+</button>
          </div>
          <button class="mini-remove" data-action="remove">Remove</button>
        </div>`;
      frag.appendChild(row);
      subtotal += (Number(item.price||0) * Number(item.qty||0));
    });
    miniList.innerHTML = '';
    miniList.appendChild(frag);

    const miniSubtotal = document.getElementById('mini-cart-sub') || document.getElementById('mini-cart-subtotal');
    if (miniSubtotal) miniSubtotal.textContent = formatPrice(subtotal);
    syncSubtotalDisplays();
    updateCheckoutButtonState();
  }

  function renderMiniCart(){ buildMiniCartHTML(); }
  function updateMiniCartUI(){ buildMiniCartHTML(); }

  // delegated mini-list interactions (attach once)
  (function(){
    const miniListEl = document.getElementById('mini-cart-list');
    if (!miniListEl) return;
    miniListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const it = btn.closest('.mini-cart-item');
      if (!it) return;
      const id = it.dataset.id;
      const action = btn.dataset.action;
      if (action === 'inc') changeQtyById(id, +1);
      else if (action === 'dec') changeQtyById(id, -1);
      else if (action === 'remove') removeById(id);
    }, false);
  })();

  /* -------------------------
     Checkout renderer (delegated)
  -------------------------*/
  function renderCheckout(){
    const container = $('#checkout-items');
    const subtotalEl = $('#checkout-subtotal');
    const emptyMsg = $('#checkout-empty');
    if (!container) { updateCheckoutButtonState(); return; }
    const bag = loadBag();
    container.innerHTML = '';
    if (!bag || bag.length === 0){
      if (emptyMsg) emptyMsg.style.display = '';
      if (subtotalEl) subtotalEl.textContent = formatPrice(0);
      syncSubtotalDisplays();
      updateCheckoutButtonState();
      return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    const frag = document.createDocumentFragment();
    let subtotal = 0;
    bag.forEach(item => {
      const id = item.id || 'unknown';
      const title = item.title || id;
      const price = Number(item.price) || 0;
      const qty = Number(item.qty) || 0;
      const img = item.img || '';
      const row = document.createElement('div');
      row.className = 'checkout-row';
      row.dataset.id = id;
      row.innerHTML = `
        <div class="checkout-thumb">${ img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(title)}" width="72" height="72">` : `<div class="thumb-placeholder"></div>` }</div>
        <div class="checkout-meta">
          <div class="checkout-title">${escapeHtml(title)}</div>
          <div class="checkout-unit">${formatPrice(price)} each</div>
        </div>
        <div class="checkout-qty">
          <button class="qty-decrease" data-action="dec">−</button>
          <span class="qty-number">${qty}</span>
          <button class="qty-increase" data-action="inc">+</button>
        </div>
        <div class="checkout-line-price">${formatPrice(price * qty)}</div>
        <div class="checkout-remove"><button class="remove-btn" data-action="remove">Remove</button></div>
      `;
      frag.appendChild(row);
      subtotal += price * qty;
    });
    container.appendChild(frag);
    if (subtotalEl) subtotalEl.textContent = formatPrice(subtotal);
    syncSubtotalDisplays();

    if (!container._delegation){
      container._delegation = true;
      container.addEventListener('click', (e) => {
        const dec = e.target.closest('[data-action="dec"]');
        const inc = e.target.closest('[data-action="inc"]');
        const rem = e.target.closest('[data-action="remove"]');
        if (dec || inc || rem){
          e.preventDefault();
          const row = (dec || inc || rem).closest('.checkout-row');
          if (!row) return;
          const id = row.dataset.id;
          if (dec) changeQtyById(id, -1);
          else if (inc) changeQtyById(id, +1);
          else if (rem) removeById(id);
          renderCheckout();
        }
      }, false);
    }
  }

  /* -------------------------
     Checkout button state
  -------------------------*/
  function updateCheckoutButtonState(){
    const bag = loadBag();
    const isEmpty = !bag || bag.length === 0;
    const checkoutAnchor = document.querySelector('#mini-cart .mini-cart-footer a.btn') || document.querySelector('#mini-cart .actions a.btn') || document.querySelector('#mini-cart .actions .btn');
    if (checkoutAnchor){
      if (isEmpty){
        checkoutAnchor.classList.add('disabled');
        checkoutAnchor.setAttribute('aria-disabled','true');
      } else {
        checkoutAnchor.classList.remove('disabled');
        checkoutAnchor.removeAttribute('aria-disabled');
      }
    }
    $$('.place-order, .checkout-action, button[data-role="checkout"]').forEach(btn => {
      if (isEmpty){
        btn.disabled = true; btn.classList.add('disabled'); btn.setAttribute('aria-disabled','true');
      } else {
        btn.disabled = false; btn.classList.remove('disabled'); btn.removeAttribute('aria-disabled');
      }
    });
  }

  /* -------------------------
     Mini-cart open/close helpers
  -------------------------*/
  let __miniDocClickHandler = null;
  let __miniDocTouchHandler = null;

  function isInteractiveInsideMini(target) {
    return !!target.closest('button, a, input, select, textarea, .qty-controls, .mini-remove, .qty-btn, .cta, .remove-btn');
  }

  function removeDocMiniListeners(){
    if (__miniDocClickHandler) {
      document.removeEventListener('click', __miniDocClickHandler, true);
      __miniDocClickHandler = null;
    }
    if (__miniDocTouchHandler) {
      document.removeEventListener('touchstart', __miniDocTouchHandler, { capture: true });
      __miniDocTouchHandler = null;
    }
  }

  function showMiniCart(open = true){
    const miniCart = document.getElementById('mini-cart') || document.querySelector('.mini-cart');
    const miniOverlay = document.getElementById('mini-cart-overlay') || document.getElementById('mini-overlay');
    const miniList = document.getElementById('mini-cart-list') || document.querySelector('.mini-cart-list');

    if (!miniCart) return;

    if (open) {
      try { renderMiniCart(); } catch(e){}
      miniCart.classList.add('show');
      if (miniOverlay) miniOverlay.classList.add('show');
      miniCart.setAttribute('aria-hidden','false');
      if (miniOverlay) miniOverlay.setAttribute('aria-hidden','false');
      setTimeout(()=> miniList && miniList.focus(), 120);

      removeDocMiniListeners();

      __miniDocClickHandler = function (ev) {
        if (ev.defaultPrevented) return;
        const target = ev.target;
        if (target.closest('.floating-cart') || target.closest('.cart-link') || target.closest('#cart-button') || target.closest('#floating-cart')) {
          return;
        }
        const inside = miniCart.contains(target);
        if (!inside) { showMiniCart(false); return; }
        if (target === miniCart || !isInteractiveInsideMini(target)) { showMiniCart(false); }
      };

      __miniDocTouchHandler = function (ev) {
        const target = ev.target;
        if (target.closest('.floating-cart') || target.closest('.cart-link') || target.closest('#cart-button') || target.closest('#floating-cart')) {
          return;
        }
        const inside = miniCart.contains(target);
        if (!inside) { showMiniCart(false); return; }
        if (target === miniCart || !isInteractiveInsideMini(target)) { showMiniCart(false); }
      };

      document.addEventListener('click', __miniDocClickHandler, true);
      document.addEventListener('touchstart', __miniDocTouchHandler, { passive: true, capture: true });

    } else {
      miniCart.classList.remove('show');
      if (miniOverlay) miniOverlay.classList.remove('show');
      miniCart.setAttribute('aria-hidden','true');
      if (miniOverlay) miniOverlay.setAttribute('aria-hidden','true');
      removeDocMiniListeners();
    }
  }

  /* -------------------------
     Global delegated UI wiring (clicks)
     - For touch devices, clicks on .cta are ignored (pointerup handles them)
     - For non-touch devices, click handles .cta
     - Click still handles qty buttons and other interactions on all devices
  -------------------------*/
  document.addEventListener('click', (e) => {
    const target = e.target;

    // Prevent navigation to cart page if empty (keeps original behaviour)
    const anchor = target.closest('a[href$="cart.html"], a[href$="/cart.html"], a[href$="bag"]');
    if (anchor) {
      const bag = loadBag();
      if (!bag || bag.length === 0){
        e.preventDefault();
        const lang = getLang();
        const msg = (I18N[lang] && I18N[lang].page && I18N[lang].page.bagEmpty) || 'Your bag is empty';
        showToast(msg);
        const miniCart = document.getElementById('mini-cart') || document.querySelector('.mini-cart');
        if (miniCart && !miniCart.classList.contains('show')) showMiniCart(true);
        return;
      }
    }

    // Add to cart clicks on product cards (desktop / non-touch OR fallback)
    const cta = target.closest('.cta');
    if (cta && !target.closest('.qty-controls') && !cta.classList.contains('disabled')) {
      // If touch-capable, pointerup handles this — ignore clicks on touch devices to avoid duplicates
      if (IS_TOUCH) return;

      e.preventDefault();
      // check suppression (in case pointerup already handled the add)
      const suppressTs = cta.dataset && cta.dataset._suppressClick ? Number(cta.dataset._suppressClick) : 0;
      if (suppressTs && (Date.now() - suppressTs) < ADD_DEBOUNCE_MS) {
        try { e.stopImmediatePropagation(); } catch(_) {}
        if (LOG) console.log('[app] click suppressed (pointerup handled)', getCtaIdFromEl(cta));
        return;
      }

      const id = getCtaIdFromEl(cta);
      if (recentlyAddedForElementOrId(cta, id) || _inFlight.has(id)) {
        try { e.stopImmediatePropagation(); } catch(_) {}
        if (LOG) console.log('[app] click skipped (recent/in-flight)', id);
        return;
      }
      if (id) {
        addToCart(id, 1);
        markElementAdded(cta, id);
      }
      try { e.stopImmediatePropagation(); } catch(_) {}
      return;
    }

    // Quantity + other buttons
    const qtyBtn = target.closest('.qty-btn');
    if (qtyBtn) {
      e.preventDefault();
      const card = qtyBtn.closest('.product-card');
      if (card){
        const delta = qtyBtn.textContent.trim() === '+' ? +1 : -1;
        changeQty(card, delta);
        return;
      }
      // other qty handling delegated in their containers (mini/checkout)
    }
  }, { passive: false });

  /* -------------------------
     Pointer touch fast-path (touch devices only)
     - pointerdown captures candidate .cta and pointerup performs add (single source)
     - pointerup sets suppression to ignore the subsequent click event
  -------------------------*/
  const touchMap = new Map(); // pointerId -> {startX, startY, startT, target}
  const MOVE_THRESHOLD = 12; // px
  const TIME_THRESHOLD = 300; // ms

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    // record candidate for potential tap — do not call preventDefault here
    try {
      touchMap.set(e.pointerId, { startX: e.clientX, startY: e.clientY, startT: performance.now(), target: e.target });
    } catch(err){ /* ignore */ }
  }, { passive: true });

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    const state = touchMap.get(e.pointerId);
    if (!state) return;
    const dx = Math.abs(e.clientX - state.startX);
    const dy = Math.abs(e.clientY - state.startY);
    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
      touchMap.delete(e.pointerId);
    }
  }, { passive: true });

  document.addEventListener('pointercancel', (e) => {
    if (e.pointerType !== 'touch') return;
    touchMap.delete(e.pointerId);
  }, { passive: true });

  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    const state = touchMap.get(e.pointerId);
    touchMap.delete(e.pointerId);
    if (!state) return;
    const dt = performance.now() - state.startT;
    if (dt > TIME_THRESHOLD) return;
    const dx = Math.abs(e.clientX - state.startX);
    const dy = Math.abs(e.clientY - state.startY);
    if (dx <= MOVE_THRESHOLD && dy <= MOVE_THRESHOLD) {
      // find nearest .cta
      const el = e.target.closest('.cta') || (state.target && state.target.closest && state.target.closest('.cta'));
      if (el && !el.classList.contains('disabled') && !el.closest('.qty-controls')) {
        // perform add here — single source for touch
        const id = getCtaIdFromEl(el);
        // skip if in-flight or recently added
        if (recentlyAddedForElementOrId(el, id) || _inFlight.has(id)) {
          if (LOG) console.log('[app] pointerup skipped (recent/in-flight)', id);
          return;
        }
        // add
        addToCart(id, 1);
        // mark element to suppress the following click (click may still fire)
        try {
          if (el && el.dataset) {
            el.dataset._suppressClick = String(Date.now());
            setTimeout(()=>{ try { if (el && el.dataset && el.dataset._suppressClick && (Date.now() - Number(el.dataset._suppressClick) > ADD_DEBOUNCE_MS)) delete el.dataset._suppressClick; } catch(_) {} }, ADD_DEBOUNCE_MS + 350);
          }
          markElementAdded(el, id);
        } catch(_) {}
      }
    }
  }, { passive: false });

  /* -------------------------
     Product-level changeQty (updates UI in-place)
  -------------------------*/
  function changeQty(card, delta){
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;
    const bag = loadBag();
    const idx = bag.findIndex(x => String(x.id) === String(id));
    if (idx === -1 && delta > 0){
      bag.push({ id, title: card.dataset.title || card.querySelector('.product-title')?.textContent || id, price: Number(card.dataset.price)||0, qty: delta, img: card.querySelector('img')?.src || '' });
    } else if (idx === -1){
      return;
    } else {
      bag[idx].qty = Math.max(0, (Number(bag[idx].qty) || 0) + delta);
      if (bag[idx].qty <= 0) bag.splice(idx,1);
    }
    saveBag(bag);
    // update only the affected product control (avoid full re-render)
    const updatedItem = bag.find(x => String(x.id) === String(id));
    const cta = card.querySelector('.cta');
    if (!cta) return;
    if (updatedItem && updatedItem.qty > 0){
      let num = cta.querySelector('.qty-number');
      if (!num){
        const qc = createQtyControls(updatedItem.qty);
        cta.innerHTML = ''; cta.appendChild(qc);
      } else {
        num.textContent = updatedItem.qty;
      }
    } else {
      const lang = getLang();
      const addText = (I18N[lang] && I18N[lang].cta && I18N[lang].cta.add) || 'Add to Cart';
      cta.textContent = addText;
      cta.setAttribute('data-id', id);
    }
  }

  /* -------------------------
     Slides, reveal, reviews (kept)
  -------------------------*/
  function initSlides(){
    const slides = $$('.slide');
    const dotsContainer = $('.dots');
    if (!slides.length || !dotsContainer) return;
    let slideIndex = 0, slideTimer = null, SLIDE_INTERVAL = 4500;
    slides.forEach((s,i)=> {
      const b = document.createElement('button'); b.className='dot'; b.setAttribute('aria-label', `Slide ${i+1}`);
      b.addEventListener('click', ()=>{ goTo(i); restart(); });
      dotsContainer.appendChild(b);
    });
    const dots = $$('.dot');
    function showSlide(i){ slides.forEach(s=>s.classList.remove('show')); dots.forEach(d=>d.classList.remove('active')); slides[i].classList.add('show'); dots[i] && dots[i].classList.add('active'); }
    function nextSlide(){ slideIndex = (slideIndex + 1) % slides.length; showSlide(slideIndex); }
    function goTo(i){ slideIndex = ((i % slides.length) + slides.length) % slides.length; showSlide(slideIndex); }
    function start(){ stop(); slideTimer = setInterval(nextSlide, SLIDE_INTERVAL); }
    function stop(){ if (slideTimer) clearInterval(slideTimer); slideTimer = null; }
    function restart(){ stop(); start(); }
    showSlide(slideIndex); start();
    const hero = $('.hero');
    let touchX = 0;
    hero && hero.addEventListener('touchstart', e => touchX = e.changedTouches[0].clientX, { passive: true });
    hero && hero.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40){ if (dx < 0) nextSlide(); else goTo(slideIndex - 1); restart(); }
    }, { passive: true });
  }

  function initReveal(){
    const revealEls = $$('.reveal');
    if ('IntersectionObserver' in window){
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => { if (en.isIntersecting){ en.target.classList.add('in-view'); obs.unobserve(en.target); } });
      }, { threshold: 0.12 });
      revealEls.forEach(el => io.observe(el));
    } else {
      revealEls.forEach(el => el.classList.add('in-view'));
    }
  }

  function initReviewsAuto(){
    const container = document.querySelector('.reviews-viewport');
    const track = document.querySelector('.reviews-track');
    if (!container || !track) return;
    if (track.dataset.duplicated !== 'true'){
      Array.from(track.children).forEach(n => track.appendChild(n.cloneNode(true)));
      track.dataset.duplicated = 'true';
    }
    let originalWidth = 0;
    function measure(){ originalWidth = track.scrollWidth / 2 || 0; }
    measure();
    let pos = 0, last = performance.now();
    const SPEED = 60; let rafId = null; let running = true;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) running = false;
    function step(now){
      const dt = (now - last) / 1000; last = now;
      if (running && originalWidth > 0){
        pos += SPEED * dt;
        if (pos >= originalWidth) pos -= originalWidth;
        track.style.transform = `translateX(${-pos}px)`;
      }
      rafId = requestAnimationFrame(step);
    }
    function start(){ if (!rafId){ last = performance.now(); rafId = requestAnimationFrame(step); } running = true; }
    function stop(){ running = false; }
    start();
    let active=false, sx=0, sy=0, decided=false, horiz=false;
    container.addEventListener('pointerdown', (e)=>{ active=true; sx=e.clientX; sy=e.clientY; decided=false; stop(); }, {passive:true});
    container.addEventListener('pointermove', (e)=>{ if (!active) return; const dx=Math.abs(e.clientX-sx), dy=Math.abs(e.clientY-sy); if(!decided && (dx>6||dy>6)){ decided=true; horiz = dx>dy; } }, {passive:true});
    container.addEventListener('pointerup', ()=>{ active=false; decided=false; horiz=false; if (!reduce) start(); }, {passive:true});
    window.addEventListener('resize', () => setTimeout(()=>{ measure(); pos = ((pos % originalWidth) + originalWidth) % originalWidth; },120));
    window.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (!reduce) start(); });
  }

  /* -------------------------
     Nav toggle + init
  -------------------------*/
  function initNavToggle(){
    const navToggle = $('.nav-toggle');
    const siteNav = $('#site-nav');
    if (!navToggle || !siteNav) return;
    navToggle.addEventListener('click', () => {
      const open = siteNav.classList.toggle('show');
      navToggle.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      siteNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    });
  }

  function initCartButtons(){
    const floatingCart = $('#floating-cart') || document.querySelector('.floating-cart');
    const cartBtn = $('#cart-button') || $('#cart-btn') || document.querySelector('.cart-link');
    const navCartBtn = $('#nav-cart-btn');
    const miniClose = document.getElementById('mini-cart-close');
    const miniOverlay = document.getElementById('mini-cart-overlay') || document.getElementById('mini-overlay');

    function toggleMiniFromToggleClick(e){
      e.preventDefault();
      const miniCart = document.getElementById('mini-cart') || document.querySelector('.mini-cart');
      const isOpen = miniCart && miniCart.classList.contains('show');
      showMiniCart(!isOpen);
    }

    if (floatingCart) floatingCart.addEventListener('click', toggleMiniFromToggleClick);
    if (cartBtn) cartBtn.addEventListener('click', toggleMiniFromToggleClick);
    if (navCartBtn) navCartBtn.addEventListener('click', toggleMiniFromToggleClick);
    if (miniClose) miniClose.addEventListener('click', () => showMiniCart(false));
    if (miniOverlay) miniOverlay.addEventListener('click', () => showMiniCart(false));
  }

  /* -------------------------
     storage sync (other tabs)
  -------------------------*/
  window.addEventListener('storage', (e) => {
    if (e.key === BAG_KEY || e.key === UPDATE_KEY) {
      try { renderBadges(); } catch(e){}
      try { renderMiniCart(); } catch(e){}
      try { renderProductControls(); } catch(e){}
      try { renderCheckout(); } catch(e){}
      try { syncSubtotalDisplays(); } catch(e){}
      try { updateCheckoutButtonState(); } catch(e){}
    }
  });

  /* -------------------------
     Small utilities
  -------------------------*/
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ensure mini-cart hidden on load
  (function ensureMiniCartHiddenOnLoad(){
    const guard = () => {
      const miniCart = document.getElementById('mini-cart') || document.querySelector('.mini-cart');
      const miniOverlay = document.getElementById('mini-cart-overlay') || document.getElementById('mini-overlay') || document.querySelector('.mini-overlay');
      if (miniCart) {
        if (!miniCart.classList.contains('show') && miniCart.getAttribute('aria-hidden') !== 'false') {
          miniCart.classList.remove('show');
          miniCart.setAttribute('aria-hidden', 'true');
        }
      }
      if (miniOverlay) {
        if (!miniOverlay.classList.contains('show') && miniOverlay.getAttribute('aria-hidden') !== 'false') {
          miniOverlay.classList.remove('show');
          miniOverlay.setAttribute('aria-hidden', 'true');
        }
      }
    };
    guard();
    setTimeout(guard, 250);
  })();

  /* -------------------------
     initial boot
  -------------------------*/
  document.addEventListener('DOMContentLoaded', () => {
    initNavToggle();
    const lang = getLang();
    const langSel = $('#lang-switcher');
    if (langSel){
      langSel.value = lang;
      langSel.addEventListener('change', (e) => { setLang(e.target.value); });
    }
    translatePage(lang);
    renderBadges();
    renderMiniCart();
    renderProductControls();
    renderCheckout();
    initCartButtons();
    initSlides();
    initReveal();
    initReviewsAuto();
    updateCheckoutButtonState();
  });

  // expose debug API
  window.app = {
    loadBag, saveBag, renderMiniCart, renderBadges, renderCheckout, addToCart, changeQtyById, changeQty, removeById, showMiniCart, setLang
  };

})();
