// checkout.js - no SKU display; strip trailing " A" from titles
(function () {
  'use strict';

  const BAG_KEY = 'bag';
  const UPDATE_KEY = '__bag_updated_at';
  const FLAT_SHIPPING = 2.50;
  const FREE_SHIPPING_OVER = 60.00;

  const $ = s => document.querySelector(s);

  const fmt = n => '$' + (Number(n || 0)).toFixed(2);
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // remove trailing " A" or " a" from titles (case-insensitive)
  function tidyTitle(t) {
    if (!t) return '';
    return String(t).replace(/\s+\bA\b$/i, '').trim();
  }

  function safeParseBag(){
    try {
      const raw = localStorage.getItem(BAG_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { localStorage.removeItem(BAG_KEY); return []; }
      return parsed.map(i => ({
        id: i?.id ?? '',
        title: tidyTitle(i?.title ?? ''),
        price: Number(i?.price) || 0,
        qty: Math.max(0, Math.floor(Number(i?.qty) || 0)),
        img: i?.img ?? ''
      })).filter(x => x.title && x.qty > 0);
    } catch (e) {
      console.error('bad bag', e);
      localStorage.removeItem(BAG_KEY);
      return [];
    }
  }

  function saveBag(bag){
    try { localStorage.setItem(BAG_KEY, JSON.stringify(bag || [])); } catch(e){}
    try { localStorage.setItem(UPDATE_KEY, Date.now().toString()); } catch(e){}
    window.dispatchEvent(new Event('bag:updated'));
  }

  function renderCheckout(){
    const container = $('#checkout-items');
    const emptyEl = $('#checkout-empty');
    if (!container) return;

    const bag = safeParseBag();
    container.innerHTML = '';

    if (!bag || bag.length === 0){
      if (emptyEl) emptyEl.style.display = '';
      updateSummary(0);
      syncHidden([]);
      togglePlaceButton();
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    // header: two columns (thumbnail | details)
    const header = document.createElement('div');
    header.className = 'checkout-header';
    header.innerHTML = `
      <div class="checkout-thumb"><span class="thumb-label">Product</span></div>
      <div class="checkout-details"><span class="checkout-unit">Price</span><span class="checkout-qty">Quantity</span><span class="checkout-line-price">Total</span></div>
    `;
    container.appendChild(header);

    let subtotal = 0;

    bag.forEach(item => {
      const row = document.createElement('div');
      row.className = 'checkout-row';

      // thumbnail + caption
      const thumb = document.createElement('div');
      thumb.className = 'checkout-thumb';

      if (item.img) {
        const im = document.createElement('img');
        im.src = item.img;
        im.alt = item.title || '';
        thumb.appendChild(im);
      } else {
        const ph = document.createElement('div');
        ph.className = 'thumb-placeholder';
        ph.style.width = '96px';
        ph.style.height = '96px';
        ph.style.background = '#f3f3f4';
        ph.style.borderRadius = '10px';
        thumb.appendChild(ph);
      }

      // caption under image (title without trailing "A")
      const caption = document.createElement('div');
      caption.className = 'thumb-caption';
      caption.textContent = item.title || '';
      thumb.appendChild(caption);

      // details (price, qty, total)
      const details = document.createElement('div');
      details.className = 'checkout-details';

      const unit = document.createElement('div');
      unit.className = 'checkout-unit';
      unit.textContent = fmt(item.price);

      const qty = document.createElement('div');
      qty.className = 'checkout-qty';
      qty.innerHTML = `<div class="qty-number" aria-label="Quantity">${item.qty}</div>`;

      const line = document.createElement('div');
      line.className = 'checkout-line-price';
      const lineTotal = item.price * item.qty;
      line.textContent = fmt(lineTotal);

      details.appendChild(unit);
      details.appendChild(qty);
      details.appendChild(line);

      row.appendChild(thumb);
      // no meta/sku column anymore
      row.appendChild(details);

      container.appendChild(row);
      subtotal += lineTotal;
    });

    updateSummary(subtotal);
    syncHidden(bag);
    togglePlaceButton();
  }

  function updateSummary(subtotal){
    const shipping = (subtotal >= FREE_SHIPPING_OVER || subtotal === 0) ? 0 : FLAT_SHIPPING;
    const total = subtotal + shipping;
    $('#subtotal').textContent = fmt(subtotal);
    $('#shipping').textContent = fmt(shipping);
    $('#total').textContent = fmt(total);

    const form = $('#checkout-form');
    if (!form) return;
    setHidden(form, 'subtotal', subtotal.toFixed(2));
    setHidden(form, 'shipping', shipping.toFixed(2));
    setHidden(form, 'total', total.toFixed(2));
  }

  function setHidden(form, name, value){
    let el = form.querySelector(`input[name="${name}"]`);
    if (!el){ el = document.createElement('input'); el.type = 'hidden'; el.name = name; form.appendChild(el); }
    el.value = String(value);
  }

  function syncHidden(bag){
    const form = $('#checkout-form');
    if (!form) return;
    ['item_id[]','item_qty[]','item_price[]'].forEach(n => form.querySelectorAll(`input[name="${n}"]`).forEach(e => e.remove()));
    (bag || []).forEach(it => {
      const idI = document.createElement('input'); idI.type='hidden'; idI.name='item_id[]'; idI.value=String(it.id ?? ''); form.appendChild(idI);
      const qI = document.createElement('input'); qI.type='hidden'; qI.name='item_qty[]'; qI.value=String(Number(it.qty||0)); form.appendChild(qI);
      const pI = document.createElement('input'); pI.type='hidden'; pI.name='item_price[]'; pI.value=(Number(it.price||0)).toFixed(2); form.appendChild(pI);
    });
  }

  function togglePlaceButton(){
    const btn = $('#place-order');
    if (!btn) return;
    const bag = safeParseBag();
    const empty = !bag || bag.length === 0;
    btn.disabled = empty;
  }

  function initPlaceOrder(){
    const btn = $('#place-order');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const bag = safeParseBag();
      if (!bag || bag.length === 0){ alert('Your cart is empty'); return; }
      const form = $('#checkout-form');
      const name = form.querySelector('#name'); const phone = form.querySelector('#phone'); const address = form.querySelector('#address');
      if (!name.value.trim() || !phone.value.trim() || !address.value.trim()){ alert('Please fill Name, Phone and Address'); return; }
      const order = {
        buyer: { name: name.value.trim(), phone: phone.value.trim(), address: address.value.trim() },
        bag: bag,
        subtotal: Number(form.querySelector('input[name="subtotal"]')?.value || 0),
        shipping: Number(form.querySelector('input[name="shipping"]')?.value || 0),
        total: Number(form.querySelector('input[name="total"]')?.value || 0),
        createdAt: new Date().toISOString()
      };
      showConfirmation(order);
    });
  }

  function showConfirmation(order){
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { position:'fixed', left:'50%', top:'18%', transform:'translateX(-50%)', zIndex:99999, background:'#fff', padding:'18px', borderRadius:'12px', boxShadow:'0 12px 40px rgba(2,6,23,0.18)', width:'92%', maxWidth:'520px' });
    wrap.innerHTML = `<h3 style="margin:0 0 8px">Order placed</h3>
      <p style="margin:0 0 12px">Thanks <strong>${esc(order.buyer.name)}</strong>. Total ${fmt(order.total)} (demo).</p>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button id="c-close" style="padding:8px 12px;border-radius:8px;border:0;background:#eee;cursor:pointer">Close</button><button id="c-home" style="padding:8px 12px;border-radius:8px;border:0;background:linear-gradient(90deg,#ff7a59,#ffb07a);color:#fff;cursor:pointer">Continue</button></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('#c-close').addEventListener('click', ()=>wrap.remove());
    wrap.querySelector('#c-home').addEventListener('click', ()=>{
      localStorage.removeItem(BAG_KEY);
      try{ localStorage.setItem(UPDATE_KEY, Date.now().toString()); } catch(e){}
      location.href = 'index.html';
    });

    // clear bag (demo)
    localStorage.removeItem(BAG_KEY);
    try{ localStorage.setItem(UPDATE_KEY, Date.now().toString()); } catch(e){}
    window.dispatchEvent(new Event('bag:updated'));
    renderCheckout();
  }

  function initMobileNav(){
function initMobileNav(){
  // Matches your HTML: button id="navToggle" and ul id="site-nav"
  const toggle = document.getElementById('navToggle') || document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav') || document.querySelector('.nav-links');

  if (!toggle || !nav) return;

  // Toggle both .open and .show to be robust with either CSS class usage
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    nav.classList.toggle('show', open);
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(Boolean(open)));
    nav.setAttribute('aria-hidden', String(!open));
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!nav.classList.contains('open') && !nav.classList.contains('show'));
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('open') && !nav.classList.contains('show')) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}

    document.addEventListener('click', (e) => {
      if (!nav.classList.contains('open')) return;
      if (nav.contains(e.target) || toggle.contains(e.target)) return;
      nav.classList.remove('open'); toggle.setAttribute('aria-expanded','false');
    });
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key === BAG_KEY || ev.key === UPDATE_KEY) renderCheckout();
  });
  window.addEventListener('bag:updated', renderCheckout);

  document.addEventListener('DOMContentLoaded', () => {
    renderCheckout();
    initPlaceOrder();
    initMobileNav();
    togglePlaceButton();
  });

  // expose for debugging
  window.checkout_render = renderCheckout;
  window.checkout_loadBag = safeParseBag;

})();
