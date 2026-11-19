// Rewards & Redemption pages (owner: Habiba).
// Everyone: browse the catalogue. Customer: redeem + "My vouchers" with full codes.
// Owner: create / edit / retire rewards. Staff/Owner: find a voucher by code and
// fulfil it at the counter. Owner: cancel a voucher (points refunded, stock restored).
import { api, qs } from './api.js';
import { h, card, field, input, select, formData, table, toast, showError, fmtDate, fmtPoints, badge, pager } from './ui.js';

const STATUS_KIND = { ISSUED: 'warn', FULFILLED: 'ok', CANCELLED: 'muted' };
const EMAIL_KIND = { queued: 'muted', sent: 'ok', failed: 'danger', skipped: 'muted' };

export async function renderRewards(view, { user }) {
  const isOwner = user.role === 'Owner';
  const isCustomer = user.role === 'Customer';
  const grid = h('div', { class: 'reward-grid' });
  const banner = h('div');
  const voucherBox = h('div');
  const parts = [h('h1', {}, 'Rewards'), banner, voucherBox];

  async function load() {
    try {
      const data = await api('GET', '/api/rewards?limit=100');
      if (isCustomer) banner.replaceChildren(h('p', { class: 'lead' }, `Your balance: ${fmtPoints(data.balance)}`));
      grid.replaceChildren(...(data.items.length ? data.items.map(rewardCard) : [h('p', { class: 'muted' }, 'No rewards yet.')]));
    } catch (err) { showError(null, err); }
  }

  function rewardCard(r) {
    const children = [
      h('h3', {}, r.name),
      h('p', { class: 'muted' }, r.description || ''),
      h('p', { class: 'reward-cost' }, fmtPoints(r.pointsCost)),
      h('p', { class: 'small' }, r.stock > 0 ? `${r.stock} left` : 'Out of stock'),
    ];
    if (isCustomer) {
      children.push(r.affordable
        ? h('button', { class: 'btn primary', onclick: () => redeem(r) }, 'Redeem')
        : h('p', { class: 'muted small' }, r.stock > 0 ? `${r.pointsNeeded} more points needed` : 'Check back later'));
    }
    if (isOwner) children.push(ownerEditor(r, load));
    return h('article', { class: 'reward' }, ...children);
  }

  async function redeem(r) {
    if (!window.confirm(`Redeem "${r.name}" for ${r.pointsCost} points?`)) return;
    try {
      const res = await api('POST', '/api/redemptions', { body: { rewardId: r.rewardId } });
      voucherBox.replaceChildren(card('Enjoy your reward!',
        h('p', {}, `Show this code at the counter for "${res.redemption.rewardName}":`),
        h('p', { class: 'code' }, res.redemption.voucherCode),
        h('p', { class: 'muted' }, `Points left: ${res.balance}. A confirmation e-mail is on its way.`)));
      load();
    } catch (err) { showError(null, err); }
  }

  if (isOwner) parts.push(card('Add a reward', createForm(load)));
  parts.push(grid);
  view.replaceChildren(...parts);
  load();
}

function createForm(onDone) {
  const msg = h('p', { class: 'message' });
  const form = h('form', { class: 'grid-form', novalidate: true },
    field('Name', input('name', { required: true, minlength: 2, maxlength: 80 })),
    field('Description', input('description', { maxlength: 500 })),
    field('Points cost', input('pointsCost', { type: 'number', min: '1', step: '1', required: true })),
    field('Stock', input('stock', { type: 'number', min: '0', step: '1', required: true })),
    field('Max per customer per month', input('maxPerCustomerMonth', { type: 'number', min: '1', max: '100', step: '1', value: '5' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Create reward'), msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { msg.textContent = 'Name, a points cost of 1+ and a stock of 0+ are required.'; return; }
    try { await api('POST', '/api/rewards', { body: formData(form) }); form.reset(); toast('Reward created'); onDone(); } catch (err) { showError(msg, err); }
  });
  return form;
}

function ownerEditor(r, onDone) {
  const cost = input(`cost-${r.rewardId}`, { type: 'number', min: '1', value: r.pointsCost, 'aria-label': 'Points cost' });
  const stock = input(`stock-${r.rewardId}`, { type: 'number', min: '0', value: r.stock, 'aria-label': 'Stock' });
  return h('div', { class: 'owner-tools' },
    h('div', { class: 'toolbar' }, cost, stock,
      h('button', { class: 'btn small', onclick: async () => {
        try {
          await api('PUT', `/api/rewards/${r.rewardId}`, { body: { pointsCost: Number(cost.value), stock: Number(stock.value) } });
          toast('Reward updated'); onDone();
        } catch (err) { showError(null, err); }
      } }, 'Save')),
    h('button', { class: 'btn small danger', onclick: async () => {
      if (!window.confirm(`Retire "${r.name}"? It stays in history but cannot be redeemed.`)) return;
      try { await api('DELETE', `/api/rewards/${r.rewardId}`); toast('Reward retired'); onDone(); } catch (err) { showError(null, err); }
    } }, 'Retire'));
}

export async function renderRedemptions(view, { user }) {
  const isCustomer = user.role === 'Customer';
  const state = { status: '', limit: 15, offset: 0 };
  const list = h('div');

  async function load() {
    try {
      const data = await api('GET', `/api/redemptions${qs(state)}`);
      list.replaceChildren(
        table([
          { label: 'When', render: (r) => fmtDate(r.createdAt) },
          { label: 'Reward', key: 'rewardName' },
          { label: 'Points', key: 'pointsSpent' },
          { label: 'Voucher', render: (r) => h('span', { class: 'mono' }, r.voucherCode) },
          { label: 'Status', render: (r) => badge(r.status, STATUS_KIND[r.status]) },
          { label: 'E-mail', render: (r) => badge(r.emailStatus, EMAIL_KIND[r.emailStatus]) },
          ...(user.role === 'Owner' ? [{ label: '', render: (r) => (r.status === 'ISSUED' ? h('button', { class: 'btn small danger', onclick: () => cancel(r) }, 'Cancel') : '') }] : []),
        ], data.items, isCustomer ? 'You have not redeemed anything yet.' : 'No vouchers yet.'),
        pager(data.total, data.limit, data.offset, (o) => { state.offset = o; load(); }),
      );
    } catch (err) { showError(null, err); }
  }

  async function cancel(r) {
    const reason = window.prompt('Cancel this voucher and refund the points? Reason (5+ characters):');
    if (!reason) return;
    try {
      const res = await api('PATCH', `/api/redemptions/${r.redemptionId}/status`, { body: { status: 'CANCELLED', reason: reason.trim() } });
      toast(`Cancelled: ${res.refundedPoints} points refunded`);
      load();
    } catch (err) { showError(null, err); }
  }

  const filter = select('status', [['', 'All'], ['ISSUED', 'Issued'], ['FULFILLED', 'Fulfilled'], ['CANCELLED', 'Cancelled']]);
  filter.addEventListener('change', () => { state.status = filter.value; state.offset = 0; load(); });

  const parts = [h('h1', {}, isCustomer ? 'My vouchers' : 'Vouchers')];
  if (!isCustomer) parts.push(card('Hand over a reward', fulfilForm(load)));
  parts.push(card(isCustomer ? 'History' : 'All vouchers (codes are masked)', h('div', { class: 'toolbar' }, filter), list));
  view.replaceChildren(...parts);
  load();
}

/** Staff type the code the customer shows; the backend checks it matches before fulfilling. */
function fulfilForm(onDone) {
  const msg = h('p', { class: 'message' });
  const form = h('form', { class: 'toolbar', novalidate: true },
    input('voucherCode', { placeholder: 'LH-XXXX-XXXX-XX', required: true, pattern: 'LH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}', maxlength: 15 }),
    h('button', { class: 'btn primary', type: 'submit' }, 'Check & fulfil'), msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const code = form.voucherCode.value.trim().toUpperCase();
    if (!/^LH-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/.test(code)) { msg.textContent = 'Codes look like LH-ABCD-EFGH-JK.'; return; }
    try {
      const found = await api('GET', `/api/redemptions${qs({ voucherCode: code, limit: 1 })}`);
      const r = found.items[0];
      if (!r) { msg.textContent = 'No voucher with this code.'; return; }
      if (r.status !== 'ISSUED') { msg.textContent = `This voucher is already ${r.status.toLowerCase()}.`; return; }
      await api('PATCH', `/api/redemptions/${r.redemptionId}/status`, { body: { status: 'FULFILLED', voucherCode: code } });
      form.reset();
      toast(`Fulfilled: ${r.rewardName}`);
      onDone();
    } catch (err) { showError(msg, err); }
  });
  return form;
}
