// Invitation QR cards and thank-you cards, drawn on a canvas in the browser.
// Only text, shapes and the QR code are drawn (no remote photos), so the image
// can always be exported as PNG or PDF.
import { APP } from './app-config.js';
import { drawQR } from './ui.js';

export const THEMES = {
  marigold: { label: 'Marigold', bg: ['#fff8ea', '#ffe0b0'], ink: '#6b2a0c', accent: '#e07a12', gold: '#e9a820', soft: '#f7c948' },
  royal: { label: 'Royal', bg: ['#3a1a63', '#6a2f9c'], ink: '#ffffff', accent: '#f7c948', gold: '#f7c948', soft: '#c9a7f0' },
  blush: { label: 'Blush', bg: ['#fff3f4', '#ffd3da'], ink: '#6d1f33', accent: '#d94a68', gold: '#e9a820', soft: '#ff9fb1' },
  mint: { label: 'Mint', bg: ['#f2fcf7', '#c9eedd'], ink: '#0d4a3d', accent: '#14806a', gold: '#d9a11a', soft: '#7ad9b9' },
};
const W = 1080;
const H = 1350;
const SERIF = "Fraunces, 'Playfair Display', Georgia, serif";
const SANS = "'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif";

function wrap(g, text, maxWidth) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
function text(g, value, y, font, color, maxWidth = 860, lineHeight = 1.3, maxLines = 8) {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const size = parseInt(/(\d+)px/.exec(font)[1], 10);
  const lines = wrap(g, value, maxWidth).slice(0, maxLines);
  lines.forEach((line, i) => g.fillText(line, W / 2, y + i * size * lineHeight));
  return y + lines.length * size * lineHeight;
}
/** A ring of petals: the mandala motif used at the top and in the corners. */
function mandala(g, cx, cy, radius, petals, color, alpha = 1) {
  g.save();
  g.translate(cx, cy);
  g.globalAlpha = alpha;
  g.fillStyle = color;
  for (let i = 0; i < petals; i++) {
    g.rotate((Math.PI * 2) / petals);
    g.beginPath();
    g.ellipse(0, -radius * 0.62, radius * 0.16, radius * 0.38, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/**
 * kind 'invite': names, date line, message, QR to the public wishlist.
 * kind 'thanks': greeting to the guest, message, names. The caller passes the
 * guest label; for anonymous gifts that label is never the guest's name.
 */
export async function renderCard(canvas, { kind, theme = 'marigold', names, message, dateLine = '', url = '', guest = '' }) {
  const t = THEMES[theme] || THEMES.marigold;
  canvas.width = W;
  canvas.height = H;
  try {
    await Promise.all([document.fonts.load(`600 90px ${SERIF}`), document.fonts.load(`500 30px ${SANS}`)]);
  } catch { /* fall back to system fonts */ }
  const g = canvas.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, t.bg[0]);
  bg.addColorStop(1, t.bg[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    mandala(g, x, y, 250, 16, t.soft, 0.38);
    mandala(g, x, y, 150, 12, t.accent, 0.5);
  }
  g.strokeStyle = t.gold;
  g.lineWidth = 5;
  roundRect(g, 46, 46, W - 92, H - 92, 44);
  g.stroke();
  g.lineWidth = 1.5;
  roundRect(g, 62, 62, W - 124, H - 124, 34);
  g.stroke();
  mandala(g, W / 2, 190, 78, 12, t.accent, 0.95);
  mandala(g, W / 2, 190, 40, 8, t.gold, 1);

  let y = 300;
  const eyebrow = kind === 'invite' ? 'WITH JOY IN OUR HEARTS' : 'WITH LOVE & GRATITUDE';
  g.letterSpacing = '6px';
  y = text(g, eyebrow, y, `600 26px ${SANS}`, t.accent) + 26;
  g.letterSpacing = '0px';

  if (kind === 'thanks') {
    y = text(g, guest, y, `italic 500 50px ${SERIF}`, t.ink, 820, 1.2, 2) + 30;
    y = text(g, 'Thank you', y, `600 112px ${SERIF}`, t.ink) + 34;
    y = text(g, message, y, `400 42px ${SERIF}`, t.ink, 800, 1.5, 8) + 54;
    g.fillStyle = t.gold;
    g.fillRect(W / 2 - 60, y, 120, 3);
    y += 34;
    y = text(g, 'With love,', y, `500 30px ${SANS}`, t.accent) + 8;
    text(g, names, y, `600 60px ${SERIF}`, t.ink, 860, 1.15, 2);
  } else {
    // The QR has a fixed place and size, so it is always large enough to scan
    // however long the names are. Names shrink to fit on one line each.
    const [a, b] = String(names).split(' & ');
    const fit = (value) => {
      let size = 88;
      for (; size > 44; size -= 4) {
        g.font = `600 ${size}px ${SERIF}`;
        if (g.measureText(value).width <= 860) break;
      }
      return size;
    };
    const size = Math.min(fit(a || names), b ? fit(b) : 88);
    y = text(g, a || names, y, `600 ${size}px ${SERIF}`, t.ink, 900, 1.1, 1);
    if (b) {
      y = text(g, '&', y, `italic 400 52px ${SERIF}`, t.accent, 860, 1.25, 1);
      y = text(g, b, y, `600 ${size}px ${SERIF}`, t.ink, 900, 1.1, 1);
    }
    if (dateLine) y = text(g, dateLine, y + 16, `600 28px ${SANS}`, t.accent, 860, 1.3, 1);
    text(g, message, y + 18, `italic 400 36px ${SERIF}`, t.ink, 780, 1.4, 2);
    const q = 290;
    const qy = H - 215 - q;
    if (url) {
      g.fillStyle = '#fff';
      roundRect(g, W / 2 - q / 2 - 16, qy - 16, q + 32, q + 32, 26);
      g.fill();
      drawQR(g, url, W / 2 - q / 2, qy, q, '#2c1a3f');
    }
    text(g, 'Scan to explore our wedding wishlist', qy + q + 26, `600 26px ${SANS}`, t.ink);
  }
  text(g, `${APP.name} · ${APP.tagline}`, H - 128, `500 22px ${SANS}`, t.accent);
  return canvas;
}

/** Wraps one JPEG in a single-page PDF. Small enough that no PDF library is needed. */
export function jpegToPdf(jpeg, width, height) {
  const pw = 420;
  const ph = Math.round((pw * height) / width);
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = pos;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = pos;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}
