// Owner dashboard + reports (owner: Jana -- integration of all three services). The dashboard is ONE call to the Rewards
// service, which gathers numbers from Customers and Points (service-to-service calls).
import { api, qs } from './api.js';
import { h, card, field, input, table, showError, stat, fmtPoints, badge } from './ui.js';

export async function renderDashboard(view) {
  const days = 30;
  const d = await api('GET', `/api/dashboard?days=${days}`);
  view.replaceChildren(
    h('h1', {}, 'Dashboard'),
    h('p', { class: 'muted' }, `Last ${days} days`),
    card('Members (Customers & Membership service)',
      h('div', { class: 'stats' },
        stat('Active members', d.members.activeMembers),
        stat(`Active in ${days} days`, d.members.activeInWindow),
        stat('New members', d.members.newInWindow),
        stat('At risk (31-90 days)', d.members.atRisk),
        stat('Lapsed (90+ days)', d.members.lapsed),
        stat('Suspended', d.members.suspendedMembers)),
      h('p', {}, ...d.members.byTier.map((t) => badge(`${t.tier}: ${t.members}`, t.tier.toLowerCase())))),
    card('Points (Points & Transactions service)',
      h('div', { class: 'stats' },
        stat('Purchases', d.points.purchases),
        stat('Sales value', `${Number(d.points.purchaseValue).toLocaleString()} EGP`),
        stat('Points issued', fmtPoints(d.points.pointsIssued)),
        stat('Points redeemed', fmtPoints(d.points.pointsRedeemed)),
        stat('Outstanding points', fmtPoints(d.points.outstandingPoints)))),
    card('Rewards (Rewards & Redemption service)',
      h('div', { class: 'stats' },
        stat('Redemptions', d.redemptions.redemptions),
        stat('Vouchers to hand over', d.redemptions.openVouchers),
        stat('Low-stock rewards', d.redemptions.lowStockRewards),
        stat('E-mail failures', d.redemptions.emailFailures))),
  );
}

export async function renderReports(view) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const out = h('div');
  const msg = h('p', { class: 'message' });
  const form = h('form', { class: 'toolbar', novalidate: true },
    field('From', input('from', { type: 'date', value: monthAgo, required: true })),
    field('To', input('to', { type: 'date', value: today, required: true })),
    h('button', { class: 'btn primary', type: 'submit' }, 'Show report'),
    h('button', { class: 'btn', type: 'button', onclick: () => run('csv') }, 'Export CSV'),
    msg);
  form.addEventListener('submit', (e) => { e.preventDefault(); run('json'); });

  async function run(format) {
    msg.textContent = '';
    try {
      const r = await api('GET', `/api/reports/redemptions${qs({ from: form.from.value, to: form.to.value, format })}`);
      if (format === 'csv') {
        // Pre-signed link to the PRIVATE reports bucket, valid for 5 minutes.
        out.replaceChildren(h('p', {}, h('a', { class: 'btn', href: r.downloadUrl, rel: 'noopener' }, 'Download CSV'), h('span', { class: 'muted small' }, ` link expires in ${r.expiresIn / 60} minutes`)));
        return;
      }
      out.replaceChildren(
        h('p', {}, `${r.totals.redemptions} redemptions, ${fmtPoints(r.totals.pointsSpent)} spent`),
        table([
          { label: 'Reward', key: 'rewardName' },
          { label: 'Redeemed', key: 'redemptions' },
          { label: 'Fulfilled', key: 'fulfilled' },
          { label: 'Cancelled', key: 'cancelled' },
          { label: 'Points', key: 'pointsSpent' },
          { label: 'Customers', key: 'uniqueCustomers' },
        ], r.rows, 'No redemptions in this period.'));
    } catch (err) { showError(msg, err); }
  }

  const members = await api('GET', '/api/reports/active-members?days=30');
  view.replaceChildren(
    h('h1', {}, 'Reports'),
    card('Redemptions by reward', form, out),
    card('Active members (30 days)',
      h('div', { class: 'stats' },
        stat('Active members', members.activeMembers),
        stat('Active in 30 days', members.activeInWindow),
        stat('New in 30 days', members.newInWindow),
        stat('At risk', members.atRisk),
        stat('Lapsed', members.lapsed))),
  );
  run('json');
}
