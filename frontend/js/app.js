// App shell: shared navigation for all three services, chosen by role (owner: Habiba).
// Hiding a menu item is NOT security: the API answers 403 to any role that is not allowed.
import { requireLogin, signOut } from './auth.js';
import { h } from './ui.js';
import * as rewards from './rewards.js';
import * as customers from './customers.js';

const user = requireLogin();

const ROUTES = {
  me: { label: 'My profile', roles: ['Customer'], render: customers.renderMyProfile },
  customers: { label: 'Customers', roles: ['Staff', 'Owner'], render: customers.renderCustomers },
  rewards: { label: 'Rewards', roles: ['Customer', 'Staff', 'Owner'], render: rewards.renderRewards },
  vouchers: { label: 'Vouchers', roles: ['Customer', 'Staff', 'Owner'], render: rewards.renderRedemptions },
};

const allowed = Object.entries(ROUTES).filter(([, r]) => r.roles.includes(user.role));
const home = { Owner: 'dashboard', Staff: 'customers', Customer: 'me' }[user.role] || 'rewards';

document.getElementById('user-email').textContent = user.email;
document.getElementById('user-role').textContent = user.role;
document.getElementById('logout').addEventListener('click', () => {
  signOut();
  window.location.replace('index.html');
});

const nav = document.getElementById('nav');
for (const [key, r] of allowed) nav.append(h('a', { href: `#/${key}`, 'data-route': key }, r.label));

async function route() {
  const [, key, ...rest] = (window.location.hash || `#/${home}`).split('/');
  const entry = allowed.find(([k]) => k === key);
  if (!entry) {
    window.location.hash = `#/${home}`;
    return;
  }
  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.route === key);
  const view = document.getElementById('view');
  view.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    await entry[1].render(view, { user, params: rest });
  } catch (err) {
    view.replaceChildren(h('p', { class: 'message' }, err.message || 'Could not load this page.'));
  }
  view.focus();
}

window.addEventListener('hashchange', route);
route();
