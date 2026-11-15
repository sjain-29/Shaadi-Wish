// Shared constants and helpers for the app logic.
import { fail } from './errors.js';

/** Payment status values. */
export const S = Object.freeze({
  PENDING: 'PENDING_VERIFICATION', // guest submitted the UTR; waiting for the couple
  VERIFIED: 'VERIFIED', // couple (or admin) confirmed the money arrived
  REJECTED: 'REJECTED',
  REFUNDED: 'REFUNDED',
});
export const AWAITING = [S.PENDING];

export const CATEGORIES = [
  'Honeymoon & Travel', 'Home Down Payment', 'Home Appliances', 'Kitchen Essentials', 'Bedroom & Furniture', 'Electronics',
  'Personal Shopping', 'Jewellery & Accessories', 'Vehicle', 'Experiences & Activities', 'Savings & Investments', 'Other Requirements',
];

export const DEFAULT_SETTINGS = Object.freeze({
  maintenance: false,
  maintenanceMessage: '',
  suggestedAmounts: [500, 1000, 2000, 5000, 10000],
  lifafaAmounts: [501, 1101, 2101, 5001, 11000],
  minAmount: 1,
  maxAmount: 100000, // usual per-transaction UPI limit
  supportContact: '',
});

export const ANONYMOUS = 'Anonymous Guest';
export const namesOf = (c) => `${c.partner1} & ${c.partner2}`;
export const publicName = (c) => (c.anonymous ? ANONYMOUS : c.guestName);
export const actorOf = (req) => (req.auth ? req.auth.role : 'guest');

export async function getSettings(ctx) {
  return { ...DEFAULT_SETTINGS, ...((await ctx.db.get('publicSettings')) || {}) };
}

/** The couple's public profile. Guests can read this; it carries names, link and UPI ID. */
export async function loadActiveCouple(ctx, coupleId) {
  const profile = await ctx.db.get(`publicProfiles/${coupleId}`);
  if (!profile) fail('not-found', 'This wishlist could not be found.');
  if (!profile.active) fail('failed-precondition', 'This wishlist is currently unavailable.');
  return profile;
}

/** Append-only activity log. Written for signed-in couples and the admin. `scope` is a couple id or "_platform". */
export async function audit(ctx, req, scope, action, details = {}) {
  if (!req.auth) return;
  await ctx.db.set(`auditLogs/${scope}/${ctx.db.newId()}`, { action, at: ctx.now(), role: req.auth.role, uid: req.auth.uid, details });
}

/**
 * Keeps a public copy in step with its private original.
 * After writing, re-read the original: if it changed meanwhile, write again.
 * This way two overlapping updates can never leave an older copy on top.
 */
export async function mirror(ctx, privatePath, publicPath, value, project) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await ctx.db.set(publicPath, project(value));
    const latest = await ctx.db.get(privatePath);
    if ((latest?.rev || 0) === (value?.rev || 0)) return;
    value = latest;
  }
}

/** Adds deltas to a couple's summary numbers. */
export async function bumpStats(ctx, coupleId, deltas) {
  const updates = {};
  for (const [key, n] of Object.entries(deltas)) if (n) updates[`coupleStats/${coupleId}/${key}`] = ctx.db.increment(n);
  if (Object.keys(updates).length) await ctx.db.update(updates);
}

/** Updates for fields that appear both on the private couple record and the public profile. */
export function profileUpdates(ctx, coupleId, fields) {
  const updates = { [`couples/${coupleId}/updatedAt`]: ctx.now() };
  for (const [key, value] of Object.entries(fields)) {
    updates[`couples/${coupleId}/${key}`] = value;
    updates[`publicProfiles/${coupleId}/${key}`] = value;
  }
  return updates;
}
