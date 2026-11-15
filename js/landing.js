// Home page.
import { mode } from './backend.js';
import { boot, h, icon, brand, footer, field, input, pageUrl, toast } from './ui.js';
import { APP } from './app-config.js';

const app = boot('');
const find = input({ placeholder: 'Paste the wishlist link or name, e.g. aarav-and-meera', 'aria-label': 'Wishlist link' });
const open = () => {
  const raw = find.value.trim().toLowerCase();
  const slug = (raw.match(/[?&]w=([a-z0-9-]+)/) || raw.match(/\/w\/\??([a-z0-9-]+)/) || [null, raw.replace(/[^a-z0-9-]/g, '')])[1];
  if (!slug) return toast('Please enter the wishlist link you received.', 'err');
  location.href = pageUrl('public-wishlist.html', { w: slug });
  return undefined;
};
const feature = (ic, title, text) => h('div', { class: 'card feature' }, h('div', { class: 'fi' }, icon(ic, 24)), h('h3', {}, title), h('p', { class: 'muted' }, text));
app.replaceChildren(
  h('header', { class: 'landing-hero' }, h('div', { class: 'topbar' }, brand(), h('a', { class: 'btn sm', href: pageUrl('login.html') }, 'Couple sign in')),
    h('div', { class: 'wrap-page center', style: 'padding-top:26px;display:grid;gap:16px;justify-items:center' }, h('h1', { style: 'max-width:680px;text-wrap:balance' }, APP.tagline),
      h('p', { style: 'max-width:560px;font-size:17px;opacity:.95' }, 'A wedding wishlist for everything you need and dream of. Guests contribute any amount, gift a whole item, team up with friends, or send a Lifafa. All by UPI, straight to you.'),
      h('div', { class: 'card', style: 'width:100%;max-width:520px;color:var(--ink)' }, field('Have a wishlist link?', h('div', { class: 'row' }, find, h('button', { class: 'btn primary', onclick: open }, 'Open'))),
        mode === 'preview' && h('div', { class: 'row wrap', style: 'margin-top:12px;justify-content:center' }, h('a', { class: 'btn gold sm', href: pageUrl('public-wishlist.html', { w: 'aarav-and-meera' }) }, 'See a sample wishlist'), h('a', { class: 'btn sm', href: pageUrl('login.html') }, 'Try the dashboard'))))),
  h('main', { class: 'wrap-page', style: 'padding-top:34px' }, h('div', { class: 'items' },
    feature('gift', 'One list for every dream', 'Honeymoon, home down payment, a mixer or a refrigerator. Each with its own budget and progress.'),
    feature('users', 'Gift together', 'Friends share one link and each pays their own part towards an expensive item.'),
    feature('envelope', 'Lifafa, the modern way', 'A simple envelope of blessings for guests who are not sure what to pick.'),
    feature('qr', 'QR on your invitation', 'Print a personal QR card. One scan opens your wishlist. No app, no sign-up for guests.'),
    feature('shield', 'Money goes straight to you', 'Guests pay your UPI ID directly. A gift counts only after you confirm it in your bank.'),
    feature('card', 'Say thank you beautifully', 'Send each guest a personalised thank-you card in a tap.'))),
  footer(),
);
find.addEventListener('keydown', (e) => e.key === 'Enter' && open());
