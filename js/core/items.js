// Wishlist items. Every change to an item - an edit, a verified payment, a gift
// reservation - goes through commitItem(), which runs as a database transaction
// on that one item. Two requests touching the same item are therefore applied
// one after the other, never on top of each other.
import { AppError, fail } from './errors.js';
import { V } from './validate.js';
import { audit, bumpStats, mirror, CATEGORIES } from './common.js';

export const emptyStats = () => ({ verified: 0, pending: 0, contributors: 0 });

/** Works out the item's state from its facts. Called inside every item transaction. */
export function settle(item) {
  const s = (item.stats = { ...emptyStats(), ...(item.stats || {}) });
  s.verified = Math.max(0, s.verified);
  s.pending = Math.max(0, s.pending);
  s.contributors = Math.max(0, s.contributors);
  const funded = item.budget > 0 && s.verified >= item.budget;
  if (item.manual === 'reopened' && !funded) item.manual = null;
  const reservation = item.reservation || null;

  if (item.manual === 'fulfilled') [item.state, item.completedVia] = ['COMPLETED', 'manual'];
  else if (reservation && reservation.state === 'RECEIVED') [item.state, item.completedVia] = ['COMPLETED', 'gift'];
  else if (funded && item.manual !== 'reopened') [item.state, item.completedVia] = ['COMPLETED', 'funded'];
  else if (reservation) [item.state, item.completedVia] = ['RESERVED', null];
  else [item.state, item.completedVia] = ['OPEN', null];
  return item;
}

/** The only fields a guest's browser ever receives. Returns null for hidden or deleted items. */
export function publicItem(item) {
  if (!item || item.deleted || item.visibility !== 'public') return null;
  return {
    name: item.name,
    description: item.description || null,
    category: item.category,
    budget: item.budget,
    imageUrl: item.imageUrl || null,
    brand: item.brand || null,
    model: item.model || null,
    productLink: item.productLink || null,
    priority: item.priority,
    createdAt: item.createdAt,
    state: item.state,
    completedVia: item.completedVia || null,
    // No amounts and no counts of guests or payments: those are for the couple only.
    // This flag only says whether one guest can still gift the whole item.
    giftable: !(item.stats.verified > 0),
    rev: item.rev,
  };
}

/** Public copy + summary counters, after an item was created or changed. */
export async function syncItem(ctx, coupleId, itemId, before, after) {
  await mirror(ctx, `wishlists/${coupleId}/${itemId}`, `publicWishlists/${coupleId}/${itemId}`, after, publicItem);
  const live = (it) => !!it && !it.deleted;
  await bumpStats(ctx, coupleId, {
    budget: (live(after) ? after.budget : 0) - (live(before) ? before.budget : 0),
    items: live(after) - live(before),
    completed: (live(after) && after.state === 'COMPLETED') - (live(before) && before.state === 'COMPLETED'),
  });
}

/**
 * Atomically change one item. `mutate(item)` edits and returns the item, or
 * throws an AppError to refuse (for example "already reserved").
 */
export async function commitItem(ctx, coupleId, itemId, mutate) {
  let before = null;
  let refused = null;
  const result = await ctx.db.transaction(`wishlists/${coupleId}/${itemId}`, (current) => {
    refused = null;
    if (current === null) return null; // not loaded yet, or does not exist
    before = structuredClone(current);
    try {
      const next = settle(mutate(current));
      next.rev = (before.rev || 0) + 1;
      return next;
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      refused = err;
      return undefined;
    }
  });
  if (refused) throw refused;
  if (result.value === null) fail('not-found', 'This wishlist item no longer exists.');
  if (!result.committed) fail('aborted', 'Please try again.');
  await syncItem(ctx, coupleId, itemId, before, result.value);
  return { before, after: result.value };
}

function itemFields(d) {
  const category = V.text(d.category, { name: 'Category', min: 2, max: 40 });
  return {
    name: V.text(d.name, { name: 'Item name', min: 2, max: 80 }),
    description: V.text(d.description, { name: 'Description', max: 600, multiline: true }) || null,
    category,
    customCategory: !CATEGORIES.includes(category),
    budget: V.amount(d.budget, { name: 'Estimated budget', min: 1, max: 100000000 }),
    imageUrl: V.url(d.imageUrl, { name: 'Image link' }) || null,
    brand: V.text(d.brand, { name: 'Preferred brand', max: 60 }) || null,
    model: V.text(d.model, { name: 'Preferred model', max: 80 }) || null,
    productLink: V.url(d.productLink, { name: 'Product link' }) || null,
    priority: V.oneOf(d.priority || 'medium', ['high', 'medium', 'low'], 'priority'),
    visibility: V.oneOf(d.visibility || 'public', ['public', 'hidden'], 'visibility'),
  };
}

export async function saveItem(ctx, req) {
  const coupleId = req.coupleId;
  const fields = itemFields(req.data);
  const now = ctx.now();

  if (req.data.id) {
    const id = V.id(req.data.id);
    const { before, after } = await commitItem(ctx, coupleId, id, (item) => {
      if (item.deleted) fail('not-found', 'This wishlist item no longer exists.');
      return Object.assign(item, fields, { updatedAt: now });
    });
    const details = { itemId: id, name: after.name };
    if (before.budget !== after.budget) Object.assign(details, { budgetFrom: before.budget, budgetTo: after.budget });
    await audit(ctx, req, coupleId, 'item.updated', details);
    return { id, item: after };
  }

  const id = ctx.db.newId();
  const item = settle({ ...fields, createdAt: now, updatedAt: now, rev: 1, stats: emptyStats() });
  await ctx.db.set(`wishlists/${coupleId}/${id}`, item);
  await syncItem(ctx, coupleId, id, null, item);
  await audit(ctx, req, coupleId, 'item.created', { itemId: id, name: item.name, budget: item.budget });
  return { id, item };
}

/** Soft delete: the item disappears from every list, its payment history stays. */
export async function deleteItem(ctx, req) {
  const id = V.id(req.data.id);
  const { after } = await commitItem(ctx, req.coupleId, id, (item) => {
    if (item.deleted) fail('not-found', 'This wishlist item no longer exists.');
    if (item.stats.pending > 0) fail('failed-precondition', 'This item has payments waiting for verification. Please verify or reject them first.');
    if (item.reservation && item.reservation.state !== 'RECEIVED') fail('failed-precondition', 'A guest has reserved this gift. Please cancel the reservation first.');
    return Object.assign(item, { deleted: true, deletedAt: ctx.now() });
  });
  await audit(ctx, req, req.coupleId, 'item.deleted', { itemId: id, name: after.name, verified: after.stats.verified });
  return { id };
}

/** Couple marks an item fulfilled, or reopens a completed one. */
export async function setItemStatus(ctx, req) {
  const id = V.id(req.data.id);
  const action = V.oneOf(req.data.action, ['fulfil', 'reopen'], 'action');
  const { after } = await commitItem(ctx, req.coupleId, id, (item) => {
    if (item.deleted) fail('not-found', 'This wishlist item no longer exists.');
    if (action === 'fulfil') item.manual = 'fulfilled';
    else {
      item.manual = 'reopened';
      if (item.reservation && item.reservation.state === 'RECEIVED') item.reservation = null;
    }
    item.updatedAt = ctx.now();
    return item;
  });
  await audit(ctx, req, req.coupleId, action === 'fulfil' ? 'item.fulfilled' : 'item.reopened', { itemId: id, name: after.name });
  return { id, state: after.state };
}
