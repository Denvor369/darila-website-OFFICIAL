// bag.js — renders bag table and delegates events to tbody (idempotent & preserves static rows)
(function () {
  const tbody = document.getElementById('bag-items');
  const checkoutBtn = document.getElementById('checkout-link');
  const CART = window.cart; // optional external cart API
  const PLACEHOLDER_IMG = 'images/placeholder.png';

  if (!tbody) return;

  function formatMoney(n){ return `$${Number(n || 0).toFixed(2)}`; }

  // unified bag accessor
  function getBag() {
    if (CART && typeof CART.loadBag === 'function') {
      try { return CART.loadBag() || []; } catch(e){ /* fallthrough */ }
    }
    try { return JSON.parse(localStorage.getItem('bag') || '[]'); } catch(e){ return []; }
  }

  // unified saver
  function saveBag(items){
    if (CART && typeof CART.saveBag === 'function') {
      try { CART.saveBag(items); return; } catch(e){ /* fallthrough */ }
    }
    try { localStorage.setItem('bag', JSON.stringify(items||[])); } catch(e){}
  }

  function updateCartQuantity(q){
    const el = document.getElementById('cart-quantity');
    if (el) el.textContent = q;
  }

  function createGeneratedRow(item) {
    const img = item.img || PLACEHOLDER_IMG;
    const subtotal = (Number(item.price||0) * Number(item.qty||0)).toFixed(2);
    return `<tr class="bag-row" data-id="${escapeHtml(item.id)}" data-generated="true">
      <td>
        <div class="product-info">
          <img class="product-thumb" src="${escapeHtml(img)}" alt="${escapeHtml(item.title||item.id)}">
          <div>
            <div class="product-title">${escapeHtml(item.title||item.id)}</div>
            <div class="product-sku">Quanity: ${escapeHtml(item.id)}</div>
          </div>
        </div>
      </td>
      <td class="cell-price" style="color:var(--accent-2,#ff7a59);font-weight:700">${formatMoney(item.price)}</td>
      <td>
        <div class="qty-control">
          <button class="qty-btn" data-action="decrease" aria-label="decrease">−</button>
          <input class="qty-input" type="number" min="1" value="${Number(item.qty||1)}" />
          <button class="qty-btn" data-action="increase" aria-label="increase">+</button>
        </div>
      </td>
      <td class="cell-subtotal" style="color:var(--accent-2,#ff7a59);font-weight:700">${formatMoney(subtotal)}</td>
      <td><button class="remove-btn" data-action="remove">Remove</button></td>
    </tr>`;
  }

  function updateRowValues(row, item) {
    const qtyInput = row.querySelector('.qty-input');
    const priceCell = row.querySelector('.cell-price');
    const subtotalCell = row.querySelector('.cell-subtotal');
    if (qtyInput) qtyInput.value = Number(item.qty || 1);
    if (priceCell) priceCell.textContent = formatMoney(item.price);
    if (subtotalCell) subtotalCell.textContent = formatMoney(Number(item.price || 0) * Number(item.qty || 0));
  }

  function render(){
    const bag = getBag();

    if (!bag || !bag.length) {
      tbody.querySelectorAll('.bag-row[data-generated="true"]').forEach(r => r.remove());
      tbody.querySelectorAll('.bag-row:not([data-generated])').forEach(r => r.remove());
      tbody.innerHTML = '<tr class="bag-row"><td colspan="5" style="padding:20px;text-align:center;color:#666">Your bag is empty.</td></tr>';
      updateCartQuantity(0);
      return;
    }

    const cartIds = bag.map(i => String(i.id));

    // update static rows (non-generated)
    tbody.querySelectorAll('.bag-row:not([data-generated])').forEach(row => {
      const rid = row.dataset.id;
      const item = bag.find(i => String(i.id) === String(rid));
      if (item) updateRowValues(row, item);
      else row.remove();
    });

    // update existing generated rows and track represented ids
    tbody.querySelectorAll('.bag-row[data-generated="true"]').forEach(row => {
      const rid = String(row.dataset.id);
      const item = bag.find(i => String(i.id) === rid);
      if (item) updateRowValues(row, item);
      else row.remove();
    });

    // append generated rows for items not present in DOM (static or generated)
    bag.forEach(item => {
      const id = String(item.id);
      const existsStatic = !!tbody.querySelector(`.bag-row:not([data-generated])[data-id="${CSS.escape(id)}"]`);
      const existsGenerated = !!tbody.querySelector(`.bag-row[data-generated="true"][data-id="${CSS.escape(id)}"]`);
      if (!existsStatic && !existsGenerated) {
        tbody.insertAdjacentHTML('beforeend', createGeneratedRow(item));
      }
    });

    updateCartQuantity(bag.reduce((s,i)=>s+Number(i.qty||0),0));
  }

  // event delegation for plus/minus/remove
  tbody.addEventListener('click', function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const row = btn.closest('.bag-row');
    if (!row) return;
    const id = row.dataset.id;
    if (!id) return;

    let bag = getBag();

    if (action === 'decrease') {
      const it = bag.find(x=>String(x.id) === String(id));
      if (!it) return;
      it.qty = Math.max(1, (it.qty||1) - 1);
      saveBag(bag);
      render();
    } else if (action === 'increase') {
      const it = bag.find(x=>String(x.id) === String(id));
      if (!it) return;
      it.qty = (it.qty||0) + 1;
      saveBag(bag);
      render();
    } else if (action === 'remove') {
      if (CART && typeof CART.removeFromBag === 'function') {
        try {
          CART.removeFromBag(id);
        } catch(e){
          bag = bag.filter(x=>String(x.id) !== String(id));
          saveBag(bag);
        }
      } else {
        bag = bag.filter(x=>String(x.id) !== String(id));
        saveBag(bag);
      }

      const genRow = tbody.querySelector(`.bag-row[data-generated="true"][data-id="${CSS.escape(String(id))}"]`);
      if (genRow) genRow.remove();
      const staticRow = tbody.querySelector(`.bag-row:not([data-generated])[data-id="${CSS.escape(String(id))}"]`);
      if (staticRow) staticRow.remove();

      render();
    }
  });

  tbody.addEventListener('change', function (e) {
    const input = e.target;
    if (!input.classList.contains('qty-input')) return;
    const row = input.closest('.bag-row');
    if (!row) return;
    const id = row.dataset.id;
    let v = parseInt(input.value, 10) || 1;
    if (v < 1) v = 1;

    if (CART && typeof CART.setQty === 'function') {
      try {
        CART.setQty(id, v);
      } catch(e){
        const bag = getBag().map(it => String(it.id) === String(id) ? Object.assign({}, it, { qty: v }) : it);
        saveBag(bag);
      }
    } else {
      const bag = getBag().map(it => String(it.id) === String(id) ? Object.assign({}, it, { qty: v }) : it);
      saveBag(bag);
    }
    render();
  });

  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', function () {
      location.href = 'checkout.html';
    });
  }

  // idempotent handler for ?add=ID&qty=N
  (function handleQueryAdd(){
    try {
      const params = new URLSearchParams(location.search);
      const id = params.get('add');
      if (!id) return;
      const qty = Math.max(1, parseInt(params.get('qty') || '1',10));

      const bag = getBag();
      const existing = bag.find(x => String(x.id) === String(id));

      if (existing) {
        if (CART && typeof CART.setQty === 'function') {
          window.cart.setQty(id, qty);
        } else {
          existing.qty = qty;
          saveBag(bag);
        }
      } else {
        const card = document.querySelector(`.product-card[data-id="${id}"]`);
        const title = card?.dataset?.title || card?.querySelector('.product-title')?.textContent || id;
        const price = Number(card?.dataset?.price || 0);
        const img = card?.querySelector('img')?.src || '';
        if (CART && typeof CART.addToBagById === 'function') {
          window.cart.addToBagById(id, title, price, qty, img);
        } else {
          bag.push({ id, title, price, qty, img });
          saveBag(bag);
        }
      }

      history.replaceState({}, document.title, location.pathname + location.hash);
    } catch(e){}
  })();

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, function (m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; }); }

  document.addEventListener('DOMContentLoaded', render);
})();
