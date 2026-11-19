// Points & Transactions pages (owner: Jana).
// Staff/Owner: find a customer, add points for a purchase, see balance + ledger.
// Owner: void a transaction, manual adjustment, earn-rate settings, staff activity report.
// Customer: own balance and history.
import { api, qs } from './api.js';
import { h, card, field, input, select, formData, table, toast, showError, fmtDate, fmtPoints, badge, pager, stat, newId } from './ui.js';

const TYPE_KIND = { EARN: 'ok', REDEEM: 'gold', REFUND: 'silver', ADJUST: 'warn', VOID: 'danger', CLOSE: 'muted' };

export async function renderPoints(view, { user, params }) {
  if (user.role === 'Customer') return renderLedger(view, user, user.customerId, 'My points');

  const picker = customerPicker((id) => { window.location.hash = `#/points/${id}`; });
  const customerId = params[0];
  view.replaceChildren(h('h1', {}, 'Points'), card('Find the customer', picker));
  if (customerId) {
    const area = h('div');
    view.append(area);
    await renderLedger(area, user, customerId);
  }
}

/** Search box that lists matching customers to pick from. */
function customerPicker(onPick) {
  const list = h('div');
  const form = h('form', { class: 'toolbar' },
    input('q', { type: 'search', placeholder: 'Name, e-mail or phone', required: true, maxlength: 100 }),
    h('button', { class: 'btn', type: 'submit' }, 'Search'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('GET', `/api/customers${qs({ q: form.q.value.trim(), status: 'active', limit: 10 })}`);
      list.replaceChildren(table([
        { label: 'Name', key: 'fullName' },
        { label: 'E-mail', key: 'email' },
        { label: 'Tier', render: (c) => badge(c.tier) },
        { label: '', render: (c) => h('button', { class: 'btn small primary', onclick: () => onPick(c.customerId) }, 'Select') },
      ], data.items, 'No active customer found.'));
    } catch (err) { showError(null, err); }
  });
  return h('div', {}, form, list);
}

async function renderLedger(view, user, customerId, title = 'Customer points') {
  const state = { customerId, type: '', limit: 15, offset: 0 };
  const balanceBox = h('div', { class: 'stats' });
  const history = h('div');
  const isStaff = user.role === 'Staff' || user.role === 'Owner';
  const isOwner = user.role === 'Owner';

  async function refresh() {
    try {
      const [bal, tx] = await Promise.all([
        api('GET', `/api/customers/${customerId}/balance`),
        api('GET', `/api/transactions${qs(user.role === 'Customer' ? { type: state.type, limit: state.limit, offset: state.offset } : state)}`),
      ]);
      balanceBox.replaceChildren(stat('Balance', fmtPoints(bal.balance)), stat('Account', bal.status));
      history.replaceChildren(
        table([
          { label: 'When', render: (t) => fmtDate(t.createdAt) },
          { label: 'Type', render: (t) => badge(t.type, TYPE_KIND[t.type]) },
          { label: 'Points', render: (t) => (t.pointsDelta > 0 ? `+${t.pointsDelta}` : String(t.pointsDelta)) },
          { label: 'Purchase', render: (t) => (t.purchaseAmount ? `${t.purchaseAmount} EGP` : '') },
          { label: 'Tier ×', render: (t) => t.tierMultiplier || '' },
          { label: 'Reason', key: 'reason' },
          ...(isOwner ? [{ label: '', render: (t) => (['EARN', 'ADJUST'].includes(t.type) ? h('button', { class: 'btn small danger', onclick: () => voidTx(t) }, 'Void') : '') }] : []),
        ], tx.items, 'No transactions yet.'),
        pager(tx.total, tx.limit, tx.offset, (o) => { state.offset = o; refresh(); }),
      );
    } catch (err) { showError(null, err); }
  }

  async function voidTx(t) {
    const reason = window.prompt(`Void ${t.type} of ${t.pointsDelta} points? Give a reason (5+ characters):`);
    if (!reason) return;
    try {
      const res = await api('POST', `/api/transactions/${t.transactionId}/reversals`, { body: { reason: reason.trim() } });
      toast(`Voided. New balance ${res.balance}`);
      refresh();
    } catch (err) { showError(null, err); }
  }

  const parts = [h('h2', {}, title), balanceBox];

  if (isStaff) {
    // One Idempotency-Key per purchase: a double click or a network retry re-sends the
    // SAME key, so the backend adds the points only once. A new key after success.
    let key = newId();
    const msg = h('p', { class: 'message' });
    const earn = h('form', { class: 'toolbar', novalidate: true },
      input('purchaseAmount', { type: 'number', min: '0.01', step: '0.01', max: '1000000', placeholder: 'Purchase amount (EGP)', required: true }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Add points'), msg);
    earn.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      const amount = Number(earn.purchaseAmount.value);
      if (!(amount > 0) || Math.round(amount * 100) !== amount * 100) { msg.textContent = 'Enter an amount above 0 with at most 2 decimals.'; return; }
      const button = earn.querySelector('button');
      button.disabled = true;
      try {
        const res = await api('POST', '/api/transactions', { headers: { 'Idempotency-Key': key }, body: { customerId, purchaseAmount: amount } });
        key = newId();
        earn.reset();
        toast(`+${res.transaction.pointsDelta} points (×${res.transaction.tierMultiplier}). Balance ${res.balance}${res.tierChanged ? ` · new tier ${res.tier}!` : ''}`);
        refresh();
      } catch (err) { showError(msg, err); } finally { button.disabled = false; }
    });
    parts.push(card('Add points for a purchase', earn));
  }

  if (isOwner) {
    const msg = h('p', { class: 'message' });
    const adj = h('form', { class: 'toolbar', novalidate: true },
      input('pointsDelta', { type: 'number', step: '1', min: '-10000', max: '10000', placeholder: '+/- points', required: true }),
      input('reason', { placeholder: 'Reason (required)', minlength: 5, maxlength: 200, required: true }),
      h('button', { class: 'btn', type: 'submit' }, 'Adjust'), msg);
    adj.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { customerId, ...formData(adj) };
      if (!Number.isInteger(body.pointsDelta) || body.pointsDelta === 0 || !body.reason || body.reason.length < 5) {
        msg.textContent = 'Enter a whole number (not 0) and a reason of 5+ characters.'; return;
      }
      try { const res = await api('POST', '/api/adjustments', { body }); adj.reset(); toast(`Adjusted. Balance ${res.balance}`); refresh(); } catch (err) { showError(msg, err); }
    });
    parts.push(card('Manual adjustment (owner)', adj));
  }

  const filter = select('type', [['', 'All types'], ['EARN', 'Earn'], ['REDEEM', 'Redeem'], ['REFUND', 'Refund'], ['ADJUST', 'Adjust'], ['VOID', 'Void']]);
  filter.addEventListener('change', () => { state.type = filter.value; state.offset = 0; refresh(); });
  parts.push(card('Transaction history (ledger)', h('div', { class: 'toolbar' }, filter), history));

  view.replaceChildren(...parts);
  refresh();
}

export async function renderEarnRules(view, { user }) {
  const rule = await api('GET', '/api/earn-rules');
  const isOwner = user.role === 'Owner';
  const msg = h('p', { class: 'message' });
  const form = h('form', { class: 'grid-form', novalidate: true },
    field('Points per 1 EGP', input('pointsPerUnit', { type: 'number', step: '0.01', min: '0.01', max: '100', value: rule.pointsPerUnit, disabled: !isOwner })),
    field('Largest purchase staff may enter (EGP)', input('maxPurchase', { type: 'number', step: '0.01', min: '1', max: '1000000', value: rule.maxPurchase, disabled: !isOwner })),
    field('Daily points cap per customer', input('dailyPointsCap', { type: 'number', step: '1', min: '1', value: rule.dailyPointsCap, disabled: !isOwner })),
    isOwner ? h('button', { class: 'btn primary', type: 'submit' }, 'Save rules') : h('p', { class: 'muted small' }, 'Only the owner can change these.'),
    msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/earn-rules', { body: formData(form) }); toast('Earn rules saved'); } catch (err) { showError(msg, err); }
  });

  const parts = [h('h1', {}, 'Earn rules'), card('How customers earn points', form,
    h('p', { class: 'muted small' }, 'Points = purchase × points per EGP × tier multiplier (Bronze ×1, Silver ×1.25, Gold ×1.5), rounded down.'))];

  if (isOwner) {
    const report = await api('GET', '/api/reports/staff-activity?days=30');
    parts.push(card('Staff activity (last 30 days)',
      table([
        { label: 'Staff member (id)', render: (s) => s.staffId.slice(0, 8) },
        { label: 'Purchases', key: 'earns' },
        { label: 'Points given', key: 'pointsGiven' },
        { label: 'Later voided', key: 'voidedEarns' },
        { label: 'Adjustments', key: 'adjustments' },
        { label: 'Flags', render: (s) => (s.flags.length ? s.flags.map((f) => badge(f, 'danger')) : badge('OK', 'ok')) },
      ], report.staff, 'No staff activity yet.'),
      h('p', { class: 'muted small' }, 'Flags: VOID_RATE (>20% of earns voided), HIGH_SHARE (>60% of all points), LARGE_AVERAGE (3× the business average).')));
  }
  view.replaceChildren(...parts);
}
