/* script.js - cleaned and focused
   - set --vh for mobile layout stability
   - accessible nav toggle
   - lightweight translations
   - slides with dots, autoplay and swipe
   - reveal on scroll (IntersectionObserver)
   - simple bag stored in localStorage with badge + toast + qty controls
*/

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function setVh(){ document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`); }
setVh(); window.addEventListener('resize', setVh);

document.addEventListener('DOMContentLoaded', () => {
  /* NAV toggle */
  const navToggle = $('.nav-toggle');
  const siteNav = $('#site-nav');
  navToggle && navToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('show');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    siteNav.setAttribute('aria-hidden', open ? 'false' : 'true');
  });

  /* TRANSLATIONS */
  const translations = {
    en: { home:'Home', products:'Products', contact:'Contact', add:'Add to bag', buy:'Buy & View' },
    kh: { home:'ទំព័រដើម', products:'ផលិតផល', contact:'ទំនាក់ទំនង', add:'បន្ថែមទៅកាបូប', buy:'ទិញ & មើល' }
  };
  let lang = localStorage.getItem('siteLang') || 'en';
  const langSel = $('#lang-switcher');
  function applyLang(l){
    $$('.nav-links a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.includes('#home')) a.textContent = translations[l].home;
      if (href.includes('#products')) a.textContent = translations[l].products;
      if (href.includes('#contact')) a.textContent = translations[l].contact;
    });
    $$('.product-card').forEach(card => {
      const id = card.dataset.id;
      if (id === 'sun1' && card.querySelector('.cta')) card.querySelector('.cta').textContent = translations[l].add;
      if (id === 'fiber1' && card.querySelector('.cta')) card.querySelector('.cta').textContent = translations[l].buy;
    });
  }
  if (langSel) {
    langSel.value = lang;
    langSel.addEventListener('change', (e) => { lang = e.target.value; localStorage.setItem('siteLang', lang); applyLang(lang); });
  }
  applyLang(lang);

  /* darila fover slides */
  const slides = $$('.slide');
  const dotsContainer = $('.dots');
  let slideIndex = 0, slideTimer = null, SLIDE_INTERVAL = 4500;
  if (slides.length && dotsContainer){
    slides.forEach((s,i) => {
      const b = document.createElement('button');
      b.className = 'dot'; b.setAttribute('aria-label', `Slide ${i+1}`);
      b.addEventListener('click', () => { goTo(i); restart(); });
      dotsContainer.appendChild(b);
    });
    const dots = $$('.dot');
    function showSlide(i){ slides.forEach(s=>s.classList.remove('show')); dots.forEach(d=>d.classList.remove('active')); slides[i].classList.add('show'); dots[i].classList.add('active'); }
    function nextSlide(){ slideIndex = (slideIndex + 1) % slides.length; showSlide(slideIndex); }
    function goTo(i){ slideIndex = ((i % slides.length) + slides.length) % slides.length; showSlide(slideIndex); }
    function start(){ stop(); slideTimer = setInterval(nextSlide, SLIDE_INTERVAL); }
    function stop(){ if (slideTimer) clearInterval(slideTimer); slideTimer = null; }
    function restart(){ stop(); start(); }
    showSlide(slideIndex); start();

    const hero = $('.hero');
    let touchX = 0;
    hero && hero.addEventListener('touchstart', e => touchX = e.changedTouches[0].clientX);
    hero && hero.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40){ if (dx < 0) nextSlide(); else goTo(slideIndex - 1); restart(); }
    });
  }

  /* REVEAL ON SCROLL */
  const revealEls = $$('.reveal');
  if ('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => { if (en.isIntersecting){ en.target.classList.add('in-view'); obs.unobserve(en.target); } });
    }, { threshold: 0.12 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }

  /* BAG (localStorage) */
  function loadBag(){ try { return JSON.parse(localStorage.getItem('bag') || '[]'); } catch(e){ return []; } }
  function saveBag(b){ localStorage.setItem('bag', JSON.stringify(b)); updateCartBadge(); }
  function updateCartBadge(){ const el = $('#cart-quantity'); if (!el) return; const total = loadBag().reduce((s,i)=> s + (i.qty || 0), 0); el.textContent = total; }

  function addToBag(id, qty = 1){
    if (!id) return;
    const bag = loadBag();
    const idx = bag.findIndex(x => x.id === id);
    if (idx === -1){
      const card = document.querySelector(`.product-card[data-id="${id}"]`);
      const title = card?.dataset?.title || card?.querySelector('.product-title')?.textContent || id;
      const price = Number(card?.dataset?.price) || 0;
      const img = card?.querySelector('img')?.src || '';
      bag.push({ id, title, price, qty, img });
    } else {
      bag[idx].qty = (bag[idx].qty || 0) + qty;
    }
    saveBag(bag);
    showToast(`${bag.find(x=>x.id===id)?.title || id} x${qty} added`);
    renderProductControls();
  }

  function showToast(message, duration=3500){
    const existing = document.querySelector('.add-toast'); if (existing) existing.remove();
    const t = document.createElement('div'); t.className = 'add-toast'; t.textContent = message;
    document.body.appendChild(t);
    setTimeout(()=> t.remove(), duration);
  }

  // Replace anchor CTA with button but remove any ?add= param from href -> data-href
  function replaceCtaAnchorWithButton(card) {
    if (!card) return;
    const cta = card.querySelector('.cta');
    if (!cta) return;
    if (cta.tagName.toLowerCase() === 'button') return; // already button

    const btn = document.createElement('button');
    btn.className = cta.className;
    btn.type = 'button';
    Object.keys(cta.dataset).forEach(k => btn.dataset[k] = cta.dataset[k]);

    if (cta.hasAttribute('href')) {
      let href = cta.getAttribute('href') || '';
      // remove any add= param (either ?add= or &add=)
      href = href.replace(/([?&])add=[^&]*/g, '');
      // clean trailing ? or &
      href = href.replace(/[?&]$/, '') || 'bag.html';
      btn.dataset.href = href;
    }
    btn.innerHTML = cta.innerHTML;
    cta.replaceWith(btn);
  }

  $$('.product-card').forEach(card => replaceCtaAnchorWithButton(card));

  function updateProductControl(card){
    if (!card) return;
    replaceCtaAnchorWithButton(card);

    const id = card.dataset.id;
    const bag = loadBag();
    const item = bag.find(x => x.id === id);
    const cta = card.querySelector('.cta');
    if (!cta) return;
    cta.innerHTML = '';
    if (cta._navHandler) {
      cta.removeEventListener('click', cta._navHandler);
      delete cta._navHandler;
    }

    if (item && item.qty > 0){
      const minus = document.createElement('button');
      minus.className = 'qty-btn';
      minus.type = 'button';
      minus.setAttribute('aria-label', 'Decrease quantity');
      minus.textContent = '−';

      const num = document.createElement('span');
      num.className = 'qty-number';
      num.textContent = item.qty;

      const plus = document.createElement('button');
      plus.className = 'qty-btn';
      plus.type = 'button';
      plus.setAttribute('aria-label', 'Increase quantity');
      plus.textContent = '+';

      const wrap = document.createElement('div');
      wrap.className = 'qty-controls';
      wrap.append(minus, num, plus);

      cta.appendChild(wrap);

      minus.addEventListener('click', (e) => { e.stopPropagation(); changeQty(card, -1); });
      plus.addEventListener('click', (e) => { e.stopPropagation(); changeQty(card, +1); });

      const handler = function(e){
        if (e.target.closest('.qty-controls')) return;
        e.stopPropagation();
        const href = cta.dataset.href || 'bag.html';
        setTimeout(()=> { location.href = href; }, 100);
      };
      cta.addEventListener('click', handler);
      cta._navHandler = handler;

    } else {
      cta.textContent = (lang === 'kh') ? translations.kh.add : translations.en.add;
    }
  }

  function renderProductControls(){ $$('.product-card').forEach(c => { if (!c.classList.contains('placeholder')) updateProductControl(c); }); }

  function changeQty(card, delta){
    if (!card) return;
    const id = card.dataset.id;
    const bag = loadBag();
    const idx = bag.findIndex(x => x.id === id);
    if (idx === -1 && delta > 0){
      bag.push({ id, title: card.dataset.title || card.querySelector('.product-title')?.textContent || id, price: Number(card.dataset.price)||0, qty: delta });
    } else if (idx === -1){
      return;
    } else {
      bag[idx].qty = (bag[idx].qty || 0) + delta;
      if (bag[idx].qty <= 0) bag.splice(idx,1);
    }
    saveBag(bag);
    updateProductControl(card);
  }

  // unified click handler for CTA buttons
  document.addEventListener('click', (e) => {
    const cta = e.target.closest('.product-card .cta');
    if (!cta) return;

    e.preventDefault();

    const id = cta.dataset.id || cta.closest('.product-card')?.dataset.id;
    const isAddAndGo = cta.classList.contains('add-and-go');

    // add to bag first
    addToBag(id, 1);

    if (isAddAndGo) {
      const href = cta.dataset.href || 'bag.html';
      setTimeout(() => { location.href = href; }, 100);
    }
  });

  // init
  updateCartBadge();
  renderProductControls();

  // sync across tabs
  window.addEventListener('storage', (e) => { if (e.key === 'bag') { updateCartBadge(); renderProductControls(); } });
});

