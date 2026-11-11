// Inicialização, roteador por hash (funciona no GitHub Pages) e estrutura da tela.
import { configured, secretKeyError, sb, S, loadContext, setChurch, isAdmin, isManager } from './lib/api.js';
import { html, raw, toStr, spinner, errorBox, toast, icon, initials, showDialog } from './lib/ui.js';
import { VERSION, RELEASED } from './version.js';

const versionTag = () => html`<p class="app-ver" title="Versão ${VERSION}, publicada em ${RELEASED.split('-').reverse().join('/')}">LouvOrganize v${VERSION}</p>`;

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
  [/^\/vestimentas$/, 'dress'],
  [/^\/relatorios$/, 'reports', { manager: true }],
  [/^\/configuracoes$/, 'settings', { admin: true }],
];

// [caminho, rótulo, quem vê, ícone, rótulo curto p/ barra do celular]
const NAV = [
  ['/', 'Início', () => true, 'home', 'Início'],
  ['/calendario', 'Calendário', () => true, 'calendar', 'Agenda'],
  ['/minhas', 'Minhas escalas', () => !!S.me, 'check', 'Minhas'],
  ['/escalas', 'Escalas', () => true, 'list', 'Escalas'],
  ['/equipes', 'Equipes', () => true, 'users', 'Equipes'],
  ['/integrantes', 'Integrantes', isManager, 'user', 'Pessoas'],
  ['/funcoes', 'Funções', isAdmin, 'tag', 'Funções'],
  ['/musicas', 'Músicas', () => true, 'music', 'Músicas'],
  ['/vestimentas', 'Vestimenta', () => true, 'shirt', 'Roupas'],
  ['/relatorios', 'Relatórios', isManager, 'chart', 'Relatórios'],
  ['/configuracoes', 'Configurações', isAdmin, 'settings', 'Ajustes'],
];
const TAB_MAX = 4;   // no celular: 4 atalhos + “Mais”

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

const ROLE_NAME = { owner: 'Proprietário', admin: 'Administrador', leader: 'Líder', member: 'Integrante' };
const isOn = (p, path) => (p === '/' ? path === '/' : path === p || path.startsWith(p + '/'));

function renderShell() {
  const items = NAV.filter(([, , show]) => show());
  const tabs = items.slice(0, TAB_MAX);
  const name = S.me?.full_name ?? S.user?.email ?? '';
  const switcher = (id) => (S.memberships.length > 1
    ? html`<label class="sr-only" for="${id}">Trocar de igreja</label>
        <select id="${id}" class="church-sw" data-church-sw>${S.memberships.map((m) =>
          html`<option value="${m.church_id}" ${m.church_id === S.church.id ? raw('selected') : ''}>${m.churches.name}</option>`)}</select>`
    : '');
  app.innerHTML = toStr(html`
    <div class="shell">
      <aside class="side" aria-label="Menu lateral">
        <a class="brand" href="#/"><span class="brand-mark">${icon('note', 22)}</span><span>LouvOrganize<small>${S.church.name}</small></span></a>
        ${switcher('church-sw-side')}
        <nav class="side-nav" aria-label="Principal">${items.map(([p, label, , ic]) =>
          html`<a href="#${p}" data-path="${p}">${icon(ic)}<span>${label}</span></a>`)}</nav>
        <div class="side-foot">
          <a href="#/i/${S.church.slug}" target="_blank" rel="noopener">${icon('external', 18)}<span>Página pública</span></a>
          <button type="button" data-logout>${icon('logout', 18)}<span>Sair</span></button>
          <div class="me"><span class="av" aria-hidden="true">${initials(name)}</span><span><strong>${name}</strong><small>${ROLE_NAME[S.role] ?? ''}</small></span></div>
          ${versionTag()}
        </div>
      </aside>
      <header class="mtop">
        <a class="brand" href="#/"><span class="brand-mark">${icon('note', 20)}</span><span>${S.church.name}</span></a>
        <span class="av" aria-label="${name}" title="${name}">${initials(name)}</span>
      </header>
      <main id="view" tabindex="-1"></main>
      <nav class="tabbar" aria-label="Atalhos">
        ${tabs.map(([p, , , ic, short]) => html`<a href="#${p}" data-path="${p}">${icon(ic, 22)}<span>${short}</span></a>`)}
        <button type="button" data-more aria-haspopup="dialog">${icon('more', 22)}<span>Mais</span></button>
      </nav>
    </div>`);
  shellFor = S.church.id;
}

function openMore() {
  const rest = NAV.filter(([, , show]) => show()).slice(TAB_MAX);
  const path = parseHash().path;
  const dlg = showDialog(html`<div class="dlg-body sheet-menu">
      <div class="sheet-head"><span class="av">${initials(S.me?.full_name ?? S.user?.email)}</span>
        <span><strong>${S.me?.full_name ?? S.user?.email}</strong><small>${S.church.name} · ${ROLE_NAME[S.role] ?? ''}</small></span></div>
      ${S.memberships.length > 1 ? html`<div class="field"><label for="church-sw-sheet">Igreja</label><select id="church-sw-sheet" data-church-sw>${S.memberships.map((m) =>
        html`<option value="${m.church_id}" ${m.church_id === S.church.id ? raw('selected') : ''}>${m.churches.name}</option>`)}</select></div>` : ''}
      <nav class="menu-list" aria-label="Mais opções">
        ${rest.map(([p, label, , ic]) => html`<a href="#${p}" ${isOn(p, path) ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span>${icon('chevron', 18)}</a>`)}
        <a href="#/i/${S.church.slug}" target="_blank" rel="noopener">${icon('external')}<span>Página pública</span>${icon('chevron', 18)}</a>
        <button type="button" data-logout class="danger-text">${icon('logout')}<span>Sair da conta</span></button>
      </nav>${versionTag()}</div>`);
  dlg.classList.add('sheet');
  dlg.querySelectorAll('a[href^="#/"]').forEach((a) => a.addEventListener('click', () => dlg.close()));
}

function markNav(path) {
  let inTabs = false;
  document.querySelectorAll('.side-nav a, .tabbar a').forEach((a) => {
    const on = isOn(a.dataset.path, path);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    if (on && a.closest('.tabbar')) inTabs = true;
  });
  document.querySelector('.tabbar [data-more]')?.classList.toggle('on', !inTabs && path !== '/');
}

// Tabelas viram cartões no celular: cada célula ganha o título da coluna (data-label).
function labelTables(root) {
  root.querySelectorAll('table').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    t.classList.add('rtable');
    t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
      if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] ?? '');
    }));
  });
}
const tableObserver = new MutationObserver((list) => {
  for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) labelTables(n.tagName === 'TABLE' ? n.parentNode : n); });
});

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
    // convite pendente vale mesmo sem igreja (é justamente o caso de quem foi convidado)
    return go(S.church || next.startsWith('/convite/') ? next : '/comecar');
  }
  if (opt.admin && !isAdmin()) { toast('Somente administradores acessam esta área.', 'bad'); return go('/'); }
  if (opt.manager && !isManager()) { toast('Somente líderes e administradores acessam esta área.', 'bad'); return go('/'); }

  const wrapper = document.createElement('div');
  wrapper.className = 'page';
  wrapper.innerHTML = toStr(spinner());

  const bare = opt.bare || !S.church;
  document.body.classList.toggle('is-bare', bare);
  if (bare) {
    app.replaceChildren(wrapper); shellFor = null;
  } else {
    if (shellFor !== S.church.id || !document.getElementById('view')) renderShell();
    document.getElementById('view').replaceChildren(wrapper);
    markNav(path);
  }
  tableObserver.disconnect();
  tableObserver.observe(wrapper, { childList: true, subtree: true });
  window.scrollTo(0, 0);

  try {
    // ?v= força o navegador a buscar as telas da versão nova (o GitHub Pages guarda arquivos por 10 min)
    const page = await import(`./pages/${mod}.js?v=${VERSION}`);
    if (token !== navToken) return;
    await page.default(wrapper, { params: m.slice(1), query, opt, go });
    labelTables(wrapper);
    // título da aba = título da tela; foco no título para leitores de tela (sem rolar)
    const h1 = wrapper.querySelector('h1');
    if (h1 && !opt.mode) {
      document.title = `${h1.textContent.trim()} · LouvOrganize`;
      if (navToken > 1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    } else if (!h1) document.title = 'LouvOrganize';
  } catch (err) {
    console.error(err);
    if (token === navToken) wrapper.innerHTML = toStr(errorBox(err));
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-reload]')) location.reload();
  if (e.target.closest('[data-more]')) openMore();
  if (e.target.closest('[data-logout]')) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    await sb.auth.signOut();
  }
});
document.addEventListener('change', async (e) => {
  if (!e.target.matches('[data-church-sw]')) return;
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  await setChurch(e.target.value); shellFor = null; go('/');
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
