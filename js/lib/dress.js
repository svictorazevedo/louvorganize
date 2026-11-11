// Vestimenta: semana (domingo a sábado), combinação de cores por peça e os 3 bonequinhos em SVG.
// Funções puras (sem Supabase), para poderem ser usadas na página pública e testadas no Node.
import { html, raw, esc } from './ui.js';
import { addDays } from './time.js';

/** Domingo da semana de uma data 'AAAA-MM-DD' (a semana do calendário começa no domingo). */
export const weekStartOf = (date) => addDays(date, -new Date(date + 'T00:00:00Z').getUTCDay());
const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const weekLabel = (ws) => `${dm(ws)} a ${dm(addDays(ws, 6))}`;

// ── cores ───────────────────────────────────────────────────────────────────
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (hex) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
function hueChroma(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const c = max - min;
  let h = 0;
  if (c) h = max === r ? ((g - b) / c) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return { h: (h * 60 + 360) % 360, c };
}
/** Mistura com branco (t>0) ou preto (t<0): detalhes como gola e botões. */
export function shade(hex, t) {
  const to = t > 0 ? 255 : 0; const k = Math.abs(t);
  return '#' + rgb(hex).map((v) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')).join('');
}
export const cleanColors = (colors) => {
  const seen = new Set();
  return (Array.isArray(colors) ? colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(c?.hex ?? ''))
    .map((c) => ({ hex: c.hex.toUpperCase(), name: String(c.name ?? '').trim() }))
    .filter((c) => !seen.has(c.hex) && seen.add(c.hex));
};

/**
 * Agrupa as cores em "famílias": neutros (preto, branco, cinzas) num grupo e as demais
 * por tom (vinhos, verdes, beges…). Assim, em "Preto e Vinho", a calça sai de um grupo
 * e a camisa do outro, como uma pessoa combinaria.
 */
export function colorGroups(colors) {
  const neutral = []; const chroma = [];
  colors.forEach((c) => { const hc = hueChroma(c.hex); (hc.c < 0.08 ? neutral : chroma).push({ ...c, ...hc }); });
  chroma.sort((a, b) => a.h - b.h);
  const groups = [];
  chroma.forEach((c, i) => {
    if (i && Math.min(Math.abs(c.h - chroma[i - 1].h), 360 - Math.abs(c.h - chroma[i - 1].h)) <= 40) groups.at(-1).push(c);
    else groups.push([c]);
  });
  if (groups.length > 1) {   // tons que dão a volta no círculo (ex.: vinho 355° e 5°) ficam juntos
    const a = groups[0][0]; const z = groups.at(-1).at(-1);
    if (360 - z.h + a.h <= 40) groups[0].unshift(...groups.pop());
  }
  if (neutral.length) groups.unshift(neutral);
  return groups.map((g) => g.map(({ hex, name }) => ({ hex, name })));
}

function rng(seed) {   // mulberry32 sobre um hash da semente: mesma semana + mesmas cores = mesmo resultado
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = (h + 0x6D2B79F5) | 0; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIGURES = [
  { key: 'camisa', label: 'Camisa', hair: 'short', skin: '#EBC3A0', hairColor: '#3B2A20', jacket: 0.7 },
  { key: 'blusa', label: 'Blusa', hair: 'long', skin: '#C68A5E', hairColor: '#20160F', jacket: 0.45 },
  { key: 'camiseta', label: 'Camiseta', hair: 'curly', skin: '#8D5A3B', hairColor: '#141010', jacket: 0.4 },
];

/** Monta as peças de cada bonequinho a partir das cores do padrão. */
export function outfits(colors, seed = '') {
  const cs = cleanColors(colors);
  if (!cs.length) return [];
  const r = rng(seed + '|' + cs.map((c) => c.hex).join(','));
  const pick = (arr, avoid = []) => { const ok = arr.filter((c) => !avoid.includes(c.hex)); const from = ok.length ? ok : arr; return from[Math.floor(r() * from.length)]; };
  const groups = colorGroups(cs);
  return FIGURES.map((f) => {
    let pants; let top;
    if (groups.length > 1) {
      const gi = groups.length === 2 ? (r() < 0.65 ? 0 : 1) : Math.floor(r() * groups.length);
      pants = pick(groups[gi]);
      top = pick(groups.filter((_, i) => i !== gi).flat());
    } else {
      pants = pick(cs); top = pick(cs, [pants.hex]);
    }
    const darkest = [...cs].sort((a, b) => lum(a.hex) - lum(b.hex))[0];
    const shoes = r() < 0.55 ? (lum(pants.hex) < 0.5 ? pants : darkest) : pick(cs);
    const jacket = r() < f.jacket ? pick(cs, [top.hex]) : null;
    return { ...f, pants, top, shoes, jacket };
  });
}

// ── SVG ─────────────────────────────────────────────────────────────────────
const P = (d, fill, cls = 'o') => `<path class="${cls}" d="${d}" fill="${fill}"/>`;
const C = (x, y, rr, fill, cls = 'o') => `<circle class="${cls}" cx="${x}" cy="${y}" r="${rr}" fill="${fill}"/>`;

function hairBack(o) {
  return o.hair === 'long' ? P('M34 30 Q32 7 50 7 Q68 7 66 30 L69 64 Q60 67 56 56 L44 56 Q40 67 31 64 Z', o.hairColor) : '';
}
function hairFront(o) {
  if (o.hair === 'short') return P('M36 25 Q35 9 50 9 Q65 9 64 25 Q61 17 50 16 Q40 16 36 25 Z', o.hairColor);
  if (o.hair === 'long') return P('M36 26 Q37 10 50 10 Q63 10 64 26 Q58 15 47 17 Q41 19 36 26 Z', o.hairColor);
  return [[38, 16], [44, 11], [51, 10], [58, 12], [63, 18], [36, 23], [64, 25]].map(([x, y]) => C(x, y, 6, o.hairColor, 'h')).join('');
}

/** Um bonequinho (SVG) vestido com as peças de `o` (saída de outfits()). */
export function figureSvg(o, size = 120) {
  const top = o.top.hex; const longSleeve = o.key !== 'camiseta';
  const parts = [];
  parts.push(hairBack(o));
  // pernas e sapatos
  parts.push(o.key === 'blusa'
    ? P('M30 108 L70 108 L74 186 L53 186 L50 130 L47 186 L26 186 Z', o.pants.hex)
    : P('M29 108 L71 108 L70 186 L54 186 L50 128 L46 186 L30 186 Z', o.pants.hex));
  parts.push(P('M28 185 L47 185 L48 195 L22 195 Q22 188 28 185 Z', o.shoes.hex), P('M53 185 L72 185 Q78 188 78 195 L52 195 Z', o.shoes.hex));
  if (o.key === 'camiseta') parts.push(P('M23 184 L48 184 L48 186 L23 186 Z', shade(o.shoes.hex, 0.75), 'd'), P('M52 184 L77 184 L77 186 L52 186 Z', shade(o.shoes.hex, 0.75), 'd'));
  // braços (pele) e mãos
  parts.push(P('M30 50 L20 100 L28 103 L37 62 Z', o.skin), P('M70 50 L80 100 L72 103 L63 62 Z', o.skin));
  parts.push(C(24, 106, 4.6, o.skin), C(76, 106, 4.6, o.skin));
  // tronco + mangas
  parts.push(o.key === 'blusa' ? P('M31 48 Q50 42 69 48 L66 80 L71 112 L29 112 L34 80 Z', top) : P('M30 48 Q50 42 70 48 L72 112 L28 112 Z', top));
  parts.push(longSleeve ? P('M30 48 L19.5 100 L28.5 103 L37 62 Z', top) + P('M70 48 L80.5 100 L71.5 103 L63 62 Z', top)
    : P('M30 48 L22 74 L31 77 L37 60 Z', top) + P('M70 48 L78 74 L69 77 L63 60 Z', top));
  // pescoço, cabeça
  parts.push(P('M45 36 L55 36 L55 47 Q50 50 45 47 Z', o.skin));
  if (o.key === 'camisa') {   // gola e botões
    parts.push(P('M43 45 L50 55 L57 45 L54 43 L50 50 L46 43 Z', shade(top, lum(top) > 0.6 ? -0.15 : 0.22), 'd'));
    [64, 76, 88, 100].forEach((y) => parts.push(C(50, y, 1.3, shade(top, lum(top) > 0.5 ? -0.35 : 0.35), 'd')));
  } else if (o.key === 'camiseta') parts.push(`<path class="d" d="M44 45 Q50 52 56 45" fill="none" stroke="${shade(top, lum(top) > 0.5 ? -0.25 : 0.25)}" stroke-width="1.6"/>`);
  else parts.push(P('M44 45 Q50 54 56 45 Z', o.skin, 'd'));
  if (o.jacket) {
    const j = o.jacket.hex; const gap = o.key === 'camisa' ? 6 : 3;
    parts.push(P(`M30 48 L${50 - gap} 45 L${50 - gap + 2} 78 L${50 - gap} 114 L27 114 Z`, j), P(`M70 48 L${50 + gap} 45 L${50 + gap - 2} 78 L${50 + gap} 114 L73 114 Z`, j));
    parts.push(P('M30 48 L19 100 L29 104 L37.5 62 Z', j), P('M70 48 L81 100 L71 104 L62.5 62 Z', j));
    if (o.key === 'camisa') parts.push(P(`M${50 - gap} 45 L${50 - gap - 6} 47 L${50 - gap + 1} 66 Z`, shade(j, lum(j) > 0.5 ? -0.12 : 0.15), 'd'), P(`M${50 + gap} 45 L${50 + gap + 6} 47 L${50 + gap - 1} 66 Z`, shade(j, lum(j) > 0.5 ? -0.12 : 0.15), 'd'));
  }
  parts.push(C(50, 26, 14, o.skin), hairFront(o));
  const label = describe(o);
  return `<svg class="fig" viewBox="14 4 72 196" width="${Math.round(size * 72 / 196)}" height="${size}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${parts.join('')}</svg>`;
}

const cname = (c) => c.name || c.hex;
export const describe = (o) => [
  `${o.label}: ${cname(o.top)}`,
  `Calça: ${cname(o.pants)}`, `${o.key === 'camiseta' ? 'Tênis' : 'Sapato'}: ${cname(o.shoes)}`,
  o.jacket ? `Casaco: ${cname(o.jacket)}` : null].filter(Boolean).join(' · ');

/** Faixa de amostras das cores. */
export const swatches = (colors, { labels = false } = {}) => html`<span class="swatches ${labels ? 'labeled' : ''}">${cleanColors(colors).map((c) =>
  html`<span class="sw ${lum(c.hex) > 0.62 ? 'light' : ''}" style="background:${c.hex}" title="${c.name ? c.name + ' · ' : ''}${c.hex}">${labels ? html`<small>${c.name || c.hex}</small>` : ''}</span>`)}</span>`;

/** Chip compacto: nome do padrão + amostras. */
export const dressChip = (code) => (code ? html`<span class="chip dress-chip">${swatches(code.colors)}${code.name}</span>` : '');

/** Os 3 bonequinhos de um padrão para uma semana. */
export const figures = (code, seed, size = 130) => html`<div class="figs">${outfits(code.colors, seed).map((o) =>
  html`<figure>${raw(figureSvg(o, size))}<figcaption>${describe(o)}</figcaption></figure>`)}</div>`;

/** Cartão "Vestimenta da semana". code = { name, colors } ou null. */
export function dressCard(code, ws, { title = 'Vestimenta da semana', manage = '', size = 130 } = {}) {
  return html`<section class="card dress-card" aria-label="${title}">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div class="grow"><div class="eyebrow">${title} · ${weekLabel(ws)}</div>
        <h2 style="margin:.15rem 0 .35rem">${code ? code.name : 'Sem padrão escalado'}</h2>
        ${code ? swatches(code.colors) : html`<p class="muted small" style="margin:0">Nenhuma vestimenta definida para esta semana.</p>`}</div>
      ${manage}</div>
    ${code ? figures(code, ws, size) : ''}</section>`;
}
