// Preview backend: runs the same app logic (js/core) against an in-memory
// database saved in this browser's localStorage, with sample data. Nothing
// leaves the device, no money moves, and no Firebase project is needed.
// Open two tabs (guest page + dashboard) and they stay in sync.
import { APP } from './app-config.js';
import { dispatch, AppError } from './core/index.js';
import { MemoryDb } from './core/memory-db.js';
import { passwords } from './core/web-passwords.js';
import { normalizeMobile, randomId } from './core/util.js';
import { V } from './core/validate.js';

const DB_KEY = 'shaadiwish-preview-db-v2';
const SESSION_KEY = 'shaadiwish-preview-session';
const db = new MemoryDb();
const saved = localStorage.getItem(DB_KEY);
if (saved) db.load(saved);
let timer;
const flush = () => {
  clearTimeout(timer);
  try { localStorage.setItem(DB_KEY, db.serialize()); } catch { /* storage full or blocked: keep working in memory */ }
};
db.onWrite = () => {
  clearTimeout(timer);
  timer = setTimeout(flush, 50);
};
addEventListener('pagehide', flush);
addEventListener('storage', (e) => {
  if (e.key === DB_KEY && e.newValue) db.load(e.newValue);
});

const ctx = {
  db,
  now: () => Date.now(),
  config: { appName: APP.name },
  auth: {
    async createUser({ mobile, password }) {
      if (await db.get(`previewLogins/${mobile}`)) throw new AppError('already-exists', 'This mobile number already has a login.');
      const uid = `u_${randomId()}`;
      await db.set(`previewLogins/${mobile}`, { uid, hash: await passwords.hash(password) });
      return uid;
    },
    async confirmPassword(uid, password, message = 'Your password is not correct.') {
      const login = Object.values((await db.get('previewLogins')) || {}).find((l) => l.uid === uid);
      if (!login || !(await passwords.verify(String(password), login.hash))) throw new AppError('permission-denied', message);
    },
    async deleteUser(uid) {
      for (const [mobile, l] of Object.entries((await db.get('previewLogins')) || {})) if (l.uid === uid) await db.set(`previewLogins/${mobile}`, null);
    },
  },
};
async function describe(uid) {
  if (await db.get(`admins/${uid}`)) return { uid, role: 'admin', coupleId: null };
  const linked = await db.get(`users/${uid}`);
  return linked ? { uid, role: 'couple', coupleId: linked.coupleId } : null;
}

let current = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
const run = (auth, action, data = {}) => dispatch(ctx, { action, data: structuredClone(data), auth });

async function seed() {
  const guest = (a, d) => run(null, a, d);
  const adminUid = await ctx.auth.createUser({ mobile: '9000000000', password: 'admin1234' });
  await db.set(`admins/${adminUid}`, true);
  const admin = await describe(adminUid);
  const date = new Date(Date.now() + 76 * 864e5).toISOString().slice(0, 10);
  const { coupleId } = await run(admin, 'adminCreateCouple', { partner1: 'Aarav Sharma', partner2: 'Meera Iyer', mobile: '9876543210', password: 'demo1234', weddingDate: date });
  await run(admin, 'adminCreateCouple', { partner1: 'Kabir Khan', partner2: 'Sana Mirza', mobile: '9876500000', password: 'demo1234', weddingDate: date });
  const me = await describe(await db.get(`couples/${coupleId}/uid`));
  await run(me, 'passwordChanged');
  await run(me, 'updatePaymentSettings', { upiId: 'aarav.meera@okhdfcbank', payeeName: 'Aarav Sharma', password: 'demo1234' });
  await run(me, 'updateProfile', { partner1: 'Aarav Sharma', partner2: 'Meera Iyer', weddingDate: date, location: 'Udaipur, Rajasthan', theme: 'marigold',
    welcomeMessage: 'Your presence is the greatest gift. If you wish to bless us with something more, here are a few dreams we are building our new life around.' });
  const items = [
    ['Honeymoon in Switzerland', 'Honeymoon & Travel', 300000, 'high', 'Ten days across Zurich, Interlaken and Zermatt.'],
    ['First Home Down Payment', 'Home Down Payment', 1000000, 'high', 'A little place of our own in Pune.'],
    ['Refrigerator', 'Home Appliances', 35000, 'medium', 'Double door, frost free.'],
    ['Kitchen Mixer', 'Kitchen Essentials', 5000, 'medium', 'For chutneys every single morning.'],
    ['Queen Bed & Mattress', 'Bedroom & Furniture', 45000, 'medium', ''],
    ['Smart TV', 'Electronics', 55000, 'low', '55 inch, for movie nights.'],
    ['Dinner Set', 'Kitchen Essentials', 8000, 'low', '24-piece ceramic set.'],
    ['Scuba Diving in Andaman', 'Experiences & Activities', 20000, 'low', 'A first for both of us!'],
  ];
  const id = {};
  for (const [name, category, budget, priority, description] of items) {
    id[name] = (await run(me, 'saveItem', { name, category, budget, priority, description })).id;
  }
  let utr = 400000000000;
  const pay = async (data, verify = true) => {
    const c = await guest('createContribution', { coupleId, utr: String(++utr), ...data });
    if (verify) await run(me, 'verifyContribution', { id: c.id, kind: data.kind });
    return c;
  };
  const h = id['Honeymoon in Switzerland'];
  const k = await pay({ kind: 'item', itemId: h, amount: 25000, guestName: 'Kavita Joshi', message: 'Send us postcards from the Alps!', messagePublic: true });
  await run(me, 'setWallApproval', { id: k.id, kind: 'item', approved: true });
  await pay({ kind: 'item', itemId: h, amount: 50000, guestName: 'Mahesh Kulkarni', anonymous: true });
  await pay({ kind: 'item', itemId: id['First Home Down Payment'], amount: 100000, guestName: 'Nana & Nani' });
  await pay({ kind: 'item', itemId: id['Scuba Diving in Andaman'], amount: 20000, guestName: 'College Gang', fullGift: true });
  await pay({ kind: 'item', itemId: h, amount: 5000, guestName: 'Ritu Malhotra', message: 'So happy for you two.' }, false);
  await pay({ kind: 'lifafa', amount: 2101, guestName: 'Sharma Family', message: 'Blessings to you both.' });
  await pay({ kind: 'lifafa', amount: 1101, guestName: 'Deepak Uncle' }, false);
  const g = await guest('createGroupGift', { coupleId, itemId: id.Refrigerator, organizerName: 'Rohan', title: 'Office friends' });
  await pay({ kind: 'item', itemId: id.Refrigerator, amount: 10000, guestName: 'Rohan', groupGiftId: g.groupGiftId });
  await pay({ kind: 'item', itemId: id.Refrigerator, amount: 5000, guestName: 'Isha', groupGiftId: g.groupGiftId });
  await guest('startGift', { coupleId, itemId: id['Kitchen Mixer'], guestName: 'Neha Kapoor', message: 'Hi! I would love to gift you this kitchen mixer. Which brand and model would you prefer?' });
  await guest('askQuestion', { coupleId, type: 'wish', guestName: 'Dadi', message: 'Sada khush raho, mere bachchon. Bahut saara pyaar.', isPublic: true });
}
if (!saved) {
  await seed();
  flush();
}

const fail = (err) => {
  const e = new Error(err.message || 'Something went wrong.');
  e.code = err.code || 'internal';
  return e;
};

export default {
  mode: 'preview',
  async call(action, data = {}) {
    try {
      const result = await run(current, action, data);
      flush(); // saved before any redirect that follows
      return result;
    } catch (err) {
      if (err.name !== 'AppError') console.error(err);
      throw fail(err);
    }
  },
  watch: (path, cb) => db.watch(path, cb),
  get: (path) => db.get(path),
  session: async () => current,
  async login(mobile, password) {
    const login = await db.get(`previewLogins/${normalizeMobile(mobile) || 'x'}`);
    if (!login || !(await passwords.verify(String(password), login.hash))) throw fail({ code: 'unauthenticated', message: 'Incorrect mobile number or password.' });
    current = await describe(login.uid);
    if (!current) throw fail({ code: 'permission-denied', message: 'This login is not linked to an account.' });
    localStorage.setItem(SESSION_KEY, JSON.stringify(current));
    return current;
  },
  async changePassword(currentPassword, next) {
    V.password(next, 'New password');
    await ctx.auth.confirmPassword(current.uid, currentPassword, 'Your current password is not correct.');
    const mobile = Object.entries(await db.get('previewLogins')).find(([, l]) => l.uid === current.uid)[0];
    await db.set(`previewLogins/${mobile}/hash`, await passwords.hash(next));
    await this.call('passwordChanged');
  },
  async signOut() {
    current = null;
    localStorage.removeItem(SESSION_KEY);
  },
  /** Preview only: wipe the sample data and start again. */
  reset() {
    localStorage.removeItem(DB_KEY);
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  },
};
