// Primeiro acesso: criar igreja (RF-102b) ou aceitar convite (RF-102a).
import { sb, q, S, loadContext } from '../lib/api.js';
import { html, toStr, esc, toast } from '../lib/ui.js';

export const slugify = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// convite guardado antes do login/cadastro (localStorage) ou na própria conta (user_metadata.invite)
function pendingInvite() {
  let c = null;
  try { c = localStorage.getItem('lo.invite'); } catch { /* ignore */ }
  return c || S.user?.user_metadata?.invite || null;
}
function clearPendingInvite() {
  try { localStorage.removeItem('lo.invite'); } catch { /* ignore */ }
  if (S.user?.user_metadata?.invite) sb.auth.updateUser({ data: { invite: null } }).catch(() => {});
}

async function accept(code, go) {
  await q(sb.rpc('accept_invite', { p_code: code }));
  clearPendingInvite();
  await loadContext();
  toast('Convite aceito! Bem-vindo(a).');
  go('/');
}

export default async function render(el, { params, opt, go }) {
  // Convite aberto por link
  if (opt.invite) {
    const code = decodeURIComponent(params[0] ?? '');
    if (!S.user) {
      try { sessionStorage.setItem('lo.next', '/convite/' + encodeURIComponent(code)); } catch { /* ignore */ }
      try { localStorage.setItem('lo.invite', code); } catch { /* ignore */ }
      el.innerHTML = toStr(html`<div class="auth"><div class="logo">LouvOrganize</div><div class="card">
        <h1>Você recebeu um convite</h1>
        <p>Para aceitar, entre na sua conta ou crie uma (leva um minuto). Depois disso o convite é aceito automaticamente.</p>
        <p class="row"><a class="btn primary" href="#/cadastro">Criar conta</a> <a class="btn" href="#/login">Já tenho conta</a></p></div></div>`);
      return;
    }
    el.innerHTML = toStr(html`<div class="auth"><div class="card"><h1>Aceitando convite…</h1><div id="e"></div></div></div>`);
    try { await accept(code, go); } catch (err) {
      clearPendingInvite();   // evita ficar preso num convite vencido/usado
      el.querySelector('#e').innerHTML = `<div class="alert bad">${esc(err.message)}</div><p><a class="btn" href="#/comecar">Voltar</a></p>`;
    }
    return;
  }

  // chegou aqui com um convite pendente (ex.: confirmou o e-mail em outra aba)? aceita direto.
  const pend = pendingInvite();
  if (pend) return go('/convite/' + encodeURIComponent(pend));

  let savedName = '';
  try { savedName = sessionStorage.getItem('lo.name') || ''; } catch { /* ignore */ }
  const name = savedName || S.user.user_metadata?.full_name || '';

  el.innerHTML = toStr(html`<div class="auth" style="max-width:560px">
    <div class="logo">LouvOrganize</div>
    <div class="card"><h1>Foi convidado pelo líder?</h1>
      <p class="muted">Abra de novo o link do convite que você recebeu, ou cole aqui o código. <strong>Não crie uma igreja nova.</strong></p>
      <div id="e2"></div>
      <form id="inv" novalidate><div class="row"><input id="code" aria-label="Código de convite" required autocomplete="off" placeholder="Cole o código" style="flex:1 1 200px">
      <button class="btn primary" type="submit">Entrar com o convite</button></div></form></div>
    <div class="card"><h2>Criar uma igreja</h2>
      <p class="muted">Você será o proprietário. Depois é só cadastrar a equipe.</p>
      <div id="e1"></div>
      <form id="new" novalidate>
        <div class="field"><label for="cname">Nome da igreja ou ministério</label><input id="cname" name="cname" required minlength="2" maxlength="120"></div>
        <div class="field"><label for="slug">Endereço da página pública
          <span class="hint">Aparecerá como …/#/i/<strong id="sl">sua-igreja</strong>. Não poderá ser alterado depois.</span></label>
          <input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9\\-]{1,38}[a-z0-9]" minlength="3" maxlength="40"></div>
        <div class="field"><label for="mname">Seu nome</label><input id="mname" name="mname" required minlength="3" maxlength="120" value="${name}"></div>
        <button class="btn" type="submit">Criar igreja</button>
      </form></div>
    <p class="center small"><button class="btn link" id="out">Sair da conta</button></p>
  </div>`);

  const nameEl = el.querySelector('#cname'); const slugEl = el.querySelector('#slug');
  let touched = false;
  slugEl.addEventListener('input', () => { touched = true; el.querySelector('#sl').textContent = slugEl.value || 'sua-igreja'; });
  nameEl.addEventListener('input', () => {
    if (!touched) { slugEl.value = slugify(nameEl.value); el.querySelector('#sl').textContent = slugEl.value || 'sua-igreja'; }
  });

  el.querySelector('#new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; if (!f.reportValidity()) return;
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      await q(sb.rpc('create_church', { p_name: f.cname.value, p_slug: f.slug.value, p_member_name: f.mname.value }));
      try { sessionStorage.removeItem('lo.name'); } catch { /* ignore */ }
      await loadContext();
      toast('Igreja criada! Comece cadastrando suas equipes e integrantes.');
      go('/');
    } catch (err) { el.querySelector('#e1').innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; btn.disabled = false; }
  });
  el.querySelector('#inv').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await accept(el.querySelector('#code').value, go); }
    catch (err) { el.querySelector('#e2').innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; btn.disabled = false; }
  });
  el.querySelector('#out').addEventListener('click', () => sb.auth.signOut());
}
