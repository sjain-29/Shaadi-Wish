// Guests have no account, so their own device remembers the secret links to
// the gifts and conversations they started. Nothing here is sent anywhere.
const key = (coupleId) => `shaadiwish-mine-${coupleId}`;

export function mine(coupleId) {
  try {
    return { receipts: [], threads: [], ...JSON.parse(localStorage.getItem(key(coupleId)) || '{}') };
  } catch {
    return { receipts: [], threads: [] };
  }
}
export function remember(coupleId, kind, token) {
  const m = mine(coupleId);
  if (!m[kind].includes(token)) m[kind].unshift(token);
  try { localStorage.setItem(key(coupleId), JSON.stringify(m)); } catch { /* private browsing */ }
}
export const guestName = {
  get: () => localStorage.getItem('shaadiwish-guest-name') || '',
  set: (name) => { try { localStorage.setItem('shaadiwish-guest-name', name); } catch { /* ignore */ } },
};
