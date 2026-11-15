// Couple dashboard: shell, navigation, overview and wishlist management.
// Reads are live from the couple's own database nodes (the rules allow nothing
// else); every change goes through backend.call(), which runs js/core.
import { backend } from './backend.js';
import {
  boot, requireRole, h, icon, inr, ago, entries, bar, cover, empty, loader, brand, modal, toast, run, confirmBox, field, input, select, check, vals, download, toCsv,
  site, publicUrl, fmtDate, statusBadge, CATEGORIES, initials,
} from './ui.js';
import * as money from './dash-money.js';
import * as social from './dash-social.js';

const app = boot('Dashboard');
app.replaceChildren(loader());
const me = await requireRole('couple');
const cid = me.coupleId;
const D = { couple: null, items: {}, contributions: {}, lifafa: {}, conversations: {}, reservations: {}, groups: {}, cards: {}, pay: null };
const AW = ['PAYMENT_REPORTED', 'PENDING_VERIFICATION'];
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const liveItems = () => entries(D.items).filter((i) => !i.deleted);
const awaiting = (node) => entries(D[node]).filter((c) => AW.includes(c.status));

const SECTIONS = [
  ['overview', 'Overview', 'home'], ['wishlist', 'My Wishlist', 'gift'], ['contributions', 'Contributions', 'wallet'], ['reservations', 'Gift Reservations', 'bag'],
  ['messages', 'Messages', 'chat'], ['lifafa', 'Lifafa', 'envelope'], ['groups', 'Group Gifts', 'users'], ['cards', 'Thank-you Cards', 'card'], ['share', 'Share Wishlist', 'qr'], ['settings', 'Settings', 'settings'],
];
const badges = () => ({
  contributions: awaiting('contributions').length, lifafa: awaiting('lifafa').length,
  messages: sum(entries(D.conversations), (c) => (c.archived ? 0 : c.unreadCouple)),
  reservations: entries(D.reservations).filter((r) => ['DISCUSSING', 'PURCHASED'].includes(r.status)).length,
});
const current = () => (SECTIONS.some((s) => s[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
const go = (id) => { location.hash = id; };
const ctx = { D, cid, go, rerender: () => render(true), names: () => `${D.couple.partner1} & ${D.couple.partner2}` };

// ---------------------------------------------------------------- overview
function donut(pct) {
  const c = 2 * Math.PI * 52;
  const box = h('div', { class: 'donut', role: 'img', 'aria-label': `${Math.round(pct)} percent complete` });
  box.innerHTML = `<svg viewBox="0 0 132 132"><defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a3d"/><stop offset=".55" stop-color="#f2637e"/><stop offset="1" stop-color="#8e3fb8"/></linearGradient></defs>
    <circle cx="66" cy="66" r="52" fill="none" stroke="#f3e9db" stroke-width="14"/><circle cx="66" cy="66" r="52" fill="none" stroke="url(#dg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(c * Math.min(100, pct)) / 100} ${c}" transform="rotate(-90 66 66)"/>
    <text x="66" y="64" text-anchor="middle" font-family="Fraunces,Georgia,serif" font-size="26" font-weight="600" fill="#2c1a3f">${Math.round(pct)}%</text><text x="66" y="84" text-anchor="middle" font-size="11" fill="#7b6c88">complete</text></svg>`;
  return box;
}
function overview() {
  const items = liveItems();
  const cons = entries(D.contributions);
  const lif = entries(D.lifafa);
  const budget = sum(items, (i) => i.budget);
  const verified = sum(cons.filter((c) => c.status === 'VERIFIED'), (c) => c.verifiedAmount);
  const pending = sum([...awaiting('contributions'), ...awaiting('lifafa')], (c) => c.amount);
  const remaining = sum(items, (i) => Math.max(0, i.budget - i.stats.verified));
  const pct = budget ? (sum(items, (i) => Math.min(i.budget, i.stats.verified)) / budget) * 100 : 0;
  const b = badges();
  const stat = (label, value, hl) => h('div', { class: `stat${hl ? ' hl' : ''}` }, h('small', {}, label), h('b', { class: 'num' }, value));
  const cats = {};
  for (const i of items) {
    const c = (cats[i.category] ||= { budget: 0, got: 0 });
    c.budget += i.budget;
    c.got += Math.min(i.budget, i.stats.verified);
  }
  const recent = [...cons, ...lif].filter((c) => c.status !== 'INITIATED').sort((a, z) => z.updatedAt - a.updatedAt).slice(0, 6);
  return [
    !D.pay && h('div', { class: 'note', style: 'margin-bottom:14px' }, 'Guests cannot contribute until you add your UPI ID. ', h('a', { href: '#settings' }, 'Add payment details')),
    b.contributions + b.lifafa > 0 && h('div', { class: 'note info', style: 'margin-bottom:14px' }, `${b.contributions + b.lifafa} payment${b.contributions + b.lifafa > 1 ? 's are' : ' is'} waiting for you to verify. `, h('a', { href: b.contributions ? '#contributions' : '#lifafa' }, 'Review now')),
    h('div', { class: 'stats' }, stat('Total dream budget', inr(budget)), stat('Verified contributions', inr(verified), true), stat('Pending verification', inr(pending)), stat('Remaining budget', inr(remaining)),
      stat('Wishlist items', items.length), stat('Completed goals', items.filter((i) => i.state === 'COMPLETED').length), stat('Contributors', cons.filter((c) => c.status === 'VERIFIED').length),
      stat('Lifafa received', inr(sum(lif.filter((l) => l.status === 'VERIFIED'), (l) => l.verifiedAmount))), stat('Unread messages', b.messages), stat('Pending reservations', b.reservations)),
    h('div', { class: 'two-col', style: 'margin-top:16px' },
      h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:12px' }, 'Progress by category'),
        items.length ? h('div', { class: 'row', style: 'align-items:flex-start;gap:18px;flex-wrap:wrap' }, donut(pct),
          h('div', { class: 'bars grow', style: 'min-width:220px' }, Object.entries(cats).map(([name, c]) => h('div', { class: 'bar' }, h('span', {}, name), bar((c.got / c.budget) * 100), h('span', { class: 'num muted' }, `${Math.round((c.got / c.budget) * 100)}%`)))))
          : empty('gift', 'Start your wishlist', 'Add the first thing you are dreaming of.', h('button', { class: 'btn primary', onclick: () => itemForm() }, icon('plus'), 'Add an item'))),
      h('div', { class: 'card' }, h('h3', { style: 'margin-bottom:12px' }, 'Recent contributions'),
        recent.length ? h('div', { class: 'list' }, recent.map((c) => h('div', { class: 'rowcard click', onclick: () => money.paymentSheet(ctx, c.kind, c) }, h('div', { class: 'who' }, initials(c.guestName)),
          h('div', { class: 'grow' }, h('b', {}, c.guestName), h('div', { class: 'small muted' }, `${c.itemName || 'Lifafa'} · ${ago(c.updatedAt)}`)), h('div', { style: 'text-align:right' }, h('b', { class: 'num' }, inr(c.verifiedAmount || c.amount)), h('div', {}, statusBadge(c.status))))))
          : empty('wallet', 'No contributions yet', 'Share your wishlist link to get started.', h('a', { class: 'btn', href: '#share' }, 'Share wishlist')))),
  ];
}

// ---------------------------------------------------------------- wishlist
let filter = 'all';
function itemForm(it) {
  const v0 = it || { priority: 'medium', category: CATEGORIES[0] };
  const custom = !!it && !CATEGORIES.includes(it.category);
  const catCustom = input({ name: 'categoryCustom', value: custom ? it.category : '', placeholder: 'Name your category', maxlength: 40, class: `in${custom ? '' : ' hide'}` });
  const catSel = select({ name: 'categorySel', value: custom ? '__custom' : v0.category, onchange: (e) => catCustom.classList.toggle('hide', e.target.value !== '__custom') }, [...CATEGORIES, ['__custom', 'Custom category…']]);
  const img = input({ name: 'imageUrl', value: v0.imageUrl || '', placeholder: 'https://… link to a picture (optional)', inputmode: 'url' });
  const form = h('div', { class: 'form' },
    field('Item name', input({ name: 'name', value: v0.name || '', maxlength: 80, placeholder: 'e.g. Honeymoon in Switzerland' })),
    h('div', { class: 'two' }, field('Category', h('div', { class: 'col', style: 'gap:8px' }, catSel, catCustom)), field('Estimated budget (₹)', input({ name: 'budget', type: 'number', inputmode: 'numeric', min: 1, value: v0.budget || '' }))),
    field('Description', input({ name: 'description', rows: 3, maxlength: 600, value: v0.description || '' })),
    field('Picture link', img, 'Paste the address of an image, for example from the product page. Leave empty for a colourful category tile.'),
    h('div', { class: 'two' }, field('Preferred brand', input({ name: 'brand', value: v0.brand || '', maxlength: 60 })), field('Preferred model', input({ name: 'model', value: v0.model || '', maxlength: 80 }))),
    field('Product link', input({ name: 'productLink', value: v0.productLink || '', placeholder: 'https://…', inputmode: 'url' })),
    h('div', { class: 'two' }, field('Priority', select({ name: 'priority', value: v0.priority }, [['high', 'High: most wanted'], ['medium', 'Medium'], ['low', 'Low']])),
      h('div', { style: 'align-self:end;padding-bottom:10px' }, check('hidden', 'Hide from guests for now', v0.visibility === 'hidden'))),
    it && it.stats.verified > 0 && h('div', { class: 'note info' }, `${inr(it.stats.verified)} has already been received for this item. Changing the budget only changes what remains; past contributions are never altered.`));
  const m = modal({
    title: it ? 'Edit item' : 'Add to wishlist', wide: true, body: form,
    actions: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancel'), h('button', {
      class: 'btn primary', onclick: async (e) => {
        const v = vals(form);
        const r = await run(e.currentTarget, () => backend.call('saveItem', { id: it?.id, name: v.name, description: v.description, category: v.categorySel === '__custom' ? v.categoryCustom : v.categorySel,
          budget: v.budget, imageUrl: v.imageUrl, brand: v.brand, model: v.model, productLink: v.productLink, priority: v.priority, visibility: v.hidden ? 'hidden' : 'public' }));
        if (r) { m.close(); toast(it ? 'Item updated' : 'Item added', 'ok'); }
      },
    }, 'Save item')],
  });
}
function itemActions(it) {
  const act = (label, iconName, fn, cls = 'ghost') => h('button', { class: `btn ${cls} block`, onclick: async (e) => { if ((await fn(e.currentTarget)) !== false) m.close(); } }, icon(iconName), label);
  const status = (action, done) => (btn) => run(btn, () => backend.call('setItemStatus', { id: it.id, action })).then((r) => (r ? toast(done, 'ok') : false));
  const m = modal({
    title: it.name,
    body: h('div', { class: 'col' },
      act('Edit details and budget', 'edit', () => itemForm(it)),
      it.state === 'COMPLETED' ? act('Reopen this item', 'refresh', status('reopen', 'Item reopened')) : act('Mark as fulfilled', 'check', status('fulfil', 'Marked as fulfilled'), 'mint'),
      act('Delete item', 'trash', async (btn) => {
        if (!(await confirmBox('Delete this item?', it.stats.verified ? `Guests have contributed ${inr(it.stats.verified)} to it. The item will be removed from your wishlist, but those contribution records are kept.` : 'It will be removed from your wishlist.', 'Delete', true))) return false;
        return (await run(btn, () => backend.call('deleteItem', { id: it.id }))) ? toast('Item deleted', 'ok') : false;
      }, 'danger')),
  });
}
function wishlist() {
  const items = liveItems().sort((a, z) => z.createdAt - a.createdAt);
  const shown = items.filter((i) => filter === 'all' || (filter === 'open' && i.state !== 'COMPLETED') || (filter === 'done' && i.state === 'COMPLETED') || (filter === 'hidden' && i.visibility === 'hidden'));
  const exportCsv = () => download(new Blob([toCsv([['Item', 'Category', 'Budget', 'Verified', 'Pending', 'Remaining', 'Status', 'Priority', 'Visible to guests', 'Brand', 'Model', 'Link', 'Added on'],
    ...items.map((i) => [i.name, i.category, i.budget, i.stats.verified, i.stats.pending, Math.max(0, i.budget - i.stats.verified), i.state, i.priority, i.visibility === 'public' ? 'Yes' : 'No', i.brand, i.model, i.productLink, fmtDate(i.createdAt)])])], { type: 'text/csv' }), 'wishlist.csv');
  return [
    h('div', { class: 'row between wrap', style: 'margin-bottom:12px' },
      h('div', { class: 'chips' }, [['all', 'All'], ['open', 'Open'], ['done', 'Completed'], ['hidden', 'Hidden']].map(([v, l]) => h('button', { class: `chip${filter === v ? ' on' : ''}`, onclick: () => { filter = v; render(true); } }, l))),
      h('div', { class: 'row' }, items.length ? h('button', { class: 'btn ghost sm', onclick: exportCsv }, icon('download', 16), 'Export') : null, h('button', { class: 'btn primary sm', onclick: () => itemForm() }, icon('plus', 16), 'Add item'))),
    shown.length ? h('div', { class: 'list' }, shown.map((i) => {
      const p = i.budget ? (i.stats.verified / i.budget) * 100 : 0;
      return h('div', { class: 'rowcard click', onclick: () => itemActions(i) }, h('div', { class: 'thumb' }, cover(i)),
        h('div', { class: 'grow col', style: 'gap:6px' }, h('div', { class: 'row wrap', style: 'gap:6px' }, h('b', {}, i.name), i.state === 'COMPLETED' && h('span', { class: 'badge ok' }, 'Completed'), i.state === 'RESERVED' && h('span', { class: 'badge warn' }, 'Reserved'), i.visibility === 'hidden' && h('span', { class: 'badge plain' }, 'Hidden')),
          h('div', { class: 'small muted num' }, `${inr(i.stats.verified)} of ${inr(i.budget)} · ${inr(Math.max(0, i.budget - i.stats.verified))} remaining${i.stats.pending ? ` · ${inr(i.stats.pending)} pending` : ''}`),
          bar(p, i.budget ? (i.stats.pending / i.budget) * 100 : 0)), icon('more'));
    })) : empty('gift', items.length ? 'Nothing in this view' : 'Your wishlist is empty', items.length ? 'Try another filter.' : 'Add everything you need or dream of: a honeymoon, a mixer, a down payment.', h('button', { class: 'btn primary', onclick: () => itemForm() }, icon('plus'), 'Add your first item')),
  ];
}

// ---------------------------------------------------------------- shell
const VIEWS = {
  overview, wishlist, contributions: () => money.payments(ctx, 'item'), lifafa: () => money.payments(ctx, 'lifafa'), groups: () => money.groups(ctx), cards: () => money.cards(ctx),
  reservations: () => social.reservations(ctx), messages: () => social.messages(ctx), share: () => social.share(ctx), settings: () => social.settings(ctx),
};
let main;
let lastBadges = null;
function render(force) {
  if (!D.couple) return;
  // do not redraw under someone who is typing in a form on the page
  if (!force && main && main.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return;
  const sec = current();
  const b = badges();
  const [, title] = SECTIONS.find((s) => s[0] === sec);
  const dot = (id) => (b[id] ? h('span', { class: 'dot' }, b[id]) : null);
  const scroll = window.scrollY;
  main = h('main', { class: 'main' },
    h('div', { class: 'main-head' }, h('div', {}, h('div', { class: 'small muted' }, ctx.names()), h('h1', { style: 'font-size:clamp(24px,5vw,32px)' }, title)),
      h('a', { class: 'btn ghost sm', href: publicUrl(D.couple.slug), target: '_blank', rel: 'noopener' }, icon('eye', 16), 'View public page')),
    VIEWS[sec]());
  const moreSheet = () => {
    const m = modal({ title: 'More', body: h('div', { class: 'col', style: 'gap:4px' }, SECTIONS.map(([id, label, ic]) => h('button', { class: `navlink${sec === id ? ' on' : ''}`, onclick: () => { m.close(); go(id); } }, icon(ic), label, dot(id)))) });
  };
  app.replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'side' }, brand('#overview'), SECTIONS.map(([id, label, ic]) => h('a', { class: `navlink${sec === id ? ' on' : ''}`, href: `#${id}` }, icon(ic), label, dot(id))),
      h('div', { class: 'grow' }), h('button', { class: 'navlink', onclick: logout }, icon('logout'), 'Sign out')),
    main,
    h('nav', { class: 'bottom', 'aria-label': 'Main' }, [['overview', 'Home', 'home'], ['wishlist', 'Wishlist', 'gift'], ['contributions', 'Payments', 'wallet'], ['messages', 'Messages', 'chat']].map(([id, label, ic]) =>
      h('button', { class: sec === id ? 'on' : '', onclick: () => go(id) }, icon(ic, 22), label, dot(id))),
    h('button', { class: ['overview', 'wishlist', 'contributions', 'messages'].includes(sec) ? '' : 'on', onclick: moreSheet }, icon('more', 22), 'More', b.lifafa + b.reservations ? h('span', { class: 'dot' }, b.lifafa + b.reservations) : null))));
  window.scrollTo(0, force === 'nav' ? 0 : scroll);
  // notify only about things that arrive after the first full load
  if (lastBadges) {
    if (b.contributions + b.lifafa > lastBadges.contributions + lastBadges.lifafa) toast('A guest has reported a new payment', 'ok');
    if (b.messages > lastBadges.messages) toast('You have a new message', 'ok');
  }
  if (loaded.size >= 9) lastBadges = b;
}
async function logout() {
  await backend.signOut();
  location.href = site('login.html');
}
function forcePasswordChange() {
  const form = h('div', { class: 'form' }, h('p', { class: 'muted' }, 'Your account was set up with a temporary password. Please choose your own before continuing.'),
    field('Temporary password', input({ name: 'current', type: 'password', autocomplete: 'current-password' })), field('New password', input({ name: 'next', type: 'password', autocomplete: 'new-password' }), 'At least 8 characters, with a letter and a number.'));
  const m = modal({ title: 'Set your password', locked: true, body: form, actions: [h('button', { class: 'btn primary', onclick: async (e) => {
    const v = vals(form);
    if ((await run(e.currentTarget, () => backend.changePassword(v.current, v.next).then(() => true))) !== true) return;
    m.close();
    toast('Password updated', 'ok');
  } }, 'Save password')] });
}

const loaded = new Set();
const bind = (key, path) => backend.watch(path, (v) => { D[key] = v || (key === 'couple' || key === 'pay' ? null : {}); loaded.add(key); render(); });
bind('couple', `couples/${cid}`);
bind('items', `wishlists/${cid}`);
bind('contributions', `contributions/${cid}`);
bind('lifafa', `lifafa/${cid}`);
bind('conversations', `conversations/${cid}`);
bind('reservations', `reservations/${cid}`);
bind('groups', `groupGifts/${cid}`);
bind('cards', `thankYouCards/${cid}`);
bind('pay', `paymentSettings/${cid}`);
addEventListener('hashchange', () => {
  document.querySelectorAll('.overlay').forEach((o) => o.remove()); // close any open sheet when moving to another section
  document.body.style.overflow = '';
  render('nav');
});
backend.call('session').then((s) => s.mustChangePassword && forcePasswordChange()).catch(async () => { await backend.signOut(); location.replace(site('login.html')); });
