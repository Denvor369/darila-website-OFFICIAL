// cart.js - shared helper for bag + checkout
(function(window){
  const KEY = 'bag';

  function loadBag(){
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch(e){ return []; }
  }
  function saveBag(bag){
    localStorage.setItem(KEY, JSON.stringify(bag));
    updateCartQuantityUI();
  }
  function addToBagById(id, title = id, price = 0, qty = 1, img = ''){
    if (!id) return;
    const bag = loadBag();
    const i = bag.find(x => x.id === id);
    if (!i) bag.push({ id, title, price: Number(price||0), qty: qty, img: img });
    else i.qty = (i.qty || 0) + qty;
    saveBag(bag);
  }
  function setQty(id, qty){
    const bag = loadBag();
    const i = bag.find(x => x.id === id);
    if (!i) return;
    i.qty = Math.max(0, qty|0);
    if (i.qty <= 0) {
      const filtered = bag.filter(x => x.id !== id);
      saveBag(filtered);
    } else saveBag(bag);
  }
  function removeFromBag(id){
    const bag = loadBag().filter(x => x.id !== id);
    saveBag(bag);
  }
  function clearBag(){ localStorage.removeItem(KEY); updateCartQuantityUI(); }

  function updateCartQuantityUI(){
    const el = document.getElementById('cart-quantity');
    if (!el) return;
    const bag = loadBag();
    const total = bag.reduce((s,i)=> s + (i.qty||0), 0);
    el.textContent = total;
  }

  function formatMoney(n){ return '$' + Number(n||0).toFixed(2); }

  // expose
  window.cart = {
    loadBag, saveBag, addToBagById, setQty, removeFromBag, clearBag,
    updateCartQuantityUI, formatMoney
  };

  // auto update UI badge if present
  document.addEventListener('DOMContentLoaded', updateCartQuantityUI);
})(window);
  (function(){
      const orderItemsEl = document.getElementById('order-items');

      function formatMoney(n){ return cart.formatMoney(n); }

      function renderOrder(){
        const bag = cart.loadBag();
        if (!bag || bag.length === 0) {
          orderItemsEl.innerHTML = '<p style="color:#666">Your cart is empty. <a href="index.html">Shop now</a></p>';
          updateSummary();
          return;
        }
        orderItemsEl.innerHTML = bag.map(it => {
          return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed rgba(0,0,0,0.04)">
            <div style="display:flex;gap:10px;align-items:center">
              <img src="${it.img || 'images/'+it.id+'.jpg'}" alt="${it.title||it.id}" style="width:56px;height:56px;object-fit:cover;border-radius:8px">
              <div>
                <div style="font-weight:700">${it.title||it.id}</div>
                <div style="color:#888;font-size:0.9rem">${it.qty} × ${formatMoney(it.price)}</div>
              </div>
            </div>
            <div style="font-weight:700">${formatMoney(it.price * it.qty)}</div>
          </div>`;
        }).join('');
        updateSummary();
      }

      function updateSummary(){
        const bag = cart.loadBag();
        const subtotal = bag.reduce((s,i) => s + (Number(i.price||0) * (i.qty||0)), 0);
        const shipping = subtotal > 0 ? 2.50 : 0;
        const total = subtotal + shipping;
        document.getElementById('subtotal').textContent = formatMoney(subtotal);
        document.getElementById('shipping').textContent = formatMoney(shipping);
        document.getElementById('total').textContent = formatMoney(total);
      }

      document.getElementById('place-order').addEventListener('click', () => {
        const bag = cart.loadBag();
        if (!bag.length) { alert('Your cart is empty'); return; }
        const name = document.getElementById('name').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const address = document.getElementById('address').value.trim();
        if (!name || !phone || !address) { alert('Please fill required fields'); return; }

        // Simulate order: show quick confirmation, clear cart
        const subtotal = bag.reduce((s,i)=> s + (Number(i.price||0) * (i.qty||0)), 0);
        const shipping = subtotal > 0 ? 2.50 : 0;
        const total = subtotal + shipping;
        if (!confirm(`Confirm order for ${name}\nTotal: ${formatMoney(total)}\nPlace order now?`)) return;

        // Clear cart and redirect to thank-you or back to shop
        cart.clearBag && cart.clearBag();
        cart.saveBag ? cart.saveBag([]) : localStorage.removeItem('bag');
        alert('Order placed — thank you!');
        location.href = 'index.html';
      });

      document.addEventListener('DOMContentLoaded', () => {
        cart.updateCartQuantityUI && cart.updateCartQuantityUI();
        renderOrder();
      });
    })();
    document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  const cartQty = document.getElementById('cart-quantity');

  if (!toggle || !nav) return;

  // unified setter
  function setOpen(isOpen) {
    toggle.classList.toggle('open', isOpen);
    nav.classList.toggle('open', isOpen);
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    nav.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.body.classList.toggle('nav-open', isOpen);
  }

  // click to toggle
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!nav.classList.contains('open'));
  });

  // close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      setOpen(false);
      toggle.focus();
    }
  });

  // close on outside click (mobile)
  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('open')) return;
    if (toggle.contains(e.target) || nav.contains(e.target)) return;
    setOpen(false);
  });

  // close when a nav link is clicked on mobile (hash anchors)
  nav.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      if (window.innerWidth <= 440) setOpen(false);
    });
  });

  // optional: expose cart update function
  window.updateCartQty = (qty) => {
    if (cartQty) cartQty.textContent = qty;
  };
});

