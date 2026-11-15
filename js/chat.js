// One chat bubble, shared by the guest thread page and the couple dashboard.
import { h, fmtDate, safeUrl } from './ui.js';

export function bubble(m, mine) {
  if (m.kind === 'system') return h('div', { class: 'msg sys' }, m.text);
  const d = m.details;
  const body = m.kind === 'details' && d
    ? [h('b', {}, 'Gift details from the couple'), h('dl', { class: 'kv', style: 'margin:8px 0 0' },
      [['Brand', d.brand], ['Model', d.model], ['Specs', d.specs], ['Notes', d.notes]].filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    safeUrl(d.link) && h('a', { href: d.link, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Open product link ↗')]
    : m.text;
  return h('div', { class: `msg ${m.kind === 'details' ? 'details them' : m.from === mine ? 'me' : 'them'}` }, body, h('time', {}, fmtDate(m.at, true)));
}
