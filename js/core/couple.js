// Couple account: public profile, payment details and thank-you cards.
import { fail } from './errors.js';
import { V } from './validate.js';
import { S, audit, profileUpdates } from './common.js';

export const THEMES = ['marigold', 'royal', 'blush', 'mint'];

export async function updateProfile(ctx, req) {
  const d = req.data;
  const coupleId = req.coupleId;
  const fields = {
    partner1: V.text(d.partner1, { name: 'Partner 1 name', min: 2, max: 40 }),
    partner2: V.text(d.partner2, { name: 'Partner 2 name', min: 2, max: 40 }),
    weddingDate: V.date(d.weddingDate, { name: 'Wedding date' }) || null,
    location: V.text(d.location, { name: 'Wedding location', max: 80 }) || null,
    welcomeMessage: V.text(d.welcomeMessage, { name: 'Welcome message', max: 400, multiline: true }) || null,
    photo1: V.url(d.photo1, { name: 'Photo' }) || null,
    photo2: V.url(d.photo2, { name: 'Photo' }) || null,
    theme: V.oneOf(d.theme || 'marigold', THEMES, 'theme'),
  };
  const updates = profileUpdates(ctx, coupleId, fields);
  // Payments are private to the couple. This also clears any list of contributors
  // that an older version of the app may have published.
  updates[`publicFeed/${coupleId}/contributors`] = null;
  updates[`publicProfiles/${coupleId}/showContributors`] = null;
  await ctx.db.update(updates);
  await audit(ctx, req, coupleId, 'profile.updated', {});
  return { ok: true };
}

/**
 * Where guests' money goes. Changing it needs the account password again, so a
 * phone left unlocked cannot be used to redirect payments.
 */
export async function updatePaymentSettings(ctx, req) {
  const coupleId = req.coupleId;
  await ctx.auth.confirmPassword(req.auth.uid, String(req.data.password ?? '')); // throws if the password is wrong
  const upiId = V.upiId(req.data.upiId);
  const payeeName = V.text(req.data.payeeName, { name: 'Name on the bank account', min: 2, max: 60 });
  const updates = {
    [`paymentSettings/${coupleId}`]: { upiId, payeeName, updatedAt: ctx.now() },
    [`couples/${coupleId}/paymentsReady`]: true,
    [`publicProfiles/${coupleId}/paymentsReady`]: true,
    [`publicProfiles/${coupleId}/upiId`]: upiId, // guests need it to pay
    [`publicProfiles/${coupleId}/payeeName`]: payeeName,
  };
  // The couple's own payment QR (the picture from their UPI app). The free plan has
  // no file storage, so the picture itself is kept in the database, in its own node
  // that is only downloaded on the payment screen.
  if (req.data.qrImage) {
    V.image(req.data.qrImage, { maxBytes: 420000 });
    updates[`publicPaymentQr/${coupleId}`] = req.data.qrImage;
    updates[`publicProfiles/${coupleId}/hasQr`] = true;
  } else if (req.data.removeQr) {
    updates[`publicPaymentQr/${coupleId}`] = null;
    updates[`publicProfiles/${coupleId}/hasQr`] = false;
  }
  await ctx.db.update(updates);
  await audit(ctx, req, coupleId, 'payment_settings.updated', { upiId: upiId.replace(/^(.{2}).*(@.*)$/, '$1•••$2') });
  return { ok: true };
}

/**
 * Records a thank-you card. The label printed on the card is decided here, on
 * the server: an anonymous guest's name is never put on a card.
 */
export async function saveThankYouCard(ctx, req) {
  const d = req.data;
  const coupleId = req.coupleId;
  const kind = V.oneOf(d.kind || 'item', ['item', 'lifafa'], 'kind');
  const id = V.id(d.contributionId, 'payment');
  const path = `${kind === 'lifafa' ? 'lifafa' : 'contributions'}/${coupleId}/${id}`;
  const c = await ctx.db.get(path);
  if (!c) fail('not-found', 'This contribution could not be found.');
  if (c.status !== S.VERIFIED) fail('failed-precondition', 'A thank-you card can be created once the contribution is verified.');
  const cardId = ctx.db.newId();
  const card = {
    contributionId: id,
    kind,
    guestLabel: c.anonymous ? 'Dear Well-wisher' : c.guestName,
    anonymous: !!c.anonymous,
    template: V.oneOf(d.template || 'marigold', THEMES, 'template'),
    message: V.text(d.message, { name: 'Message', min: 2, max: 320, multiline: true }),
    createdAt: ctx.now(),
  };
  await ctx.db.update({ [`thankYouCards/${coupleId}/${cardId}`]: card, [`${path}/thankedAt`]: card.createdAt });
  return { cardId, card };
}
