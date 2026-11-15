// Group gifting: several guests chip in towards one expensive item through a
// shared link. Nobody creates an account. A group is only a label on normal
// contributions, so every rupee still goes through the same verification flow.
import { fail } from './errors.js';
import { V } from './validate.js';
import { S, AWAITING, ANONYMOUS, audit, loadActiveCouple, mirror } from './common.js';

/** What friends in the group can see. Names and amounts only where each member allowed it. */
export function publicGroup(group) {
  if (!group) return null;
  const members = {};
  for (const [id, m] of Object.entries(group.members || {})) {
    members[id] = { name: m.anonymous ? ANONYMOUS : m.name, amount: m.showAmount ? m.amount : null, status: m.status };
  }
  return {
    itemId: group.itemId,
    itemName: group.itemName,
    title: group.title || null,
    organizer: group.organizer,
    target: group.target,
    verified: group.verified || 0,
    pending: group.pending || 0,
    createdAt: group.createdAt,
    completedAt: group.completedAt || null,
    members,
    rev: group.rev,
  };
}

export async function createGroupGift(ctx, req) {
  const coupleId = V.id(req.data.coupleId, 'couple');
  const itemId = V.id(req.data.itemId, 'item');
  await loadActiveCouple(ctx, coupleId);
  const item = await ctx.db.get(`publicWishlists/${coupleId}/${itemId}`); // guests only ever read the public copy
  if (!item) fail('not-found', 'This wishlist item is not available.');
  if (item.state !== 'OPEN') fail('failed-precondition', item.state === 'RESERVED' ? 'Another guest has reserved this gift.' : 'This wish has already been fulfilled.');
  const target = item.budget - (item.received || 0);
  if (target <= 0) fail('failed-precondition', 'This wish has already been fulfilled.');

  const id = ctx.db.newId();
  const group = {
    itemId,
    itemName: item.name,
    organizer: V.text(req.data.organizerName, { name: 'Your name', min: 2, max: 60 }),
    title: V.text(req.data.title, { name: 'Group name', max: 60 }) || null,
    target,
    verified: 0,
    pending: 0,
    createdAt: ctx.now(),
    rev: 1,
  };
  await ctx.db.update({ [`groupGifts/${coupleId}/${id}`]: group, [`publicGroupGifts/${coupleId}/${id}`]: publicGroup(group) });
  await audit(ctx, req, coupleId, 'group.created', { groupGiftId: id, itemId, organizer: group.organizer });
  return { groupGiftId: id, target };
}

/** Called by the payment ledger whenever a group member's contribution changes state. */
export async function updateGroupLedger(ctx, coupleId, groupGiftId, contributionId, c, { pending = 0, verified = 0 }) {
  const path = `groupGifts/${coupleId}/${groupGiftId}`;
  const result = await ctx.db.transaction(path, (group) => {
    if (group === null) return null;
    group.pending = Math.max(0, (group.pending || 0) + pending);
    group.verified = Math.max(0, (group.verified || 0) + verified);
    group.members = group.members || {};
    const status = c.status === S.VERIFIED ? 'verified' : AWAITING.includes(c.status) ? 'pending' : null;
    if (status) {
      group.members[contributionId] = {
        name: c.guestName,
        anonymous: !!c.anonymous,
        showAmount: c.showAmount !== false,
        amount: status === 'verified' ? c.verifiedAmount : c.amount,
        status,
      };
    } else delete group.members[contributionId];
    group.completedAt = group.verified >= group.target ? group.completedAt || ctx.now() : null;
    group.rev = (group.rev || 0) + 1;
    return group;
  });
  if (result.value) await mirror(ctx, path, `publicGroupGifts/${coupleId}/${groupGiftId}`, result.value, publicGroup);
}
