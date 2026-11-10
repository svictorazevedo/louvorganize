// Entrar, cadastrar, recuperar e redefinir senha (RF-101, RF-103).
import { sb, friendly } from '../lib/api.js';
import { html, toStr, esc } from '../lib/ui.js';

const redirectUrl = () => location.origin + location.pathname;

export default async function render(el, { opt, go }) {
  const mode = opt.mode;
  const titles = { login: 'Entrar', signup: 'Criar conta', recover: 'Recuperar senha', newpass: 'Escolha uma nova senha' };
  const pw = (id, label, auto) => html`<div class="field"><label for="${id}">${label}<span class="hint">Mínimo de 8 caracteres</span></label>
    <input id="${id}" name="${id}" type="password" minlength="8" required autocomplete="${auto}"></div>`;

  const forms = {
    login: html`
      <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email" inputmode="email"></div>
      <div class="field"><label for="password">Senha</label><input id="password" name="password" type="password" required autocomplete="current-password"></div>
      <button class="btn primary" style="width:100%" type="submit">Entrar</button>
      <p class="small" style="margin-top:1rem"><a href="#/recuperar">Esqueci minha senha</a> · <a href="#/cadastro">Cadastre-se</a></p>`,
    signup: html`
      <div class="field"><label for="name">Seu nome completo</label><input id="name" name="name" required minlength="3" maxlength="120" autocomplete="name"></div>
      <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email" inputmode="email"></div>
      ${pw('password', 'Senha', 'new-password')}
      <button class="btn primary" style="width:100%" type="submit">Criar conta</button>
      <p class="small" style="margin-top:1rem">Já tem conta? <a href="#/login">Entrar</a></p>`,
    recover: html`
      <p class="muted">Informe seu e-mail. Se ele estiver cadastrado, enviaremos um link para criar uma nova senha (válido por 60 minutos).</p>
      <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" required autocomplete="email" inputmode="email"></div>
      <button class="btn primary" style="width:100%" type="submit">Enviar link</button>
      <p class="small" style="margin-top:1rem"><a href="#/login">Voltar</a></p>`,
    newpass: html`${pw('password', 'Nova senha', 'new-password')}
      <button class="btn primary" style="width:100%" type="submit">Salvar nova senha</button>`,
  };

  el.innerHTML = toStr(html`<div class="auth">
    <div class="logo">LouvOrganize<small>Escalas do ministério de louvor</small></div>
    <div class="card"><h1>${titles[mode]}</h1>
      <div id="msg" role="alert"></div>
      <form id="f" novalidate>${forms[mode]}</form>
    </div>
    ${mode === 'login' ? html`<div class="card"><form id="inv" novalidate>
      <label for="code">Tenho um código de convite</label>
      <div class="row"><input id="code" class="grow" autocomplete="off" placeholder="Cole o código aqui" style="flex:1 1 200px">
      <button class="btn" type="submit">Continuar</button></div></form></div>` : ''}
  </div>`);

  const msg = (kind, text) => { el.querySelector('#msg').innerHTML = `<div class="alert ${kind}">${esc(text)}</div>`; };
  const form = el.querySelector('#f');

  el.querySelector('#inv')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = el.querySelector('#code').value.trim();
    if (code) go('/convite/' + encodeURIComponent(code));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    const v = Object.fromEntries(new FormData(form));
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.password });
        if (error) throw friendly(error);
      } else if (mode === 'signup') {
        // o código do convite vai junto na conta: sobrevive ao link de confirmação aberto em outra aba/navegador
        let invite = null;
        try { invite = localStorage.getItem('lo.invite'); } catch { /* ignore */ }
        const { data, error } = await sb.auth.signUp({
          email: v.email.trim(), password: v.password,
          options: { data: { full_name: v.name.trim(), ...(invite ? { invite } : {}) }, emailRedirectTo: redirectUrl() },
        });
        if (error) throw friendly(error);
        try { sessionStorage.setItem('lo.name', v.name.trim()); } catch { /* ignore */ }
        if (!data.session) {
          form.remove();
          msg('ok', 'Conta criada! Enviamos um e-mail de confirmação. Abra-o neste mesmo aparelho e clique no link para entrar.');
        }
      } else if (mode === 'recover') {
        const { error } = await sb.auth.resetPasswordForEmail(v.email.trim(), { redirectTo: redirectUrl() });
        if (error) throw friendly(error);
        form.remove();
        msg('ok', 'Pronto. Se este e-mail estiver cadastrado, o link de recuperação já está a caminho. Abra-o neste mesmo aparelho.');
      } else if (mode === 'newpass') {
        const { error } = await sb.auth.updateUser({ password: v.password });
        if (error) throw friendly(error);
        go('/');
      }
    } catch (err) { msg('bad', err.message); btn.disabled = false; }
  });
  el.querySelector('input')?.focus();
}
