// Guest's side of a conversation with the couple, opened through a secret link.
import { backend } from './backend.js';
import { remember } from './guest-store.js';
import { boot, h, icon, params, entries, empty, loader, brand, run, input, pageUrl, confirmBox, copy, toast } from './ui.js';
import { bubble } from './chat.js';

const app = boot('Conversation');
const token = params().get('t') || '';
let seen = 0;

function reservationPanel(meta) {
  const r = meta.reservation;
  if (!r) return null;
  const act = (intent, label, cls, ask, done) => h('button', {
    class: `btn ${cls} sm`, onclick: async (e) => {
      const btn = e.currentTarget;
      if (ask && !(await confirmBox(ask[0], ask[1], label, cls === 'danger'))) return;
      if (await run(btn, () => backend.call('guestGiftNotice', { token, intent }))) toast(done, 'ok');
    },
  }, label);
  const text = {
    DISCUSSING: 'Not reserved yet. When you and the couple agree on the product, tap confirm. The couple then reserves the item for you so no one else buys the same gift.',
    RESERVED: 'Reserved for you. Other guests now see this item as reserved.',
    RECEIVED: 'The couple has received your gift. Thank you!',
    CANCELLED: 'This gift was cancelled and the item is open again.',
  }[r.status];
  return h('div', { class: 'card tint col' }, h('div', { class: 'row between' }, h('b', {}, `Gift: ${meta.itemName}`), h('span', { class: `badge ${r.status === 'RECEIVED' ? 'ok' : r.status === 'CANCELLED' ? 'plain' : 'warn'}` }, r.status.toLowerCase())),
    h('p', { class: 'small muted' }, text),
    h('div', { class: 'row wrap' },
      r.status === 'DISCUSSING' && act('confirm', 'Confirm, I will gift this', 'primary', ['Confirm this gift?', 'The couple will be asked to reserve the item for you. Please only confirm if you will buy it.'], 'The couple has been told. They will reserve it for you.'),
      r.status === 'RESERVED' && act('purchased', 'I have purchased it', 'primary', null, 'The couple has been told.'),
      ['DISCUSSING', 'RESERVED'].includes(r.status) && act('cancel', 'I cannot gift this', 'danger', ['Cancel this gift?', 'The couple will be asked to open the item up again for other guests.'], 'The couple has been told.')));
}

function render(thread) {
  if (!thread || !thread.meta) {
    app.replaceChildren(h('div', { class: 'wrap-page' }, h('div', { class: 'topbar' }, brand()), empty('lock', 'This conversation link is not valid', 'Please open the link exactly as it was shared with you.')));
    return;
  }
  const meta = thread.meta;
  remember(meta.coupleId, 'threads', token);
  const messages = entries(thread.messages).sort((a, b) => a.at - b.at);
  const box = input({ rows: 1, placeholder: 'Write a message…', maxlength: 1000, 'aria-label': 'Message', style: 'min-height:46px' });
  const keep = document.querySelector('.composer textarea')?.value || '';
  box.value = keep;
  const send = async (e) => {
    if (!box.value.trim()) return;
    const r = await run(e.currentTarget, () => backend.call('sendMessage', { token, text: box.value }));
    if (r) box.value = '';
  };
  app.replaceChildren(h('div', { class: 'wrap-page', style: 'max-width:640px' },
    h('div', { class: 'topbar', style: 'padding-left:0;padding-right:0' }, h('a', { class: 'btn ghost sm', href: pageUrl('public-wishlist.html', { w: meta.slug }) }, icon('back', 16), 'Wishlist'),
      h('button', { class: 'btn ghost sm', onclick: () => copy(location.href, 'Private link copied. Keep it to yourself.') }, icon('link', 16), 'Save link')),
    h('div', { style: 'margin-bottom:12px' }, h('div', { class: 'small muted' }, 'Private conversation with'), h('h2', {}, meta.coupleNames), meta.itemName && h('div', { class: 'small muted' }, `About: ${meta.itemName}`)),
    reservationPanel(meta),
    h('div', { class: 'chat', 'aria-live': 'polite' }, messages.map((m) => bubble(m, 'guest'))),
    h('div', { class: 'composer' }, box, h('button', { class: 'btn primary', 'aria-label': 'Send', onclick: send }, icon('send')))));
  if (messages.length !== seen) {
    seen = messages.length;
    window.scrollTo(0, document.body.scrollHeight);
    if (meta.unreadGuest) backend.call('markRead', { token }).catch(() => {});
  }
}

app.replaceChildren(loader());
if (/^[A-Za-z0-9_-]{32,64}$/.test(token)) backend.watch(`guestThreads/${token}`, render);
else render(null);
