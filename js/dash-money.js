// Couple dashboard: contributions, payment verification, Lifafa, group gifts
// and thank-you cards.
import { backend } from './backend.js';
import {
  h, icon, inr, ago, fmtDate, entries, bar, empty, modal, toast, run, field, input, vals, download, toCsv, statusBadge, initials, copy, pageUrl, share, canvasBlob, waLink, STATUS,
} from './ui.js';
import { renderCard, THEMES } from './cards.js';

const AW = ['PAYMENT_REPORTED', 'PENDING_VERIFICATION'];
const tabs = { item: 'action', lifafa: 'action' };

/** Small form in a sheet. Resolves with the values, or null if closed. */
export function askForm(title, nodes, okLabel, cls = 'primary') {
  return new Promise((resolve) => {
    let done = false;
    const form = h('div', { class: 'form' }, nodes);
    const m = modal({ title, body: form, onClose: () => !done && resolve(null), actions: [h('button', { class: `btn ${cls}`, onclick: () => { done = true; const v = vals(form); m.close(); resolve(v); } }, okLabel)] });
  });
}

export function paymentSheet(ctx, kind, c0) {
  const k = kind === 'lifafa' ? 'lifafa' : 'item';
  const c = { ...c0, ...(ctx.D[k === 'lifafa' ? 'lifafa' : 'contributions'][c0.id] || {}), id: c0.id };
  const call = async (btn, action, data, done) => {
    const r = await run(btn, () => backend.call(action, { id: c.id, kind: k, ...data }));
    if (r) { m.close(); toast(done, 'ok'); }
  };
  const verify = async (e) => {
    const btn = e.currentTarget;
    const v = await askForm('Confirm you received this money', [
      h('p', { class: 'muted' }, 'Check your bank statement or UPI app first. Only verify if the money has actually arrived.'),
      c.utr && h('div', { class: 'note info' }, `Look for UPI reference ${c.utr}, or the note "${c.refCode}".`),
      field('Amount received (₹)', input({ name: 'receivedAmount', type: 'number', inputmode: 'numeric', value: c.amount }), `The guest reported ${inr(c.amount)}. Change this only if a different amount arrived.`),
      field('Note (optional)', input({ name: 'note', maxlength: 200 }))], 'Yes, I received it');
    if (v) call(btn, 'verifyContribution', v, 'Payment verified');
  };
  const reject = async (e) => {
    const btn = e.currentTarget;
    const v = await askForm('Reject this payment report', [field('Reason (the guest will see this)', input({ name: 'reason', maxlength: 200, value: 'We could not find this payment in our bank statement' }))], 'Reject', 'danger');
    if (v) call(btn, 'rejectContribution', v, 'Marked as rejected');
  };
  const refund = async (e) => {
    const btn = e.currentTarget;
    const v = await askForm('Record a refund', [h('p', { class: 'muted' }, 'Use this after you have sent the money back to the guest yourself. It removes the amount from your received total; the original record is kept.'), field('Refund note', input({ name: 'note', maxlength: 200 }))], 'Record refund', 'danger');
    if (v) call(btn, 'refundContribution', v, 'Refund recorded');
  };
  const row = (k2, v) => (v || v === 0 ? [h('dt', {}, k2), h('dd', {}, v)] : []);
  const history = entries(c.history).sort((a, z) => a.at - z.at);
  const m = modal({
    title: c.guestName, wide: true,
    body: h('div', { class: 'col' },
      h('div', { class: 'row between' }, h('div', { class: 'amount-big num' }, inr(c.verifiedAmount || c.amount)), statusBadge(c.status)),
      c.flags?.duplicateUtr && h('div', { class: 'note' }, `This guest tried to use UTR ${c.flags.duplicateUtr}, which was already submitted for another gift. Verify with extra care.`),
      h('dl', { class: 'kv' }, row('For', c.itemName || 'Lifafa'), row('Guest', c.anonymous ? `${c.guestName} (anonymous to the public)` : c.guestName), row('Reported amount', inr(c.amount)),
        c.verifiedAmount && c.verifiedAmount !== c.amount ? row('Amount received', inr(c.verifiedAmount)) : [], row('UPI reference (UTR)', c.utr || 'Not given yet'), row('Our reference', c.refCode),
        row('Started', fmtDate(c.createdAt, true)), row('Rejection reason', c.rejectedReason), row('Refund note', c.refundNote)),
      c.message && h('div', { class: 'wish' }, h('p', {}, `“${c.message}”`), h('div', { class: 'small muted' }, c.messagePublic ? 'The guest is happy for this to be shown publicly.' : 'Private message')),
      h('details', {}, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'History'), h('div', { class: 'col small', style: 'gap:4px;margin-top:8px' }, history.map((x) => h('div', { class: 'row between' }, h('span', {}, `${STATUS[x.status]?.[0] || x.status} · by ${x.by}`), h('span', { class: 'muted' }, fmtDate(x.at, true)))))),
    ),
    actions: [
      (AW.includes(c.status) || c.status === 'REJECTED') && h('button', { class: 'btn primary', onclick: verify }, icon('check'), 'Verify'),
      AW.includes(c.status) && h('button', { class: 'btn danger', onclick: reject }, 'Reject'),
      c.status === 'VERIFIED' && h('button', { class: 'btn primary', onclick: () => { m.close(); cardEditor(ctx, c, k); } }, icon('card'), 'Thank-you card'),
      c.status === 'VERIFIED' && c.message && c.messagePublic && h('button', { class: 'btn', onclick: (e) => call(e.currentTarget, 'setWallApproval', { approved: !c.wallApproved }, c.wallApproved ? 'Message hidden' : 'Message is now on your wishlist page') }, c.wallApproved ? 'Hide message' : 'Show message publicly'),
      c.status === 'VERIFIED' && h('button', { class: 'btn danger', onclick: refund }, 'Refund'),
    ].filter(Boolean),
  });
}

export function payments(ctx, kind) {
  const node = kind === 'lifafa' ? 'lifafa' : 'contributions';
  const all = entries(ctx.D[node]).sort((a, z) => z.updatedAt - a.updatedAt);
  const groupsOf = { action: all.filter((c) => AW.includes(c.status)), verified: all.filter((c) => c.status === 'VERIFIED'), other: all.filter((c) => !AW.includes(c.status) && c.status !== 'VERIFIED') };
  const list = groupsOf[tabs[kind]];
  const total = (arr, f) => arr.reduce((s, c) => s + f(c), 0);
  const exportCsv = () => download(new Blob([toCsv([['Date', 'Guest', 'Anonymous', 'For', 'Amount reported', 'Amount verified', 'Status', 'UTR', 'Reference', 'Method', 'Message', 'Verified on'],
    ...all.filter((c) => c.status !== 'INITIATED').map((c) => [fmtDate(c.createdAt, true), c.guestName, c.anonymous ? 'Yes' : 'No', c.itemName || 'Lifafa', c.amount, c.verifiedAmount || '', STATUS[c.status][0], c.utr || '', c.refCode, c.method, c.message || '', c.verifiedAt ? fmtDate(c.verifiedAt, true) : ''])])], { type: 'text/csv' }), `${node}.csv`);
  return [
    h('div', { class: 'stats', style: 'margin-bottom:14px' },
      h('div', { class: 'stat hl' }, h('small', {}, kind === 'lifafa' ? 'Lifafa received' : 'Verified contributions'), h('b', { class: 'num' }, inr(total(groupsOf.verified, (c) => c.verifiedAmount)))),
      h('div', { class: 'stat' }, h('small', {}, 'Pending verification'), h('b', { class: 'num' }, inr(total(groupsOf.action, (c) => c.amount)))),
      h('div', { class: 'stat' }, h('small', {}, kind === 'lifafa' ? 'Envelopes' : 'Contributors'), h('b', { class: 'num' }, groupsOf.verified.length))),
    kind === 'lifafa' && h('p', { class: 'small muted', style: 'margin-bottom:10px' }, 'Lifafa is kept separate. It is never added to your wishlist budget or completion percentage.'),
    h('div', { class: 'row between wrap' }, h('div', { class: 'tabs' }, [['action', 'Needs action'], ['verified', 'Verified'], ['other', 'Other']].map(([id, label]) => h('button', { class: `tab${tabs[kind] === id ? ' on' : ''}`, onclick: () => { tabs[kind] = id; ctx.rerender(); } }, label, id === 'action' && groupsOf.action.length ? h('span', { class: 'dot' }, groupsOf.action.length) : null))),
      all.length ? h('button', { class: 'btn ghost sm', onclick: exportCsv }, icon('download', 16), 'Export CSV') : null),
    list.length ? h('div', { class: 'list' }, list.map((c) => h('div', { class: 'rowcard click', onclick: () => paymentSheet(ctx, kind, c) }, h('div', { class: 'who' }, initials(c.guestName)),
      h('div', { class: 'grow' }, h('div', { class: 'row wrap', style: 'gap:6px' }, h('b', {}, c.guestName), c.anonymous && h('span', { class: 'badge plain' }, 'Anonymous'), c.groupGiftId && h('span', { class: 'badge' }, 'Group'), c.flags && h('span', { class: 'badge bad' }, 'Check')),
        h('div', { class: 'small muted' }, `${c.itemName || 'Lifafa'} · ${c.utr ? `UTR ${c.utr}` : 'no UTR'} · ${ago(c.updatedAt)}`)),
      h('div', { style: 'text-align:right' }, h('b', { class: 'num' }, inr(c.verifiedAmount || c.amount)), h('div', {}, statusBadge(c.status))))))
      : empty(kind === 'lifafa' ? 'envelope' : 'wallet', tabs[kind] === 'action' ? 'Nothing waiting for you' : 'Nothing here yet', tabs[kind] === 'action' ? 'New payment reports from guests will appear here for you to verify.' : 'Records will appear here as guests contribute.'),
  ];
}

export function groups(ctx) {
  const list = entries(ctx.D.groups).sort((a, z) => z.createdAt - a.createdAt);
  if (!list.length) return empty('users', 'No group gifts yet', 'When friends team up for an expensive item, their group and each person\'s share appears here.');
  return h('div', { class: 'list' }, list.map((g) => {
    const members = entries(g.members);
    const url = pageUrl('contribution.html', { w: ctx.D.couple.slug, item: g.itemId, g: g.id });
    return h('div', { class: 'card col' }, h('div', { class: 'row between' }, h('div', {}, h('h3', {}, g.title || `${g.organizer}'s group`), h('div', { class: 'small muted' }, `${g.itemName} · started by ${g.organizer}`)), g.completedAt ? h('span', { class: 'badge ok' }, 'Goal completed') : h('span', { class: 'badge warn' }, 'In progress')),
      bar((g.verified / g.target) * 100, (g.pending / g.target) * 100), h('div', { class: 'small num' }, h('b', {}, inr(g.verified)), ` verified of ${inr(g.target)}`, g.pending ? ` · ${inr(g.pending)} pending` : ''),
      members.map((m) => h('div', { class: 'row between small' }, h('span', {}, m.name, m.anonymous ? ' (anonymous)' : ''), h('span', { class: 'row' }, h('b', { class: 'num' }, inr(m.amount)), h('span', { class: `badge ${m.status === 'verified' ? 'ok' : 'warn'}` }, m.status)))),
      h('button', { class: 'btn ghost sm', onclick: () => copy(url, 'Group link copied') }, icon('copy', 16), 'Copy group link'));
  }));
}

// ------------------------------------------------------------ thank-you cards
/** The greeting printed on a card. An anonymous guest's name is never used. */
export const cardGreeting = (c) => (c.anonymous ? 'Dear Well-wisher' : `Dear ${c.guestName}`);

export function cardEditor(ctx, c, kind) {
  const canvas = h('canvas', { class: 'cardprev' });
  let theme = ctx.D.couple.theme || 'marigold';
  let saved = false;
  const message = input({ rows: 4, maxlength: 320, value: 'Thank you for being part of our special journey. Your love and generosity mean so much to us.' });
  const draw = () => renderCard(canvas, { kind: 'thanks', theme, names: ctx.names(), message: message.value, guest: cardGreeting(c) });
  message.oninput = draw;
  const chips = h('div', { class: 'chips' });
  const paint = () => chips.replaceChildren(...Object.entries(THEMES).map(([id, t]) => h('button', { class: `chip${theme === id ? ' on' : ''}`, onclick: () => { theme = id; paint(); draw(); } }, t.label)));
  const record = async () => {
    if (saved) return true;
    const r = await run(null, () => backend.call('saveThankYouCard', { contributionId: c.id, kind, template: theme, message: message.value }));
    saved = !!r;
    return saved;
  };
  const file = async () => new File([await canvasBlob(canvas)], 'thank-you.png', { type: 'image/png' });
  paint();
  draw();
  modal({
    title: 'Thank-you card', wide: true,
    body: h('div', { class: 'col' }, c.anonymous && h('div', { class: 'note info' }, 'This guest gave anonymously, so their name is not printed on the card.'), canvas, chips, field('Your message', message)),
    actions: [
      h('button', { class: 'btn primary', onclick: async (e) => { if (await run(e.currentTarget, record)) download(await file(), 'thank-you.png'); } }, icon('download'), 'Download image'),
      h('button', { class: 'btn mint', onclick: async (e) => {
        if (!(await run(e.currentTarget, record))) return;
        const f = await file();
        if (navigator.canShare && navigator.canShare({ files: [f] })) share({ files: [f], text: message.value });
        else { download(f, 'thank-you.png'); window.open(waLink(message.value), '_blank', 'noopener'); toast('Card downloaded. Attach it in WhatsApp.', 'ok'); }
      } }, icon('chat'), 'Share on WhatsApp'),
    ],
  });
}

export function cards(ctx) {
  const all = [...entries(ctx.D.contributions), ...entries(ctx.D.lifafa)].filter((c) => c.status === 'VERIFIED').sort((a, z) => z.verifiedAt - a.verifiedAt);
  if (!all.length) return empty('card', 'No one to thank yet', 'Once you verify a contribution, you can send that guest a personalised thank-you card from here.');
  const waiting = all.filter((c) => !c.thankedAt).length;
  return [h('p', { class: 'muted', style: 'margin-bottom:12px' }, waiting ? `${waiting} guest${waiting > 1 ? 's are' : ' is'} waiting for a thank-you.` : 'Everyone has been thanked.'),
    h('div', { class: 'list' }, all.map((c) => h('div', { class: 'rowcard' }, h('div', { class: 'who' }, initials(c.guestName)),
      h('div', { class: 'grow' }, h('b', {}, c.guestName), h('div', { class: 'small muted' }, `${inr(c.verifiedAmount)} · ${c.itemName || 'Lifafa'}`)),
      c.thankedAt ? h('span', { class: 'badge ok' }, icon('check', 13), 'Thanked') : null,
      h('button', { class: `btn sm ${c.thankedAt ? 'ghost' : 'primary'}`, onclick: () => cardEditor(ctx, c, c.kind) }, c.thankedAt ? 'Send again' : 'Create card'))))];
}
