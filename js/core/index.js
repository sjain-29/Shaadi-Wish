// The app's rule book. Every change a page wants to make goes through
// dispatch(): it looks the action up in the table below, checks WHO may do it,
// validates the input, and then writes to the database.
//
// This code runs in the browser. It keeps honest users' data tidy; the real
// lock is firebase/database.rules.json, which the database itself enforces
// whatever code a visitor runs.
import { AppError, fail } from './errors.js';
import { V } from './validate.js';
import { getSettings, namesOf } from './common.js';
import * as admin from './admin.js';
import * as couple from './couple.js';
import * as items from './items.js';
import * as payments from './payments.js';
import * as conversations from './conversations.js';
import * as groups from './groups.js';

export { AppError } from './errors.js';

async function session(ctx, req) {
  if (req.auth.role === 'admin') return { role: 'admin', coupleId: null, name: 'Administrator', mustChangePassword: false };
  const [c, user] = await Promise.all([ctx.db.get(`couples/${req.auth.coupleId}`), ctx.db.get(`users/${req.auth.uid}`)]);
  return { role: 'couple', coupleId: req.auth.coupleId, name: namesOf(c), mustChangePassword: !!(user && user.mustChange) };
}
async function passwordChanged(ctx, req) {
  await ctx.db.set(`users/${req.auth.uid}/mustChange`, false);
  return { ok: true };
}

// access: who may call the action
//   guest         anyone, no sign-in
//   guestOrCouple a guest holding a secret link token, or the signed-in couple
//   couple        the signed-in couple, on their own data only
//   coupleOrAdmin the couple, or the admin naming the couple (payment disputes)
//   user          any signed-in couple or admin
//   admin         the admin only
const ACTIONS = {
  session: ['user', session],
  passwordChanged: ['user', passwordChanged],

  adminCreateCouple: ['admin', admin.createCouple],
  adminUpdateCouple: ['admin', admin.updateCouple],
  adminSetCoupleStatus: ['admin', admin.setCoupleStatus],
  adminNewLogin: ['admin', admin.newLogin],
  adminSaveSettings: ['admin', admin.saveSettings],

  updateProfile: ['couple', couple.updateProfile],
  updatePaymentSettings: ['couple', couple.updatePaymentSettings],
  saveThankYouCard: ['couple', couple.saveThankYouCard],
  saveItem: ['couple', items.saveItem],
  deleteItem: ['couple', items.deleteItem],
  setItemStatus: ['couple', items.setItemStatus],
  setWallApproval: ['couple', payments.setWallApproval],
  sendGiftDetails: ['couple', conversations.sendGiftDetails],
  confirmReservation: ['couple', conversations.confirmReservation],
  confirmReceipt: ['couple', conversations.confirmReceipt],
  cancelReservation: ['couple', conversations.cancelReservation],
  archiveConversation: ['couple', conversations.archiveConversation],
  setWishApproval: ['couple', conversations.setWishApproval],

  verifyContribution: ['coupleOrAdmin', payments.verifyContribution],
  rejectContribution: ['coupleOrAdmin', payments.rejectContribution],
  refundContribution: ['coupleOrAdmin', payments.refundContribution],
  recalculateTotals: ['coupleOrAdmin', admin.recalculate],

  createContribution: ['guest', payments.createContribution],
  createGroupGift: ['guest', groups.createGroupGift],
  askQuestion: ['guest', conversations.askQuestion],
  startGift: ['guest', conversations.startGift],
  guestGiftNotice: ['guest', conversations.guestGiftNotice],

  sendMessage: ['guestOrCouple', conversations.sendMessage],
  markRead: ['guestOrCouple', conversations.markRead],
};

export const actionNames = Object.keys(ACTIONS);

/** Confirms the caller's role against the database on every call, not just at sign-in. */
async function authorise(ctx, req, access) {
  const a = req.auth;
  if (!a || !a.uid) fail('unauthenticated', 'Please sign in to continue.');
  if (a.role === 'admin') {
    if (!(await ctx.db.get(`admins/${a.uid}`))) fail('permission-denied', 'You do not have access to this.');
    if (access === 'couple') fail('permission-denied', 'Only the couple can do this.');
    if (access === 'coupleOrAdmin') {
      req.coupleId = V.id(req.data.coupleId, 'couple');
      if (!(await ctx.db.get(`couples/${req.coupleId}/status`))) fail('not-found', 'This couple account does not exist.');
    }
    return;
  }
  if (a.role === 'couple' && a.coupleId) {
    if (access === 'admin') fail('permission-denied', 'Only the administrator can do this.');
    const [mine, status] = await Promise.all([ctx.db.get(`users/${a.uid}/coupleId`), ctx.db.get(`couples/${a.coupleId}/status`)]);
    if (mine !== a.coupleId || status !== 'active') fail('permission-denied', 'This account is currently inactive. Please contact the administrator.');
    req.coupleId = a.coupleId; // always from the sign-in, never from the request
    return;
  }
  fail('permission-denied', 'You do not have access to this.');
}

export async function dispatch(ctx, req) {
  const entry = typeof req.action === 'string' && Object.hasOwn(ACTIONS, req.action) ? ACTIONS[req.action] : null;
  if (!entry) fail('not-found', 'Unknown request.');
  const [access, handler] = entry;
  req.data = req.data && typeof req.data === 'object' ? req.data : {};

  const asGuest = access === 'guest' || (access === 'guestOrCouple' && !!req.data.token);
  if (asGuest) {
    const settings = await getSettings(ctx);
    if (settings.maintenance) fail('unavailable', settings.maintenanceMessage || 'We are making a few improvements. Please try again shortly.');
    req.auth = null; // guest actions never run with couple or admin privileges
  } else {
    await authorise(ctx, req, access === 'guestOrCouple' ? 'couple' : access);
  }
  return handler(ctx, req);
}

export const isAppError = (err) => err instanceof AppError;
