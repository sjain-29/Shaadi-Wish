// Guest payment flow for wishlist items, group gifts and Lifafa.
//   1 amount & details  ->  2 pay by UPI and enter the UTR  ->  3 status
// The page only shows the couple's UPI ID (with Copy) and a QR (with Save as
// image). The guest pays in their own UPI app. Money counts as received only
// after the couple verifies it against their bank statement.
import { backend } from './backend.js';
import { remember, guestName } from './guest-store.js';
import {
  boot, h, icon, inr, params, empty, loader, brand, footer, toast, run, field, input, check, vals, copy, download,
  pageUrl, waLink, statusBadge, confetti, first,
} from './ui.js';
import { refCode } from './core/util.js';

const lifafa = document.body.dataset.kind === 'lifafa';
const app = boot(lifafa ? 'Send a Lifafa' : 'Contribute');
const q = params();
const s = { slug: (q.get('w') || '').toLowerCase(), itemId: q.get('item'), groupId: q.get('g'), full: q.has('full'), receipt: q.get('r'), step: 1, amount: null, form: null, ref: null, rec: null };
let coupleId, profile, item, group, settings;
let coupleQr = null; // the QR picture the couple uploaded, if any

const back = () => pageUrl('public-wishlist.html', { w: s.slug });
const remaining = () => (item ? item.budget : Infinity); // guests never see what others paid
const shell = (...kids) => app.replaceChildren(h('div', { class: 'wrap-page', style: 'max-width:560px' },
  h('div', { class: 'topbar', style: 'padding-left:0;padding-right:0' }, brand(), h('a', { class: 'btn ghost sm', href: back() }, icon('back', 16), 'Wishlist')),
  h('div', { class: 'steps', 'aria-label': `Step ${s.step} of 3` }, [1, 2, 3].map((n) => h('i', { class: n <= s.step ? 'on' : '' }))), ...kids), footer());

function groupPanel() {
  if (!group) return null;
  const url = pageUrl('contribution.html', { w: s.slug, item: s.itemId, g: s.groupId });
  return h('div', { class: 'card tint col' },
    h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'small muted' }, 'Group gift'), h('h3', {}, group.title || `${group.organizer}'s group`)), group.completedAt ? h('span', { class: 'badge ok' }, 'Goal completed') : null),
    h('p', { class: 'small muted' }, `Started by ${group.organizer}. What each friend gives stays private between them and the couple.`),
    h('a', { class: 'btn mint sm', href: waLink(`Let's gift ${profile.partner1.split(' ')[0]} & ${profile.partner2.split(' ')[0]} "${group.itemName}" together! Add your share here: ${url}`), target: '_blank', rel: 'noopener' }, icon('chat', 16), 'Invite friends on WhatsApp'),
    h('button', { class: 'btn ghost sm', onclick: () => copy(url, 'Group link copied') }, icon('copy', 16), 'Copy group link'));
}

function stepDetails() {
  const max = Math.min(settings.maxAmount, remaining());
  if (item && (item.state !== 'OPEN' || max <= 0)) {
    return shell(groupPanel(), empty('check', item.state === 'RESERVED' ? 'This gift is reserved' : 'This wish is fulfilled', 'Thank you for your love. You can still pick another wish or send a Lifafa.', h('a', { class: 'btn primary', href: back() }, 'Back to wishlist')));
  }
  let chips = (lifafa ? settings.lifafaAmounts : settings.suggestedAmounts).filter((a) => a <= max);
  if (item && max <= settings.maxAmount && !chips.includes(max)) chips = [...chips, max];
  if (s.full && item && item.giftable === false) s.full = false; // someone has already contributed
  if (s.full) s.amount = max;
  const custom = input({ type: 'number', name: 'custom', inputmode: 'numeric', min: settings.minAmount, max, placeholder: 'Custom amount (₹)', value: s.amount && !chips.includes(s.amount) ? s.amount : '', oninput: (e) => { s.amount = Number(e.target.value) || null; paint(); } });
  const chipRow = h('div', { class: 'chips wrap' });
  const paint = () => chipRow.replaceChildren(...chips.map((a) => h('button', { class: `chip num${s.amount === a ? ' on' : ''}`, type: 'button', onclick: () => { s.amount = a; custom.value = ''; paint(); } }, item && a === max && item.giftable !== false ? `Full ${inr(a)}` : inr(a))));
  paint();
  const form = h('div', { class: 'form' },
    field('Your name', input({ name: 'guestName', value: guestName.get(), maxlength: 60, autocomplete: 'name' })),
    check('anonymous', 'Gift anonymously. The couple will know it is you; everyone else sees "Anonymous Guest".'),
    field('Message for the couple (optional)', input({ name: 'message', rows: 3, maxlength: 500 })),
    check('messagePublic', 'Show my message on the wishlist page (if the couple approves). Your amount is never shown.'));
  shell(
    h('div', { class: 'col', style: 'margin-bottom:14px' }, h('div', { class: 'small muted' }, lifafa ? 'A Little Extra Love' : `For ${first(profile.partner1)} & ${first(profile.partner2)}`),
      h('h1', {}, lifafa ? 'Send a Lifafa ❤️' : item.name), lifafa ? h('p', { class: 'muted' }, `Your blessings go directly to ${first(profile.partner1)} & ${first(profile.partner2)}.`) : h('p', { class: 'muted num' }, `Budget ${inr(item.budget)}`)),
    groupPanel(),
    h('div', { class: 'card col', style: 'margin-top:14px' }, h('h3', {}, 'Choose an amount'), chipRow, s.full ? null : custom, h('hr', { class: 'divider' }), form,
      h('button', {
        class: 'btn primary block caps', onclick: () => {
          const v = vals(form);
          if (!s.amount || s.amount < settings.minAmount) return toast('Please choose an amount.', 'err');
          if (s.amount > max) return toast(`The most you can send here is ${inr(max)}.`, 'err');
          if (v.guestName.length < 2) return toast('Please enter your name.', 'err');
          guestName.set(v.guestName);
          Object.assign(s, { form: v, ref: refCode(), step: 2 });
          window.scrollTo(0, 0);
          return stepPay();
        },
      }, 'Continue to payment')));
}

function stepPay() {
  const names = `${profile.partner1} & ${profile.partner2}`;
  const note = `${s.ref}`;
  // Only the QR picture the couple uploaded is shown. The app never makes a payment QR itself.
  const own = typeof coupleQr === 'string' && coupleQr.startsWith('data:image/');
  const qr = own ? h('img', { class: 'couple-qr', src: coupleQr, alt: `Payment QR of ${names}`, style: 'width:100%;max-width:270px;border-radius:10px' }) : null;
  const saveQr = () => download(coupleQr, `payment-qr.${coupleQr.slice(11, coupleQr.indexOf(';')).replace('jpeg', 'jpg')}`);
  const utr = input({ name: 'utr', inputmode: 'numeric', maxlength: 14, placeholder: '12-digit number', autocomplete: 'off' });
  shell(
    h('div', { class: 'card col center' },
      h('div', { class: 'small muted' }, lifafa ? 'Lifafa for' : `For "${item.name}"`), h('h2', {}, names), h('div', { class: 'amount-big num' }, inr(s.amount)),
      h('div', { class: 'small muted' }, 'Pay to this UPI ID'),
      h('div', { class: 'row', style: 'justify-content:center;flex-wrap:wrap' }, h('b', { style: 'font-size:18px;overflow-wrap:anywhere' }, profile.upiId), h('button', { class: 'btn sm', onclick: () => copy(profile.upiId, 'UPI ID copied') }, icon('copy', 16), 'Copy')),
      h('div', { class: 'small muted' }, `Name: ${profile.payeeName || names}`),
      own && h('div', { class: 'qr-box', style: 'margin:6px auto 0' }, qr),
      own && h('button', { class: 'btn sm', onclick: saveQr }, icon('download', 16), 'Save QR as image'),
      h('p', { class: 'small muted' }, own ? `Scan this QR in any UPI app from another phone, or save it and open it from the gallery inside your UPI app. Enter ${inr(s.amount)} as the amount and add the note ${note}.`
        : `Copy the UPI ID and pay it from any UPI app. Enter ${inr(s.amount)} as the amount and add the note ${note}.`)),
    h('div', { class: 'card col', style: 'margin-top:14px' }, h('h3', {}, 'After you have paid'),
      field('UPI transaction reference (UTR)', utr, 'Open the payment in your UPI app and look for "UTR" or "UPI Ref No". It is 12 digits.'),
      h('div', { class: 'note' }, 'Showing this page or scanning the QR does not record a payment. Your gift appears as received after the couple confirms it in their bank account.'),
      h('button', {
        class: 'btn primary block caps', onclick: async (e) => {
          const v = s.form;
          const r = await run(e.currentTarget, () => backend.call('createContribution', {
            coupleId, kind: lifafa ? 'lifafa' : 'item', itemId: s.itemId, groupGiftId: s.groupId, fullGift: s.full, amount: s.amount, utr: utr.value, refCode: s.ref,
            guestName: v.guestName, anonymous: v.anonymous, message: v.message, messagePublic: v.messagePublic, 
          }));
          if (!r) return;
          remember(coupleId, 'receipts', r.receipt);
          s.receipt = r.receipt;
          history.replaceState(null, '', pageUrl(lifafa ? 'lifafa.html' : 'contribution.html', { r: r.receipt }));
          watchReceipt();
        },
      }, icon('check'), 'I have paid. Submit'),
      h('button', { class: 'btn ghost block', onclick: () => { s.step = 1; stepDetails(); } }, 'Change amount or details')));
}

let celebrated = false;
function stepStatus() {
  const r = s.rec;
  const view = {
    PENDING_VERIFICATION: ['clock', 'Thank you! Waiting for the couple', `Your payment of ${inr(r.amount)} has been reported. It will show as received once ${r.coupleNames} confirm it in their bank account.`],
    VERIFIED: ['heart', 'Received with love', `${r.coupleNames} have confirmed your gift of ${inr(r.amount)}. Thank you for your blessings!`],
    REJECTED: ['alert', 'The couple could not find this payment', `${r.rejectedReason ? `Reason: ${r.rejectedReason}. ` : ''}If money left your account, please message the couple with your UTR.`],
    REFUNDED: ['refresh', 'This gift was refunded', 'The couple has recorded this payment as returned to you.'],
  }[r.status] || ['clock', 'Payment status', ''];
  if (r.status === 'VERIFIED' && !celebrated) { celebrated = true; confetti(); }
  shell(empty(view[0], view[1], view[2], h('div', { class: 'col', style: 'width:100%;max-width:320px' }, statusBadge(r.status),
    h('div', { class: 'small muted' }, `Reference ${r.refCode}`), h('a', { class: 'btn primary block', href: pageUrl('public-wishlist.html', { w: r.slug }) }, 'Back to wishlist'),
    r.groupGiftId && h('a', { class: 'btn block', href: pageUrl('contribution.html', { w: r.slug, item: r.itemId, g: r.groupGiftId }) }, icon('users'), 'See the group'))));
}

function watchReceipt() {
  backend.watch(`guestReceipts/${s.receipt}`, (rec) => {
    if (!rec) return shell(empty('search', 'This link is not valid', 'Please start again from the wishlist.', h('a', { class: 'btn', href: pageUrl('index.html') }, 'Home')));
    Object.assign(s, { rec, slug: rec.slug, step: 3 });
    remember(rec.coupleId, 'receipts', s.receipt);
    return stepStatus();
  });
}

async function start() {
  app.replaceChildren(loader());
  settings = { suggestedAmounts: [500, 1000, 2000, 5000, 10000], lifafaAmounts: [501, 1101, 2101, 5001, 11000], minAmount: 1, maxAmount: 100000, ...((await backend.get('publicSettings')) || {}) };
  if (s.receipt) return watchReceipt();
  coupleId = s.slug ? await backend.get(`slugs/${s.slug}`) : null;
  profile = coupleId ? await backend.get(`publicProfiles/${coupleId}`) : null;
  if (!profile || !profile.active) return shell(empty('search', 'We could not find this wishlist', 'Please check the link.', h('a', { class: 'btn', href: pageUrl('index.html') }, 'Home')));
  if (profile.hasQr) coupleQr = await backend.get(`publicPaymentQr/${coupleId}`);
  if (!profile.paymentsReady || !profile.upiId) return shell(empty('wallet', 'Payments are not set up yet', 'The couple has not added their UPI details. Please check back soon.', h('a', { class: 'btn', href: back() }, 'Back to wishlist')));
  if (lifafa) return stepDetails();
  if (!s.itemId) return location.replace(back());
  backend.watch(`publicWishlists/${coupleId}/${s.itemId}`, (v) => {
    item = v;
    if (!v) return shell(empty('search', 'This wish is no longer listed', '', h('a', { class: 'btn', href: back() }, 'Back to wishlist')));
    if (s.step === 1 && !document.activeElement?.matches('input,textarea')) stepDetails();
  });
  if (s.groupId) backend.watch(`publicGroupGifts/${coupleId}/${s.groupId}`, (v) => { group = v; if (s.step === 1 && item && !document.activeElement?.matches('input,textarea')) stepDetails(); });
}
start().catch((e) => toast(e.message, 'err'));
