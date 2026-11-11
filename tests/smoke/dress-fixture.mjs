// Padrões de vestimenta fictícios (os mesmos 10 da semente do banco) e semanas escaladas a partir de hoje.
// Usado pelo teste de fumaça e pela prévia visual.
const DEF = [
  ['All Black', [['#000000', 'Preto']]],
  ['Preto e Branco', [['#000000', 'Preto'], ['#FFFFFF', 'Branco']]],
  ['Bege e Verde', [['#DBCDB5', 'Pale Oak'], ['#E8E0D0', 'Bone'], ['#DED7C2', 'Bone'], ['#516B4B', 'Hunter Green'], ['#334E2D', 'Dark Spruce']]],
  ['Bege e Marrom', [['#DBCDB5', 'Pale Oak'], ['#E8E0D0', 'Bone'], ['#DED7C2', 'Bone'], ['#4D3B34', 'Deep Mocha'], ['#3A2F2F', 'Deep Mocha']]],
  ['Preto e Verde', [['#000000', 'Preto'], ['#293727', 'Evergreen'], ['#72956E', 'Sage Green'], ['#516B4B', 'Hunter Green'], ['#334E2D', 'Dark Spruce']]],
  ['Branco e Bege', [['#FFFFFF', 'Branco'], ['#EFE5D9', 'Linen'], ['#DBCDB5', 'Pale Oak'], ['#E8E0D0', 'Bone'], ['#DED7C2', 'Bone']]],
  ['Preto, Marrom e Bege', [['#000000', 'Preto'], ['#281F12', 'Dark Coffee'], ['#433030', 'Deep Mocha'], ['#4D3B34', 'Deep Mocha'], ['#857C62', 'Grey Olive']]],
  ['Branco e Azul', [['#FFFFFF', 'Branco'], ['#ACDDFF', 'Icy Blue'], ['#28587A', 'Baltic Blue'], ['#436781', 'Blue Slate'], ['#16344B', 'Deep Space Blue']]],
  ['Preto e Vinho', [['#000000', 'Preto'], ['#722F37', 'Wine Plum'], ['#551B21', 'Night Bordeaux'], ['#3F1419', 'Rich Mahogany']]],
  ['Branco e Cinza', [['#FFFFFF', 'Branco'], ['#C0C0C0', 'Silver'], ['#757575', 'Grey'], ['#575757', 'Charcoal'], ['#ECECEC', 'Platinum']]],
];
export function dressFixture(C, id) {
  const codes = DEF.map(([name, cs], i) => ({ id: id(80 + i), church_id: C, name, position: i + 1, colors: cs.map(([hex, n]) => ({ hex, name: n })) }));
  const local = new Date(Date.now() - 4 * 3600e3);                      // Cuiabá
  const sun = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - local.getUTCDay()));
  const wk = (n) => new Date(sun.getTime() + n * 7 * 864e5).toISOString().slice(0, 10);
  const weeks = [[0, 8], [1, 2], [2, 7], [3, 4]].map(([n, i]) => ({ church_id: C, week_start: wk(n), dress_code_id: codes[i].id }));
  const pub = weeks.map((w) => { const c = codes.find((x) => x.id === w.dress_code_id); return { week_start: w.week_start, name: c.name, colors: c.colors }; });
  return { codes, weeks, pub };
}
