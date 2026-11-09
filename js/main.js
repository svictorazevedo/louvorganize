// Inicialização, roteador por hash (funciona no GitHub Pages) e estrutura da tela.
import { configured, secretKeyError, sb, S, loadContext, setChurch, isAdmin, isManager } from './lib/api.js';
import { html, raw, toStr, spinner, errorBox, toast } from './lib/ui.js';

const app = document.getElementById('app');

// [padrão, módulo, opções]  — auth: exige login · manager/admin: exige papel · bare: sem moldura
const ROUTES = [
  [/^\/$/, 'dashboard'],
  [/^\/login$/, 'auth', { auth: false, bare: true, mode: 'login' }],
  [/^\/cadastro$/, 'auth', { auth: false, bare: true, mode: 'signup' }],
  [/^\/recuperar$/, 'auth', { auth: false, bare: true, mode: 'recover' }],
  [/^\/nova-senha$/, 'auth', { auth: false, bare: true, mode: 'newpass' }],
  [/^\/comecar$/, 'start', { bare: true, noChurch: true }],
  [/^\/convite\/([^/]+)$/, 'start', { auth: false, bare: true, noChurch: true, invite: true }],
  [/^\/i\/([a-z0-9-]+)$/, 'public', { auth: false, bare: true }],
  [/^\/calendario$/, 'calendar'],
  [/^\/minhas$/, 'mine'],
  [/^\/escalas$/, 'events'],
  [/^\/escalas\/nova$/, 'event-edit', { manager: true }],
  [/^\/escalas\/([0-9a-f-]{36})$/, 'event-edit'],
  [/^\/equipes$/, 'teams'],
  [/^\/equipes\/nova$/, 'team-edit', { admin: true }],
  [/^\/equipes\/([0-9a-f-]{36})$/, 'teams'],
  [/^\/equipes\/([0-9a-f-]{36})\/editar$/, 'team-edit', { manager: true }],
  [/^\/integrantes$/, 'members', { manager: true }],
  [/^\/integrantes\/([0-9a-f-]{36})$/, 'members', { manager: true }],
  [/^\/funcoes$/, 'roles', { admin: true }],
  [/^\/musicas$/, 'songs'],
  [/^\/relatorios$/, 'reports', { manager: true }],
  [/^\/configuracoes$/, 'settings', { admin: true }],
];

const NAV = [
  ['/', 'Início', () => true],
  ['/calendario', 'Calendário', () => true],
  ['/minhas', 'Minhas escalas', () => !!S.me],
  ['/escalas', 'Escalas', () => true],
  ['/equipes', 'Equipes', () => true],
  ['/integrantes', 'Integrantes', isManager],
  ['/funcoes', 'Funções', isAdmin],
  ['/musicas', 'Músicas', () => true],
  ['/relatorios', 'Relatórios', isManager],
  ['/configuracoes', 'Configurações', isAdmin],
];

let navToken = 0;
let shellFor = null;

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path: path.replace(/(.)\/$/, '$1'), query: Object.fromEntries(new URLSearchParams(qs)) };
}
const go = (p) => { if (location.hash !== '#' + p) location.hash = '#' + p; else route(); };

function setupScreen() {
  if (secretKeyError) {
    app.innerHTML = toStr(html`<div class="auth"><div class="card"><div class="logo">LouvOrganize</div>
      <h1>Chave errada em js/config.js</h1>
      <div class="alert bad">Você colou a chave <strong>secreta</strong> do Supabase. Ela dá acesso total ao banco e não pode ficar num site público.</div>
      <ol><li>Troque em <code>js/config.js</code> pela chave <strong>publicável</strong> (<code>sb_publishable_…</code>) ou <em>anon public</em>.</li>
      <li>Por segurança, gere uma nova chave secreta no Supabase (<em>Project Settings › API Keys</em>), já que esta pode ter vazado.</li></ol></div></div>`);
    return;
  }
  app.innerHTML = toStr(html`<div class="auth"><div class="card">
    <div class="logo">LouvOrganize</div>
    <h1>Falta conectar o banco de dados</h1>
    <p>O site está no ar, mas ainda não foi ligado a um projeto Supabase.</p>
    <ol>
      <li>Crie um projeto grátis em <strong>supabase.com</strong>.</li>
      <li>No <em>SQL Editor</em>, rode o arquivo <code>supabase/schema.sql</code>.</li>
      <li>Em <em>Project Settings › API Keys</em>, copie a <strong>Project URL</strong> e a chave <strong>publicável</strong> (<code>sb_publishable_…</code>) para <code>js/config.js</code>.</li>
      <li>Publique de novo. O passo a passo completo está no <code>README.md</code>.</li>
    </ol></div></div>`);
}

function renderShell() {
  const items = NAV.filter(([, , show]) => show());
  const switcher = S.memberships.length > 1
    ? html`<label class="sr-only" for="church-sw">Igreja</label>
        <select id="church-sw" style="width:auto;min-height:36px">${S.memberships.map((m) =>
          html`<option value="${m.church_id}" ${m.church_id === S.church.id ? raw('selected') : ''}>${m.churches.name}</option>`)}</select>`
    : '';
  app.innerHTML = toStr(html`
    <header class="top"><div class="top-in">
      <a class="brand" href="#/">LouvOrganize<small>${S.church.name}</small></a>
      ${switcher}
      <a class="btn sm" href="#/i/${S.church.slug}" target="_blank" rel="noopener" title="Página pública da igreja">Página pública ↗</a>
      <button class="btn sm" id="logout">Sair</button>
    </div>
    <nav class="nav" aria-label="Principal">${items.map(([p, label]) => html`<a href="#${p}" data-path="${p}">${label}</a>`)}</nav>
    </header>
    <main id="view" tabindex="-1"></main>`);
  document.getElementById('logout').addEventListener('click', async () => { await sb.auth.signOut(); });
  document.getElementById('church-sw')?.addEventListener('change', async (e) => {
    await setChurch(e.target.value); shellFor = null; go('/');
  });
  shellFor = S.church.id;
}

function markNav(path) {
  document.querySelectorAll('.nav a').forEach((a) => {
    const p = a.dataset.path;
    const on = p === '/' ? path === '/' : path === p || path.startsWith(p + '/');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function route() {
  const token = ++navToken;
  if (!configured) return setupScreen();
  const { path, query } = parseHash();

  const hit = ROUTES.map(([re, mod, opt = {}]) => ({ m: re.exec(path), mod, opt })).find((r) => r.m);
  if (!hit) { go('/'); return; }
  const { m, mod, opt } = hit;
  const needAuth = opt.auth !== false;

  if (needAuth && !S.user) {
    try { sessionStorage.setItem('lo.next', path); } catch { /* ignore */ }
    return go('/login');
  }
  if (S.user && !S.church && !opt.noChurch && needAuth) return go('/comecar');
  if (S.user && opt.mode && opt.mode !== 'newpass') {
    let next = '/';
    try { next = sessionStorage.getItem('lo.next') || '/'; sessionStorage.removeItem('lo.next'); } catch { /* ignore */ }
    return go(S.church ? next : '/comecar');
  }
  if (opt.admin && !isAdmin()) { toast('Somente administradores acessam esta área.', 'bad'); return go('/'); }
  if (opt.manager && !isManager()) { toast('Somente líderes e administradores acessam esta área.', 'bad'); return go('/'); }

  const wrapper = document.createElement('div');
  wrapper.className = 'page';
  wrapper.innerHTML = toStr(spinner());

  if (opt.bare || !S.church) {
    app.replaceChildren(wrapper); shellFor = null;
  } else {
    if (shellFor !== S.church.id || !document.getElementById('view')) renderShell();
    document.getElementById('view').replaceChildren(wrapper);
    markNav(path);
  }
  document.title = 'LouvOrganize';
  window.scrollTo(0, 0);

  try {
    const page = await import(`./pages/${mod}.js`);
    if (token !== navToken) return;
    await page.default(wrapper, { params: m.slice(1), query, opt, go });
  } catch (err) {
    console.error(err);
    if (token === navToken) wrapper.innerHTML = toStr(errorBox(err));
  }
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-reload]')) location.reload();
});

async function boot() {
  if (!configured) return setupScreen();
  sb.auth.onAuthStateChange((event) => {
    // não faça chamadas ao Supabase direto aqui dentro (risco de deadlock): adie.
    setTimeout(async () => {
      if (event === 'PASSWORD_RECOVERY') { await loadContext(); return go('/nova-senha'); }
      if (event === 'SIGNED_IN' && S.user?.id) return;               // já carregado no boot
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        try { await loadContext(); } catch (e) { toast(e.message, 'bad'); }
        shellFor = null;
        route();
      }
    }, 0);
  });
  try { await loadContext(); } catch (e) { console.error(e); toast(e.message, 'bad'); }
  window.addEventListener('hashchange', route);
  route();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline é um extra */ });
}
boot();
