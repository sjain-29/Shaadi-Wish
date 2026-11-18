// Password check for PREVIEW MODE ONLY (sample logins kept in this browser).
// In live mode, passwords are handled by Firebase Authentication instead.
const ITERATIONS = 60000;
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export const passwords = {
  async hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return ['pbkdf2', ITERATIONS, b64(salt), b64(await derive(password, salt, ITERATIONS))].join('$');
  },
  async verify(password, stored) {
    try {
      const [scheme, iterations, salt, key] = String(stored).split('$');
      if (scheme !== 'pbkdf2') return false;
      return b64(await derive(password, unb64(salt), Number(iterations))) === key;
    } catch {
      return false;
    }
  },
  dummy: 'pbkdf2$60000$c2hhYWRpd2lzaA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};
