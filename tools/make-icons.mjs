// Gera os ícones PNG (sem dependências). Uso: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const C0 = [0x44, 0x57, 0xE8], C1 = [0x2E, 0x35, 0xB0], C2 = [0x24, 0x1F, 0x7A], WHITE = [0xFF, 0xFF, 0xFF], GOLD = [0xE5, 0xB6, 0x5A];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// degradê diagonal índigo
const bgAt = (x, y) => { const t = (x + y) / 2; return t < .55 ? mix(C0, C1, t / .55) : mix(C1, C2, (t - .55) / .45); };
const inGold = (x, y) => (x - .73) ** 2 + (y - .70) ** 2 <= .04 ** 2;
const inEllipse = (x, y, cx, cy, rx, ry, rot) => {
  const c = Math.cos(rot), s = Math.sin(rot), dx = x - cx, dy = y - cy;
  const u = dx * c + dy * s, v = -dx * s + dy * c;
  return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
};
const inPoly = (x, y, p) => {
  let r = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r;
  }
  return r;
};
// colcheia: cabeça + haste + bandeira (coordenadas 0..1, dentro da zona segura central)
const note = (x, y) =>
  inEllipse(x, y, 0.415, 0.665, 0.125, 0.09, -0.35) ||
  (x >= 0.51 && x <= 0.55 && y >= 0.27 && y <= 0.66) ||
  inPoly(x, y, [[0.55, 0.27], [0.70, 0.36], [0.715, 0.50], [0.55, 0.43]]);

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 3;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (note((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hit++;
      const t = hit / (SS * SS), o = py * (size * 4 + 1) + 1 + px * 4;
      const fx = (px + .5) / size, fy = (py + .5) / size; const base = inGold(fx, fy) ? GOLD : bgAt(fx, fy);
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(base[k] * (1 - t) + WHITE[k] * t);
      raw[o + 3] = 255;
    }
  }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 192, 512]) { writeFileSync(`icons/icon-${s}.png`, png(s)); console.log('icons/icon-' + s + '.png'); }
