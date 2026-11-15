// Contributions and Lifafa: the money records.
//
//   - A guest's browser may only CREATE a payment report (status
//     PENDING_VERIFICATION). The database rules stop it changing anything else.
//   - Only the couple (or the admin) can mark a report VERIFIED, and only
//     verified money counts as received.
//   - Status changes go through transition(), a compare-and-set transaction,
//     so each one is applied exactly once.
//   - Records are never deleted; every change is appended to `history`.
//   - Lifafa has its own totals and never touches the wishlist budget.
import { fail } from './errors.js';
import { V } from './validate.js';
import { randomToken, refCode, inr } from './util.js';
import { S, AWAITING, namesOf, publicName, actorOf, audit, getSettings, loadActiveCouple, bumpStats } from './common.js';
import { commitItem } from './items.js';
import { updateGroupLedger } from './groups.js';

const col = (kind) => (kind === 'lifafa' ? 'lifafa' : 'contributions');
const kindOf = (value) => V.oneOf(value || 'item', ['item', 'lifafa'], 'kind');
const LABEL = { PENDING_VERIFICATION: 'waiting for verification', VERIFIED: 'verified', REJECTED: 'rejected', REFUNDED: 'refunded' };

function stamp(ctx, c, status, by, extra = {}) {
  c.status = status;
  c.updatedAt = ctx.now();
  c.history = { ...(c.history || {}), [ctx.db.newId()]: { status, at: c.updatedAt, by, ...extra } };
  return c;
}

async function transition(ctx, path, from, mutate) {
  let before = null;
  const result = await ctx.db.transaction(path, (current) => {
    if (current === null) return null;
    before = structuredClone(current);
    if (!from.includes(current.status)) return undefined;
    return mutate(current);
  });
  if (result.value === null) fail('not-found', 'This payment record could not be found.');
  if (!result.committed) fail('failed-precondition', `This payment is already ${LABEL[before.status] || before.status}.`, { status: before.status });
  return { before, after: result.value };
}

/** Adds or removes verified money from the totals. */
async function applyLedger(ctx, coupleId, id, c, { verified = 0, contributors = 0 }) {
  if (c.kind === 'lifafa') {
    await bumpStats(ctx, coupleId, { lifafaVerified: verified, lifafaCount: contributors });
    return;
  }
  await commitItem(ctx, coupleId, c.itemId, (item) => {
    item.stats.verified += verified;
    item.stats.contributors += contributors;
    return item;
  });
  await bumpStats(ctx, coupleId, { verified, contributors });
  if (c.groupGiftId) await updateGroupLedger(ctx, coupleId, c.groupGiftId, id, c, { verified });
}

/** Keeps the guest's status page and the public feed in step with a record. */
async function publish(ctx, coupleId, id, c) {
  const verified = c.status === S.VERIFIED;
  const showOnFeed = verified && (await ctx.db.get(`couples/${coupleId}/showContributors`)) !== false;
  const updates = {
    [`guestReceipts/${c.receipt}/status`]: c.status,
    [`guestReceipts/${c.receipt}/updatedAt`]: c.updatedAt,
    [`guestReceipts/${c.receipt}/rejectedReason`]: c.status === S.REJECTED ? c.rejectedReason || null : null,
    [`publicFeed/${coupleId}/contributors/${id}`]: showOnFeed ? { name: publicName(c), kind: c.kind, itemName: c.itemName || null, at: c.verifiedAt } : null,
  };
  if (!verified) updates[`publicFeed/${coupleId}/wall/${id}`] = null;
  await ctx.db.update(updates);
}

/**
 * Guest reports a payment they have already made, with its 12-digit UTR.
 * This creates a record waiting for the couple. It does not count as received.
 */
export async function createContribution(ctx, req) {
  const d = req.data;
  const kind = kindOf(d.kind);
  const coupleId = V.id(d.coupleId, 'couple');
  const [couple, settings] = await Promise.all([loadActiveCouple(ctx, coupleId), getSettings(ctx)]);
  if (!couple.upiId) fail('failed-precondition', 'This couple has not set up payments yet. Please check back soon.');

  const now = ctx.now();
  const message = V.text(d.message, { name: 'Message', max: 500, multiline: true });
  const c = {
    kind,
    amount: V.amount(d.amount, { min: settings.minAmount, max: settings.maxAmount }),
    guestName: V.text(d.guestName, { name: 'Your name', min: 2, max: 60 }),
    anonymous: !!d.anonymous,
    message: message || null,
    messagePublic: !!message && !!d.messagePublic,
    utr: V.utr(d.utr),
    refCode: typeof d.refCode === 'string' && /^SW[A-Z2-9]{6}$/.test(d.refCode) ? d.refCode : refCode(),
    method: 'upi',
    receipt: randomToken(),
    createdAt: now,
  };

  if (kind === 'item') {
    const itemId = V.id(d.itemId, 'item');
    const item = await ctx.db.get(`publicWishlists/${coupleId}/${itemId}`);
    if (!item) fail('not-found', 'This wishlist item is not available.');
    if (item.state === 'COMPLETED') fail('failed-precondition', 'This wish has already been fulfilled.');
    if (item.state === 'RESERVED') fail('failed-precondition', 'Another guest has reserved this gift.');
    const remaining = Math.max(0, item.budget - (item.received || 0));
    if (c.amount > remaining) fail('invalid-argument', `Only ${inr(remaining)} is still needed for this wish.`);
    if (d.fullGift && c.amount !== remaining) fail('invalid-argument', `The remaining amount for this gift is now ${inr(remaining)}.`, { remaining });
    Object.assign(c, { itemId, itemName: item.name, fullGift: !!d.fullGift });
    if (d.groupGiftId) {
      const groupGiftId = V.id(d.groupGiftId, 'group');
      const group = await ctx.db.get(`publicGroupGifts/${coupleId}/${groupGiftId}`);
      if (!group || group.itemId !== itemId) fail('not-found', 'This group gift link is no longer valid.');
      Object.assign(c, { groupGiftId, showAmount: d.showAmount !== false });
    }
  }

  // One UTR can back exactly one gift, across the whole platform.
  // The database rules also refuse a second claim, whatever code a visitor runs.
  let claimed = false;
  try {
    claimed = (await ctx.db.transaction(`utrIndex/${c.utr}`, (cur) => (cur === null ? { at: now } : undefined))).committed;
  } catch {
    claimed = false;
  }
  if (!claimed) fail('already-exists', 'This UPI reference number has already been submitted for another gift. Please check the 12-digit number and try again.');

  stamp(ctx, c, S.PENDING, 'guest');
  const id = ctx.db.newId();
  await ctx.db.update({
    [`${col(kind)}/${coupleId}/${id}`]: c,
    [`guestReceipts/${c.receipt}`]: {
      coupleId, id, kind, slug: couple.slug, coupleNames: namesOf(couple), itemId: c.itemId || null, itemName: c.itemName || null,
      groupGiftId: c.groupGiftId || null, amount: c.amount, refCode: c.refCode, status: c.status, createdAt: now, updatedAt: now,
    },
  });
  return { id, receipt: c.receipt, refCode: c.refCode, status: c.status };
}

/** The couple (or the admin, in a dispute) confirms the money reached the bank account. */
export async function verifyContribution(ctx, req) {
  const d = req.data;
  const kind = kindOf(d.kind);
  const id = V.id(d.id, 'payment');
  const received = d.receivedAmount === undefined || d.receivedAmount === null || d.receivedAmount === '' ? null : V.amount(d.receivedAmount, { name: 'Amount received' });
  const note = V.text(d.note, { name: 'Note', max: 200 });
  const by = actorOf(req);
  const { after } = await transition(ctx, `${col(kind)}/${req.coupleId}/${id}`, [S.PENDING, S.REJECTED], (c) => {
    Object.assign(c, { verifiedAmount: received ?? c.amount, verifiedAt: ctx.now(), verifiedBy: req.auth.uid, verifyNote: note || null, rejectedReason: null });
    return stamp(ctx, c, S.VERIFIED, by, c.verifiedAmount !== c.amount ? { received: c.verifiedAmount } : {});
  });
  await applyLedger(ctx, req.coupleId, id, after, { verified: after.verifiedAmount, contributors: 1 });
  await publish(ctx, req.coupleId, id, after);
  await audit(ctx, req, req.coupleId, 'payment.verified', { id, kind, reported: after.amount, received: after.verifiedAmount, guest: after.guestName });
  return { status: after.status, verifiedAmount: after.verifiedAmount };
}

export async function rejectContribution(ctx, req) {
  const d = req.data;
  const kind = kindOf(d.kind);
  const id = V.id(d.id, 'payment');
  const reason = V.text(d.reason, { name: 'Reason', min: 3, max: 200 });
  const { after } = await transition(ctx, `${col(kind)}/${req.coupleId}/${id}`, AWAITING, (c) => {
    Object.assign(c, { rejectedReason: reason, rejectedAt: ctx.now(), rejectedBy: req.auth.uid });
    return stamp(ctx, c, S.REJECTED, actorOf(req), { reason });
  });
  await publish(ctx, req.coupleId, id, after);
  await audit(ctx, req, req.coupleId, 'payment.rejected', { id, kind, amount: after.amount, reason });
  return { status: after.status };
}

/** Records that verified money was returned to the guest. The original record stays. */
export async function refundContribution(ctx, req) {
  const d = req.data;
  const kind = kindOf(d.kind);
  const id = V.id(d.id, 'payment');
  const note = V.text(d.note, { name: 'Refund note', min: 3, max: 200 });
  const { before, after } = await transition(ctx, `${col(kind)}/${req.coupleId}/${id}`, [S.VERIFIED], (c) => {
    Object.assign(c, { refundedAt: ctx.now(), refundNote: note, wallApproved: null });
    return stamp(ctx, c, S.REFUNDED, actorOf(req), { note });
  });
  await applyLedger(ctx, req.coupleId, id, after, { verified: -before.verifiedAmount, contributors: -1 });
  await publish(ctx, req.coupleId, id, after);
  await audit(ctx, req, req.coupleId, 'payment.refunded', { id, kind, amount: before.verifiedAmount, note });
  return { status: after.status };
}

/** Couple chooses whether a guest's public message appears on the wishlist page. */
export async function setWallApproval(ctx, req) {
  const kind = kindOf(req.data.kind);
  const id = V.id(req.data.id, 'payment');
  const approved = !!req.data.approved;
  const path = `${col(kind)}/${req.coupleId}/${id}`;
  const c = await ctx.db.get(path);
  if (!c) fail('not-found', 'This payment record could not be found.');
  if (!c.message || !c.messagePublic) fail('failed-precondition', 'This guest asked to keep their message private.');
  if (approved && c.status !== S.VERIFIED) fail('failed-precondition', 'Please verify the payment before showing its message publicly.');
  await ctx.db.update({
    [`${path}/wallApproved`]: approved,
    [`publicFeed/${req.coupleId}/wall/${id}`]: approved ? { name: publicName(c), text: c.message, at: c.verifiedAt } : null,
  });
  return { approved };
}
