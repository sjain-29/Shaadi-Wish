// Admin operations: the only place couple accounts can be created.
import { fail } from './errors.js';
import { V } from './validate.js';
import { randomId, slugify, firstWord } from './util.js';
import { audit, namesOf, getSettings, profileUpdates, S, AWAITING } from './common.js';
import { commitItem, emptyStats } from './items.js';
import { publicGroup } from './groups.js';

async function claimSlug(ctx, base, coupleId) {
  const root = base || 'wedding';
  for (let i = 0; i < 60; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    if ((await ctx.db.transaction(`slugs/${slug}`, (cur) => (cur === null ? coupleId : undefined))).committed) return slug;
  }
  return fail('internal', 'Could not create a wishlist link. Please try again.');
}

export function publicProfile(couple) {
  return {
    partner1: couple.partner1, partner2: couple.partner2, slug: couple.slug, weddingDate: couple.weddingDate || null,
    theme: couple.theme || 'marigold', paymentsReady: false, active: couple.status === 'active',
  };
}

async function requireCouple(ctx, coupleId) {
  const couple = await ctx.db.get(`couples/${coupleId}`);
  if (!couple) fail('not-found', 'This couple account does not exist.');
  return couple;
}

export async function createCouple(ctx, req) {
  const d = req.data;
  const partner1 = V.text(d.partner1, { name: 'Partner 1 name', min: 2, max: 40 });
  const partner2 = V.text(d.partner2, { name: 'Partner 2 name', min: 2, max: 40 });
  const mobile = V.mobile(d.mobile);
  const password = V.password(d.password, 'Initial password');
  const weddingDate = V.date(d.weddingDate, { name: 'Wedding date' });
  const status = V.oneOf(d.status || 'active', ['active', 'inactive'], 'status');

  const uid = await ctx.auth.createUser({ mobile, password }); // refuses a mobile number that already has a login
  const coupleId = randomId();
  let slug = null;
  try {
    slug = await claimSlug(ctx, slugify(`${firstWord(partner1)}-and-${firstWord(partner2)}`), coupleId);
    const now = ctx.now();
    const couple = { partner1, partner2, mobile, uid, weddingDate: weddingDate || null, status, slug, createdAt: now, updatedAt: now, theme: 'marigold' };
    await ctx.db.update({
      [`couples/${coupleId}`]: couple,
      [`users/${uid}`]: { coupleId, mobile, mustChange: true, createdAt: now },
      [`publicProfiles/${coupleId}`]: publicProfile(couple),
    });
    await audit(ctx, req, '_platform', 'couple.created', { coupleId, names: namesOf(couple), slug });
    return { coupleId, slug, names: namesOf(couple) };
  } catch (err) {
    if (slug) await ctx.db.set(`slugs/${slug}`, null);
    await ctx.auth.deleteUser(uid);
    throw err;
  }
}

export async function updateCouple(ctx, req) {
  const d = req.data;
  const coupleId = V.id(d.coupleId, 'couple');
  await requireCouple(ctx, coupleId);
  await ctx.db.update(profileUpdates(ctx, coupleId, {
    partner1: V.text(d.partner1, { name: 'Partner 1 name', min: 2, max: 40 }),
    partner2: V.text(d.partner2, { name: 'Partner 2 name', min: 2, max: 40 }),
    weddingDate: V.date(d.weddingDate, { name: 'Wedding date' }) || null,
  }));
  await audit(ctx, req, '_platform', 'couple.updated', { coupleId });
  return { coupleId };
}

/** Deactivating locks the couple out at once (the rules check this flag) and takes the public wishlist offline. */
export async function setCoupleStatus(ctx, req) {
  const coupleId = V.id(req.data.coupleId, 'couple');
  const status = V.oneOf(req.data.status, ['active', 'inactive'], 'status');
  await requireCouple(ctx, coupleId);
  await ctx.db.update({
    [`couples/${coupleId}/status`]: status,
    [`couples/${coupleId}/updatedAt`]: ctx.now(),
    [`publicProfiles/${coupleId}/active`]: status === 'active',
  });
  await audit(ctx, req, '_platform', `couple.${status}`, { coupleId });
  return { coupleId, status };
}

/**
 * Gives a couple a fresh login (forgotten password, or a new mobile number).
 * All their data stays, because it is stored under the couple id, not the login.
 */
export async function newLogin(ctx, req) {
  const coupleId = V.id(req.data.coupleId, 'couple');
  const couple = await requireCouple(ctx, coupleId);
  const mobile = V.mobile(req.data.mobile || couple.mobile);
  const password = V.password(req.data.password, 'Temporary password');
  const uid = await ctx.auth.createUser({ mobile, password });
  await ctx.db.update({
    [`users/${uid}`]: { coupleId, mobile, mustChange: true, createdAt: ctx.now() },
    [`users/${couple.uid}`]: null, // the old login no longer opens this account
    [`couples/${coupleId}/uid`]: uid,
    [`couples/${coupleId}/mobile`]: mobile,
  });
  await audit(ctx, req, '_platform', 'couple.new_login', { coupleId });
  return { coupleId, mobile };
}

export async function saveSettings(ctx, req) {
  const d = req.data;
  const amounts = (list, name) => {
    if (!Array.isArray(list) || list.length < 1 || list.length > 8) fail('invalid-argument', `${name} must have between 1 and 8 amounts.`);
    return [...new Set(list.map((n) => V.amount(n, { name })))].sort((a, b) => a - b);
  };
  const settings = {
    maintenance: !!d.maintenance,
    maintenanceMessage: V.text(d.maintenanceMessage, { name: 'Maintenance message', max: 200 }),
    suggestedAmounts: amounts(d.suggestedAmounts, 'Suggested amounts'),
    lifafaAmounts: amounts(d.lifafaAmounts, 'Lifafa amounts'),
    minAmount: V.amount(d.minAmount, { name: 'Minimum amount', min: 1, max: 10000 }),
    maxAmount: V.amount(d.maxAmount, { name: 'Maximum amount', min: 100, max: 10000000 }),
    supportContact: V.text(d.supportContact, { name: 'Support contact', max: 120 }),
  };
  if (settings.minAmount > settings.maxAmount) fail('invalid-argument', 'Minimum amount cannot be more than the maximum.');
  await ctx.db.set('publicSettings', settings);
  await audit(ctx, req, '_platform', 'settings.updated', { maintenance: settings.maintenance, maxAmount: settings.maxAmount });
  return { settings: await getSettings(ctx) };
}

/**
 * Rebuilds every total for one couple from the payment records themselves.
 * The payment records are the source of truth; totals are only a cache of them.
 */
export async function recalculate(ctx, req) {
  const coupleId = req.coupleId;
  const [contributions, lifafa] = await Promise.all([ctx.db.get(`contributions/${coupleId}`), ctx.db.get(`lifafa/${coupleId}`)]);
  const perItem = {};
  const totals = { verified: 0, contributors: 0, lifafaVerified: 0, lifafaCount: 0 };
  for (const c of Object.values(contributions || {})) {
    if (c.status !== S.VERIFIED) continue;
    const s = (perItem[c.itemId] ||= emptyStats());
    s.verified += c.verifiedAmount;
    s.contributors += 1;
    totals.verified += c.verifiedAmount;
    totals.contributors += 1;
  }
  for (const l of Object.values(lifafa || {})) {
    if (l.status !== S.VERIFIED) continue;
    totals.lifafaVerified += l.verifiedAmount;
    totals.lifafaCount += 1;
  }
  for (const id of Object.keys((await ctx.db.get(`wishlists/${coupleId}`)) || {})) {
    await commitItem(ctx, coupleId, id, (item) => Object.assign(item, { stats: perItem[id] || emptyStats() }));
  }
  // Rewrite the public copies of group gifts and drop any public list of contributors,
  // so data published by an older version of the app no longer shows who paid what.
  const cleanup = { [`publicFeed/${coupleId}/contributors`]: null };
  for (const [gid, g] of Object.entries((await ctx.db.get(`groupGifts/${coupleId}`)) || {})) cleanup[`publicGroupGifts/${coupleId}/${gid}`] = publicGroup(g);
  await ctx.db.update(cleanup);
  const items = Object.values((await ctx.db.get(`wishlists/${coupleId}`)) || {}).filter((it) => !it.deleted);
  const fresh = { ...totals, budget: items.reduce((sum, it) => sum + it.budget, 0), items: items.length, completed: items.filter((it) => it.state === 'COMPLETED').length };
  await ctx.db.set(`coupleStats/${coupleId}`, fresh);
  await audit(ctx, req, coupleId, 'totals.recalculated', { verified: fresh.verified });
  return { stats: fresh, awaiting: Object.values(contributions || {}).filter((c) => AWAITING.includes(c.status)).length };
}
