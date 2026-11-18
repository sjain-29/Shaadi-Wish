// Guest <-> couple messaging and physical-gift reservations.
//
// Guests have no account. When a guest starts a conversation the server creates
// a secret 192-bit token; the guest's copy of the thread lives at
// /guestThreads/{token}. Knowing the token is the only way to read it, and the
// database rules do not allow listing tokens, so one guest can never open
// another guest's conversation.
import { fail } from './errors.js';
import { V } from './validate.js';
import { randomToken, snippet } from './util.js';
import { namesOf, audit, loadActiveCouple } from './common.js';
import { commitItem } from './items.js';

/** Appends one message to both copies of a thread and updates unread counters, atomically. */
async function post(ctx, coupleId, convId, conv, message, notify) {
  const id = ctx.db.newId();
  const c = `conversations/${coupleId}/${convId}`;
  const g = `guestThreads/${conv.token}`;
  const updates = {
    [`messages/${coupleId}/${convId}/${id}`]: message,
    [`${g}/messages/${id}`]: message,
    [`${c}/lastAt`]: message.at,
    [`${c}/lastText`]: snippet(message.text),
    [`${c}/lastFrom`]: message.from,
    [`${g}/meta/lastAt`]: message.at,
  };
  if (notify === 'couple') updates[`${c}/unreadCouple`] = ctx.db.increment(1);
  else updates[`${g}/meta/unreadGuest`] = ctx.db.increment(1);
  await ctx.db.update(updates);
  return id;
}

const system = (ctx, text) => ({ from: 'system', kind: 'system', text, at: ctx.now() });

async function open(ctx, req, { coupleId, couple, type, item, itemId, guestName, text, extra = {}, metaExtra = {} }) {
  const convId = ctx.db.newId();
  const token = randomToken();
  const now = ctx.now();
  const message = { from: 'guest', kind: 'text', text, at: now };
  const messageId = ctx.db.newId();
  const shared = { type, itemId: itemId || null, itemName: item ? item.name : null, guestName, createdAt: now, lastAt: now };
  await ctx.db.update({
    [`conversations/${coupleId}/${convId}`]: { ...shared, token, lastText: snippet(text), lastFrom: 'guest', unreadCouple: 1, archived: false, ...extra },
    [`messages/${coupleId}/${convId}/${messageId}`]: message,
    [`guestThreads/${token}`]: {
      meta: { ...shared, coupleId, convId, slug: couple.slug, coupleNames: namesOf(couple), unreadGuest: 0, ...metaExtra },
      messages: { [messageId]: message },
    },
  });
  return { convId, token };
}

async function guestThread(ctx, token) {
  const meta = await ctx.db.get(`guestThreads/${V.token(token)}/meta`);
  if (!meta) fail('not-found', 'This conversation link is not valid.');
  // Everything a guest needs is in their own copy; they never read the couple's private nodes.
  const conv = { token, itemId: meta.itemId || null, guestName: meta.guestName, reservationId: meta.reservation ? meta.reservation.id : null };
  return { coupleId: meta.coupleId, convId: meta.convId, conv };
}

async function coupleThread(ctx, req) {
  const convId = V.id(req.data.convId, 'conversation');
  const conv = await ctx.db.get(`conversations/${req.coupleId}/${convId}`);
  if (!conv) fail('not-found', 'This conversation no longer exists.');
  return { coupleId: req.coupleId, convId, conv };
}

// ---------------------------------------------------------------- messaging

/** Guest asks a question about an item, or sends wedding wishes. */
export async function askQuestion(ctx, req) {
  const d = req.data;
  const coupleId = V.id(d.coupleId, 'couple');
  const couple = await loadActiveCouple(ctx, coupleId);
  const type = V.oneOf(d.type || 'question', ['question', 'wish'], 'type');
  let item = null;
  let itemId = null;
  if (type === 'question' && d.itemId) {
    itemId = V.id(d.itemId, 'item');
    item = await ctx.db.get(`publicWishlists/${coupleId}/${itemId}`);
    if (!item) fail('not-found', 'This wishlist item is not available.');
  }
  const result = await open(ctx, req, {
    coupleId,
    couple,
    type,
    item,
    itemId,
    guestName: V.text(d.guestName, { name: 'Your name', min: 2, max: 60 }),
    text: V.text(d.message, { name: 'Message', min: 2, max: 1000, multiline: true }),
    extra: type === 'wish' ? { wishPublic: !!d.isPublic, wallApproved: false } : {},
  });
  return { token: result.token };
}

export async function sendMessage(ctx, req) {
  const text = V.text(req.data.text, { name: 'Message', min: 1, max: 1000, multiline: true });
  if (req.data.token) {
    const { coupleId, convId, conv } = await guestThread(ctx, req.data.token);
    await loadActiveCouple(ctx, coupleId);
    await post(ctx, coupleId, convId, conv, { from: 'guest', kind: 'text', text, at: ctx.now() }, 'couple');
    return { ok: true };
  }
  if (!req.auth || req.auth.role !== 'couple') fail('unauthenticated', 'Please sign in again.');
  const { coupleId, convId, conv } = await coupleThread(ctx, req);
  await post(ctx, coupleId, convId, conv, { from: 'couple', kind: 'text', text, at: ctx.now() }, 'guest');
  return { ok: true };
}

export async function markRead(ctx, req) {
  if (req.data.token) {
    const token = V.token(req.data.token);
    if (!(await ctx.db.get(`guestThreads/${token}/meta/convId`))) fail('not-found', 'This conversation link is not valid.');
    await ctx.db.set(`guestThreads/${token}/meta/unreadGuest`, 0);
    return { ok: true };
  }
  if (!req.auth || req.auth.role !== 'couple') fail('unauthenticated', 'Please sign in again.');
  const { coupleId, convId } = await coupleThread(ctx, req);
  await ctx.db.set(`conversations/${coupleId}/${convId}/unreadCouple`, 0);
  return { ok: true };
}

export async function archiveConversation(ctx, req) {
  const { coupleId, convId } = await coupleThread(ctx, req);
  await ctx.db.set(`conversations/${coupleId}/${convId}/archived`, !!req.data.archived);
  return { archived: !!req.data.archived };
}

/** Couple approves (or hides) a guest's public wedding wish on the wishlist page. */
export async function setWishApproval(ctx, req) {
  const { coupleId, convId, conv } = await coupleThread(ctx, req);
  if (conv.type !== 'wish' || !conv.wishPublic) fail('failed-precondition', 'This guest asked to keep their message private.');
  const approved = !!req.data.approved;
  const first = Object.values((await ctx.db.get(`messages/${coupleId}/${convId}`)) || {}).find((m) => m.from === 'guest');
  await ctx.db.update({
    [`conversations/${coupleId}/${convId}/wallApproved`]: approved,
    [`publicFeed/${coupleId}/wall/${convId}`]: approved && first ? { name: conv.guestName, text: first.text, at: first.at } : null,
  });
  return { approved };
}

// ------------------------------------------------------------ gift reservations
// DISCUSSING -> RESERVED -> RECEIVED, or CANCELLED before receipt.
// Sending a message never reserves or completes an item. Only an explicit
// confirmation does, and the item is claimed inside a transaction so two
// guests confirming at the same instant cannot both succeed.

async function setReservation(ctx, coupleId, resId, conv, from, status, by, extra = {}) {
  let before = null;
  const result = await ctx.db.transaction(`reservations/${coupleId}/${resId}`, (r) => {
    if (r === null) return null;
    before = structuredClone(r);
    if (!from.includes(r.status)) return undefined;
    const at = ctx.now();
    return { ...r, ...extra, status, updatedAt: at, history: { ...(r.history || {}), [ctx.db.newId()]: { status, at, by } } };
  });
  if (result.value === null) fail('not-found', 'This gift reservation could not be found.');
  if (!result.committed) fail('failed-precondition', `This gift is already ${before.status.toLowerCase()}.`, { status: before.status });
  await ctx.db.set(`guestThreads/${conv.token}/meta/reservation/status`, status);
  return result.value;
}

/** Guest: "I want to gift this item" (option A - buy the exact product). Starts a conversation only. */
export async function startGift(ctx, req) {
  const d = req.data;
  const coupleId = V.id(d.coupleId, 'couple');
  const itemId = V.id(d.itemId, 'item');
  const couple = await loadActiveCouple(ctx, coupleId);
  const item = await ctx.db.get(`publicWishlists/${coupleId}/${itemId}`);
  if (!item) fail('not-found', 'This wishlist item is not available.');
  if (item.state !== 'OPEN') fail('failed-precondition', item.state === 'RESERVED' ? 'Another guest has already reserved this gift.' : 'This wish has already been fulfilled.');
  if (item.giftable === false) fail('failed-precondition', 'Other guests have already contributed towards this item. You can contribute the remaining amount instead.');
  const guestName = V.text(d.guestName, { name: 'Your name', min: 2, max: 60 });
  const text = V.text(d.message, { name: 'Message', min: 2, max: 1000, multiline: true });
  const resId = ctx.db.newId();
  const now = ctx.now();
  const { convId, token } = await open(ctx, req, {
    coupleId,
    couple,
    type: 'gift',
    item,
    itemId,
    guestName,
    text,
    extra: { reservationId: resId },
    metaExtra: { reservation: { id: resId, status: 'DISCUSSING' } },
  });
  await ctx.db.set(`reservations/${coupleId}/${resId}`, {
    itemId,
    itemName: item.name,
    guestName,
    convId,
    status: 'DISCUSSING',
    createdAt: now,
    updatedAt: now,
    history: { [ctx.db.newId()]: { status: 'DISCUSSING', at: now, by: 'guest' } },
  });
  await audit(ctx, req, coupleId, 'gift.discussion_started', { reservationId: resId, itemId, guest: guestName });
  return { token };
}

/** Couple replies with the exact product they would like. */
export async function sendGiftDetails(ctx, req) {
  const { coupleId, convId, conv } = await coupleThread(ctx, req);
  if (!conv.reservationId) fail('failed-precondition', 'This conversation is not about a gift.');
  const d = req.data;
  const details = {
    brand: V.text(d.brand, { name: 'Brand', max: 60 }) || null,
    model: V.text(d.model, { name: 'Model', max: 80 }) || null,
    link: V.url(d.link, { name: 'Product link' }) || null,
    specs: V.text(d.specs, { name: 'Specifications', max: 300, multiline: true }) || null,
    notes: V.text(d.notes, { name: 'Notes', max: 300, multiline: true }) || null,
  };
  if (!Object.values(details).some(Boolean)) fail('invalid-argument', 'Please fill in at least one detail.');
  await ctx.db.update({
    [`reservations/${coupleId}/${conv.reservationId}/agreed`]: details,
    [`guestThreads/${conv.token}/meta/reservation/agreed`]: details,
  });
  const text = [details.brand, details.model].filter(Boolean).join(' ') || 'Gift details';
  await post(ctx, coupleId, convId, conv, { from: 'couple', kind: 'details', text, details, at: ctx.now() }, 'guest');
  return { ok: true };
}

/**
 * Guest tells the couple what they intend (confirm / purchased / cancel).
 * This only posts a notice in the thread. A guest's browser is never allowed
 * to change an item, so the couple makes the actual reservation.
 */
export async function guestGiftNotice(ctx, req) {
  const { coupleId, convId, conv } = await guestThread(ctx, req.data.token);
  if (!conv.reservationId) fail('failed-precondition', 'This conversation is not about a gift.');
  await loadActiveCouple(ctx, coupleId);
  const intent = V.oneOf(req.data.intent, ['confirm', 'purchased', 'cancel'], 'intent');
  const text = {
    confirm: `${conv.guestName} is ready to gift this item. Please mark it as reserved for them.`,
    purchased: `${conv.guestName} has purchased the gift.`,
    cancel: `${conv.guestName} can no longer gift this item. Please release the reservation.`,
  }[intent];
  await post(ctx, coupleId, convId, conv, system(ctx, text), 'couple');
  return { ok: true };
}

async function release(ctx, coupleId, itemId, resId) {
  await commitItem(ctx, coupleId, itemId, (item) => {
    if (item.reservation && item.reservation.id === resId) item.reservation = null;
    return item;
  });
}

async function reservationForCouple(ctx, req) {
  const resId = V.id(req.data.reservationId, 'reservation');
  const reservation = await ctx.db.get(`reservations/${req.coupleId}/${resId}`);
  if (!reservation) fail('not-found', 'This gift reservation could not be found.');
  const conv = await ctx.db.get(`conversations/${req.coupleId}/${reservation.convId}`);
  if (!conv) fail('not-found', 'This gift reservation could not be found.');
  return { coupleId: req.coupleId, resId, reservation, conv, convId: reservation.convId };
}

/**
 * Couple reserves the item for this guest. The item is claimed inside a
 * transaction, so it can only ever be reserved for one guest at a time.
 */
export async function confirmReservation(ctx, req) {
  const { coupleId, resId, reservation, conv, convId } = await reservationForCouple(ctx, req);
  if (reservation.status !== 'DISCUSSING') fail('failed-precondition', 'This gift can no longer be reserved.');
  await commitItem(ctx, coupleId, reservation.itemId, (item) => {
    if (item.deleted) fail('not-found', 'This wishlist item no longer exists.');
    if (item.state === 'RESERVED') fail('already-exists', 'This item is already reserved for another guest.');
    if (item.state !== 'OPEN') fail('failed-precondition', 'This wish has already been fulfilled.');
    if (item.stats.verified > 0) fail('failed-precondition', 'Guests have already contributed money towards this item.');
    item.reservation = { id: resId, state: 'RESERVED', at: ctx.now() };
    return item;
  });
  try {
    await setReservation(ctx, coupleId, resId, conv, ['DISCUSSING'], 'RESERVED', 'couple');
  } catch (err) {
    await release(ctx, coupleId, reservation.itemId, resId);
    throw err;
  }
  await post(ctx, coupleId, convId, conv, system(ctx, 'The couple has reserved this item for you. Thank you!'), 'guest');
  await audit(ctx, req, coupleId, 'gift.reserved', { reservationId: resId, itemId: reservation.itemId, guest: reservation.guestName });
  return { status: 'RESERVED' };
}

/** Couple confirms the gift arrived. Only now does the item become Completed. */
export async function confirmReceipt(ctx, req) {
  const { coupleId, resId, reservation, conv, convId } = await reservationForCouple(ctx, req);
  await setReservation(ctx, coupleId, resId, conv, ['RESERVED'], 'RECEIVED', 'couple');
  await commitItem(ctx, coupleId, reservation.itemId, (item) => {
    if (item.reservation && item.reservation.id === resId) item.reservation.state = 'RECEIVED';
    return item;
  });
  await post(ctx, coupleId, convId, conv, system(ctx, 'The couple has received this gift. Thank you!'), 'guest');
  await audit(ctx, req, coupleId, 'gift.received', { reservationId: resId, itemId: reservation.itemId });
  return { status: 'RECEIVED' };
}

/** Couple declines a request or releases a reservation; the item opens up again. */
export async function cancelReservation(ctx, req) {
  const { coupleId, resId, reservation, conv, convId } = await reservationForCouple(ctx, req);
  await setReservation(ctx, coupleId, resId, conv, ['DISCUSSING', 'RESERVED'], 'CANCELLED', 'couple');
  await release(ctx, coupleId, reservation.itemId, resId);
  await post(ctx, coupleId, convId, conv, system(ctx, 'The couple released this reservation. The item is open again.'), 'guest');
  await audit(ctx, req, coupleId, 'gift.cancelled', { reservationId: resId, itemId: reservation.itemId });
  return { status: 'CANCELLED' };
}
