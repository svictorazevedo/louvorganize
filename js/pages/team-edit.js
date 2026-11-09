// Cadastro e edição de equipe (RF-401..403, RN-401): 1 a 14 integrantes.
import { sb, q, S, isAdmin, invalidate, lookups } from '../lib/api.js';
import { html, toStr, esc, actions, toast } from '../lib/ui.js';

const MAX = 14;

export default async function render(el, { params, go }) {
  const id = params[0] ?? null;
  const L = await lookups();
  const t = id ? L.teamById.get(id) : null;
  if (id && !t) { el.innerHTML = '<div class="alert bad">Equipe não encontrada.</div>'; return; }
  if (id && !isAdmin() && t.leader_id !== S.me?.id) { el.innerHTML = '<div class="alert bad">Você não lidera esta equipe.</div>'; return; }

  const members = L.members.filter((m) => !m.deleted_at);
  // composição em edição: [{member_id, role_id}]
  let comp = t ? t.team_members.map((x) => ({ ...x })) : [];
  const rolesOf = (mid) => (L.memberById.get(mid)?.member_roles ?? []).map((x) => L.roleById.get(x.role_id)).filter((r) => r?.active);

  const draw = () => {
    const n = new Set(comp.map((c) => c.member_id)).size;
    const essential = L.roles.filter((r) => r.is_essential && r.active && !comp.some((c) => c.role_id === r.id));
    const free = members.filter((m) => !comp.some((c) => c.member_id === m.id));
    el.querySelector('#comp').innerHTML = toStr(html`
      <p class="small ${n > MAX || n < 1 ? '' : 'muted'}" aria-live="polite"><strong>${n}</strong> de ${MAX} integrantes${n > MAX ? ' — remova alguém (máximo ' + MAX + ').' : n < 1 ? ' — adicione pelo menos 1.' : ''}</p>
      ${comp.length ? html`<ul class="list">${comp.map((c, i) => {
        const m = L.memberById.get(c.member_id); const opts = rolesOf(c.member_id);
        return html`<li><span class="grow"><strong>${m?.full_name}</strong></span>
          <label class="sr-only" for="cr${i}">Função de ${m?.full_name}</label>
          <select id="cr${i}" data-act="role" data-i="${i}" style="width:auto">${opts.map((r) => html`<option value="${r.id}" ${r.id === c.role_id ? 'selected' : ''}>${r.name}</option>`)}</select>
          <button type="button" class="btn sm danger" data-act="rm" data-i="${i}" aria-label="Tirar ${m?.full_name}">Remover</button></li>`;
      })}</ul>` : html`<p class="muted">Nenhum integrante ainda.</p>`}
      ${essential.length && comp.length ? html`<div class="alert warn">Esta equipe não cobre: <strong>${essential.map((r) => r.name).join(', ')}</strong> (função essencial). É só um alerta; você pode salvar.</div>` : ''}
      <div class="row" style="margin-top:.75rem"><div class="grow"><label for="addm" class="sr-only">Adicionar integrante</label>
        <select id="addm"><option value="">Adicionar integrante…</option>${free.map((m) => html`<option value="${m.id}">${m.full_name}</option>`)}</select></div>
        <button type="button" class="btn" data-act="add">Adicionar</button></div>`);
  };

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>${t ? 'Editar equipe' : 'Cadastrar equipe'}</h1></div></div>
    <form id="f" class="card" novalidate>
      <div class="grid2">
        <div class="field"><label for="name">Nome</label><input id="name" name="name" required minlength="2" maxlength="60" value="${t?.name ?? ''}"></div>
        <div class="field"><label for="color">Cor</label><input id="color" name="color" type="color" value="${t?.color ?? '#2F5D62'}"></div>
        ${isAdmin() ? html`<div class="field"><label for="leader">Líder da equipe <span class="hint">Pode criar e editar as escalas desta equipe</span></label>
          <select id="leader" name="leader"><option value="">Sem líder definido</option>
          ${members.map((m) => html`<option value="${m.id}" ${t?.leader_id === m.id ? 'selected' : ''}>${m.full_name}</option>`)}</select></div>` : ''}
      </div>
      <h2>Composição</h2>
      <div id="comp"></div>
      <div class="actions" style="margin-top:1rem"><button class="btn primary" type="submit">Salvar</button><a class="btn" href="#/equipes">Cancelar</a></div>
    </form>`);
  draw();

  let dirty = false;
  const warn = (e) => { if (dirty && el.isConnected) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', warn);
  el.querySelector('#f').addEventListener('input', () => { dirty = true; });

  actions(el, {
    add: () => {
      const mid = el.querySelector('#addm').value; if (!mid) return;
      const opts = rolesOf(mid);
      if (!opts.length) return toast('Este integrante não tem função ativa. Edite o cadastro dele primeiro.', 'bad');
      if (new Set(comp.map((c) => c.member_id)).size >= MAX) return toast(`Uma equipe pode ter no máximo ${MAX} integrantes.`, 'bad');
      const primary = (L.memberById.get(mid).member_roles.find((r) => r.is_primary)?.role_id) ?? opts[0].id;
      comp.push({ member_id: mid, role_id: opts.some((r) => r.id === primary) ? primary : opts[0].id }); dirty = true; draw();
    },
    rm: (b) => { comp.splice(+b.dataset.i, 1); dirty = true; draw(); },
  });
  actions(el, { role: (s) => { comp[+s.dataset.i].role_id = s.value; dirty = true; } }, 'change');

  el.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; if (!f.reportValidity()) return;
    const n = new Set(comp.map((c) => c.member_id)).size;
    if (n < 1 || n > MAX) return toast(n < 1 ? 'Adicione pelo menos 1 integrante.' : `Máximo de ${MAX} integrantes.`, 'bad');
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await q(sb.rpc('save_team', {
        p_id: id, p_church: S.church.id, p_name: f.elements.namedItem('name').value, p_color: f.elements.namedItem('color').value,
        p_leader: f.elements.namedItem('leader') ? f.elements.namedItem('leader').value || null : t?.leader_id ?? null, p_members: comp,
      }));
      dirty = false; invalidate('teams', 'members'); toast('Equipe salva.'); go('/equipes');
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
  });
}
