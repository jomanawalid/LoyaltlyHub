// Small DOM helpers shared by every page (owner: Habiba).
// Everything is built with textContent / createElement - never innerHTML with data -
// so a customer name like "<script>" is shown as text and can never run (XSS).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM: allowed by our CSP (no inline style attributes)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function toast(text, kind = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.className = `show ${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 4000);
}

/** Show an API error under a form and as a toast. */
export function showError(target, err) {
  const text = err.requestId ? `${err.message} (ref ${err.requestId.slice(0, 8)})` : err.message;
  if (target) target.textContent = text;
  toast(text, 'error');
}

export function field(label, input, hint) {
  return h('label', {}, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function input(name, attrs = {}) {
  return h('input', { name, id: name, ...attrs });
}

export function select(name, options, value) {
  return h('select', { name, id: name }, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
}

/** Read a form into an object; numbers are converted when the input type is number. */
export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    const v = el.value.trim();
    if (v === '') continue;
    out[el.name] = el.type === 'number' ? Number(v) : v;
  }
  return out;
}

export function table(columns, rows, empty = 'Nothing to show yet.') {
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  return h(
    'div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c.label)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', {}, c.render ? c.render(r) : r[c.key] ?? '')))))),
  );
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h2', {}, title) : null, ...children);
}

export function stat(label, value) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, String(value ?? '–')), h('div', { class: 'stat-label' }, label));
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '–');
export const fmtPoints = (n) => `${Number(n || 0).toLocaleString()} pts`;
export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);

export function pager(total, limit, offset, onChange) {
  if (total <= limit) return document.createTextNode('');
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return h('div', { class: 'pager' },
    h('button', { class: 'btn small', disabled: offset === 0, onclick: () => onChange(offset - limit) }, '‹ Prev'),
    h('span', { class: 'muted small' }, `Page ${page} of ${pages} (${total})`),
    h('button', { class: 'btn small', disabled: offset + limit >= total, onclick: () => onChange(offset + limit) }, 'Next ›'));
}

/** UUID v4 that also works on plain-http pages (crypto.randomUUID needs HTTPS or localhost). */
export function newId() {
  if (window.crypto.randomUUID && window.isSecureContext) return window.crypto.randomUUID();
  const b = window.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
