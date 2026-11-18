// Public wedding wishlist: what a guest sees after tapping the WhatsApp link or
// scanning the QR code. No login. Reads only the public* database nodes.
import { backend } from './backend.js';
import { mine, remember, guestName } from './guest-store.js';
import {
  boot, h, icon, inr, fmtDate, ago, initials, first, safeUrl, params, entries, cover, empty, loader, brand, footer, modal, toast, run, field, input, check, vals,
  share, copy, download, qrCanvas, canvasBlob, publicUrl, pageUrl, waLink, statusBadge, FUNDS,
} from './ui.js';

const app = boot('Wedding wishlist');
const slug = (params().get('w') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const state = { profile: null, items: {}, feed: {}, groups: {}, cat: 'All', show: 'all', sort: 'priority', mine: {} };
let coupleId = null;
let opened = false;

const names = () => `${first(state.profile.partner1)} & ${first(state.profile.partner2)}`;
const link = () => publicUrl(slug);

function countdown(date) {
  const ms = new Date(`${date}T00:00:00`).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return h('span', { class: 'badge', style: 'background:rgba(255,255,255,.25);color:#fff' }, 'Just married');
  const d = Math.floor(ms / 864e5);
  const hrs = Math.floor((ms % 864e5) / 36e5);
  const min = Math.floor((ms % 36e5) / 6e4);
  return h('div', { class: 'count', 'aria-label': `${d} days to the wedding` }, [[d, 'days'], [hrs, 'hours'], [min, 'mins']].map(([n, l]) => h('div', {}, h('b', { class: 'num' }, n), h('span', {}, l))));
}

function shareSheet(title, url, text) {
  const qr = qrCanvas(url);
  modal({
    title,
    body: h('div', { class: 'col center' }, h('div', { class: 'qr-box', style: 'margin:0 auto' }, qr), h('p', { class: 'small muted', style: 'overflow-wrap:anywhere' }, url)),
    actions: [
      h('a', { class: 'btn mint', href: waLink(`${text} ${url}`), target: '_blank', rel: 'noopener' }, icon('chat'), 'WhatsApp'),
      h('button', { class: 'btn', onclick: () => copy(url, 'Link copied') }, icon('copy'), 'Copy link'),
      h('button', { class: 'btn ghost', onclick: async () => download(await canvasBlob(qr), 'wishlist-qr.png') }, icon('download'), 'Download QR'),
      navigator.share && h('button', { class: 'btn ghost', onclick: () => share({ title, text, url }) }, icon('share'), 'More'),
    ],
  });
}

// ------------------------------------------------------------ guest actions
function nameField() {
  return field('Your name', input({ name: 'guestName', value: guestName.get(), maxlength: 60, autocomplete: 'name', placeholder: 'e.g. Neha Kapoor' }));
}
function startConversation(title, intro, action, extra, defaults = {}) {
  const form = h('div', { class: 'form' }, intro && h('p', { class: 'muted' }, intro), nameField(),
    field('Message', input({ name: 'message', rows: 4, maxlength: 1000, value: defaults.message || '' })),
    defaults.askPublic && check('isPublic', 'Show my wishes on the wishlist page (after the couple approves)', true));
  const m = modal({
    title, body: form,
    actions: [h('button', {
      class: 'btn primary', onclick: async (e) => {
        const v = vals(form);
        const r = await run(e.currentTarget, () => backend.call(action, { coupleId, ...extra, ...v }));
        if (!r) return;
        guestName.set(v.guestName);
        remember(coupleId, 'threads', r.token);
        m.close();
        location.href = pageUrl('conversation.html', { t: r.token });
      },
    }, icon('send'), 'Send')],
  });
}
function groupSheet(id, it) {
  const form = h('div', { class: 'form' },
    h('p', { class: 'muted' }, `Start a group for "${it.name}" and share the link. Each friend pays their own share directly to the couple. No one needs an account.`),
    nameField(), field('Group name (optional)', input({ name: 'title', maxlength: 60, placeholder: 'e.g. College friends' })));
  const m = modal({
    title: 'Contribute with friends', body: form,
    actions: [h('button', {
      class: 'btn primary', onclick: async (e) => {
        const v = vals(form);
        const r = await run(e.currentTarget, () => backend.call('createGroupGift', { coupleId, itemId: id, organizerName: v.guestName, title: v.title }));
        if (!r) return;
        guestName.set(v.guestName);
        m.close();
        location.href = pageUrl('contribution.html', { w: slug, item: id, g: r.groupGiftId, new: 1 });
      },
    }, icon('users'), 'Create group link')],
  });
}
function giftChoice(id, it) {
  const m = modal({
    title: 'I want to gift this item',
    body: h('div', { class: 'col' },
      h('button', { class: 'rowcard click', onclick: () => { m.close(); startConversation('Buy it yourself', 'Tell the couple you would like to buy this. They will reply with the brand and model they prefer. The item is reserved only when you confirm.', 'startGift', { itemId: id }, { message: `Hi! I would love to gift you this ${it.name.toLowerCase()}. Which brand and model would you prefer?` }); } },
        h('div', { class: 'who' }, icon('bag')), h('div', { class: 'grow', style: 'text-align:left' }, h('b', {}, 'Buy the exact product'), h('div', { class: 'small muted' }, 'Chat with the couple about brand and model, then reserve it.'))),
      h('a', { class: 'rowcard click', style: 'text-decoration:none;color:inherit', href: pageUrl('contribution.html', { w: slug, item: id, full: 1 }) },
        h('div', { class: 'who', style: 'background:var(--g-gold)' }, icon('wallet')), h('div', { class: 'grow' }, h('b', {}, `Pay the full amount · ${inr(it.budget)}`), h('div', { class: 'small muted' }, 'Send the money by UPI and let the couple buy it.')))),
  });
}

function itemSheet(id) {
  const it = state.items[id];
  if (!it) return;
  const open = it.state === 'OPEN';
  const product = !FUNDS.includes(it.category);
  const url = pageUrl('public-wishlist.html', { w: slug, item: id });
  const groups = entries(state.groups).filter((g) => g.itemId === id && !g.completedAt);
  const m = modal({
    title: it.name, wide: true,
    body: h('div', { class: 'col' },
      h('div', { style: 'border-radius:18px;overflow:hidden' }, cover(it)),
      it.description && h('p', {}, it.description),
      (it.brand || it.model) && h('p', { class: 'small' }, h('b', {}, 'Preferred: '), [it.brand, it.model].filter(Boolean).join(' · ')),
      safeUrl(it.productLink) && h('a', { class: 'small', href: it.productLink, target: '_blank', rel: 'noopener noreferrer' }, 'View the product ↗'),
      h('div', { class: 'card flat row between num' }, h('small', {}, 'Budget'), h('b', {}, inr(it.budget))),
      it.state === 'RESERVED' && h('div', { class: 'note info' }, 'A guest has reserved this gift, so it is not open for contributions right now.'),
      it.state === 'COMPLETED' && h('div', { class: 'note ok' }, 'This wish has been fulfilled. Thank you!'),
      groups.map((g) => h('a', { class: 'rowcard click', style: 'text-decoration:none;color:inherit', href: pageUrl('contribution.html', { w: slug, item: id, g: g.id }) }, h('div', { class: 'who' }, icon('users')),
        h('div', { class: 'grow' }, h('b', {}, g.title || `${g.organizer}'s group`), h('div', { class: 'small muted' }, `Started by ${g.organizer}`)), icon('arrow'))),
      open && h('div', { class: 'col' },
        h('a', { class: 'btn primary block caps', href: pageUrl('contribution.html', { w: slug, item: id }) }, 'Contribute now'),
        product && it.giftable !== false && h('button', { class: 'btn gold block caps', onclick: () => { m.close(); giftChoice(id, it); } }, icon('gift'), 'I want to gift this item'),
        h('button', { class: 'btn block caps', onclick: () => { m.close(); groupSheet(id, it); } }, icon('users'), 'Contribute with friends')),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm grow', onclick: () => { m.close(); startConversation('Ask the couple', `Your question about "${it.name}" goes privately to the couple.`, 'askQuestion', { itemId: id, type: 'question' }); } }, icon('chat'), 'Ask a question'),
        h('button', { class: 'btn ghost sm grow', onclick: () => shareSheet('Share this wish', url, `Let's gift ${names()} "${it.name}" together:`) }, icon('share'), 'Share'))),
  });
}

// ------------------------------------------------------------ page sections
function itemCard(it) {
  const done = it.state === 'COMPLETED';
  const product = !FUNDS.includes(it.category);
  const label = done ? 'Fulfilled' : it.state === 'RESERVED' ? 'Reserved' : product && it.giftable !== false ? 'Gift this item' : 'Contribute now';
  return h('article', { class: 'item', tabindex: 0, onclick: () => itemSheet(it.id), onkeydown: (e) => e.key === 'Enter' && itemSheet(it.id) },
    cover(it, h('div', { class: 'tags' }, h('span', { class: 'badge' }, it.category), done && h('span', { class: 'badge ok' }, icon('check', 13), 'Completed'), it.state === 'RESERVED' && h('span', { class: 'badge warn' }, 'Reserved'))),
    h('div', { class: 'item-body' }, h('h3', {}, it.name),
      h('div', { class: 'row between num' }, h('small', { class: 'muted' }, 'Budget'), h('b', {}, inr(it.budget))),
      h('button', { class: `btn block caps ${done || it.state === 'RESERVED' ? 'ghost' : 'primary'}`, tabindex: -1 }, label)));
}

function myGifts() {
  const m = mine(coupleId);
  const rows = [
    ...m.threads.map((t) => state.mine[`t${t}`] && { href: pageUrl('conversation.html', { t }), iconName: 'chat', title: state.mine[`t${t}`].itemName || 'Your wishes', sub: 'Conversation with the couple', unread: state.mine[`t${t}`].unreadGuest }),
    ...m.receipts.map((r) => state.mine[`r${r}`] && { href: pageUrl(state.mine[`r${r}`].kind === 'lifafa' ? 'lifafa.html' : 'contribution.html', { r }), iconName: 'wallet', title: `${inr(state.mine[`r${r}`].amount)} · ${state.mine[`r${r}`].itemName || 'Lifafa'}`, status: state.mine[`r${r}`].status }),
  ].filter(Boolean);
  if (!rows.length) return null;
  return h('section', {}, h('div', { class: 'section-title' }, h('h2', {}, 'Your gifts & chats')),
    h('div', { class: 'list' }, rows.map((r) => h('a', { class: 'rowcard click', href: r.href, style: 'text-decoration:none;color:inherit' }, h('div', { class: 'who' }, icon(r.iconName)),
      h('div', { class: 'grow' }, h('b', {}, r.title), r.sub && h('div', { class: 'small muted' }, r.sub)), r.status && statusBadge(r.status), r.unread ? h('span', { class: 'badge bad' }, `${r.unread} new`) : null))));
}

function render() {
  const p = state.profile;
  if (!p) return;
  if (!p.active) {
    app.replaceChildren(h('div', { class: 'wrap-page' }, h('div', { class: 'topbar' }, brand()), empty('lock', 'This wishlist is resting', 'The couple has taken their wishlist offline for now. Please check back later.')));
    return;
  }
  document.title = `${names()}'s wedding wishlist`;
  const all = entries(state.items);
  const cats = ['All', ...new Set(all.map((i) => i.category))];
  const order = { high: 0, medium: 1, low: 2 };
  const sorters = {
    priority: (a, b) => (a.state === 'COMPLETED') - (b.state === 'COMPLETED') || order[a.priority] - order[b.priority] || b.createdAt - a.createdAt,
    high: (a, b) => b.budget - a.budget, low: (a, b) => a.budget - b.budget, newest: (a, b) => b.createdAt - a.createdAt,
  };
  const list = all.filter((i) => (state.cat === 'All' || i.category === state.cat) && (state.show === 'all' || (state.show === 'done') === (i.state === 'COMPLETED'))).sort(sorters[state.sort]);
  const doneCount = all.filter((i) => i.state === 'COMPLETED').length;
  const feed = state.feed || {};
  const wall = entries(feed.wall).sort((a, b) => b.at - a.at).slice(0, 12);
  const photo = (url, name) => (safeUrl(url) ? h('img', { src: url, alt: name }) : h('div', {}, initials(name)));
  const set = (k, v) => { state[k] = v; render(); };

  app.replaceChildren(
    h('header', { class: 'hero' },
      h('div', { class: 'topbar' }, brand(), h('button', { class: 'iconbtn', 'aria-label': 'Share this wishlist', onclick: () => shareSheet('Share this wishlist', link(), `${names()} would love your blessings. Their wedding wishlist:`) }, icon('share'))),
      h('div', { class: 'hero-body' }, h('div', { class: 'duo' }, photo(p.photo1, p.partner1), photo(p.photo2, p.partner2)),
        h('h1', {}, first(p.partner1), h('em', {}, '&'), first(p.partner2)),
        h('p', {}, [p.weddingDate && fmtDate(`${p.weddingDate}T00:00:00`), p.location].filter(Boolean).join(' · ')),
        p.weddingDate && countdown(p.weddingDate),
        p.welcomeMessage && h('p', { style: 'max-width:520px;opacity:.95' }, p.welcomeMessage))),
    h('main', { class: 'wrap-page' },
      all.length ? h('div', { class: 'card lift row between' }, h('div', { class: 'small muted' }, 'Wishes fulfilled'), h('div', { class: 'num', style: 'font:600 24px var(--display)' }, `${doneCount} of ${all.length}`)) : null,
      myGifts(),
      h('div', { class: 'section-title' }, h('h2', {}, 'Our wishlist'),
        h('select', { class: 'in', style: 'width:auto;min-height:38px;padding:4px 10px;font-size:14px', 'aria-label': 'Sort', onchange: (e) => set('sort', e.target.value) },
          [['priority', 'Most wanted'], ['high', 'Budget: high to low'], ['low', 'Budget: low to high'], ['newest', 'Newest']].map(([v, l]) => h('option', { value: v, selected: state.sort === v }, l)))),
      h('div', { class: 'chips' }, cats.map((c) => h('button', { class: `chip${state.cat === c ? ' on' : ''}`, onclick: () => set('cat', c) }, c))),
      h('div', { class: 'chips', style: 'margin:4px 0 12px' }, [['all', 'All'], ['open', 'Pending'], ['done', 'Completed']].map(([v, l]) => h('button', { class: `chip${state.show === v ? ' on' : ''}`, onclick: () => set('show', v) }, l))),
      list.length ? h('div', { class: 'items' }, list.map(itemCard)) : empty('gift', all.length ? 'Nothing matches this filter' : 'The wishlist is being prepared', all.length ? 'Try a different category.' : `${names()} are still adding their wishes. Please check back soon.`),

      h('section', { style: 'margin-top:34px' }, h('div', { class: 'lifafa' }, icon('envelope', 44), h('h2', {}, 'A Little Extra Love – Lifafa ❤️'),
        h('p', { style: 'max-width:440px;opacity:.95' }, 'Not sure what to gift? Send your blessings directly to the couple.'),
        p.paymentsReady ? h('a', { class: 'btn gold caps', href: pageUrl('lifafa.html', { w: slug }) }, 'Send a Lifafa') : h('span', { class: 'badge' }, 'Opening soon'))),

      h('div', { class: 'section-title' }, h('h2', {}, 'Wishes for the couple'), h('button', { class: 'btn sm', onclick: () => startConversation('Send your wishes', '', 'askQuestion', { type: 'wish' }, { askPublic: true }) }, icon('heart', 16), 'Send wishes')),
      wall.length ? h('div', { class: 'col' }, wall.map((w) => h('div', { class: 'wish' }, h('p', {}, `“${w.text}”`), h('div', { class: 'small muted' }, `${w.name} · ${ago(w.at)}`))))
        : h('p', { class: 'muted' }, 'Be the first to leave your blessings.')),
    footer(),
  );
  const wanted = params().get('item');
  if (wanted && !opened && state.items[wanted]) {
    opened = true;
    itemSheet(wanted);
  }
}

async function start() {
  app.replaceChildren(loader());
  coupleId = slug ? await backend.get(`slugs/${slug}`) : null;
  if (!coupleId) {
    app.replaceChildren(h('div', { class: 'wrap-page' }, h('div', { class: 'topbar' }, brand()), empty('search', 'We could not find this wishlist', 'Please check the link or ask the couple to share it again.', h('a', { class: 'btn', href: pageUrl('index.html') }, 'Go to home'))));
    return;
  }
  backend.watch(`publicProfiles/${coupleId}`, (v) => { state.profile = v || { active: false }; render(); });
  backend.watch(`publicWishlists/${coupleId}`, (v) => { state.items = v || {}; render(); });
  backend.watch(`publicFeed/${coupleId}`, (v) => { state.feed = v || {}; render(); });
  backend.watch(`publicGroupGifts/${coupleId}`, (v) => { state.groups = v || {}; render(); });
  const m = mine(coupleId);
  m.receipts.slice(0, 8).forEach((r) => backend.watch(`guestReceipts/${r}`, (v) => { state.mine[`r${r}`] = v; render(); }));
  m.threads.slice(0, 8).forEach((t) => backend.watch(`guestThreads/${t}/meta`, (v) => { state.mine[`t${t}`] = v; render(); }));
  setInterval(() => !document.querySelector('.overlay') && render(), 60000);
}
start().catch((e) => toast(e.message, 'err'));
