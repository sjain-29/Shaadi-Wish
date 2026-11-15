// Live backend on the FREE Firebase plan (Spark): Authentication + Realtime
// Database only. No Cloud Functions, no Storage, no billing account.
//
// The app logic in js/core runs in this browser and writes straight to the
// database. What each visitor is allowed to read or write is decided by
// firebase/database.rules.json, which Firebase enforces on its servers.
import { APP, firebaseConfig } from './app-config.js';
import { dispatch, AppError } from './core/index.js';
import { normalizeMobile } from './core/util.js';
import { V } from './core/validate.js';

const base = `https://www.gstatic.com/firebasejs/${APP.firebaseSdkVersion}/firebase-`;
const [F, A, D] = await Promise.all([import(`${base}app.js`), import(`${base}auth.js`), import(`${base}database.js`)]);
const app = F.initializeApp(firebaseConfig);
const auth = A.getAuth(app);
const db = D.getDatabase(app);

// Firebase's free sign-in is "email + password". People type their mobile
// number; it is turned into a private login address they never see.
const email = (mobile) => `${mobile}@${APP.loginDomain}`;
const problem = (code, message) => Object.assign(new Error(message), { code });

const store = {
  get: async (path) => (await D.get(D.ref(db, path))).val(),
  set: (path, value) => D.set(D.ref(db, path), value),
  update: (updates) => D.update(D.ref(db), updates), // all paths are written together, or none
  async transaction(path, updateFn) {
    const result = await D.runTransaction(D.ref(db, path), updateFn, { applyLocally: false });
    return { committed: result.committed, value: result.snapshot.val() };
  },
  newId: () => D.push(D.ref(db)).key,
  increment: (n) => D.increment(n),
};

async function reauthenticate(password, message) {
  try {
    await A.reauthenticateWithCredential(auth.currentUser, A.EmailAuthProvider.credential(auth.currentUser.email, String(password)));
  } catch {
    throw new AppError('permission-denied', message);
  }
}

const ctx = {
  db: store,
  now: () => Date.now(),
  config: { appName: APP.name },
  auth: {
    /** Admin creates a couple's login. A second, temporary connection is used so the admin stays signed in. */
    async createUser({ mobile, password }) {
      const second = F.initializeApp(firebaseConfig, `provision-${Date.now()}`);
      try {
        return (await A.createUserWithEmailAndPassword(A.getAuth(second), email(mobile), password)).user.uid;
      } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
          throw new AppError('already-exists', 'This mobile number already has a login. To replace it, delete that user in the Firebase console (Authentication → Users), then try again.');
        }
        throw new AppError('internal', 'The login could not be created. Check that Email/Password sign-in is enabled in the Firebase console.');
      } finally {
        await A.signOut(A.getAuth(second)).catch(() => {});
        await F.deleteApp(second).catch(() => {});
      }
    },
    confirmPassword: (uid, password) => reauthenticate(password, 'Your password is not correct.'),
    deleteUser: async () => {}, // only the Firebase console can delete a login on the free plan
  },
};

/** Works out who a signed-in person is from the database, not from anything the browser claims. */
async function describe(user) {
  if (!user) return null;
  if (await store.get(`admins/${user.uid}`).catch(() => null)) return { uid: user.uid, role: 'admin', coupleId: null };
  const linked = await store.get(`users/${user.uid}`).catch(() => null);
  return linked && linked.coupleId ? { uid: user.uid, role: 'couple', coupleId: linked.coupleId } : null;
}
let current = null;
const ready = new Promise((resolve) => {
  A.onAuthStateChanged(auth, async (user) => {
    current = await describe(user);
    resolve();
  });
});

export default {
  mode: 'live',
  async call(action, data = {}) {
    try {
      return await dispatch(ctx, { action, data: structuredClone(data), auth: current });
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error(err);
      const refused = /permission/i.test(String(err.message || err.code));
      throw problem(refused ? 'permission-denied' : 'internal', refused ? 'The database did not allow this change. Please refresh the page and try again.' : 'Something went wrong. Please check your connection and try again.');
    }
  },
  /** Live read. Calls back with null if the security rules refuse it. */
  watch: (path, cb) => D.onValue(D.ref(db, path), (snap) => cb(snap.val()), () => cb(null)),
  get: (path) => store.get(path).catch(() => null),
  async session() {
    await ready;
    return current;
  },
  async login(mobile, password) {
    const m = normalizeMobile(mobile);
    if (!m) throw problem('invalid-argument', 'Please enter a valid 10-digit mobile number.');
    let user;
    try {
      ({ user } = await A.signInWithEmailAndPassword(auth, email(m), String(password)));
    } catch (err) {
      throw problem('unauthenticated', err.code === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes and try again.' : 'Incorrect mobile number or password.');
    }
    current = await describe(user);
    if (!current) {
      await A.signOut(auth);
      throw problem('permission-denied', 'This login is not linked to an account. Please contact the administrator.');
    }
    return current;
  },
  async changePassword(currentPassword, next) {
    V.password(next, 'New password');
    await reauthenticate(currentPassword, 'Your current password is not correct.');
    await A.updatePassword(auth.currentUser, next);
    await this.call('passwordChanged');
  },
  async signOut() {
    await A.signOut(auth);
    current = null;
  },
};
