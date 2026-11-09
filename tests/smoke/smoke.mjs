// Teste de fumaça: monta cada tela com dados falsos num DOM simulado (jsdom).
// Rodar: node --import ./tests/smoke/register.mjs tests/smoke/smoke.mjs   (precisa de: npm i jsdom)
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'https://exemplo.github.io/louvorganize/', pretendToBeVisual: true });
const w = dom.window;
w.scrollTo = () => {};
w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
w.HTMLDialogElement.prototype.close = function (v) { this.removeAttribute('open'); if (v !== undefined) this.returnValue = v; this.dispatchEvent(new w.Event('close')); };
Object.assign(globalThis, { window: w, document: w.document, location: w.location, localStorage: w.localStorage, sessionStorage: w.sessionStorage,
  FormData: w.FormData, Event: w.Event, HTMLElement: w.HTMLElement, MutationObserver: w.MutationObserver });
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });

// ── dados falsos ─────────────────────────────────────────────────────────────
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = id(1), U = id(2);
const church = { id: C, name: 'Igreja Teste', slug: 'teste', timezone: 'America/Cuiaba', public_mode: 'link', show_setlist_publicly: true };
const inDays = (n, h = 23) => new Date(Date.now() + n * 864e5).toISOString().replace(/T\d\d/, `T${h}`);
const roles = [
  { id: id(10), church_id: C, name: 'Vocal', category: 'voz', color: '#B5446E', is_essential: true, active: true },
  { id: id(11), church_id: C, name: 'Violão', category: 'instrumento', color: '#B8860B', is_essential: false, active: true },
  { id: id(12), church_id: C, name: 'Bateria', category: 'instrumento', color: '#4A5D23', is_essential: true, active: false },
];
const members = [
  { id: id(20), church_id: C, user_id: U, full_name: 'Ana Souza', status: 'active', deleted_at: null, member_roles: [{ role_id: id(10), is_primary: true }], team_members: [{ team_id: id(30), role_id: id(10) }] },
  { id: id(21), church_id: C, user_id: null, full_name: 'Caio <b>Mendes</b>', status: 'active', deleted_at: null, member_roles: [{ role_id: id(11), is_primary: true }, { role_id: id(10), is_primary: false }], team_members: [{ team_id: id(30), role_id: id(11) }] },
  { id: id(22), church_id: C, user_id: null, full_name: 'Duda Arquivada', status: 'archived', deleted_at: '2026-01-01T00:00:00Z', member_roles: [{ role_id: id(10), is_primary: true }], team_members: [] },
];
const teams = [{ id: id(30), church_id: C, name: 'Equipe A', color: '#2F5D62', leader_id: id(20), deleted_at: null, team_members: [{ member_id: id(20), role_id: id(10) }, { member_id: id(21), role_id: id(11) }] }];
const songs = [{ id: id(40), church_id: C, title: 'Grande é o Senhor', artist: 'Adhemar', song_key: 'G', bpm: 72, duration_sec: 270, media_url: 'https://youtu.be/x', chart_url: null, lyrics: 'letra', tags: ['adoração'], active: true }];
const ev1 = { id: id(50), church_id: C, team_id: id(30), kind: 'evento', title: 'Batismo no Rio', starts_at: inDays(10), location: 'Rio', status: 'published', notes: null, deleted_at: null, setlist_items: [{ count: 1 }] };
const ev2 = { id: id(51), church_id: C, team_id: id(30), kind: 'culto', title: null, starts_at: inDays(17), location: null, status: 'draft', notes: 'interno', deleted_at: null, setlist_items: [{ count: 0 }] };
const asg = (n, member, role, status, extra = {}) => ({ id: id(n), church_id: C, event_id: ev1.id, member_id: member, role_id: role, status, decline_reason: null, suggested_substitute_id: null, attended: null, events: ev1, ...extra });
const roster = [
  { event_id: ev1.id, assignment_id: id(60), member_id: id(20), member_name: 'Ana Souza', role_id: id(10), role_name: 'Vocal', role_color: '#B5446E', role_category: 'voz', status: 'pending', responded_by_name: null, decline_reason: null, attended: null },
  { event_id: ev1.id, assignment_id: id(61), member_id: id(21), member_name: 'Caio <b>Mendes</b>', role_id: id(11), role_name: 'Violão', role_color: '#B8860B', role_category: 'instrumento', status: 'declined', responded_by_name: 'Ana Souza', decline_reason: 'Viagem a trabalho <script>x</script>', attended: null },
];
const pub = { church: { name: 'Igreja Teste', timezone: 'America/Cuiaba', public_mode: 'link' },
  events: [{ id: ev1.id, kind: 'evento', title: 'Batismo no Rio', starts_at: ev1.starts_at, location: 'Rio', team: 'Equipe A', team_color: '#2F5D62', roster: [{ name: 'Ana Souza', role: 'Vocal' }], setlist: [{ title: 'Grande é o Senhor', key: 'G', moment: 'abertura' }] }],
  teams: [{ name: 'Equipe A', color: '#2F5D62', members: [{ name: 'Ana Souza', role: 'Vocal' }] }] };

globalThis.__DB = {
  writes: [], rpcs: [],
  session: { user: { id: U, email: 'ana@x.com', user_metadata: { full_name: 'Ana Souza' } } },
  tables: {
    memberships: [{ id: id(3), church_id: C, user_id: U, role: 'owner', churches: church }],
    members, roles, teams, songs, events: [ev1, ev2],
    assignments: [asg(60, id(20), id(10), 'pending'), asg(61, id(21), id(11), 'declined', { decline_reason: 'Viagem', suggested_substitute_id: id(20) })],
    setlist_items: [{ song_id: id(40), position: 1, key_override: 'A', bpm_override: null, moment: 'abertura', event_id: ev1.id, events: { starts_at: inDays(-3), status: 'closed' } }],
    member_contacts: [{ member_id: id(20), church_id: C, phone: '+5565999990001', email: 'ana@x.com', notes: 'obs' }],
    unavailabilities: [{ id: id(70), member_id: id(20), start_date: '2026-10-01', end_date: '2026-10-03', reason: 'viagem' }],
    invites: [{ id: id(71), member_id: id(21), role: 'member', expires_at: inDays(5), accepted_at: null }],
    audit_log: [{ id: 1, entity: 'events', action: 'update', actor_user_id: U, created_at: inDays(-1), diff: { new: { status: 'published' } } }],
  },
  rpc: {
    event_roster: () => roster, member_loads: () => [{ member_id: id(20), load60: 3 }, { member_id: id(21), load60: 0 }],
    substitutes: () => [{ member_id: id(21), full_name: 'Caio <b>Mendes</b>', load60: 1 }], public_church: () => pub,
    archive_member: () => ({ ok: false, events: [{ event_id: ev1.id, kind: 'evento', title: 'Batismo no Rio', starts_at: ev1.starts_at, status: 'pending' }] }),
    archive_team: () => ({ ok: false, events: 2 }),
    respond_assignment: (a) => ({ id: a.p_id, status: a.p_action === 'confirm' ? 'confirmed' : 'declined', substitutes_available: 1 }),
    create_invite: () => 'abc123def456',
  },
};

// ── execução ─────────────────────────────────────────────────────────────────
const results = []; let failed = 0;
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function check(name, fn) {
  try { await fn(); results.push(['ok', name]); } catch (e) { failed++; results.push(['FALHOU', name, e.stack?.split('\n').slice(0, 4).join(' | ')]); }
}
const mod = (p) => import(`../../js/pages/${p}.js`);
async function mount(page, { params = [], query = {}, opt = {} } = {}) {
  document.querySelectorAll('dialog').forEach((d) => d.remove()); document.body.querySelectorAll(':scope > div:not(#app)').forEach((d) => d.remove());
  const el = document.createElement('div'); document.body.append(el);
  const nav = [];
  await (await mod(page)).default(el, { params, query, opt, go: (p) => nav.push(p) });
  await settle();
  return { el, nav };
}
const clean = (el) => { if (/Não foi possível carregar|undefined|\[object Object\]|NaN/.test(el.textContent)) throw new Error('conteúdo suspeito: ' + (el.textContent.match(/.{0,40}(Não foi possível carregar|undefined|\[object Object\]|NaN).{0,40}/) || [''])[0]); if (el.textContent.trim().length < 20) throw new Error('tela vazia'); };
const noRawHtml = (el) => { if ([...el.querySelectorAll('b')].some((b) => b.textContent === 'Mendes') || el.querySelector('script')) throw new Error('HTML do usuário virou elemento (sem escape)'); };
const answer = (v = 'ok') => { const d = document.querySelector('dialog[open]'); if (!d) throw new Error('nenhum diálogo aberto'); d.close(v); };
const click = (el, sel) => { const b = el.querySelector(sel); if (!b) throw new Error('não achei ' + sel); b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
const rpcCalled = (n) => globalThis.__DB.rpcs.some(([x]) => x === n);

const E = { params: [ev1.id] };
const pages = [
  ['dashboard', {}], ['calendar', {}], ['calendar', { query: { v: 'list' } }], ['events', {}], ['event-edit (nova)', { page: 'event-edit' }],
  ['event-edit (existente)', { page: 'event-edit', ...E }], ['event-edit (rascunho)', { page: 'event-edit', params: [ev2.id] }],
  ['teams', {}], ['teams (ver)', { page: 'teams', params: [id(30)] }], ['team-edit (nova)', { page: 'team-edit' }], ['team-edit (editar)', { page: 'team-edit', params: [id(30)] }],
  ['members', {}], ['members (perfil)', { page: 'members', params: [id(20)] }], ['roles', {}], ['songs', {}], ['reports', {}], ['settings', {}], ['mine', {}],
  ['public', { params: ['teste'] }], ['public (equipes)', { page: 'public', params: ['teste'], query: { t: 'teams' } }], ['public (escalas)', { page: 'public', params: ['teste'], query: { t: 'escalas' } }],
  ['start', { opt: {} }], ['auth (login)', { page: 'auth', opt: { mode: 'login' } }], ['auth (cadastro)', { page: 'auth', opt: { mode: 'signup' } }], ['auth (recuperar)', { page: 'auth', opt: { mode: 'recover' } }], ['auth (nova senha)', { page: 'auth', opt: { mode: 'newpass' } }],
];

// o carregamento do contexto precisa acontecer antes das telas
const api = await import('../../js/lib/api.js');
await api.loadContext();
await check('contexto carregado (igreja, papel, líder)', async () => {
  if (api.S.church?.name !== 'Igreja Teste' || api.S.role !== 'owner' || !api.isManager()) throw new Error(JSON.stringify(api.S.church));
});

for (const [label, cfg] of pages) {
  await check(`tela: ${label}`, async () => {
    const page = cfg.page ?? label.split(' ')[0];
    const { el } = await mount(page, cfg);
    clean(el); noRawHtml(el);
  });
}

// ── interações principais ────────────────────────────────────────────────────
await check('integrantes: abrir cadastro, busca e ordenação', async () => {
  const { el } = await mount('members');
  click(el, '[data-act="new"]'); await settle();
  if (!document.querySelector('dialog[open] form')) throw new Error('diálogo de cadastro não abriu');
  document.querySelector('dialog [data-close]').click();
  const q = el.querySelector('#q'); q.value = 'cai'; q.dispatchEvent(new w.Event('input', { bubbles: true }));
  if (!el.textContent.includes('Caio') || el.textContent.includes('Ana Souza')) throw new Error('busca sem acento falhou');
  click(el, '[data-act="sort"]');
});
await check('integrantes: arquivar bloqueado mostra as escalas afetadas', async () => {
  const { el } = await mount('members');
  click(el, '[data-act="archive"]'); await settle();
  answer('ok'); await settle(80);
  if (!document.body.textContent.includes('Batismo no Rio')) throw new Error('não listou a escala bloqueadora');
  document.querySelectorAll('dialog').forEach((d) => d.close());
});
await check('dashboard: confirmar chama respond_assignment', async () => {
  const { el } = await mount('dashboard');
  click(el, '[data-act="confirm"]'); await settle(80);
  if (!rpcCalled('respond_assignment')) throw new Error('RPC não chamada');
});
await check('dashboard: buscar substituto abre o diálogo com candidatos', async () => {
  const { el } = await mount('dashboard');
  click(el, '[data-act="sub"]'); await settle(80);
  if (!document.querySelector('dialog[open]')?.textContent.includes('Caio')) throw new Error('sem candidatos');
  document.querySelectorAll('dialog').forEach((d) => d.close());
});
await check('minhas escalas: recusar abre formulário com justificativa obrigatória', async () => {
  const { el } = await mount('mine');
  click(el, '[data-act="decline"]'); await settle(80);
  const ta = document.querySelector('dialog[open] textarea[name=reason]');
  if (!ta || !ta.required || ta.minLength !== 10) throw new Error('campo de justificativa incorreto');
  document.querySelectorAll('dialog').forEach((d) => d.close());
});
await check('escala (rascunho): painel de escalações, setlist e botão publicar', async () => {
  const { el } = await mount('event-edit', { params: [ev2.id] });
  if (!el.querySelector('[data-act="publish"]')) throw new Error('sem botão publicar');
  if (!el.querySelector('#addasg') || !el.querySelector('#addsong')) throw new Error('faltam formulários');
});
await check('escala publicada: mostra ações de substituir e o painel de status', async () => {
  const { el } = await mount('event-edit', E);
  if (!el.querySelector('[data-act="sub"]')) throw new Error('sem substituir');
  if (!/pendente\(s\)/.test(el.textContent)) throw new Error('sem contadores');
  click(el, '[data-act="share"]'); await settle(80);
  if (!document.querySelector('dialog[open] textarea')?.value.includes('Batismo no Rio')) throw new Error('mensagem do WhatsApp vazia');
  document.querySelectorAll('dialog').forEach((d) => d.close());
});
await check('funções e músicas: abrir formulário de cadastro', async () => {
  for (const p of ['roles', 'songs']) { const { el } = await mount(p); click(el, '[data-act="new"]'); await settle(); if (!document.querySelector('dialog[open] form')) throw new Error(p); document.querySelectorAll('dialog').forEach((d) => d.close()); }
});
await check('equipes: excluir bloqueado informa escalas futuras', async () => {
  const { el } = await mount('teams');
  click(el, '[data-act="del"]'); await settle();
  answer('ok'); await settle(80);
  if (!document.body.textContent.includes('escala(s) futura(s)')) throw new Error('mensagem ausente');
  document.querySelectorAll('dialog').forEach((d) => d.close());
});
await check('calendário: abrir escala mostra elenco', async () => {
  const { el } = await mount('calendar', { query: { v: 'list', m: new Date(ev1.starts_at).toISOString().slice(0, 7) } });
  click(el, '[data-act="open"]'); await settle();
  if (!document.querySelector('dialog[open]')?.textContent.includes('Vocal')) throw new Error('sem elenco');
  document.querySelectorAll('dialog').forEach((d) => d.close());
});

// ── o roteador completo (main.js) ────────────────────────────────────────────
await check('main.js: monta a moldura e o início para usuário logado', async () => {
  await import('../../js/main.js'); await settle(400);
  if (!document.querySelector('aside.side') || !document.querySelector('#view')) throw new Error('sem moldura: ' + document.getElementById('app').innerHTML.slice(0, 200));
  if (!/(Bom dia|Boa tarde|Boa noite), Ana/.test(document.querySelector('#view').textContent)) throw new Error('início não renderizou: ' + document.querySelector('#view').textContent.slice(0, 200));
  if (document.querySelectorAll('.side-nav a').length < 8 || document.querySelectorAll('.tabbar a').length !== 4) throw new Error('menu incompleto');
});

for (const r of results) console.log(r[0] === 'ok' ? '  ok   ' : '  FALHOU', r[1], r[2] ? '\n         ' + r[2] : '');
console.log(`\n${results.length - failed}/${results.length} telas e interações OK`);
process.exit(failed ? 1 : 0);
