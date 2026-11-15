// Couple dashboard: gift reservations, messages, sharing (QR invitation) and settings.
import { backend } from './backend.js';
import {
  h, icon, ago, fmtDate, entries, empty, modal, toast, run, confirmBox, field, input, select, check, vals, download, initials, copy, publicUrl, share as nativeShare, canvasBlob,
  waLink, qrCanvas, site, shrinkImage,
} from './ui.js';
import { bubble } from './chat.js';
import { renderCard, jpegToPdf, THEMES } from './cards.js';
import { askForm } from './dash-money.js';

const RES = { DISCUSSING: ['Discussing', 'warn'], RESERVED: ['Reserved', 'warn'], RECEIVED: ['Received', 'ok'], CANCELLED: ['Cancelled', 'plain'] };
let inbox = 'inbox';

async function giftDetails(conv) {
  const v = await askForm('Tell the guest what you would like', [
    h('div', { class: 'two' }, field('Brand', input({ name: 'brand', maxlength: 60 })), field('Model', input({ name: 'model', maxlength: 80 }))),
    field('Product link', input({ name: 'link', placeholder: 'https://…', inputmode: 'url' })), field('Specifications', input({ name: 'specs', rows: 2, maxlength: 300 })), field('Notes', input({ name: 'notes', rows: 2, maxlength: 300 }))], 'Send to guest');
  if (v && (await run(null, () => backend.call('sendGiftDetails', { convId: conv.id, ...v })))) toast('Details sent', 'ok');
}
const reserve = (btn, id) => run(btn, () => backend.call('confirmReservation', { reservationId: id })).then((r) => r && toast('Reserved for this guest. Other guests now see it as reserved.', 'ok'));
const receive = (btn, id) => run(btn, () => backend.call('confirmReceipt', { reservationId: id })).then((r) => r && toast('Marked as received. The item is completed.', 'ok'));
async function release(btn, id) {
  if (!(await confirmBox('Release this reservation?', 'The item will open up again for other guests, and the guest will be told.', 'Release', true))) return;
  if (await run(btn, () => backend.call('cancelReservation', { reservationId: id }))) toast('Reservation released', 'ok');
}

function openThread(ctx, conv) {
  const list = h('div', { class: 'chat', style: 'min-height:140px' });
  const box = input({ rows: 1, placeholder: 'Reply…', maxlength: 1000, 'aria-label': 'Reply', style: 'min-height:46px' });
  const off = backend.watch(`messages/${ctx.cid}/${conv.id}`, (v) => {
    list.replaceChildren(...entries(v).sort((a, z) => a.at - z.at).map((m) => bubble(m, 'couple')));
    list.lastChild?.scrollIntoView({ block: 'end' });
  });
  if (conv.unreadCouple) backend.call('markRead', { convId: conv.id }).catch(() => {});
  const res = conv.reservationId ? ctx.D.reservations[conv.reservationId] : null;
  const live = () => ctx.D.conversations[conv.id] || conv;
  const m = modal({
    title: conv.guestName, wide: true, onClose: off,
    body: h('div', {},
      h('div', { class: 'row wrap small muted', style: 'margin-bottom:8px' }, conv.type === 'wish' ? 'Wedding wishes' : `About: ${conv.itemName || 'your wishlist'}`, res && h('span', { class: `badge ${RES[res.status][1]}` }, RES[res.status][0])),
      h('div', { class: 'row wrap', style: 'margin-bottom:6px' },
        res && ['DISCUSSING', 'RESERVED'].includes(res.status) && h('button', { class: 'btn gold sm', onclick: () => giftDetails(conv) }, icon('gift', 16), 'Send brand & model'),
        res && res.status === 'DISCUSSING' && h('button', { class: 'btn primary sm', onclick: (e) => reserve(e.currentTarget, conv.reservationId).then(() => m.close()) }, icon('lock', 16), 'Reserve for this guest'),
        res && res.status === 'RESERVED' && h('button', { class: 'btn mint sm', onclick: (e) => receive(e.currentTarget, conv.reservationId).then(() => m.close()) }, icon('check', 16), 'Confirm receipt'),
        res && ['DISCUSSING', 'RESERVED'].includes(res.status) && h('button', { class: 'btn danger sm', onclick: (e) => release(e.currentTarget, conv.reservationId).then(() => m.close()) }, 'Release'),
        conv.type === 'wish' && conv.wishPublic && h('button', { class: 'btn sm', onclick: async (e) => { const on = !live().wallApproved; if (await run(e.currentTarget, () => backend.call('setWishApproval', { convId: conv.id, approved: on }))) { toast(on ? 'Shown on your wishlist page' : 'Hidden from your wishlist page', 'ok'); e.target.textContent = on ? 'Hide from public page' : 'Show on public page'; } } }, conv.wallApproved ? 'Hide from public page' : 'Show on public page'),
        h('button', { class: 'btn ghost sm', onclick: async (e) => { if (await run(e.currentTarget, () => backend.call('archiveConversation', { convId: conv.id, archived: !conv.archived }))) { toast(conv.archived ? 'Moved to inbox' : 'Archived', 'ok'); m.close(); } } }, conv.archived ? 'Move to inbox' : 'Archive')),
      list,
      h('div', { class: 'composer' }, box, h('button', { class: 'btn primary', 'aria-label': 'Send', onclick: async (e) => {
        if (!box.value.trim()) return;
        if (await run(e.currentTarget, () => backend.call('sendMessage', { convId: conv.id, text: box.value }))) box.value = '';
      } }, icon('send')))),
  });
}

export function messages(ctx) {
  const all = entries(ctx.D.conversations).sort((a, z) => z.lastAt - a.lastAt);
  const list = all.filter((c) => !!c.archived === (inbox === 'archived'));
  return [
    h('div', { class: 'tabs' }, [['inbox', 'Inbox'], ['archived', 'Archived']].map(([id, label]) => h('button', { class: `tab${inbox === id ? ' on' : ''}`, onclick: () => { inbox = id; ctx.rerender(); } }, label))),
    list.length ? h('div', { class: 'list' }, list.map((c) => h('div', { class: 'rowcard click', onclick: () => openThread(ctx, c) }, h('div', { class: 'who' }, initials(c.guestName)),
      h('div', { class: 'grow' }, h('div', { class: 'row wrap', style: 'gap:6px' }, h('b', {}, c.guestName), h('span', { class: 'badge plain' }, c.type === 'gift' ? 'Gift' : c.type === 'wish' ? 'Wishes' : 'Question')),
        h('div', { class: 'small muted', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60vw' }, `${c.lastFrom === 'couple' ? 'You: ' : ''}${c.lastText || ''}`)),
      h('div', { style: 'text-align:right' }, h('div', { class: 'small muted' }, ago(c.lastAt)), c.unreadCouple ? h('span', { class: 'badge bad' }, `${c.unreadCouple} new`) : null))))
      : empty('chat', inbox === 'inbox' ? 'No messages yet' : 'Nothing archived', 'Questions, gift discussions and wedding wishes from your guests will appear here.'),
  ];
}

export function reservations(ctx) {
  const list = entries(ctx.D.reservations).sort((a, z) => z.updatedAt - a.updatedAt);
  if (!list.length) return empty('bag', 'No gift reservations yet', 'When a guest offers to buy an item themselves, you can agree on the brand and model here.');
  return h('div', { class: 'list' }, list.map((r) => {
    const conv = ctx.D.conversations[r.convId];
    const a = r.agreed;
    return h('div', { class: 'card col' }, h('div', { class: 'row between' }, h('div', {}, h('h3', {}, r.itemName), h('div', { class: 'small muted' }, `${r.guestName} · ${ago(r.updatedAt)}`)), h('span', { class: `badge ${RES[r.status][1]}` }, RES[r.status][0])),
      a && h('div', { class: 'small' }, h('b', {}, 'Agreed: '), [a.brand, a.model, a.specs].filter(Boolean).join(' · ') || a.notes),
      h('div', { class: 'row wrap' }, conv && h('button', { class: 'btn sm', onclick: () => openThread(ctx, { ...conv, id: r.convId }) }, icon('chat', 16), 'Open chat'),
        r.status === 'DISCUSSING' && h('button', { class: 'btn primary sm', onclick: (e) => reserve(e.currentTarget, r.id) }, icon('lock', 16), 'Reserve for this guest'),
        r.status === 'RESERVED' && h('button', { class: 'btn mint sm', onclick: (e) => receive(e.currentTarget, r.id) }, icon('check', 16), 'Confirm receipt'),
        ['DISCUSSING', 'RESERVED'].includes(r.status) && h('button', { class: 'btn danger sm', onclick: (e) => release(e.currentTarget, r.id) }, r.status === 'DISCUSSING' ? 'Decline' : 'Release')));
  }));
}

// ------------------------------------------------------------ share + QR invitation
export function share(ctx) {
  const c = ctx.D.couple;
  const url = publicUrl(c.slug);
  const text = `${ctx.names()} would love your blessings. Here is our wedding wishlist:`;
  const qr = qrCanvas(url, 720);
  const canvas = h('canvas', { class: 'cardprev' });
  let theme = c.theme || 'marigold';
  const message = input({ value: 'Your blessings mean everything to us.', maxlength: 120 });
  const dateLine = input({ value: [c.weddingDate && fmtDate(`${c.weddingDate}T00:00:00`), c.location].filter(Boolean).join(' · '), maxlength: 80 });
  const draw = () => renderCard(canvas, { kind: 'invite', theme, names: ctx.names(), message: message.value, dateLine: dateLine.value, url });
  message.oninput = dateLine.oninput = draw;
  const chips = h('div', { class: 'chips' });
  const paint = () => chips.replaceChildren(...Object.entries(THEMES).map(([id, t]) => h('button', { class: `chip${theme === id ? ' on' : ''}`, onclick: () => { theme = id; paint(); draw(); } }, t.label)));
  paint();
  draw();
  const pdf = async () => {
    const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
    download(jpegToPdf(jpeg, canvas.width, canvas.height), 'wedding-invitation-qr.pdf');
  };
  return h('div', { class: 'two-col' },
    h('div', { class: 'card col' }, h('h3', {}, 'Your wishlist link'), h('div', { class: 'note info', style: 'overflow-wrap:anywhere;font-weight:600' }, url),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn sm', onclick: () => copy(url, 'Link copied') }, icon('copy', 16), 'Copy link'),
        h('a', { class: 'btn mint sm', href: waLink(`${text} ${url}`), target: '_blank', rel: 'noopener' }, icon('chat', 16), 'Share on WhatsApp'),
        navigator.share ? h('button', { class: 'btn ghost sm', onclick: () => nativeShare({ title: ctx.names(), text, url }) }, icon('share', 16), 'More') : null),
      h('hr', { class: 'divider' }), h('h3', {}, 'QR code'), h('p', { class: 'small muted' }, 'Print it on your wedding invitation. Scanning opens your wishlist directly.'),
      h('div', { class: 'qr-box', style: 'justify-self:start' }, qr), h('button', { class: 'btn ghost sm', onclick: async () => download(await canvasBlob(qr), 'wishlist-qr.png') }, icon('download', 16), 'Download QR image')),
    h('div', { class: 'card col' }, h('h3', {}, 'Invitation QR card'), canvas, chips, field('Message', message), field('Date and place', dateLine),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary sm', onclick: async () => download(await canvasBlob(canvas), 'wedding-invitation-qr.png') }, icon('download', 16), 'Download image'),
        h('button', { class: 'btn sm', onclick: pdf }, icon('download', 16), 'Download PDF'))));
}

// ------------------------------------------------------------ settings
export function settings(ctx) {
  const c = ctx.D.couple;
  const pay = ctx.D.pay || {};
  const photo = (name, label) => field(label, input({ name, value: c[name] || '', placeholder: 'https://… link to a photo (optional)', inputmode: 'url' }));
  const profile = h('div', { class: 'form' },
    h('div', { class: 'two' }, field('Partner 1', input({ name: 'partner1', value: c.partner1, maxlength: 40 })), field('Partner 2', input({ name: 'partner2', value: c.partner2, maxlength: 40 }))),
    h('div', { class: 'two' }, field('Wedding date', input({ name: 'weddingDate', type: 'date', value: c.weddingDate || '' })), field('Wedding location', input({ name: 'location', value: c.location || '', maxlength: 80 }))),
    field('Welcome message for guests', input({ name: 'welcomeMessage', rows: 3, maxlength: 400, value: c.welcomeMessage || '' })),
    h('div', { class: 'two' }, photo('photo1', `Photo of ${c.partner1.split(' ')[0]}`), photo('photo2', `Photo of ${c.partner2.split(' ')[0]}`)),
    field('Card theme', select({ name: 'theme', value: c.theme || 'marigold' }, Object.entries(THEMES).map(([id, t]) => [id, t.label]))),
    check('showContributors', 'Show recent contributors on my public page (names only, never amounts)', c.showContributors !== false),
    h('button', { class: 'btn primary', onclick: (e) => run(e.currentTarget, () => backend.call('updateProfile', vals(profile))).then((r) => r && toast('Profile saved', 'ok')) }, 'Save profile'));
  let qrData = null;
  const qrPreview = h('img', { alt: 'Your payment QR', class: 'hide', style: 'max-width:190px;border-radius:14px;border:1px solid var(--line)' });
  const showQr = (src) => { qrPreview.src = src; qrPreview.classList.remove('hide'); };
  backend.get(`publicPaymentQr/${ctx.cid}`).then((v) => v && !qrData && showQr(v));
  const qrFile = h('input', { type: 'file', accept: 'image/*', class: 'in', 'aria-label': 'Payment QR picture', onchange: async (e) => {
    if (!e.target.files[0]) return;
    qrData = await run(null, () => shrinkImage(e.target.files[0], 1400, 0.85));
    if (qrData) showQr(qrData);
  } });
  const payment = h('div', { class: 'form' },
    h('p', { class: 'small muted' }, 'Guests pay you directly, using your UPI ID or your QR. The money never passes through this app.'),
    field('Your UPI ID', input({ name: 'upiId', value: pay.upiId || '', placeholder: 'name@okhdfcbank', autocapitalize: 'off', autocomplete: 'off' })),
    field('Name on the bank account', input({ name: 'payeeName', value: pay.payeeName || '', maxlength: 60 }), 'Guests see this name in their UPI app before paying. Check it matches.'),
    field('Your payment QR', h('div', { class: 'col payment-qr', style: 'gap:8px' }, qrFile, qrPreview), 'Upload the QR picture from your UPI app (in GPay, PhonePe or Paytm look for "My QR"). Crop it to just the QR. Guests scan it, or save it as an image.'),
    check('removeQr', 'Remove my uploaded QR'),
    field('Your password, to confirm this change', input({ name: 'password', type: 'password', autocomplete: 'current-password' })),
    h('button', { class: 'btn primary', onclick: (e) => run(e.currentTarget, () => backend.call('updatePaymentSettings', { ...vals(payment), qrImage: qrData })).then((r) => { if (r) { toast('Payment details saved', 'ok'); payment.querySelector('[name=password]').value = ''; } }) }, 'Save payment details'));
  const password = h('div', { class: 'form' }, field('Current password', input({ name: 'current', type: 'password', autocomplete: 'current-password' })), field('New password', input({ name: 'next', type: 'password', autocomplete: 'new-password' }), 'At least 8 characters, with a letter and a number.'),
    h('button', { class: 'btn', onclick: async (e) => {
      const v = vals(password);
      if ((await run(e.currentTarget, () => backend.changePassword(v.current, v.next).then(() => true))) !== true) return;
      password.querySelectorAll('input').forEach((i) => { i.value = ''; });
      toast('Password changed', 'ok');
    } }, 'Change password'));
  return h('div', { class: 'two-col' },
    h('div', { class: 'card col' }, h('h3', {}, 'Couple profile'), profile),
    h('div', { class: 'col' }, h('div', { class: 'card col' }, h('h3', {}, 'Payment details'), payment), h('div', { class: 'card col' }, h('h3', {}, 'Password'), password),
      h('div', { class: 'card col' }, h('h3', {}, 'Account'), h('p', { class: 'small muted' }, `Registered mobile: ${c.mobile}. To change it, ask the administrator for a new login.`),
        h('button', { class: 'btn ghost sm', onclick: (e) => run(e.currentTarget, () => backend.call('recalculateTotals')).then((r) => r && toast('Totals rebuilt from your payment records', 'ok')) }, icon('refresh', 16), 'Recalculate totals'),
        h('button', { class: 'btn danger sm', onclick: async () => { await backend.signOut(); location.href = site('login.html'); } }, icon('logout', 16), 'Sign out'))));
}
