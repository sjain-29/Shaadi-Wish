// Test harness: runs the app logic (js/core) against an in-memory database.
import { MemoryDb } from '../js/core/memory-db.js';
import { dispatch, AppError } from '../js/core/index.js';

export function makeApp({ cold = false } = {}) {
  const db = new MemoryDb({ simulateColdCache: cold });
  const logins = new Map(); // mobile -> { uid, password }
  let clock = Date.now();
  let n = 0;
  const ctx = {
    db,
    now: () => (clock = Math.max(clock + 1, Date.now())),
    config: { appName: 'ShaadiWish' },
    auth: {
      async createUser({ mobile, password }) {
        if (logins.has(mobile)) throw new AppError('already-exists', 'This mobile number already has a login.');
        const uid = `u${++n}`;
        logins.set(mobile, { uid, password });
        return uid;
      },
      async confirmPassword(uid, password) {
        if (![...logins.values()].some((l) => l.uid === uid && l.password === password)) throw new AppError('permission-denied', 'Your password is not correct.');
      },
      async deleteUser(uid) {
        for (const [m, l] of logins) if (l.uid === uid) logins.delete(m);
      },
    },
  };
  /** Sign in the way the app does: check the password, then look the role up in the database. */
  async function login(mobile, password) {
    const l = logins.get(mobile);
    if (!l || l.password !== password) throw new AppError('unauthenticated', 'Incorrect mobile number or password.');
    if (await db.get(`admins/${l.uid}`)) return JSON.stringify({ uid: l.uid, role: 'admin' });
    const user = await db.get(`users/${l.uid}`);
    if (!user) throw new AppError('permission-denied', 'This login is not linked to an account.');
    return JSON.stringify({ uid: l.uid, role: 'couple', coupleId: user.coupleId });
  }
  const call = (action, data = {}, as = null) => dispatch(ctx, { action, data, auth: as ? JSON.parse(as) : null });
  async function denied(action, data = {}, as = null) {
    try {
      await call(action, data, as);
    } catch (err) {
      if (err.name === 'AppError') return err.code;
      throw err;
    }
    throw new Error(`${action} was expected to be refused, but it succeeded`);
  }
  return { ctx, db, call, denied, login, logins };
}

/** True if `needle` appears anywhere inside a JSON value. */
export const mentions = (value, needle) => JSON.stringify(value ?? null).includes(needle);
