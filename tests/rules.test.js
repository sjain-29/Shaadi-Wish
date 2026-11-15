// Security-rules tests for firebase/database.rules.json. On the free plan the
// browser writes straight to the database, so these rules ARE the security.
// They are evaluated locally with "targaryen" (an offline rules evaluator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const targaryen = createRequire(import.meta.url)('targaryen');
const rules = JSON.parse(readFileSync(new URL('../firebase/database.rules.json', import.meta.url), 'utf8'));
const TOKEN = 'kq3ZxT9bV1mN7pR5sW2yA8cE4gH6jL0d';
const NEW = 'Zz9ZxT9bV1mN7pR5sW2yA8cE4gH6jL0d';
const data = {
  admins: { adminUid: true },
  users: { uidA: { coupleId: 'cA', mustChange: true }, uidB: { coupleId: 'cB' }, uidX: { coupleId: 'cX' } },
  couples: { cA: { status: 'active', slug: 'a-and-b', mobile: '9876543210' }, cB: { status: 'active' }, cX: { status: 'inactive' } },
  publicProfiles: { cA: { active: true, slug: 'a-and-b', upiId: 'a@okhdfcbank' }, cB: { active: true }, cX: { active: false } },
  publicWishlists: { cA: { i1: { name: 'Honeymoon', received: 5000 } }, cX: { i9: { name: 'Offline' } } },
  publicFeed: { cA: { contributors: { p1: { name: 'Anonymous Guest' } } } },
  publicGroupGifts: { cA: { g1: { target: 35000, verified: 0 } } },
  groupGifts: { cA: { g1: { target: 35000, verified: 0 } } },
  slugs: { 'a-and-b': 'cA' },
  wishlists: { cA: { i1: { budget: 300000, stats: { verified: 5000 } } }, cB: { i2: { budget: 60000 } } },
  contributions: { cA: { p1: { amount: 5000, status: 'PENDING_VERIFICATION', utr: '412355678901' } }, cB: { p2: { amount: 2000 } } },
  lifafa: { cA: { l1: { amount: 2101 } } },
  conversations: { cA: { v1: { guestName: 'Neha', token: TOKEN, unreadCouple: 0 } }, cB: { v2: { guestName: 'Other', token: 'x' } } },
  messages: { cA: { v1: { m1: { text: 'hi', from: 'guest' } } }, cB: { v2: { m2: { text: 'private', from: 'guest' } } } },
  reservations: { cA: { r1: { status: 'DISCUSSING' } } },
  thankYouCards: { cA: { t1: { message: 'Thanks' } } },
  paymentSettings: { cA: { upiId: 'a@okhdfcbank' } },
  coupleStats: { cA: { verified: 5000 } },
  guestThreads: { [TOKEN]: { meta: { coupleId: 'cA', guestName: 'Neha', unreadGuest: 0 }, messages: { m1: { text: 'hi' } } } },
  guestReceipts: { [TOKEN]: { coupleId: 'cA', status: 'PENDING_VERIFICATION' } },
  utrIndex: { 412355678901: { at: 1 } },
  auditLogs: { cA: { x1: { action: 'item.created' } }, _platform: { x2: { action: 'couple.created' } } },
  publicSettings: { maxAmount: 100000 },
  publicPaymentQr: { cA: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', cX: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' },
};
const db = targaryen.database(rules, data);
const who = { guest: null, coupleA: { uid: 'uidA' }, coupleB: { uid: 'uidB' }, inactive: { uid: 'uidX' }, admin: { uid: 'adminUid' }, stranger: { uid: 'selfSignedUp' } };
const canRead = (actor, path) => db.as(who[actor]).read(path).allowed;
const canWrite = (actor, path, value = { tampered: true }) => db.as(who[actor]).write(path, value).allowed;
const canUpdate = (actor, patch) => db.as(who[actor]).update('/', patch).allowed;
const reads = (actor, yes, no) => {
  for (const p of yes) assert.equal(canRead(actor, p), true, `${actor} should read ${p}`);
  for (const p of no) assert.equal(canRead(actor, p), false, `${actor} must NOT read ${p}`);
};
const payment = (over = {}) => ({ kind: 'item', status: 'PENDING_VERIFICATION', amount: 5000, guestName: 'Kavita', utr: '499999999999', itemId: 'i1', createdAt: 1, ...over });

test('guests read only public data and one secret link at a time', () => {
  reads('guest',
    ['publicSettings', 'slugs/a-and-b', 'publicProfiles/cA', 'publicWishlists/cA', 'publicFeed/cA', 'publicGroupGifts/cA', `guestThreads/${TOKEN}`, `guestReceipts/${TOKEN}`, 'utrIndex/412355678901'],
    ['/', 'slugs', 'publicProfiles', 'guestThreads', 'guestReceipts', 'guestThreads/short', 'utrIndex', 'publicWishlists/cX', 'couples', 'couples/cA', 'wishlists/cA', 'contributions/cA',
      'contributions/cA/p1', 'lifafa/cA', 'conversations/cA', 'messages/cA/v1', 'reservations/cA', 'groupGifts/cA', 'paymentSettings/cA', 'coupleStats/cA', 'thankYouCards/cA', 'users/uidA', 'admins', 'auditLogs']);
});

test('a guest can only ADD a pending payment report, and cannot fake a verified one', () => {
  const ok = { 'contributions/cA/new1': payment(), [`guestReceipts/${NEW}`]: { coupleId: 'cA', status: 'PENDING_VERIFICATION' } };
  assert.equal(canUpdate('guest', ok), true, 'valid report');
  assert.equal(canWrite('guest', 'lifafa/cA/new2', payment({ kind: 'lifafa' })), true, 'valid lifafa');
  for (const [why, bad] of [['already verified', { status: 'VERIFIED' }], ['verified amount set', { verifiedAmount: 5000 }], ['no UTR', { utr: null }], ['bad UTR', { utr: '12AB' }],
    ['negative amount', { amount: -1 }], ['amount as text', { amount: '5000' }], ['huge name', { guestName: 'x'.repeat(200) }], ['wrong kind', { kind: 'lifafa' }], ['pre-approved message', { wallApproved: true }]]) {
    assert.equal(canWrite('guest', 'contributions/cA/new3', payment(bad)), false, why);
  }
  assert.equal(canWrite('guest', 'contributions/cX/new4', payment()), false, 'inactive couple');
  assert.equal(canWrite('guest', 'contributions/cA/p1', payment()), false, 'cannot overwrite an existing record');
  assert.equal(canWrite('guest', 'contributions/cA/p1/status', 'VERIFIED'), false);
  assert.equal(canWrite('guest', 'contributions/cA/p1', null), false, 'cannot delete');
  assert.equal(canWrite('guest', `guestReceipts/${TOKEN}/status`, 'VERIFIED'), false, 'cannot mark own receipt verified');
  assert.equal(canWrite('guest', 'utrIndex/499999999999', { at: 1 }), true, 'new UTR can be claimed');
  assert.equal(canWrite('guest', 'utrIndex/412355678901', { at: 2 }), false, 'a used UTR cannot be claimed again');
  assert.equal(canWrite('guest', 'utrIndex/412355678901', null), false, 'or released');
});

test('a guest can start and continue a conversation, start a group or gift request, and nothing more', () => {
  const start = {
    'conversations/cA/v9': { guestName: 'Asha', token: NEW, lastFrom: 'guest', lastText: 'hello', unreadCouple: 1 },
    'messages/cA/v9/m1': { from: 'guest', text: 'hello', at: 1 },
    [`guestThreads/${NEW}`]: { meta: { coupleId: 'cA', convId: 'v9', guestName: 'Asha' }, messages: { m1: { from: 'guest', text: 'hello' } } },
  };
  assert.equal(canUpdate('guest', start), true, 'start a conversation');
  const reply = { 'messages/cA/v1/m2': { from: 'guest', text: 'thanks', at: 2 }, [`guestThreads/${TOKEN}/messages/m2`]: { from: 'guest', text: 'thanks' },
    'conversations/cA/v1/lastAt': 2, 'conversations/cA/v1/lastText': 'thanks', 'conversations/cA/v1/lastFrom': 'guest', 'conversations/cA/v1/unreadCouple': 1, [`guestThreads/${TOKEN}/meta/lastAt`]: 2 };
  assert.equal(canUpdate('guest', reply), true, 'reply in own thread');
  assert.equal(canWrite('guest', `guestThreads/${TOKEN}/meta/unreadGuest`, 0), true, 'mark own thread read');
  assert.equal(canWrite('guest', 'messages/cA/v1/m3', { from: 'couple', text: 'forged' }), false, 'cannot post as the couple');
  assert.equal(canWrite('guest', 'messages/cA/nope/m1', { from: 'guest', text: 'x' }), false, 'no such conversation');
  assert.equal(canWrite('guest', 'messages/cA/v1/m1', { from: 'guest', text: 'edited' }), false, 'cannot edit a sent message');
  assert.equal(canWrite('guest', 'messages/cA/v1/m4', { from: 'guest', text: 'x'.repeat(2000) }), false, 'too long');
  assert.equal(canWrite('guest', 'conversations/cA/v1/token', 'stolen'), false);
  assert.equal(canWrite('guest', 'conversations/cA/v1', null), false);
  assert.equal(canWrite('guest', `guestThreads/${TOKEN}/meta/reservation/status`, 'RESERVED'), false, 'cannot reserve by themselves');
  assert.equal(canWrite('guest', `guestThreads/${TOKEN}`, null), false);
  assert.equal(canWrite('guest', 'reservations/cA/r9', { status: 'DISCUSSING', guestName: 'Asha', itemId: 'i1' }), true, 'gift request');
  assert.equal(canWrite('guest', 'reservations/cA/r9', { status: 'RESERVED', guestName: 'Asha' }), false);
  assert.equal(canWrite('guest', 'reservations/cA/r1/status', 'RESERVED'), false);
  const group = { target: 35000, verified: 0, organizer: 'Rohan', itemId: 'i1' };
  assert.equal(canUpdate('guest', { 'groupGifts/cA/g9': group, 'publicGroupGifts/cA/g9': group }), true, 'start a group');
  assert.equal(canWrite('guest', 'publicGroupGifts/cA/g9', { ...group, verified: 35000 }), false, 'cannot start a group as already funded');
  assert.equal(canWrite('guest', 'publicGroupGifts/cA/g1/verified', 35000), false);
});

test('guests, strangers and deactivated couples cannot touch anything else', () => {
  const paths = ['/', 'couples/cA/status', 'couples/cA/location', 'wishlists/cA/i1/budget', 'wishlists/cA/i1/stats/verified', 'coupleStats/cA/verified', 'publicWishlists/cA/i1/received',
    'publicProfiles/cA/upiId', 'publicProfiles/cA/partner1', 'publicFeed/cA/wall/x', 'paymentSettings/cA/upiId', 'thankYouCards/cA/t9', 'admins/selfSignedUp', 'users/selfSignedUp',
    'users/uidA/coupleId', 'slugs/evil', 'publicSettings', 'auditLogs/cA/x9', 'auditLogs/_platform/x9', 'brandNewNode/x'];
  for (const actor of ['guest', 'stranger', 'inactive']) for (const p of paths) assert.equal(canWrite(actor, p), false, `${actor} must NOT write ${p}`);
  reads('stranger', ['publicProfiles/cA'], ['couples/cA', 'contributions/cA', 'users/uidA', 'admins']);
  reads('inactive', ['publicProfiles/cX'], ['couples/cX', 'wishlists/cX', 'contributions/cX']);
});

test("a couple controls its own data and nothing of another couple's", () => {
  reads('coupleA', ['couples/cA', 'wishlists/cA', 'contributions/cA', 'lifafa/cA', 'conversations/cA', 'messages/cA/v1', 'reservations/cA', 'groupGifts/cA', 'thankYouCards/cA', 'paymentSettings/cA', 'coupleStats/cA', 'users/uidA'],
    ['couples', 'couples/cB', 'wishlists/cB', 'contributions/cB', 'contributions', 'conversations/cB', 'messages/cB/v2', 'users/uidB', 'users', 'auditLogs/cA', 'admins']);
  for (const p of ['wishlists/cA/i1/budget', 'contributions/cA/p1/status', 'coupleStats/cA/verified', 'publicWishlists/cA/i1', 'publicFeed/cA/wall/p1', 'couples/cA/location', 'couples/cA/paymentsReady',
    'publicProfiles/cA/upiId', 'paymentSettings/cA', `guestReceipts/${TOKEN}/status`, `guestThreads/${TOKEN}/meta/reservation/status`, `guestThreads/${TOKEN}/messages/m9`, 'reservations/cA/r1/status', 'auditLogs/cA/x9']) {
    assert.equal(canWrite('coupleA', p, p.endsWith('m9') ? { from: 'couple', text: 'hi' } : 'x'), true, `coupleA should write ${p}`);
  }
  assert.equal(canWrite('coupleA', 'users/uidA/mustChange', false), true);
  for (const p of ['couples/cA/status', 'couples/cA/slug', 'couples/cA/mobile', 'couples/cA/uid', 'publicProfiles/cA/active', 'publicProfiles/cA/slug', 'users/uidA/coupleId', 'admins/uidA', 'slugs/mine',
    'publicSettings', 'auditLogs/cA/x1', 'auditLogs/_platform/x9', 'wishlists/cB/i2/budget', 'contributions/cB/p2/status', 'publicWishlists/cB/i2', 'publicProfiles/cB/upiId', 'couples/cB/location', 'coupleStats/cB']) {
    assert.equal(canWrite('coupleA', p, 'x'), false, `coupleA must NOT write ${p}`);
  }
});

test("the couple's payment QR: anyone can see it, only that couple can replace it, and it must be a picture", () => {
  const qr = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  reads('guest', ['publicPaymentQr/cA'], ['publicPaymentQr/cX', 'publicPaymentQr']);
  assert.equal(canWrite('coupleA', 'publicPaymentQr/cA', qr), true);
  assert.equal(canWrite('coupleA', 'publicPaymentQr/cA', null), true, 'the couple can remove it');
  assert.equal(canWrite('coupleA', 'publicProfiles/cA/hasQr', true), true);
  for (const bad of ['https://evil.example/qr.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', 12345, { a: 1 }, `data:image/png;base64,${'A'.repeat(700000)}`]) {
    assert.equal(canWrite('coupleA', 'publicPaymentQr/cA', bad), false, `must be a small JPG/PNG/WebP picture: ${String(bad).slice(0, 30)}`);
  }
  for (const actor of ['guest', 'stranger', 'coupleB', 'inactive']) assert.equal(canWrite(actor, 'publicPaymentQr/cA', qr), false, `${actor} must NOT replace couple A's QR`);
  assert.equal(canWrite('admin', 'publicPaymentQr/cA', qr), true);
});

test('the admin oversees everything; nobody can make themselves an admin from the app', () => {
  reads('admin', ['couples', 'couples/cB', 'wishlists/cA', 'contributions', 'lifafa', 'coupleStats', 'auditLogs', 'users', 'admins', 'conversations/cA'], ['/']);
  for (const p of ['couples/cNew', 'couples/cA/status', 'users/uidNew', 'slugs/new-couple', 'publicProfiles/cA/active', 'publicSettings', 'contributions/cB/p2/status', 'auditLogs/_platform/x9']) {
    assert.equal(canWrite('admin', p, 'x'), true, `admin should write ${p}`);
  }
  for (const actor of Object.keys(who)) assert.equal(canWrite(actor, 'admins/someone', true), false, `${actor} must NOT write /admins`);
});
