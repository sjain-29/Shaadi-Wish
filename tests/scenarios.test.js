// The 25 acceptance scenarios from the specification (section 23), run against
// the app logic in js/core. Browser-only parts (QR image, card image, CSV file,
// mobile layout) are covered by tests/e2e/smoke.mjs.
// Everything runs twice: normally, and with database transactions starting
// from an empty cache, the way the Firebase SDK behaves on a fresh page.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, mentions } from './helpers.js';

for (const cold of [false, true]) {
  describe(`acceptance scenarios (${cold ? 'cold transaction cache' : 'warm cache'})`, () => {
    const app = makeApp({ cold });
    const { call, denied, db, login } = app;
    const s = {};
    let utr = 400000000000;
    /** A guest pays by UPI outside the app, then reports it with the UTR. */
    const guestPays = (data) => call('createContribution', { kind: data.itemId ? 'item' : 'lifafa', utr: String(++utr), ...data });
    const item = (coupleId, id) => db.get(`wishlists/${coupleId}/${id}`);
    const stats = async (coupleId, id) => (await item(coupleId, id)).stats;

    test('setup: the admin is whoever is listed under /admins', async () => {
      const uid = await app.ctx.auth.createUser({ mobile: '9000000001', password: 'admin1234' });
      await db.set(`admins/${uid}`, true);
      s.admin = await login('9000000001', 'admin1234');
      const strangerUid = await app.ctx.auth.createUser({ mobile: '9111111111', password: 'selfmade123' });
      // someone who signs up by themselves has a login but no role, so no access
      await assert.rejects(login('9111111111', 'selfmade123'), { code: 'permission-denied' });
      assert.equal(await denied('adminCreateCouple', {}, JSON.stringify({ uid: strangerUid, role: 'admin' })), 'permission-denied');
    });

    test('1. admin creates two couple accounts', async () => {
      s.A = await call('adminCreateCouple', { partner1: 'Suyash Verma', partner2: 'Ananya Rao', mobile: '+91 98765 43210', password: 'couple1234', weddingDate: '2027-02-14' }, s.admin);
      s.B = await call('adminCreateCouple', { partner1: 'Rohan Mehta', partner2: 'Priya Shah', mobile: '9876500000', password: 'couple5678' }, s.admin);
      assert.equal(s.A.slug, 'suyash-and-ananya');
      assert.notEqual(s.A.coupleId, s.B.coupleId);
      assert.equal(await denied('adminCreateCouple', { partner1: 'No', partner2: 'Way', mobile: '9876511111', password: 'couple1234' }), 'unauthenticated');
      assert.equal(await denied('adminCreateCouple', { partner1: 'Dup', partner2: 'Mobile', mobile: '9876543210', password: 'couple1234' }, s.admin), 'already-exists');
      const twin = await call('adminCreateCouple', { partner1: 'Suyash K', partner2: 'Ananya P', mobile: '9876522222', password: 'couple1234' }, s.admin);
      assert.equal(twin.slug, 'suyash-and-ananya-2');
    });

    test('2. both couples log in independently', async () => {
      s.a = await login('9876543210', 'couple1234');
      s.b = await login('9876500000', 'couple5678');
      assert.equal(JSON.parse(s.a).coupleId, s.A.coupleId);
      assert.equal(JSON.parse(s.b).coupleId, s.B.coupleId);
      await assert.rejects(login('9876543210', 'couple5678'), { code: 'unauthenticated' });
      assert.equal((await call('session', {}, s.a)).mustChangePassword, true, 'the admin-set password must be replaced');
      await call('passwordChanged', {}, s.a);
      assert.equal((await call('session', {}, s.a)).mustChangePassword, false);
      assert.equal(await denied('updatePaymentSettings', { upiId: 'suyash@okhdfcbank', payeeName: 'Suyash Verma', password: 'wrong-pass1' }, s.a), 'permission-denied');
      await call('updatePaymentSettings', { upiId: 'suyash@okhdfcbank', payeeName: 'Suyash Verma', password: 'couple1234' }, s.a);
      await call('updatePaymentSettings', { upiId: 'rohan@oksbi', payeeName: 'Rohan Mehta', password: 'couple5678' }, s.b);
    });

    test('the couple uploads their own payment QR; guests can read it, only the couple can change it', async () => {
      const pay = { upiId: 'suyash@okhdfcbank', payeeName: 'Suyash Verma' };
      const qr = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
      assert.equal(await denied('updatePaymentSettings', { ...pay, qrImage: qr, password: 'wrong-pass1' }, s.a), 'permission-denied');
      assert.equal(await denied('updatePaymentSettings', { ...pay, qrImage: 'data:image/png;base64,AAAA', password: 'couple1234' }, s.a), 'invalid-argument', 'not really an image');
      assert.equal(await denied('updatePaymentSettings', { ...pay, qrImage: 'data:text/html;base64,PHNjcmlwdD4=', password: 'couple1234' }, s.a), 'invalid-argument');
      await call('updatePaymentSettings', { ...pay, qrImage: qr, password: 'couple1234' }, s.a);
      assert.equal(await db.get(`publicPaymentQr/${s.A.coupleId}`), qr);
      assert.equal((await db.get(`publicProfiles/${s.A.coupleId}`)).hasQr, true);
      assert.equal(await db.get(`publicPaymentQr/${s.B.coupleId}`), null);
      await call('updatePaymentSettings', { ...pay, password: 'couple1234' }, s.a);
      assert.equal(await db.get(`publicPaymentQr/${s.A.coupleId}`), qr, 'saving other details keeps the QR');
      await call('updatePaymentSettings', { ...pay, removeQr: true, password: 'couple1234' }, s.a);
      assert.equal(await db.get(`publicPaymentQr/${s.A.coupleId}`), null);
      assert.equal(await denied('updatePaymentSettings', { ...pay, qrImage: qr }), 'unauthenticated');
    });

    test('4. couple A creates a ₹3,00,000 honeymoon goal', async () => {
      s.honeymoon = (await call('saveItem', { name: 'Honeymoon in Switzerland', category: 'Honeymoon & Travel', budget: 300000, priority: 'high' }, s.a)).id;
      const it = await item(s.A.coupleId, s.honeymoon);
      assert.equal(it.budget, 300000);
      assert.equal(it.state, 'OPEN');
      s.hidden = (await call('saveItem', { name: 'Secret surprise', category: 'Other Requirements', budget: 9000, visibility: 'hidden' }, s.a)).id;
      assert.equal(await db.get(`publicWishlists/${s.A.coupleId}/${s.hidden}`), null);
      s.bItem = (await call('saveItem', { name: 'Sofa set', category: 'Bedroom & Furniture', budget: 60000 }, s.b)).id;
      s.bPay = await guestPays({ coupleId: s.B.coupleId, itemId: s.bItem, amount: 2000, guestName: 'Guest Of B' });
    });

    test("3. couple A cannot reach couple B's private data", async () => {
      assert.equal(await denied('saveItem', { id: s.bItem, name: 'Hijacked', category: 'Other Requirements', budget: 1 }, s.a), 'not-found');
      assert.equal(await denied('deleteItem', { id: s.bItem }, s.a), 'not-found');
      assert.equal(await denied('verifyContribution', { id: s.bPay.id, kind: 'item', coupleId: s.B.coupleId }, s.a), 'not-found');
      assert.equal(await denied('adminSetCoupleStatus', { coupleId: s.B.coupleId, status: 'inactive' }, s.a), 'permission-denied');
      // claiming to be couple B with couple A's login is refused
      assert.equal(await denied('saveItem', { name: 'x y', category: 'Electronics', budget: 5 }, JSON.stringify({ uid: JSON.parse(s.a).uid, role: 'couple', coupleId: s.B.coupleId })), 'permission-denied');
      assert.equal((await item(s.B.coupleId, s.bItem)).name, 'Sofa set');
    });

    test('5. a guest opens the public link without logging in', async () => {
      const coupleId = await db.get(`slugs/${s.A.slug}`);
      assert.equal(coupleId, s.A.coupleId);
      const profile = await db.get(`publicProfiles/${coupleId}`);
      const list = await db.get(`publicWishlists/${coupleId}`);
      assert.equal(profile.partner1, 'Suyash Verma');
      assert.equal(profile.upiId, 'suyash@okhdfcbank');
      assert.equal(list[s.honeymoon].giftable, true);
      assert.ok(!('received' in list[s.honeymoon]) && !('contributors' in list[s.honeymoon]), 'no money figures in public data');
      for (const secret of ['9876543210', 'Secret surprise', 'couple1234']) assert.ok(!mentions([profile, list], secret), `public data must not contain ${secret}`);
    });

    test('6-7. a guest contributes ₹5,000 and it shows as pending verification', async () => {
      s.c1 = await guestPays({ coupleId: s.A.coupleId, itemId: s.honeymoon, amount: 5000, guestName: 'Kavita Joshi', message: 'Enjoy the mountains!', messagePublic: true, utr: '4123 5567 8901' });
      const record = await db.get(`contributions/${s.A.coupleId}/${s.c1.id}`);
      assert.equal(record.status, 'PENDING_VERIFICATION');
      assert.equal(record.utr, '412355678901');
      assert.match(record.refCode, /^SW[A-Z2-9]{6}$/);
      assert.equal((await db.get(`guestReceipts/${s.c1.receipt}`)).status, 'PENDING_VERIFICATION');
      assert.equal((await stats(s.A.coupleId, s.honeymoon)).verified, 0, 'self-reporting must not raise the verified total');
      assert.equal((await db.get(`publicWishlists/${s.A.coupleId}/${s.honeymoon}`)).giftable, true);
    });

    test('8-9. the couple verifies the payment and the remaining budget becomes ₹2,95,000', async () => {
      await call('verifyContribution', { id: s.c1.id, kind: 'item' }, s.a);
      const it = await item(s.A.coupleId, s.honeymoon);
      assert.deepEqual(it.stats, { verified: 5000, pending: 0, contributors: 1 });
      assert.equal(it.budget - it.stats.verified, 295000);
      const pubItem = await db.get(`publicWishlists/${s.A.coupleId}/${s.honeymoon}`);
      assert.equal(pubItem.giftable, false, 'whole-item gifting closes once money arrives');
      assert.ok(!('received' in pubItem) && !mentions(await db.get(`publicFeed/${s.A.coupleId}`), 'Kavita'), 'guests never see who paid or how much');
      assert.equal((await db.get(`guestReceipts/${s.c1.receipt}`)).status, 'VERIFIED');
      assert.equal((await db.get(`coupleStats/${s.A.coupleId}`)).verified, 5000);
      assert.equal(await denied('verifyContribution', { id: s.c1.id, kind: 'item' }, s.a), 'failed-precondition', 'verifying twice must not count twice');
      assert.equal((await stats(s.A.coupleId, s.honeymoon)).verified, 5000);
    });

    test('10-11. an anonymous contribution stays anonymous in everything the public can read', async () => {
      s.c2 = await guestPays({ coupleId: s.A.coupleId, itemId: s.honeymoon, amount: 10000, guestName: 'Mahesh Kulkarni', anonymous: true, message: 'From a well-wisher', messagePublic: true });
      await call('verifyContribution', { id: s.c2.id, kind: 'item' }, s.a);
      await call('setWallApproval', { id: s.c2.id, kind: 'item', approved: true }, s.a);
      const everythingPublic = await Promise.all(['publicFeed', 'publicWishlists', 'publicProfiles', 'publicGroupGifts'].map((n) => db.get(`${n}/${s.A.coupleId}`)));
      assert.ok(!mentions(everythingPublic, 'Mahesh'), 'the anonymous guest must not be named publicly');
      const feed = await db.get(`publicFeed/${s.A.coupleId}`);
      assert.equal(feed.contributors, undefined, 'no public list of who paid');
      assert.equal(feed.wall[s.c2.id].name, 'Anonymous Guest');
      assert.equal((await db.get(`contributions/${s.A.coupleId}/${s.c2.id}`)).guestName, 'Mahesh Kulkarni', 'the couple keeps the real name');
    });

    test('12-13. a guest asks about a kitchen mixer and the couple replies with brand and model', async () => {
      s.mixer = (await call('saveItem', { name: 'Kitchen Mixer', category: 'Kitchen Essentials', budget: 5000 }, s.a)).id;
      s.neha = (await call('startGift', { coupleId: s.A.coupleId, itemId: s.mixer, guestName: 'Neha Kapoor', message: 'Hi! I would love to gift you this kitchen mixer. Which brand and model would you prefer?' })).token;
      const [convId, conv] = Object.entries(await db.get(`conversations/${s.A.coupleId}`)).find(([, c]) => c.itemId === s.mixer);
      s.mixerRes = conv.reservationId;
      assert.equal(conv.unreadCouple, 1);
      assert.equal((await item(s.A.coupleId, s.mixer)).state, 'OPEN', 'a message alone does not reserve the item');
      await call('markRead', { convId }, s.a);
      await call('sendGiftDetails', { convId, brand: 'Philips', model: 'HL7756/00 750W', notes: 'Black, please!' }, s.a);
      const thread = await db.get(`guestThreads/${s.neha}`);
      assert.equal(thread.meta.unreadGuest, 1);
      assert.equal(thread.meta.reservation.agreed.brand, 'Philips');
      assert.equal(Object.values(thread.messages)[1].details.model, 'HL7756/00 750W');
      assert.equal(await denied('sendMessage', { token: 'A'.repeat(32), text: 'let me in' }), 'not-found');
      assert.equal(await denied('sendMessage', { convId, text: 'no login' }), 'unauthenticated');
      assert.equal(await denied('sendMessage', { convId, text: 'wrong couple' }, s.b), 'not-found');
    });

    test('14-15. the gift is reserved; another guest sees it reserved and cannot take it', async () => {
      await call('guestGiftNotice', { token: s.neha, intent: 'confirm' });
      assert.equal((await item(s.A.coupleId, s.mixer)).state, 'OPEN', 'a guest cannot change the item by themselves');
      await call('confirmReservation', { reservationId: s.mixerRes }, s.a);
      const pub = await db.get(`publicWishlists/${s.A.coupleId}/${s.mixer}`);
      assert.equal(pub.state, 'RESERVED');
      assert.ok(!mentions(pub, 'Neha'), 'the reserving guest is not named publicly');
      assert.equal((await db.get(`guestThreads/${s.neha}/meta/reservation/status`)), 'RESERVED');
      assert.equal(await denied('startGift', { coupleId: s.A.coupleId, itemId: s.mixer, guestName: 'Second Guest', message: 'Me too!' }), 'failed-precondition');
      assert.equal(await denied('createContribution', { coupleId: s.A.coupleId, kind: 'item', itemId: s.mixer, amount: 500, guestName: 'Second Guest', utr: '499999999991' }), 'failed-precondition');
      await call('guestGiftNotice', { token: s.neha, intent: 'purchased' });
      assert.equal((await item(s.A.coupleId, s.mixer)).state, 'RESERVED', 'not completed until the couple confirms receipt');
      await call('confirmReceipt', { reservationId: s.mixerRes }, s.a);
      const done = await item(s.A.coupleId, s.mixer);
      assert.deepEqual([done.state, done.completedVia], ['COMPLETED', 'gift']);
    });

    test('15b. two reservation attempts on one item at the same moment: exactly one wins', async () => {
      const dinner = (await call('saveItem', { name: 'Dinner Set', category: 'Kitchen Essentials', budget: 8000 }, s.a)).id;
      await Promise.all([1, 2, 3].map((n) => call('startGift', { coupleId: s.A.coupleId, itemId: dinner, guestName: `Racer ${n}`, message: 'I will buy this' })));
      const ids = Object.entries(await db.get(`reservations/${s.A.coupleId}`)).filter(([, r]) => r.itemId === dinner).map(([id]) => id);
      const results = await Promise.allSettled(ids.map((id) => call('confirmReservation', { reservationId: id }, s.a)));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'already-exists'));
      const held = Object.entries(await db.get(`reservations/${s.A.coupleId}`)).find(([, r]) => r.itemId === dinner && r.status === 'RESERVED');
      await call('cancelReservation', { reservationId: held[0] }, s.a);
      assert.equal((await db.get(`publicWishlists/${s.A.coupleId}/${dinner}`)).state, 'OPEN');
    });

    test('16-17. five friends fund a ₹35,000 refrigerator together and the goal completes', async () => {
      s.fridge = (await call('saveItem', { name: 'Refrigerator', category: 'Home Appliances', budget: 35000 }, s.a)).id;
      const { groupGiftId, target } = await call('createGroupGift', { coupleId: s.A.coupleId, itemId: s.fridge, organizerName: 'Guest A', title: 'College friends' });
      assert.equal(target, 35000);
      const paid = [];
      for (const [name, amount] of [['Guest A', 5000], ['Guest B', 10000], ['Guest C', 5000], ['Guest D', 10000], ['Guest E', 5000]]) {
        paid.push(await guestPays({ coupleId: s.A.coupleId, itemId: s.fridge, amount, guestName: name, groupGiftId, anonymous: name === 'Guest C' }));
      }
      // verify all five at the same moment: totals must still be exact
      await Promise.all(paid.map((c) => call('verifyContribution', { id: c.id, kind: 'item' }, s.a)));
      const group = await db.get(`publicGroupGifts/${s.A.coupleId}/${groupGiftId}`);
      assert.ok(group.completedAt, 'the group goal is marked completed');
      for (const k of ['verified', 'pending', 'members']) assert.equal(group[k], undefined, `public group must not show ${k}`);
      assert.ok(!mentions(group, 'Guest B'), 'friends never see who paid or how much');
      const priv = await db.get(`groupGifts/${s.A.coupleId}/${groupGiftId}`);
      assert.equal(Object.values(priv.members).reduce((sum, m) => sum + m.amount, 0), 35000, 'each contributor is tracked separately');
      const it = await item(s.A.coupleId, s.fridge);
      assert.deepEqual([it.stats.verified, it.stats.contributors, it.state, it.completedVia], [35000, 5, 'COMPLETED', 'funded']);
      assert.equal((await db.get(`publicWishlists/${s.A.coupleId}/${s.fridge}`)).state, 'COMPLETED');
      assert.equal(await denied('createContribution', { coupleId: s.A.coupleId, kind: 'item', itemId: s.fridge, amount: 500, guestName: 'Late Guest', utr: '499999999992' }), 'failed-precondition');
    });

    test('18-19. a Lifafa is recorded separately and never touches the wishlist budget', async () => {
      const before = await db.get(`coupleStats/${s.A.coupleId}`);
      const l = await guestPays({ coupleId: s.A.coupleId, amount: 2101, guestName: 'Sharma Family', message: 'Blessings to you both' });
      assert.equal((await db.get(`lifafa/${s.A.coupleId}/${l.id}`)).status, 'PENDING_VERIFICATION');
      assert.equal(await db.get(`contributions/${s.A.coupleId}/${l.id}`), null);
      await call('verifyContribution', { id: l.id, kind: 'lifafa' }, s.a);
      const after = await db.get(`coupleStats/${s.A.coupleId}`);
      assert.deepEqual([after.lifafaVerified, after.lifafaCount], [2101, 1]);
      assert.deepEqual([after.verified, after.budget, after.completed], [before.verified, before.budget, before.completed], 'wishlist totals unchanged');
    });

    test('20. every couple has a unique public link that resolves to their wishlist (QR target)', async () => {
      assert.equal(await db.get(`slugs/${s.A.slug}`), s.A.coupleId);
      assert.equal(await db.get(`slugs/${s.B.slug}`), s.B.coupleId);
    });

    test('21. thank-you cards exist only for verified gifts and never reveal an anonymous guest', async () => {
      const named = await call('saveThankYouCard', { contributionId: s.c1.id, kind: 'item', template: 'royal', message: 'Thank you for being part of our special journey.' }, s.a);
      assert.equal(named.card.guestLabel, 'Kavita Joshi');
      const anon = await call('saveThankYouCard', { contributionId: s.c2.id, kind: 'item', template: 'blush', message: 'Your love means so much to us.' }, s.a);
      assert.ok(!mentions(anon.card, 'Mahesh') && anon.card.anonymous);
      const pending = await guestPays({ coupleId: s.A.coupleId, amount: 501, guestName: 'Not Yet Verified' });
      assert.equal(await denied('saveThankYouCard', { contributionId: pending.id, kind: 'lifafa', message: 'Thanks!' }, s.a), 'failed-precondition');
    });

    test('22. the couple can read every contribution record needed for the export', async () => {
      for (const r of Object.values(await db.get(`contributions/${s.A.coupleId}`))) {
        for (const field of ['guestName', 'amount', 'status', 'refCode', 'utr', 'createdAt', 'itemName']) assert.ok(r[field] !== undefined, `record has ${field}`);
      }
    });

    test('23. a guest cannot change any financial record', async () => {
      const snapshot = async () => JSON.stringify(await Promise.all(['contributions', 'wishlists', 'coupleStats'].map((n) => db.get(`${n}/${s.A.coupleId}`))));
      const before = await snapshot();
      const target = { id: s.c1.id, kind: 'item', coupleId: s.A.coupleId };
      for (const [action, data] of [['verifyContribution', target], ['rejectContribution', { ...target, reason: 'mischief' }], ['refundContribution', { ...target, note: 'mischief' }],
        ['saveItem', { id: s.honeymoon, name: 'Honeymoon', category: 'Honeymoon & Travel', budget: 1 }], ['recalculateTotals', target], ['adminSaveSettings', {}], ['confirmReservation', { reservationId: s.mixerRes }]]) {
        assert.equal(await denied(action, data), 'unauthenticated', action);
      }
      assert.equal(await denied('verifyContribution', target, JSON.stringify({ uid: 'fake', role: 'admin' })), 'permission-denied');
      assert.equal(await denied('noSuchAction', {}), 'not-found');
      assert.equal(await denied('constructor', {}), 'not-found');
      assert.equal(await snapshot(), before);
    });

    test('24. invalid and duplicate UTRs are refused', async () => {
      const base = { coupleId: s.A.coupleId, kind: 'item', itemId: s.honeymoon, amount: 1000, guestName: 'Copy Cat' };
      for (const bad of ['12345', 'ABCDEFGHIJKL', '1234567890123', '']) assert.equal(await denied('createContribution', { ...base, utr: bad }), 'invalid-argument');
      const count = Object.keys(await db.get(`contributions/${s.A.coupleId}`)).length;
      assert.equal(await denied('createContribution', { ...base, utr: '412355678901' }), 'already-exists', "re-using Kavita's UTR");
      assert.equal(await denied('createContribution', { ...base, kind: 'lifafa', utr: '412355678901' }), 'already-exists', 'also refused as a Lifafa');
      assert.equal(Object.keys(await db.get(`contributions/${s.A.coupleId}`)).length, count, 'no record is created for a duplicate');
    });

    // ------------------------------------------------------------ beyond the 25

    test('budget changes recalculate what remains without touching payment history', async () => {
      const history = JSON.stringify(await db.get(`contributions/${s.A.coupleId}`));
      await call('saveItem', { id: s.honeymoon, name: 'Honeymoon in Switzerland', category: 'Honeymoon & Travel', budget: 350000, priority: 'high' }, s.a);
      const it = await item(s.A.coupleId, s.honeymoon);
      assert.equal(it.budget - it.stats.verified, 335000);
      assert.equal(JSON.stringify(await db.get(`contributions/${s.A.coupleId}`)), history);
    });

    test('reject, re-verify with a corrected amount, and refund all keep the totals exact', async () => {
      const c = await guestPays({ coupleId: s.A.coupleId, itemId: s.honeymoon, amount: 2000, guestName: 'Arjun Nair' });
      const base = await stats(s.A.coupleId, s.honeymoon);
      await call('rejectContribution', { id: c.id, kind: 'item', reason: 'Not found in bank statement' }, s.a);
      assert.equal((await db.get(`guestReceipts/${c.receipt}`)).rejectedReason, 'Not found in bank statement');
      await call('verifyContribution', { id: c.id, kind: 'item', receivedAmount: 1800 }, s.a);
      assert.equal((await stats(s.A.coupleId, s.honeymoon)).verified, base.verified + 1800);
      const record = await db.get(`contributions/${s.A.coupleId}/${c.id}`);
      assert.deepEqual([record.amount, record.verifiedAmount], [2000, 1800], 'the reported amount is preserved');
      assert.deepEqual(Object.values(record.history).map((h) => h.status), ['PENDING_VERIFICATION', 'REJECTED', 'VERIFIED']);
      await call('refundContribution', { id: c.id, kind: 'item', note: 'Returned at guest request' }, s.a);
      assert.deepEqual(await stats(s.A.coupleId, s.honeymoon), base);
      assert.equal(await db.get(`publicFeed/${s.A.coupleId}/contributors/${c.id}`), null);
    });

    test('a refund re-opens an item it un-funds; deleting an item keeps its payments; fulfil and reopen', async () => {
      const lamp = (await call('saveItem', { name: 'Lamp', category: 'Bedroom & Furniture', budget: 1500 }, s.a)).id;
      const c = await guestPays({ coupleId: s.A.coupleId, itemId: lamp, amount: 1500, guestName: 'Full Gifter', fullGift: true });
      await call('verifyContribution', { id: c.id, kind: 'item' }, s.a);
      assert.equal((await item(s.A.coupleId, lamp)).state, 'COMPLETED');
      await call('refundContribution', { id: c.id, kind: 'item', note: 'Guest paid twice' }, s.a);
      assert.equal((await item(s.A.coupleId, lamp)).state, 'OPEN');
      const again = await guestPays({ coupleId: s.A.coupleId, itemId: lamp, amount: 700, guestName: 'Half Gifter' });
      await call('verifyContribution', { id: again.id, kind: 'item' }, s.a);
      const was = await db.get(`coupleStats/${s.A.coupleId}`);
      await call('deleteItem', { id: lamp }, s.a);
      assert.equal(await db.get(`publicWishlists/${s.A.coupleId}/${lamp}`), null);
      assert.equal((await db.get(`contributions/${s.A.coupleId}/${again.id}`)).status, 'VERIFIED');
      const now = await db.get(`coupleStats/${s.A.coupleId}`);
      assert.deepEqual([now.budget, now.items, now.verified], [was.budget - 1500, was.items - 1, was.verified]);
      const fryer = (await call('saveItem', { name: 'Air Fryer', category: 'Kitchen Essentials', budget: 7000 }, s.a)).id;
      assert.equal((await call('setItemStatus', { id: fryer, action: 'fulfil' }, s.a)).state, 'COMPLETED');
      assert.equal((await call('setItemStatus', { id: fryer, action: 'reopen' }, s.a)).state, 'OPEN');
    });

    test('totals rebuilt from the payment records match the running totals', async () => {
      const running = await db.get(`coupleStats/${s.A.coupleId}`);
      const { stats: rebuilt } = await call('recalculateTotals', {}, s.a);
      for (const key of ['budget', 'items', 'completed', 'verified', 'contributors', 'lifafaVerified', 'lifafaCount']) assert.equal(rebuilt[key] || 0, running[key] || 0, `coupleStats.${key}`);
      const priv = await db.get(`wishlists/${s.A.coupleId}`);
      const pub = (await db.get(`publicWishlists/${s.A.coupleId}`)) || {};
      for (const [id, it] of Object.entries(priv)) {
        if (it.deleted || it.visibility !== 'public') assert.equal(pub[id], undefined);
        else assert.deepEqual([pub[id].giftable, pub[id].state, pub[id].budget, pub[id].received], [!(it.stats.verified > 0), it.state, it.budget, undefined]);
      }
    });

    test('wedding wishes: private stays private, public appears only after the couple approves', async () => {
      const pub = await call('askQuestion', { coupleId: s.A.coupleId, type: 'wish', guestName: 'Dadi', message: 'Bahut bahut badhai!', isPublic: true });
      const priv = await call('askQuestion', { coupleId: s.A.coupleId, type: 'wish', guestName: 'Chachu', message: 'Call me after the wedding', isPublic: false });
      const convs = Object.entries(await db.get(`conversations/${s.A.coupleId}`));
      const pubId = convs.find(([, c]) => c.token === pub.token)[0];
      assert.ok(!mentions(await db.get(`publicFeed/${s.A.coupleId}`), 'badhai'));
      await call('setWishApproval', { convId: pubId, approved: true }, s.a);
      assert.equal((await db.get(`publicFeed/${s.A.coupleId}/wall/${pubId}`)).text, 'Bahut bahut badhai!');
      assert.equal(await denied('setWishApproval', { convId: convs.find(([, c]) => c.token === priv.token)[0], approved: true }, s.a), 'failed-precondition');
      await call('sendMessage', { convId: pubId, text: 'Thank you Dadi!' }, s.a);
      await call('sendMessage', { token: pub.token, text: 'Khush raho' });
      assert.equal(Object.keys((await db.get(`guestThreads/${pub.token}`)).messages).length, 3);
      assert.equal((await db.get(`conversations/${s.A.coupleId}/${pubId}`)).unreadCouple, 2);
    });

    test('admin: dispute override, new login, deactivation, maintenance mode', async () => {
      await call('verifyContribution', { id: s.bPay.id, kind: 'item', coupleId: s.B.coupleId, note: 'Confirmed with bank' }, s.admin);
      assert.equal((await stats(s.B.coupleId, s.bItem)).verified, 2000);
      // forgotten password: the old login is removed, the admin issues a new one, the data stays
      await app.ctx.auth.deleteUser(JSON.parse(s.b).uid);
      await call('adminNewLogin', { coupleId: s.B.coupleId, password: 'temp12345' }, s.admin);
      assert.equal(await denied('saveItem', { name: 'Old login', category: 'Electronics', budget: 100 }, s.b), 'permission-denied', 'the old sign-in no longer opens the account');
      s.b = await login('9876500000', 'temp12345');
      assert.equal((await call('session', {}, s.b)).mustChangePassword, true);
      assert.equal((await item(s.B.coupleId, s.bItem)).name, 'Sofa set');

      await call('adminSetCoupleStatus', { coupleId: s.B.coupleId, status: 'inactive' }, s.admin);
      assert.equal(await denied('saveItem', { name: 'Still here?', category: 'Other Requirements', budget: 100 }, s.b), 'permission-denied');
      assert.equal((await db.get(`publicProfiles/${s.B.coupleId}`)).active, false);
      assert.equal(await denied('createContribution', { coupleId: s.B.coupleId, kind: 'lifafa', amount: 500, guestName: 'Late', utr: '499999999993' }), 'failed-precondition');
      await call('adminSetCoupleStatus', { coupleId: s.B.coupleId, status: 'active' }, s.admin);

      const settings = { suggestedAmounts: [500, 1000, 2000, 5000, 10000], lifafaAmounts: [501, 1101], minAmount: 1, maxAmount: 100000 };
      await call('adminSaveSettings', { ...settings, maintenance: true, maintenanceMessage: 'Back at 6 pm' }, s.admin);
      assert.equal(await denied('createContribution', { coupleId: s.A.coupleId, kind: 'lifafa', amount: 501, guestName: 'Paused', utr: '499999999994' }), 'unavailable');
      await call('adminSaveSettings', { ...settings, maintenance: false }, s.admin);
      assert.equal(await denied('createContribution', { coupleId: s.A.coupleId, kind: 'lifafa', amount: 200000, guestName: 'Too Much', utr: '499999999995' }), 'invalid-argument');
    });

    test('input validation refuses unsafe or malformed data', async () => {
      const base = { name: 'Valid name', category: 'Electronics', budget: 1000 };
      for (const bad of [{ budget: -5 }, { budget: 99.5 }, { budget: '1e9' }, { productLink: 'javascript:alert(1)' }, { imageUrl: 'http://insecure.example/a.png' }, { name: 'x'.repeat(200) }, { id: '../../admins' }]) {
        assert.equal(await denied('saveItem', { ...base, ...bad }, s.a), 'invalid-argument', JSON.stringify(bad));
      }
      assert.equal(await denied('createContribution', { coupleId: '../x', kind: 'lifafa', amount: 500, guestName: 'Path', utr: '499999999996' }), 'invalid-argument');
      assert.equal(await denied('updatePaymentSettings', { upiId: 'not a upi id', payeeName: 'Suyash', password: 'couple1234' }, s.a), 'invalid-argument');
      const { id } = await call('saveItem', { ...base, name: '  Tidy​   name\u0007 ' }, s.a);
      assert.equal((await item(s.A.coupleId, id)).name, 'Tidy name');
    });
  });
}
