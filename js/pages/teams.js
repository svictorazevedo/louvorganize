// Equipes: listagem (RF-401), visualização (RF-407), duplicar (RF-404) e excluir (RF-406).
import { sb, q, S, tz, isAdmin, invalidate, lookups } from '../lib/api.js';
import {
  html, toStr, actions, empty, sortRows, sortTh, toggleSort, confirmDialog, infoDialog, toast, CATEGORY, initials, eventChip,
} from '../lib/ui.js';
import { evName, evWhen } from '../lib/shared.js';

const distinct = (t) => [...new Set(t.team_members.map((x) => x.member_id))];

export default async function render(el, { params }) {
  const L = await lookups();
  if (params[0]) return view(el, L, params[0]);

  const st = { key: 'name', dir: 'asc' };
  const canEdit = (t) => isAdmin() || t.leader_id === S.me?.id;
  const nameOf = (id) => L.memberById.get(id)?.full_name ?? '?';

  const draw = () => {
    const rows = sortRows(L.teams, st.key, st.dir, { count: (t) => distinct(t).length });
    el.innerHTML = toStr(html`
      <div class="page-head"><div class="grow"><h1>Equipes</h1>
        <p class="muted">Modelos de escalação. Ao criar uma escala, escolha a equipe e cada integrante vira uma escalação individual.</p></div>
        ${isAdmin() ? html`<div class="actions"><a class="btn primary" href="#/equipes/nova">+ Cadastrar equipe</a></div>` : ''}</div>
      ${rows.length ? html`<div class="tablewrap"><table><thead><tr>${sortTh('Nome', 'name', st)}${sortTh('Integrantes', 'count', st)}
        <th scope="col">Quem</th><th scope="col">Funções cobertas</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>
        ${rows.map((t) => {
          const ids = distinct(t); const roles = [...new Set(t.team_members.map((x) => x.role_id))];
          return html`<tr><td><span class="chip"><span class="dot" style="background:${t.color}"></span></span> <a href="#/equipes/${t.id}"><strong>${t.name}</strong></a>
              ${t.leader_id ? html`<br><span class="muted small">Líder: ${nameOf(t.leader_id)}</span>` : ''}</td>
            <td>${ids.length}</td>
            <td><div class="chips">${ids.map((m) => html`<span class="chip" title="${nameOf(m)}"><span class="av" style="width:22px;height:22px;font-size:.65rem" aria-hidden="true">${initials(nameOf(m))}</span> ${nameOf(m).split(' ')[0]}</span>`)}</div></td>
            <td><div class="chips">${roles.map((r) => html`<span class="chip"><span class="dot" style="background:${L.roleById.get(r)?.color}"></span>${L.roleById.get(r)?.name}</span>`)}</div></td>
            <td class="nowrap"><div class="actions">
              <a class="btn sm" href="#/equipes/${t.id}">Ver</a>
              ${canEdit(t) ? html`<a class="btn sm" href="#/equipes/${t.id}/editar">Editar</a>` : ''}
              ${isAdmin() ? html`<button class="btn sm" data-act="dup" data-id="${t.id}">Duplicar</button><button class="btn sm danger" data-act="del" data-id="${t.id}" aria-label="Excluir ${t.name}">Excluir</button>` : ''}
            </div></td></tr>`;
        })}</tbody></table></div>`
        : empty('Nenhuma equipe ainda', isAdmin() ? 'Monte a primeira equipe para escalar com um clique.' : 'O administrador ainda não cadastrou equipes.',
            isAdmin() ? html`<a class="btn primary" href="#/equipes/nova">+ Cadastrar equipe</a>` : '')}`);
  };
  draw();

  actions(el, {
    sort: (b) => { toggleSort(st, b.dataset.key); draw(); },
    dup: async (b) => {
      const t = L.teamById.get(b.dataset.id);
      let name = `${t.name} (cópia)`; let n = 2;
      while (L.teams.some((x) => x.name.toLowerCase() === name.toLowerCase())) name = `${t.name} (cópia ${n++})`;
      try {
        await q(sb.rpc('save_team', { p_id: null, p_church: S.church.id, p_name: name, p_color: t.color, p_leader: null, p_members: t.team_members }));
        invalidate('teams', 'members'); toast(`“${name}” criada.`); render(el, { params: [] });
      } catch (e) { toast(e.message, 'bad'); }
    },
    del: async (b) => {
      const t = L.teamById.get(b.dataset.id);
      if (!(await confirmDialog({ title: 'Excluir equipe?', danger: true, confirmText: 'Excluir equipe',
        message: html`<p>A equipe <strong>${t.name}</strong> (${distinct(t).length} integrantes) será excluída. As escalas passadas continuam com o histórico.</p>` }))) return;
      try {
        const r = await q(sb.rpc('archive_team', { p_id: t.id }));
        if (!r.ok) {
          await infoDialog({ title: 'Não foi possível excluir', body: html`<p>Há <strong>${r.events}</strong> escala(s) futura(s) publicada(s) com esta equipe. Cancele ou troque a equipe nelas primeiro.</p>` });
          return;
        }
        invalidate('teams', 'members'); toast('Equipe excluída.'); render(el, { params: [] });
      } catch (e) { toast(e.message, 'bad'); }
    },
  });
}

async function view(el, L, id) {
  const t = L.teamById.get(id);
  if (!t) { el.innerHTML = toStr(empty('Equipe não encontrada', '', html`<a class="btn" href="#/equipes">Voltar</a>`)); return; }
  const events = await q(sb.from('events').select('*').eq('team_id', id).is('deleted_at', null).in('status', ['draft', 'published'])
    .gt('starts_at', new Date().toISOString()).order('starts_at').limit(8));
  const byCat = new Map();
  t.team_members.forEach((x) => {
    const r = L.roleById.get(x.role_id); const key = r?.category ?? 'instrumento';
    (byCat.get(key) ?? byCat.set(key, []).get(key)).push({ m: L.memberById.get(x.member_id), r });
  });
  const canEdit = isAdmin() || t.leader_id === S.me?.id;
  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1><span class="chip"><span class="dot" style="background:${t.color}"></span></span> ${t.name}</h1>
      <p class="muted">${distinct(t).length} integrante(s)${t.leader_id ? ' · Líder: ' + (L.memberById.get(t.leader_id)?.full_name ?? '') : ''}</p></div>
      <div class="actions">${canEdit ? html`<a class="btn primary" href="#/equipes/${t.id}/editar">Editar</a>` : ''}<a class="btn" href="#/equipes">Voltar</a></div></div>
    <div class="cards">
      <section class="card"><h2>Composição</h2>
        ${[...byCat].map(([cat, rows]) => html`<h3>${CATEGORY[cat]}</h3><ul class="list">${rows.map(({ m, r }) =>
          html`<li><span class="av" aria-hidden="true">${initials(m?.full_name)}</span><span class="grow"><strong>${m?.full_name}</strong></span>
            <span class="chip"><span class="dot" style="background:${r?.color}"></span>${r?.name}</span></li>`)}</ul>`)}</section>
      <section class="card"><h2>Próximas escalas</h2>
        ${events.length ? html`<ul class="list">${events.map((e) => html`<li><div class="grow"><a href="#/escalas/${e.id}">${evName(e)}</a><br><span class="muted">${evWhen(e)}</span></div>${eventChip(e.status)}</li>`)}</ul>`
          : html`<p class="muted">Nenhuma escala futura com esta equipe.</p>`}</section></div>`);
}
