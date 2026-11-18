// Server-side input validation. Every value that reaches the database passes
// through one of these functions first. The browser is never trusted.
import { fail } from './errors.js';
import { normalizeMobile } from './util.js';

// Control characters, zero-width characters and bidirectional overrides.
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const bad = (message) => fail('invalid-argument', message);

export const V = {
  text(value, { name = 'This field', min = 0, max = 200, multiline = false } = {}) {
    if (value === undefined || value === null || value === '') {
      if (min > 0) bad(`${name} is required.`);
      return '';
    }
    if (typeof value !== 'string') bad(`${name} must be text.`);
    let s = value.replace(UNSAFE, '');
    s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
    s = s.trim();
    if (s.length < min) bad(min > 1 && s.length ? `${name} is too short.` : `${name} is required.`);
    if (s.length > max) bad(`${name} must be ${max} characters or fewer.`);
    return s;
  },

  id(value, name = 'id') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(value)) bad(`Invalid ${name}.`);
    return value;
  },

  token(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(value)) fail('not-found', 'This link is not valid.');
    return value;
  },

  oneOf(value, allowed, name = 'value') {
    if (!allowed.includes(value)) bad(`Invalid ${name}.`);
    return value;
  },

  /** Whole rupees only. Money is never stored as a decimal. */
  amount(value, { name = 'Amount', min = 1, max = 10000000 } = {}) {
    const n = typeof value === 'string' && /^\d{1,9}$/.test(value) ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n)) bad(`${name} must be a whole number of rupees.`);
    if (n < min) bad(`${name} must be at least ₹${min.toLocaleString('en-IN')}.`);
    if (n > max) bad(`${name} cannot be more than ₹${max.toLocaleString('en-IN')}.`);
    return n;
  },

  mobile(value) {
    const m = normalizeMobile(value);
    if (!m) bad('Please enter a valid 10-digit mobile number.');
    return m;
  },

  password(value, name = 'Password') {
    if (typeof value !== 'string' || value.length < 8) bad(`${name} must be at least 8 characters.`);
    if (value.length > 128) bad(`${name} is too long.`);
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) bad(`${name} must contain at least one letter and one number.`);
    return value;
  },

  date(value, { name = 'Date', required = false } = {}) {
    if (!value) {
      if (required) bad(`${name} is required.`);
      return '';
    }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) bad(`${name} is not a valid date.`);
    return value;
  },

  /** https links only, so a stored link can never run script. */
  url(value, { name = 'Link' } = {}) {
    if (!value) return '';
    if (typeof value !== 'string' || value.length > 600) bad(`${name} is not valid.`);
    let u;
    try {
      u = new URL(value.trim());
    } catch {
      bad(`${name} must be a full web address starting with https://`);
    }
    if (u.protocol !== 'https:') bad(`${name} must start with https://`);
    return u.href;
  },

  upiId(value) {
    const s = String(value ?? '').trim();
    if (!/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(s)) bad('Please enter a valid UPI ID, for example name@okhdfcbank.');
    return s.toLowerCase();
  },

  /** UPI transaction reference (UTR / RRN) is always 12 digits. */
  utr(value) {
    const s = String(value ?? '').replace(/\s+/g, '');
    if (!/^\d{12}$/.test(s)) bad('The UPI reference number (UTR) must be exactly 12 digits. You can find it in your UPI app under the payment details.');
    return s;
  },

  /** Picture sent as a data URL. Checks the type, the size and that the bytes really are an image. */
  image(dataUrl, { maxBytes = 1500000 } = {}) {
    const m = typeof dataUrl === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
    if (!m) bad('The picture must be a JPG, PNG or WebP image.');
    if (m[2].length > maxBytes * 1.4) bad('The picture is too large. Please crop it and try again.');
    const binary = globalThis.atob(m[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length > maxBytes) bad('The picture is too large. Please crop it and try again.');
    const sig = (...sigBytes) => sigBytes.every((b, i) => bytes[i] === b);
    const ok =
      (m[1] === 'jpeg' && sig(0xff, 0xd8, 0xff)) ||
      (m[1] === 'png' && sig(0x89, 0x50, 0x4e, 0x47)) ||
      (m[1] === 'webp' && sig(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45);
    if (!ok) bad('The file is not a valid image.');
    return { bytes, type: `image/${m[1]}`, ext: m[1] === 'jpeg' ? 'jpg' : m[1] };
  },
};
