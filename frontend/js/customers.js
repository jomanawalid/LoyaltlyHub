// Customer & Membership pages (owner: Jomana).
// Staff/Owner: register, search/filter, view, edit, membership tier; Owner also
// suspends/reactivates and erases. Customer: "My profile" with balance and tier.
import { api, qs } from './api.js';
import { h, card, field, input, select, formData, table, toast, showError, fmtDate, fmtPoints, badge, pager, stat } from './ui.js';

const STATUS_KIND = { active: 'ok', suspended: 'warn', erased: 'muted' };
const TIER_KIND = { BRONZE: 'bronze', SILVER: 'silver', GOLD: 'gold' };

export async function renderCustomers(view, { user }) {
  const state = { q: '', status: '', tier: '', limit: 20, offset: 0 };
  const results = h('div');
  const detail = h('div');

  // ---- register form ----
  const regMsg = h('p', { class: 'message' });
  const regForm = h('form', { class: 'grid-form', novalidate: true },
    field('Full name', input('fullName', { required: true, minlength: 2, maxlength: 100 })),
    field('E-mail', input('email', { type: 'email', required: true, maxlength: 254 })),
    field('Phone', input('phone', { required: true, pattern: '\\+?[0-9]{8,15}', placeholder: '+201001234567' })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Register customer'),
    regMsg);
  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    regMsg.textContent = '';
    if (!regForm.checkValidity()) { regMsg.textContent = 'Please fill in name, a valid e-mail and phone (8-15 digits).'; return; }
    try {
      const res = await api('POST', '/api/customers', { body: formData(regForm) });
      regForm.reset();
      toast(`Registered ${res.customer.fullName}`);
      if (res.login.temporaryPassword) showTemporaryPassword(detail, res.customer, res.login.temporaryPassword);
      load();
    } catch (err) { showError(regMsg, err); }
  });

  // ---- search ----
  const searchForm = h('form', { class: 'toolbar' },
    input('q', { type: 'search', placeholder: 'Name, e-mail or phone', maxlength: 100 }),
    select('status', [['', 'All statuses'], ['active', 'Active'], ['suspended', 'Suspended'], ['erased', 'Erased']]),
    select('tier', [['', 'All tiers'], ['BRONZE', 'Bronze'], ['SILVER', 'Silver'], ['GOLD', 'Gold']]),
    h('button', { class: 'btn', type: 'submit' }, 'Search'));
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(state, { q: searchForm.q.value.trim(), status: searchForm.status.value, tier: searchForm.tier.value, offset: 0 });
    load();
  });

  async function load() {
    try {
      const data = await api('GET', `/api/customers${qs(state)}`);
      results.replaceChildren(
        table([
          { label: 'Name', render: (c) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); openDetail(c.customerId); } }, c.fullName) },
          { label: 'E-mail', key: 'email' },
          { label: 'Phone', key: 'phone' },
          { label: 'Tier', render: (c) => badge(c.tier, TIER_KIND[c.tier]) },
          { label: 'Status', render: (c) => badge(c.status, STATUS_KIND[c.status]) },
          { label: 'Activity', render: (c) => badge(c.segment) },
          { label: 'Joined', render: (c) => fmtDate(c.joinedAt) },
        ], data.items, 'No customers match.'),
        pager(data.total, data.limit, data.offset, (o) => { state.offset = o; load(); }),
      );
    } catch (err) { showError(null, err); }
  }

  async function openDetail(id) {
    detail.replaceChildren(h('p', { class: 'muted' }, 'Loading customer…'));
    try {
      const [c, m] = await Promise.all([
        api('GET', `/api/customers/${id}`),
        api('GET', `/api/customers/${id}/membership`).catch(() => null),
      ]);
      detail.replaceChildren(customerDetail(c, m, user, () => { openDetail(id); load(); }));
      detail.scrollIntoView({ behavior: 'smooth' });
    } catch (err) { showError(null, err); detail.replaceChildren(); }
  }

  view.replaceChildren(
    h('h1', {}, 'Customers'),
    h('div', { class: 'two-col' }, card('Register a customer', regForm), card('Find customers', searchForm, results)),
    detail,
  );
  load();
}

function showTemporaryPassword(target, customer, password) {
  // Shown ONCE so staff can hand it over in person; it is not stored anywhere and
  // Cognito forces the customer to replace it at first sign-in.
  target.replaceChildren(card('Hand this to the customer',
    h('p', {}, `${customer.fullName} signs in with ${customer.email} and this temporary password (valid 3 days, must be changed at first sign-in):`),
    h('p', { class: 'code' }, password),
    h('button', { class: 'btn', onclick: () => target.replaceChildren() }, 'Done, hide it')));
    target.scrollIntoView({ behavior: 'smooth' });
}

function customerDetail(c, m, user, refresh) {
  const msg = h('p', { class: 'message' });
  const isOwner = user.role === 'Owner';

  const edit = h('form', { class: 'grid-form', novalidate: true },
    field('Full name', input('fullName', { value: c.fullName, minlength: 2, maxlength: 100 })),
    field('E-mail', input('email', { type: 'email', value: c.email || '', maxlength: 254 })),
    field('Phone', input('phone', { value: c.phone || '', pattern: '\\+?[0-9]{8,15}' })),
    h('button', { class: 'btn', type: 'submit', disabled: c.status === 'erased' }, 'Save changes'));
  edit.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = formData(edit);
    for (const k of Object.keys(body)) if (body[k] === (c[k] || '')) delete body[k];
    if (!Object.keys(body).length) { msg.textContent = 'Nothing changed.'; return; }
    try { await api('PUT', `/api/customers/${c.customerId}`, { body }); toast('Customer updated'); refresh(); } catch (err) { showError(msg, err); }
  });

  const ownerTools = [];
  if (isOwner && c.status !== 'erased') {
    const next = c.status === 'active' ? 'suspended' : 'active';
    const reason = input('reason', { placeholder: 'Reason (required)', minlength: 5, maxlength: 200 });
    ownerTools.push(h('div', { class: 'toolbar' }, reason,
      h('button', { class: `btn ${next === 'suspended' ? 'warn' : ''}`, onclick: async () => {
        try { await api('PATCH', `/api/customers/${c.customerId}/status`, { body: { status: next, reason: reason.value.trim() } }); toast(`Customer ${next}`); refresh(); } catch (err) { showError(msg, err); }
      } }, next === 'suspended' ? 'Suspend membership' : 'Reactivate membership')));
    ownerTools.push(h('button', { class: 'btn danger', onclick: async () => {
      if (!window.confirm(`Erase ${c.fullName}? Personal data is removed for good; points history stays anonymous.`)) return;
      try { await api('DELETE', `/api/customers/${c.customerId}`); toast('Customer erased'); refresh(); } catch (err) { showError(msg, err); }
    } }, 'Erase customer (GDPR)'));
  }

  return card(`${c.fullName}`,
    h('p', {}, badge(c.status, STATUS_KIND[c.status]), ' ', badge(c.tier, TIER_KIND[c.tier]), ' ', badge(c.segment)),
    m ? membershipStats(m) : null,
    h('p', { class: 'muted small' }, `Joined ${fmtDate(c.joinedAt)} · last activity ${fmtDate(c.lastActivityAt)}`),
    c.status === 'active' ? h('a', { class: 'btn small', href: `#/points/${c.customerId}` }, 'Add points / history') : null,
    edit, ...ownerTools, msg);
}

function membershipStats(m) {
  return h('div', { class: 'stats' },
    stat('Balance', fmtPoints(m.balance)),
    stat('Tier', `${m.tier} ×${m.multiplier}`),
    stat('Earned in 12 months', fmtPoints(m.points12m)),
    stat(m.nextTier ? `To ${m.nextTier}` : 'Top tier', m.nextTier ? fmtPoints(m.pointsToNextTier) : '★'));
}

export async function renderMyProfile(view) {
  const me = await api('GET', '/api/me');
  const m = me.membership;
  const progress = m.nextTier ? Math.round((m.points12m / (m.points12m + m.pointsToNextTier)) * 100) : 100;
  view.replaceChildren(
    h('h1', {}, `Hello, ${me.fullName}`),
    card('My membership',
      membershipStats(m),
      h('div', { class: 'progress', title: `${progress}%` }, h('div', { class: 'progress-bar', style: `width:${progress}%` })),
      h('p', { class: 'muted' }, m.nextTier
        ? `Earn ${m.pointsToNextTier} more points this year to reach ${m.nextTier} and get more points on every purchase.`
        : 'You are at our top tier. Thank you!')),
    card('My details',
      h('dl', { class: 'details' },
        h('dt', {}, 'E-mail'), h('dd', {}, me.email),
        h('dt', {}, 'Phone'), h('dd', {}, me.phone),
        h('dt', {}, 'Member since'), h('dd', {}, fmtDate(me.joinedAt))),
      h('p', { class: 'muted small' }, 'To change your details, ask a staff member.')),
    h('p', {}, h('a', { class: 'btn primary', href: '#/rewards' }, 'See rewards')),
  );
}
