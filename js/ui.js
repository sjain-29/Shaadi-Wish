// Shared interface helpers. All text is inserted with textContent (via h()),
// never innerHTML, so nothing a guest types can run as code.
import { APP } from './app-config.js';
import { backend, mode } from './backend.js';
import qrcode from '../assets/vendor/qrcode.mjs';

const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10', gift: 'M4 11h16v10H4zM2 7h20v4H2zM12 7v14M12 7c-2-4-7-3-5 0M12 7c2-4 7-3 5 0', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h12M16 13h2', chat: 'M21 12a8 8 0 01-11.5 7.2L4 20l1-4.6A8 8 0 1121 12z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z', share: 'M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 3v13M7 8l5-5 5 5',
  settings: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M14 4v4M6 10v4M16 16v4', plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1', download: 'M12 3v12M7 11l5 5 5-5M4 20h16', qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M17 3.5a4 4 0 010 7.5M22 21a7 7 0 00-4-6',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4', logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10', clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', alert: 'M12 3l10 17H2zM12 10v4M12 17h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6', back: 'M19 12H5M11 6l-6 6 6 6', more: 'M5 12h.01M12 12h.01M19 12h.01', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z', plane: 'M21 4L3 11l6 3 3 6zM9 14l12-10',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4', pot: 'M5 10h14v6a4 4 0 01-4 4H9a4 4 0 01-4-4zM3 10h18M9 6c0-2 2-2 2-4M14 6c0-2 2-2 2-4', bed: 'M3 18V7M3 13h18v5M21 15a3 3 0 00-3-3H9M6 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 016 0v2', gem: 'M6 4h12l4 6-10 11L2 10zM2 10h20M9 4l-2 6 5 11 5-11-2-6', car: 'M3 16v-4l2-5h14l2 5v4M3 16h18M6 16v2M18 16v2M7 12h.01M17 12h.01',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z', coins: 'M9 14a6 6 0 100-12 6 6 0 000 12zM15 10a6 6 0 11-5 9', box: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8',
  envelope: 'M3 6h18v12H3zM3 7l9 7 9-7', send: 'M4 12l16-8-6 16-3-6z', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', flag: 'M5 21V4h12l-2 4 2 4H5',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01', refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
};
export const CAT = {
  'Honeymoon & Travel': ['plane', '#ff8a3d', '#f2637e'], 'Home Down Payment': ['home', '#5b2a86', '#9c5bd0'], 'Home Appliances': ['box', '#14806a', '#5fd0ae'],
  'Kitchen Essentials': ['pot', '#f2637e', '#ffb08a'], 'Bedroom & Furniture': ['bed', '#8e3fb8', '#c9a7f0'], Electronics: ['tv', '#4b3fa8', '#8e6fe0'],
  'Personal Shopping': ['bag', '#f08a24', '#f7c948'], 'Jewellery & Accessories': ['gem', '#d18f0a', '#f7c948'], Vehicle: ['car', '#2c1a3f', '#6a3fa0'],
  'Experiences & Activities': ['star', '#ff6f91', '#ffa26b'], 'Savings & Investments': ['coins', '#0f7a63', '#1faa86'], 'Other Requirements': ['gift', '#f2637e', '#8e3fb8'],
};
export const CATEGORIES = Object.keys(CAT);
/** Money goals: guests chip in, nobody "buys" them. Everything else can also be gifted as a product. */
export const FUNDS = ['Honeymoon & Travel', 'Home Down Payment', 'Experiences & Activities', 'Savings & Investments'];

export const $ = (sel, root = document) => root.querySelector(sel);
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  if (size) svg.style.cssText = `width:${size}px;height:${size}px`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.gift);
  svg.append(path);
  return svg;
}

// ---- formatting ----
export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const fmtDate = (ts, time = false) => (ts ? new Date(ts).toLocaleString('en-IN', time ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return s < 7 * 86400 ? `${Math.floor(s / 86400)} d ago` : fmtDate(ts);
}
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const first = (name) => String(name || '').trim().split(/\s+/)[0];
export const safeUrl = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : '');
export const params = () => new URLSearchParams(location.search);
export const entries = (obj) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));
export const STATUS = {
  INITIATED: ['Started', 'plain'], PAYMENT_REPORTED: ['Reported, no UTR yet', 'warn'], PENDING_VERIFICATION: ['Pending verification', 'warn'],
  VERIFIED: ['Verified', 'ok'], REJECTED: ['Rejected', 'bad'], REFUNDED: ['Refunded', 'plain'],
};
export const statusBadge = (s) => h('span', { class: `badge ${STATUS[s]?.[1] || 'plain'}` }, STATUS[s]?.[0] || s);

// ---- links ----
const ROOT = new URL('../', import.meta.url);
export const site = (path = '') => new URL(path, ROOT).href;
export const publicUrl = (slug) => site(`w/?${slug}`);
export const pageUrl = (page, query = {}) => {
  const u = new URL(page, ROOT);
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, v);
  return u.href;
};
export const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
/** upi://pay link understood by every UPI app (NPCI linking specification). */
export function upiLink({ upiId, name, amount, note }, scheme = 'upi://pay') {
  const q = new URLSearchParams({ pa: upiId, pn: name, am: Number(amount).toFixed(2), cu: 'INR', tn: note });
  return `${scheme}?${q.toString().replace(/\+/g, '%20')}`;
}

// ---- feedback ----
let toasts;
export function toast(message, type = '') {
  if (!toasts) document.body.append((toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })));
  const t = h('div', { class: `toast ${type}` }, message);
  toasts.append(t);
  setTimeout(() => t.remove(), type === 'err' ? 5200 : 3200);
}
export function modal({ title, body, actions = [], wide = false, locked = false, onClose }) {
  const close = () => {
    overlay.remove();
    if (!$('.overlay')) document.body.style.overflow = '';
    if (onClose) onClose();
  };
  const sheet = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), !locked && h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: close }, icon('x'))),
    body, actions.length ? h('div', { class: 'sheet-actions' }, actions) : null);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => e.target === overlay && !locked && close() }, sheet);
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  return { close, sheet };
}
export function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title, body: h('p', { class: 'muted' }, text), onClose: () => !answered && resolve(false),
      actions: [
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { answered = true; m.close(); resolve(true); } }, okLabel),
      ],
    });
  });
}
/** Runs an action with a loading button; shows the server's message if it fails. Returns the result, or undefined. */
export async function run(btn, fn) {
  if (btn) btn.classList.add('loading');
  try {
    return await fn();
  } catch (err) {
    toast(err.message || 'Something went wrong. Please try again.', 'err');
    return undefined;
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}
export function confetti() {
  const box = h('div', { class: 'confetti' });
  const colors = ['#ff8a3d', '#f2637e', '#8e3fb8', '#f7c948', '#1faa86'];
  for (let i = 0; i < 70; i++) box.append(h('i', { style: `left:${Math.random() * 100}%;background:${colors[i % 5]};animation-duration:${1.6 + Math.random() * 1.8}s;animation-delay:${Math.random() * 0.5}s` }));
  document.body.append(box);
  setTimeout(() => box.remove(), 4200);
}

// ---- building blocks ----
export const field = (label, control, hint) => h('label', { class: 'field' }, label, control, hint && h('span', { class: 'hint' }, hint));
export const input = (attrs) => h(attrs.rows ? 'textarea' : 'input', { class: 'in', ...attrs });
export const select = (attrs, options) => h('select', { class: 'in', ...attrs }, options.map((o) => (Array.isArray(o) ? h('option', { value: o[0], selected: attrs.value === o[0] }, o[1]) : h('option', { value: o, selected: attrs.value === o }, o))));
export const check = (name, label, checked = false) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked }), h('span', {}, label));
export function vals(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    out[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim();
  });
  return out;
}
export function bar(pct, pending = 0) {
  const p = Math.min(100, Math.max(0, pct || 0));
  return h('div', { class: `progress${p >= 100 ? ' done' : ''}`, role: 'progressbar', 'aria-valuenow': Math.round(p), 'aria-valuemin': 0, 'aria-valuemax': 100 },
    pending > 0 && h('i', { class: 'pend', style: `width:${Math.min(100, p + pending)}%` }), h('i', { style: `width:${p}%` }));
}
export const empty = (iconName, title, text, action) => h('div', { class: 'empty' }, h('div', { class: 'art' }, icon(iconName)), h('h3', {}, title), h('p', {}, text), action);
export const loader = () => h('div', { class: 'loading-page' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Loading' }));
export function cover(item, extra) {
  const m = CAT[item.category] || CAT['Other Requirements'];
  const src = safeUrl(item.imageUrl);
  return h('div', { class: 'cover', style: `background:linear-gradient(135deg,${m[1]},${m[2]})` }, src ? h('img', { src, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : icon(m[0]), extra);
}
export const brand = (href = site('index.html')) => h('a', { class: 'brand', href }, h('span', { class: 'mark' }, icon('heart', 18)), APP.name);
export const footer = () => h('footer', { class: 'footer' }, h('div', {}, `${APP.name} · ${APP.tagline}`));

// ---- device features ----
export async function copy(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast(label, 'ok');
}
export async function share({ title, text, url, files }) {
  try {
    if (files && navigator.canShare && navigator.canShare({ files })) return await navigator.share({ title, text, files });
    if (navigator.share) return await navigator.share({ title, text, url });
  } catch (err) {
    if (err.name === 'AbortError') return undefined;
  }
  return copy([text, url].filter(Boolean).join(' '), 'Link copied');
}
export function download(blobOrUrl, filename) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/** Draws a QR code. Generated in the browser; the link never goes to any third-party service. */
export function drawQR(g, text, x, y, size, dark = '#2c1a3f') {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const cell = size / (n + 4);
  g.fillStyle = '#fff';
  g.fillRect(x, y, size, size);
  g.fillStyle = dark;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect(x + (c + 2) * cell, y + (r + 2) * cell, Math.ceil(cell), Math.ceil(cell));
}
export function qrCanvas(text, size = 480) {
  const canvas = h('canvas', { width: size, height: size, style: 'width:100%;max-width:230px;height:auto;display:block' });
  drawQR(canvas.getContext('2d'), text, 0, 0, size);
  return canvas;
}
export const canvasBlob = (canvas, type = 'image/png', q) => new Promise((res) => canvas.toBlob(res, type, q));
/** Shrinks a photo before upload (max 1280 px, JPEG) so it is quick on mobile data. */
export function shrinkImage(file, max = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = h('canvas', { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('That file is not an image we can read.'));
    img.src = URL.createObjectURL(file);
  });
}
/** CSV text that opens cleanly in Excel. Cells starting with = + - @ are neutralised. */
export function toCsv(rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t]/.test(s) && typeof v !== 'number') s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

// ---- page start-up ----
export function boot(title) {
  document.title = title ? `${title} · ${APP.name}` : `${APP.name} · ${APP.tagline}`;
  for (const [k, v] of Object.entries(APP.colors || {})) document.documentElement.style.setProperty(`--${k}`, v);
  if (mode === 'preview') {
    document.body.prepend(h('div', { class: 'banner' }, 'Preview mode: sample data kept only in this browser. No real payments. ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); backend.reset(); } }, 'Reset sample data')));
  }
  return $('#app');
}
export async function requireRole(role) {
  const s = await backend.session();
  if (!s || s.role !== role) {
    location.replace(site('login.html'));
    return new Promise(() => {});
  }
  return s;
}
