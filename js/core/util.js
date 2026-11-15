// Small helpers that work unchanged in the browser and in the Node test runner.
// They only rely on the standard Web Crypto API.

const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOWER = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - easy to read aloud

function pick(alphabet, length) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Unguessable secret used in guest links (32 chars = 192 bits). */
export const randomToken = (length = 32) => pick(URL_SAFE, length);
/** Short lowercase id for couples/admins. */
export const randomId = (length = 12) => pick(LOWER, length);
/** Human-friendly payment reference shown in the UPI note, e.g. SW7K3F9Q. */
export const refCode = () => 'SW' + pick(CODE, 6);

export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Returns a 10-digit Indian mobile number, or null when the input is not one. */
export function normalizeMobile(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export const maskMobile = (m) => (m ? `${String(m).slice(0, 2)}••••••${String(m).slice(-2)}` : '');

export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const firstWord = (name) => String(name ?? '').trim().split(/\s+/)[0] || '';
export const snippet = (text, max = 90) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
