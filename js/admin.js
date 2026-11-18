// Admin panel: create and manage couple accounts, oversee payments, read the
// activity log, change platform settings.
import { backend } from './backend.js';
import {
  boot, requireRole, h, icon, inr, ago, fmtDate, entries, empty, loader, brand, modal, toast, run, confirmBox, field, input, select, check, vals, copy, initials, site, publicUrl, statusBadge, STATUS,
} from './ui.js';
import { askForm } from './dash-money.js';

const app = boot('Admin');
app.replaceChildren(loader());
await requireRole('admin');
const D = { couples: {}, stats: {}, logs: {}, settings: {}, contributions: {}, lifafa: {} };
const SECTIONS = [['overview', 'Overview', 'chart'], ['couples', 'Couples', 'users'], ['payments', 'Payments', 'wallet'], ['activity', 'Audit log', 'list'], ['settings', 'Settings', 'settings']];
const current = () => (SECTIONS.some((s) => s[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
const namesOf = (c) => (c ? `${c.partner1} & ${c.partner2}` : 'Unknown couple');
/** Every payment report still waiting for its couple, across all couples. */
const queue = () => ['contributions', 'lifafa'].flatMap((node) => Object.entries(D[node] || {}).flatMap(([coupleId, list]) => entries(list).filter((x) => x.status === 'PENDING_VERIFICATION')
  .map((x) => ({ ...x, coupleId, kind: node === 'lifafa' ? 'lifafa' : 'item' })))).sort((a, z) => a.updatedAt - z.updatedAt);
const newPassword = () => `Shaadi${Math.floor(1000 + Math.random() * 9000)}${'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]}`;

function overview() {
  const all = Object.values(D.stats || {});
  const sum = (key) => all.reduce((s, c) => s + (c[key] || 0), 0);
  const couples = Object.values(D.couples || {});
  const waiting = queue();
  const stat = (label, value, hl) => h('div', { class: `stat${hl ? ' hl' : ''}` }, h('small', {}, label), h('b', { class: 'num' }, value));
  const logs = entries(D.logs).sort((a, z) => z.at - a.at).slice(0, 8);
  return [h('div', { class: 'stats' }, stat('Registered couples', couples.length), stat('Active couples', couples.filter((c) => c.status === 'active').length), stat('Wishlist items', sum('items')), stat('Total wishlist budget', inr(sum('budget'))),
    stat('Verified contributions', inr(sum('verified')), true), stat('Pending verification', inr(waiting.reduce((s, x) => s + x.amount, 0))), stat('Total Lifafa', inr(sum('lifafaVerified'))), stat('Payments waiting', waiting.length)),
  h('div', { class: 'card', style: 'margin-top:16px' }, h('h3', { style: 'margin-bottom:10px' }, 'Recent activity'), logs.length ? logRows(logs) : h('p', { class: 'muted' }, 'Nothing yet.'))];
}
const logRows = (logs) => h('div', { class: 'list' }, logs.map((l) => h('div', { class: 'row between small', style: 'gap:12px;align-items:flex-start' },
  h('div', {}, h('b', {}, l.action), h('div', { class: 'muted', style: 'overflow-wrap:anywhere' }, `${l.role}${Object.keys(l.details || {}).length ? ` · ${Object.entries(l.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')}` : ''}`)),
  h('span', { class: 'muted', style: 'white-space:nowrap' }, fmtDate(l.at, true)))));

function coupleForm(c) {
  const pw = input({ name: 'password', value: newPassword(), autocomplete: 'off' });
  const form = h('div', { class: 'form' },
    h('div', { class: 'two' }, field('Partner 1 name', input({ name: 'partner1', value: c?.partner1 || '', maxlength: 40 })), field('Partner 2 name', input({ name: 'partner2', value: c?.partner2 || '', maxlength: 40 }))),
    h('div', { class: 'two' }, field('Mobile number (login)', input({ name: c ? null : 'mobile', value: c?.mobile || '', inputmode: 'numeric', maxlength: 14, disabled: !!c }), c ? 'To change it, use "New login".' : null), field('Wedding date', input({ name: 'weddingDate', type: 'date', value: c?.weddingDate || '' }))),
    !c && field('Initial password', pw, 'The couple must replace this the first time they sign in.'),
    !c && field('Account status', select({ name: 'status', value: 'active' }, [['active', 'Active'], ['inactive', 'Inactive']])));
  const m = modal({ title: c ? 'Edit couple' : 'Create couple account', wide: true, body: form, actions: [h('button', { class: 'btn primary', onclick: async (e) => {
    const v = vals(form);
    const r = await run(e.currentTarget, () => backend.call(c ? 'adminUpdateCouple' : 'adminCreateCouple', c ? { coupleId: c.id, ...v } : v));
    if (!r) return;
    m.close();
    if (c) return toast('Couple updated', 'ok');
    const text = `Your ${document.title.split(' · ')[1]} account is ready.\nLogin: ${site('login.html')}\nMobile: ${v.mobile}\nTemporary password: ${v.password}\nYour wishlist: ${publicUrl(r.slug)}`;
    modal({ title: 'Account created', body: h('div', { class: 'col' }, h('p', {}, `${r.names} can now sign in. Send them these details privately.`), h('pre', { class: 'note info', style: 'white-space:pre-wrap;font:inherit;margin:0' }, text)),
      actions: [h('button', { class: 'btn primary', onclick: () => copy(text, 'Details copied') }, icon('copy'), 'Copy details')] });
    return undefined;
  } }, c ? 'Save changes' : 'Create account')] });
}

async function coupleSheet(c) {
  const [items, cons, lif, logs] = await Promise.all(['wishlists', 'contributions', 'lifafa', 'auditLogs'].map((n) => backend.get(`${n}/${c.id}`)));
  const s = D.stats[c.id] || {};
  const pay = (list, kind) => entries(list).filter((x) => x.status !== 'INITIATED').sort((a, z) => z.updatedAt - a.updatedAt).map((x) => h('div', { class: 'row between small' },
    h('span', {}, `${x.guestName} · ${x.itemName || 'Lifafa'}${x.utr ? ` · UTR ${x.utr}` : ''}`), h('span', { class: 'row' }, h('b', { class: 'num' }, inr(x.verifiedAmount || x.amount)), statusBadge(x.status),
      x.status === 'PENDING_VERIFICATION' ? h('button', { class: 'btn sm', onclick: () => settle({ id: x.id, coupleId: c.id, kind, amount: x.amount, guestName: x.guestName }) }, 'Review') : null)));
  const sec = (title, rows) => h('details', {}, h('summary', { style: 'cursor:pointer;font-weight:700' }, `${title} (${rows.length})`), h('div', { class: 'col', style: 'gap:6px;margin-top:8px' }, rows.length ? rows : h('span', { class: 'small muted' }, 'None')));
  const act = (label, cls, fn) => h('button', { class: `btn ${cls} sm`, onclick: fn }, label);
  const m = modal({
    title: namesOf(c), wide: true,
    body: h('div', { class: 'col' },
      h('dl', { class: 'kv' }, h('dt', {}, 'Couple ID'), h('dd', {}, c.id), h('dt', {}, 'Mobile'), h('dd', {}, c.mobile), h('dt', {}, 'Wishlist link'), h('dd', {}, h('a', { href: publicUrl(c.slug), target: '_blank', rel: 'noopener' }, c.slug)),
        h('dt', {}, 'Status'), h('dd', {}, c.status), h('dt', {}, 'Last sign-in'), h('dd', {}, c.lastLoginAt ? fmtDate(c.lastLoginAt, true) : 'Never'), h('dt', {}, 'Wishlist budget'), h('dd', {}, inr(s.budget)),
        h('dt', {}, 'Verified contributions'), h('dd', {}, inr(s.verified)), h('dt', {}, 'Lifafa'), h('dd', {}, inr(s.lifafaVerified))),
      h('div', { class: 'row wrap' }, act('Edit', '', () => { m.close(); coupleForm(c); }),
        act(c.status === 'active' ? 'Deactivate' : 'Activate', c.status === 'active' ? 'danger' : 'mint', async (e) => {
          const to = c.status === 'active' ? 'inactive' : 'active';
          if (to === 'inactive' && !(await confirmBox('Deactivate this account?', 'The couple is signed out at once and their public wishlist goes offline. No data is deleted.', 'Deactivate', true))) return;
          if (await run(e.currentTarget, () => backend.call('adminSetCoupleStatus', { coupleId: c.id, status: to }))) { toast(`Account ${to}`, 'ok'); m.close(); }
        }),
        act('New login', 'ghost', async () => {
          const v = await askForm('Give this couple a new login', [
            h('div', { class: 'note' }, 'Use this for a forgotten password or a new mobile number. If the mobile number stays the same, first delete the old login in the Firebase console: Authentication → Users → find the number → Delete account. The couple keeps all their data.'),
            field('Mobile number', input({ name: 'mobile', value: c.mobile, inputmode: 'numeric', maxlength: 14 })), field('Temporary password', input({ name: 'password', value: newPassword() }), 'They must change it at their next sign-in.')], 'Create new login');
          if (v && (await run(null, () => backend.call('adminNewLogin', { coupleId: c.id, ...v })))) { copy(`Mobile: ${v.mobile}\nTemporary password: ${v.password}`, 'New login created and copied'); m.close(); }
        }),
        act('Recalculate totals', 'ghost', (e) => run(e.currentTarget, () => backend.call('recalculateTotals', { coupleId: c.id })).then((r) => r && toast('Totals rebuilt', 'ok')))),
      sec('Wishlist', entries(items).filter((i) => !i.deleted).map((i) => h('div', { class: 'row between small' }, h('span', {}, `${i.name} · ${i.state.toLowerCase()}`), h('span', { class: 'num' }, `${inr(i.stats.verified)} of ${inr(i.budget)}`)))),
      sec('Contributions', pay(cons, 'item')), sec('Lifafa', pay(lif, 'lifafa')),
      sec('Account activity', [logRows(entries(logs).sort((a, z) => z.at - a.at).slice(0, 40))].filter(() => logs))),
  });
}

function couples() {
  const list = entries(D.couples).sort((a, z) => z.createdAt - a.createdAt);
  const rows = h('div', { class: 'list' }, list.map((c) => {
    const s = D.stats[c.id] || {};
    return h('div', { class: 'rowcard click', 'data-q': `${namesOf(c)} ${c.mobile} ${c.slug}`.toLowerCase(), onclick: (e) => run(e.currentTarget, () => coupleSheet(c)) }, h('div', { class: 'who' }, initials(namesOf(c).replace('& ', ''))),
      h('div', { class: 'grow' }, h('b', {}, namesOf(c)), h('div', { class: 'small muted' }, `${c.mobile} · ${s.items || 0} items · ${inr(s.verified)} of ${inr(s.budget)}`)),
      h('span', { class: `badge ${c.status === 'active' ? 'ok' : 'plain'}` }, c.status));
  }));
  return [h('div', { class: 'row', style: 'margin-bottom:12px' }, input({ placeholder: 'Search by name, mobile or link', 'aria-label': 'Search couples', oninput: (e) => rows.childNodes.forEach((r) => r.classList.toggle('hide', !r.dataset.q.includes(e.target.value.toLowerCase()))) }),
    h('button', { class: 'btn primary', style: 'white-space:nowrap', onclick: () => coupleForm() }, icon('plus'), 'New couple')),
  list.length ? rows : empty('users', 'No couples yet', 'Create the first couple account to get started.', h('button', { class: 'btn primary', onclick: () => coupleForm() }, 'Create couple account'))];
}

async function settle(p) {
  const v = await askForm(`${p.guestName} · ${inr(p.amount)}`, [h('p', { class: 'muted' }, 'Admin override for a disputed payment. This is recorded in the audit log under your name.'),
    field('Decision', select({ name: 'decision', value: 'verify' }, [['verify', 'Verify: the money was received'], ['reject', 'Reject: no such payment']])), field('Note or reason', input({ name: 'note', maxlength: 200 }))], 'Apply');
  if (!v) return;
  const data = { id: p.id, kind: p.kind, coupleId: p.coupleId };
  const r = await run(null, () => (v.decision === 'verify' ? backend.call('verifyContribution', { ...data, note: v.note }) : backend.call('rejectContribution', { ...data, reason: v.note || 'Rejected by administrator' })));
  if (r) toast('Payment updated', 'ok');
}
function payments() {
  const waiting = queue();
  return [h('p', { class: 'muted', style: 'margin-bottom:12px' }, 'Couples verify their own payments against their bank statements. Step in here only when a couple or a guest asks you to settle a dispute.'),
    waiting.length ? h('div', { class: 'list' }, waiting.map((x) => h('div', { class: 'rowcard' }, h('div', { class: 'who' }, initials(x.guestName)),
      h('div', { class: 'grow' }, h('b', {}, `${x.guestName} · ${inr(x.amount)}`), h('div', { class: 'small muted' }, `${namesOf(D.couples[x.coupleId])} · ${x.itemName || 'Lifafa'} · UTR ${x.utr} · ${ago(x.updatedAt)}`)),
      h('button', { class: 'btn sm', onclick: () => settle(x) }, 'Review')))) : empty('wallet', 'No payments are waiting', 'Every reported payment has been verified or rejected by its couple.')];
}

function settings() {
  const s = { suggestedAmounts: [500, 1000, 2000, 5000, 10000], lifafaAmounts: [501, 1101, 2101, 5001, 11000], minAmount: 1, maxAmount: 100000, ...(D.settings || {}) };
  const nums = (t) => String(t).split(/[,\s]+/).filter(Boolean).map(Number);
  const form = h('div', { class: 'form' },
    check('maintenance', 'Maintenance mode: pause all guest actions (couples and admin keep working)', !!s.maintenance), field('Message shown to guests during maintenance', input({ name: 'maintenanceMessage', value: s.maintenanceMessage || '', maxlength: 200 })),
    h('div', { class: 'two' }, field('Suggested contribution amounts (₹)', input({ name: 'suggestedAmounts', value: s.suggestedAmounts.join(', ') })), field('Suggested Lifafa amounts (₹)', input({ name: 'lifafaAmounts', value: s.lifafaAmounts.join(', ') }))),
    h('div', { class: 'two' }, field('Minimum amount (₹)', input({ name: 'minAmount', type: 'number', value: s.minAmount })), field('Maximum amount (₹)', input({ name: 'maxAmount', type: 'number', value: s.maxAmount }), 'UPI usually allows ₹1,00,000 per transaction.')),
    field('Support contact shown to users', input({ name: 'supportContact', value: s.supportContact || '', maxlength: 120 })),
    h('button', { class: 'btn primary', onclick: (e) => { const v = vals(form); run(e.currentTarget, () => backend.call('adminSaveSettings', { ...v, suggestedAmounts: nums(v.suggestedAmounts), lifafaAmounts: nums(v.lifafaAmounts) })).then((r) => r && toast('Settings saved', 'ok')); } }, 'Save settings'));
  return h('div', { class: 'card', style: 'max-width:760px' }, form);
}

const VIEWS = { overview, couples, payments, activity: () => h('div', { class: 'card' }, logRows(entries(D.logs).sort((a, z) => z.at - a.at).slice(0, 150))), settings };
let main;
function render(force) {
  if (!force && main && main.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return;
  const sec = current();
  const dots = { payments: queue().length };
  const link = (tag, [id, label, ic], extra = {}) => h(tag, { class: tag === 'a' ? `navlink${sec === id ? ' on' : ''}` : sec === id ? 'on' : '', ...extra }, icon(ic, tag === 'a' ? 20 : 22), label, dots[id] ? h('span', { class: 'dot' }, dots[id]) : null);
  const out = async () => { await backend.signOut(); location.href = site('login.html'); };
  main = h('main', { class: 'main' }, h('div', { class: 'main-head' }, h('div', {}, h('div', { class: 'small muted' }, 'Platform administration'), h('h1', { style: 'font-size:clamp(24px,5vw,32px)' }, SECTIONS.find((s) => s[0] === sec)[1])),
    h('button', { class: 'btn ghost sm', onclick: out }, icon('logout', 16), 'Sign out')), VIEWS[sec]());
  app.replaceChildren(h('div', { class: 'shell' }, h('aside', { class: 'side' }, brand('#overview'), SECTIONS.map((s) => link('a', s, { href: `#${s[0]}` }))), main,
    h('nav', { class: 'bottom', 'aria-label': 'Main' }, SECTIONS.map((s) => link('button', s, { onclick: () => { location.hash = s[0]; } })))));
}
const bind = (key, path) => backend.watch(path, (v) => { D[key] = v || {}; render(); });
bind('couples', 'couples'); bind('stats', 'coupleStats'); bind('contributions', 'contributions'); bind('lifafa', 'lifafa'); bind('logs', 'auditLogs/_platform'); bind('settings', 'publicSettings');
addEventListener('hashchange', () => {
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  document.body.style.overflow = '';
  render(true);
});
