// In-memory database with the same small interface as ./admin-db.js.
// Used by the automated tests and by the browser preview mode. It deliberately
// copies the Realtime Database behaviours the backend relies on:
//   - null values and empty objects do not exist
//   - multi-path updates are atomic and may not target a path and its ancestor
//   - increment sentinels
//   - transactions (optionally starting from an empty cache, like the Admin SDK)

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const clone = (v) => (v === null || v === undefined ? null : structuredClone(v));
const parts = (path) => String(path).split('/').filter(Boolean);

function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => clean(v));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const c = clean(v);
    if (c !== null) out[k] = c;
  }
  return Object.keys(out).length ? out : null;
}

function setIn(node, keys, index, value) {
  if (index === keys.length) return value;
  const base = node && typeof node === 'object' && !Array.isArray(node) ? node : {};
  const child = setIn(base[keys[index]], keys, index + 1, value);
  if (child === null) delete base[keys[index]];
  else base[keys[index]] = child;
  return Object.keys(base).length ? base : null;
}

export class MemoryDb {
  constructor({ data = null, simulateColdCache = false } = {}) {
    this.root = clean(data) || {};
    this.simulateColdCache = simulateColdCache;
    this.listeners = new Set();
    this.onWrite = null; // set by the preview backend to persist data
    this._lastPush = 0;
    this._lastRand = [];
  }

  _read(path) {
    let node = this.root;
    for (const key of parts(path)) {
      if (node === null || typeof node !== 'object' || !(key in node)) return null;
      node = node[key];
    }
    return node ?? null;
  }

  _resolve(value, path) {
    if (value && typeof value === 'object' && value['.sv'] !== undefined) {
      const sv = value['.sv'];
      if (sv === 'timestamp') return Date.now();
      if (sv && typeof sv.increment === 'number') {
        const cur = this._read(path);
        return (typeof cur === 'number' ? cur : 0) + sv.increment;
      }
    }
    return clean(value);
  }

  _write(path, value) {
    this.root = setIn(this.root, parts(path), 0, value) || {};
  }

  _changed() {
    for (const l of this.listeners) {
      const json = JSON.stringify(this._read(l.path));
      if (json !== l.last) {
        l.last = json;
        l.cb(json === 'null' ? null : JSON.parse(json));
      }
    }
    if (this.onWrite) this.onWrite();
  }

  async get(path) {
    return clone(this._read(path));
  }

  async set(path, value) {
    this._write(path, this._resolve(value, path));
    this._changed();
  }

  async update(updates) {
    const keys = Object.keys(updates).map((k) => parts(k).join('/'));
    for (const a of keys) {
      for (const b of keys) {
        if (a !== b && (b + '/').startsWith(a + '/')) throw new Error(`update(): "${a}" is an ancestor of "${b}"`);
      }
    }
    const resolved = Object.entries(updates).map(([path, value]) => [path, this._resolve(value, path)]);
    for (const [path, value] of resolved) this._write(path, value);
    this._changed();
  }

  async transaction(path, updateFn) {
    const actual = this._read(path);
    if (this.simulateColdCache && actual !== null) {
      // The Admin SDK first runs the function against an empty local cache.
      // Returning undefined at that point aborts without ever seeing real data.
      if (updateFn(null) === undefined) return { committed: false, value: null };
    }
    const next = updateFn(clone(actual));
    if (next === undefined) return { committed: false, value: clone(actual) };
    this._write(path, this._resolve(next, path));
    this._changed();
    return { committed: true, value: clone(this._read(path)) };
  }

  /** Chronologically sortable id, same shape as a Firebase push id. */
  newId() {
    let now = Date.now();
    const duplicate = now === this._lastPush;
    this._lastPush = now;
    const stamp = new Array(8);
    for (let i = 7; i >= 0; i--) {
      stamp[i] = PUSH_CHARS.charAt(now % 64);
      now = Math.floor(now / 64);
    }
    if (!duplicate) {
      for (let i = 0; i < 12; i++) this._lastRand[i] = Math.floor(Math.random() * 64);
    } else {
      let i = 11;
      for (; i >= 0 && this._lastRand[i] === 63; i--) this._lastRand[i] = 0;
      if (i >= 0) this._lastRand[i]++;
    }
    return stamp.join('') + this._lastRand.map((n) => PUSH_CHARS.charAt(n)).join('');
  }

  increment(n) {
    return { '.sv': { increment: n } };
  }

  // ---- preview-mode extras (not part of the backend interface) ----
  watch(path, cb) {
    const listener = { path, cb, last: undefined };
    this.listeners.add(listener);
    queueMicrotask(() => {
      if (!this.listeners.has(listener) || listener.last !== undefined) return;
      const value = this._read(path);
      listener.last = JSON.stringify(value);
      cb(clone(value));
    });
    return () => this.listeners.delete(listener);
  }

  serialize() {
    return JSON.stringify(this.root);
  }

  load(json) {
    this.root = clean(JSON.parse(json)) || {};
    for (const l of this.listeners) {
      const now = JSON.stringify(this._read(l.path));
      if (now !== l.last) {
        l.last = now;
        l.cb(now === 'null' ? null : JSON.parse(now));
      }
    }
  }
}
