// Integrantes (RF-200): grade com busca/filtros, cadastro, convite, arquivamento, CSV e perfil.
import { sb, q, S, tz, isAdmin, invalidate, lookups, getContacts } from '../lib/api.js';
import {
  html, raw, toStr, esc, actions, empty, sortRows, sortTh, toggleSort, confirmDialog, infoDialog, formDialog, showDialog,
  toast, copyText, statusChip, initials,
} from '../lib/ui.js';
import { evName, evWhen } from '../lib/shared.js';
import { norm, toE164 } from '../lib/time.js';
import { parseCsv } from '../lib/csv.js';

const ROLE_LABEL = { owner: 'Proprietário', admin: 'Administrador', leader: 'Líder', member: 'Integrante' };

export default async function render(el, { params }) {
  const L = await lookups();
  if (params[0]) return profile(el, L, params[0]);

  const contacts = await getContacts();
  const access = new Map((await q(sb.from('memberships').select('user_id, role').eq('church_id', S.church.id))).map((m) => [m.user_id, m.role]));
  const myRole = S.role;
  const admin = isAdmin();
  const st = { key: 'full_name', dir: 'asc', q: '', role: '', team: '', status: 'active' };

  const stateOf = (m) => (m.deleted_at ? 'archived' : m.user_id ? 'account' : m.status === 'invited' ? 'invited' : 'noaccount');
  const STATE = { archived: ['Arquivado', ''], account: ['Com conta', 'ok'], invited: ['Convidado', 'info'], noaccount: ['Sem conta', 'warn'] };
  const rolesOf = (m) => m.member_roles.map((x) => L.roleById.get(x.role_id)).filter(Boolean);
  const teamsOf = (m) => [...new Set(m.team_members.map((x) => x.team_id))].map((id) => L.teamById.get(id)).filter(Boolean);

  function filtered() {
    const needle = norm(st.q);
    const rows = L.members.filter((m) => {
      const s = stateOf(m);
      if (st.status === 'active' && s === 'archived') return false;
      if (st.status === 'archived' && s !== 'archived') return false;
      if (st.status === 'noaccount' && !(s === 'noaccount' || s === 'invited')) return false;
      if (st.role && !m.member_roles.some((x) => x.role_id === st.role)) return false;
      if (st.team && !m.team_members.some((x) => x.team_id === st.team)) return false;
      if (needle.length >= 2 && !norm(m.full_name).includes(needle)) return false;
      return true;
    });
    return sortRows(rows, st.key, st.dir, { roles: (m) => rolesOf(m).map((r) => r.name).join(), teams: (m) => teamsOf(m).map((t) => t.name).join(), status: (m) => STATE[stateOf(m)][0] });
  }

  function drawTable() {
    const rows = filtered();
    el.querySelector('#tbl').innerHTML = toStr(rows.length ? html`<div class="tablewrap"><table>
      <thead><tr><th scope="col"><span class="sr-only">Foto</span></th>${sortTh('Nome', 'full_name', st)}${sortTh('Funções', 'roles', st)}${sortTh('Equipes', 'teams', st)}${sortTh('Situação', 'status', st)}<th scope="col">Acesso</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
      <tbody>${rows.map((m) => {
        const s = stateOf(m); const role = m.user_id ? access.get(m.user_id) : null;
        return html`<tr><td><span class="av" aria-hidden="true">${initials(m.full_name)}</span></td>
          <td><a href="#/integrantes/${m.id}"><strong>${m.full_name}</strong></a>${contacts.get(m.id)?.phone ? html`<br><span class="muted small">${contacts.get(m.id).phone}</span>` : ''}</td>
          <td><div class="chips">${rolesOf(m).map((r) => html`<span class="chip"><span class="dot" style="background:${r.color}"></span>${r.name}</span>`)}</div></td>
          <td><div class="chips">${teamsOf(m).map((t) => html`<span class="chip">${t.name}</span>`)}</div></td>
          <td><span class="chip ${STATE[s][1]}">${STATE[s][0]}</span></td>
          <td>${role ? (isAdmin() && role !== 'owner' && m.user_id !== S.user.id
              ? html`<label class="sr-only" for="ac${m.id}">Acesso de ${m.full_name}</label><select id="ac${m.id}" data-act="access" data-uid="${m.user_id}" style="width:auto;min-height:32px" ${myRole === 'owner' ? '' : raw('disabled')}>
                  ${['admin', 'member'].map((r) => html`<option value="${r}" ${role === r || (r === 'member' && role === 'leader') ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`)}</select>`
              : ROLE_LABEL[role]) : html`<span class="muted">—</span>`}</td>
          <td class="nowrap"><div class="actions">
            ${!admin ? html`<a class="btn sm" href="#/integrantes/${m.id}">Ver</a>` : s === 'archived' ? html`<button class="btn sm" data-act="restore" data-id="${m.id}">Restaurar</button>` : html`
              <button class="btn sm" data-act="edit" data-id="${m.id}">Editar</button>
              ${s === 'noaccount' || s === 'invited' ? html`<button class="btn sm" data-act="invite" data-id="${m.id}">${s === 'invited' ? 'Novo convite' : 'Convidar'}</button>` : ''}
              <button class="btn sm danger" data-act="archive" data-id="${m.id}" aria-label="Arquivar ${m.full_name}">Arquivar</button>`}
          </div></td></tr>`;
      })}</tbody></table></div><p class="small muted" style="margin-top:.5rem">${rows.length} integrante(s)</p>`
      : empty('Nenhum integrante encontrado', st.q || st.role || st.team ? 'Tente limpar a busca ou os filtros.' : 'Cadastre quem serve no ministério.',
          admin ? html`<button class="btn primary" data-act="new">+ Cadastrar integrante</button>` : ''));
  }

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>Integrantes</h1>
      ${admin ? '' : html`<p class="muted">Somente administradores cadastram, editam e convidam integrantes.</p>`}</div>
      ${admin ? html`<div class="actions"><button class="btn" data-act="csv">Importar CSV</button><button class="btn primary" data-act="new">+ Cadastrar integrante</button></div>` : ''}</div>
    <div class="filters">
      <div style="flex:2 1 220px"><label for="q">Buscar por nome</label><input id="q" type="search" data-act="search" placeholder="Digite 2 letras ou mais" autocomplete="off"></div>
      <div><label for="fr">Função</label><select id="fr" data-act="flt" data-k="role"><option value="">Todas</option>${L.roles.filter((r) => r.active).map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select></div>
      <div><label for="ft">Equipe</label><select id="ft" data-act="flt" data-k="team"><option value="">Todas</option>${L.teams.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></div>
      <div><label for="fs">Situação</label><select id="fs" data-act="flt" data-k="status">
        <option value="active">Ativos</option><option value="noaccount">Sem conta / convidados</option><option value="archived">Arquivados</option><option value="all">Todos</option></select></div></div>
    <div id="tbl"></div>`);
  drawTable();

  async function memberForm(m) {
    const ct = m ? contacts.get(m.id) : null;
    const myRoles = new Set(m?.member_roles.map((x) => x.role_id) ?? []);
    const myTeams = new Set(m?.team_members.map((x) => x.team_id) ?? []);
    const done = await formDialog({
      title: m ? 'Editar integrante' : 'Cadastrar integrante', wide: true,
      body: html`<div class="grid2">
        <div class="field"><label for="n">Nome completo</label><input id="n" name="n" required minlength="3" maxlength="120" value="${m?.full_name ?? ''}"></div>
        <div class="field"><label for="p">Telefone / WhatsApp <span class="hint">Com DDD, ex.: (65) 99999-0000</span></label><input id="p" name="p" inputmode="tel" value="${ct?.phone ?? ''}"></div>
        <div class="field"><label for="e">E-mail <span class="hint">Necessário para convidar</span></label><input id="e" name="e" type="email" maxlength="254" value="${ct?.email ?? ''}"></div></div>
        <fieldset class="field" style="border:0;padding:0"><legend style="font-weight:600;font-size:.9rem">Funções <span class="muted">(escolha pelo menos uma; a primeira marcada é a principal)</span></legend>
          <div class="grid2">${L.roles.filter((r) => r.active || myRoles.has(r.id)).map((r) => html`<label class="check"><input type="checkbox" name="roles" value="${r.id}" ${myRoles.has(r.id) ? 'checked' : ''}>
            <span class="chip"><span class="dot" style="background:${r.color}"></span>${r.name}</span></label>`)}</div></fieldset>
        ${L.teams.length ? html`<fieldset class="field" style="border:0;padding:0"><legend style="font-weight:600;font-size:.9rem">Equipes <span class="muted">(opcional)</span></legend>
          <div class="grid2">${L.teams.map((t) => html`<label class="check"><input type="checkbox" name="teams" value="${t.id}" ${myTeams.has(t.id) ? 'checked' : ''}> ${t.name}</label>`)}</div></fieldset>` : ''}
        <div class="field"><label for="o">Observações <span class="hint">Até 500 caracteres. Só líderes veem.</span></label><textarea id="o" name="o" maxlength="500">${ct?.notes ?? ''}</textarea></div>`,
      onSubmit: async (fd) => {
        const roleIds = fd.getAll('roles');
        if (!roleIds.length) throw new Error('Escolha pelo menos uma função para o integrante.');
        const phone = toE164(fd.get('p'));
        if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Telefone inválido. Use DDD + número, ex.: (65) 99999-0000.');
        await q(sb.rpc('save_member', {
          p_id: m?.id ?? null, p_church: S.church.id, p_name: String(fd.get('n')), p_phone: phone, p_email: String(fd.get('e')),
          p_notes: String(fd.get('o')), p_role_ids: roleIds, p_team_ids: fd.getAll('teams'),
        }));
        return true;
      },
    });
    if (done) { invalidate('members', 'teams', 'contacts'); toast('Integrante salvo.'); render(el, { params: [] }); }
  }

  async function inviteFlow(m) {
    const ct = contacts.get(m.id);
    let code = null;
    const ok = await formDialog({
      title: `Convidar ${m.full_name}`, submitText: 'Gerar convite',
      body: html`<p>Gera um link de uso único, válido por 7 dias. Quem abrir cria a conta e fica ligado(a) a este cadastro.</p>
        ${isAdmin() && myRole === 'owner' ? html`<div class="field"><label for="ir">Acesso</label><select id="ir" name="ir"><option value="member">Integrante</option><option value="admin">Administrador</option></select></div>` : ''}`,
      onSubmit: async (fd) => { code = await q(sb.rpc('create_invite', { p_member_id: m.id, p_role: fd.get('ir') || 'member' })); return true; },
    });
    if (!ok) return;
    const link = `${location.origin}${location.pathname}#/convite/${code}`;
    const msg = `Olá, ${m.full_name.split(' ')[0]}! Você foi convidado(a) para o LouvOrganize (${S.church.name}). Crie sua conta por aqui: ${link} (vale por 7 dias)`;
    const phone = (ct?.phone ?? '').replace(/\D/g, '');
    const dlg = showDialog(html`<form method="dialog"><div class="dlg-body"><h2>Convite gerado</h2>
      <p>Envie este link para ${m.full_name}. <strong>Ele aparece só agora</strong>; se perder, gere outro.</p>
      <input readonly value="${link}" aria-label="Link do convite" id="lk"><p class="small muted">Código: <code>${code}</code></p>
      <div class="row"><button class="btn" type="button" id="cl">Copiar link</button>
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/${phone}?text=${encodeURIComponent(msg)}">Enviar pelo WhatsApp</a></div></div>
      <div class="dlg-foot"><button class="btn primary">Fechar</button></div></form>`);
    dlg.querySelector('#cl').addEventListener('click', () => copyText(link));
    dlg.querySelector('#lk').addEventListener('focus', (e) => e.target.select());
    invalidate('members'); drawTable();
  }

  async function csvFlow() {
    const roleByName = new Map(L.roles.filter((r) => r.active).map((r) => [norm(r.name), r]));
    let parsed = [];
    await formDialog({
      title: 'Importar integrantes por CSV', wide: true, submitText: 'Importar linhas válidas',
      body: html`<p>Colunas: <code>nome</code>, <code>email</code>, <code>telefone</code>, <code>funcoes</code> (várias separadas por <code>|</code>, ex.: <code>Vocal|Violão</code>). Primeira linha = cabeçalho.</p>
        <div class="field"><label for="csvf">Arquivo .csv</label><input id="csvf" type="file" accept=".csv,text/csv"></div>
        <div id="prev"></div>`,
      onOpen: (dlg) => {
        dlg.querySelector('#csvf').addEventListener('change', async (e) => {
          const file = e.target.files[0]; if (!file) return;
          const rows = parseCsv(await file.text());
          const head = rows.shift()?.map((h) => norm(h)) ?? [];
          const idx = (...names) => head.findIndex((h) => names.includes(h));
          const [iN, iE, iT, iF] = [idx('nome', 'name'), idx('email', 'e-mail'), idx('telefone', 'celular', 'whatsapp'), idx('funcoes', 'funcao', 'funcões')];
          if (iN < 0 || iF < 0) { dlg.querySelector('#prev').innerHTML = '<div class="alert bad">Não achei as colunas “nome” e “funcoes” no cabeçalho.</div>'; parsed = []; return; }
          const seen = new Set(L.members.filter((m) => !m.deleted_at).map((m) => norm(m.full_name)));
          parsed = rows.map((r, n) => {
            const name = (r[iN] ?? '').trim(); const errs = [];
            const roleNames = (r[iF] ?? '').split('|').map((x) => x.trim()).filter(Boolean);
            const roles = roleNames.map((x) => roleByName.get(norm(x)));
            if (name.length < 3) errs.push('nome curto');
            if (seen.has(norm(name))) errs.push('já cadastrado'); else seen.add(norm(name));
            if (!roleNames.length) errs.push('sem função');
            roleNames.forEach((x, i) => { if (!roles[i]) errs.push(`função “${x}” não existe`); });
            const phone = toE164(iT >= 0 ? r[iT] : '');
            if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) errs.push('telefone inválido');
            return { line: n + 2, name, email: iE >= 0 ? (r[iE] ?? '').trim() : '', phone, roles: roles.filter(Boolean), errs };
          });
          const bad = parsed.filter((p) => p.errs.length).length;
          dlg.querySelector('#prev').innerHTML = toStr(html`<div class="alert ${bad ? 'warn' : 'ok'}">${parsed.length - bad} linha(s) válida(s), ${bad} com erro.</div>
            <div class="tablewrap"><table><thead><tr><th>Linha</th><th>Nome</th><th>Funções</th><th>Situação</th></tr></thead><tbody>
            ${parsed.map((p) => html`<tr><td>${p.line}</td><td>${p.name}</td><td>${p.roles.map((r) => r.name).join(', ')}</td>
              <td>${p.errs.length ? html`<span class="chip bad">${p.errs.join('; ')}</span>` : html`<span class="chip ok">ok</span>`}</td></tr>`)}</tbody></table></div>`);
        });
      },
      onSubmit: async () => {
        const good = parsed.filter((p) => !p.errs.length);
        if (!good.length) throw new Error('Nenhuma linha válida para importar.');
        let n = 0;
        for (const p of good) {
          await q(sb.rpc('save_member', { p_id: null, p_church: S.church.id, p_name: p.name, p_phone: p.phone, p_email: p.email, p_notes: '', p_role_ids: p.roles.map((r) => r.id), p_team_ids: [] }));
          n++;
        }
        toast(`${n} integrante(s) importado(s).`); return true;
      },
    }) && (invalidate('members', 'contacts'), render(el, { params: [] }));
  }

  actions(el, {
    sort: (b) => { toggleSort(st, b.dataset.key); drawTable(); },
    new: () => memberForm(null),
    edit: (b) => memberForm(L.memberById.get(b.dataset.id)),
    invite: (b) => inviteFlow(L.memberById.get(b.dataset.id)),
    csv: csvFlow,
    restore: async (b) => { try { await q(sb.rpc('restore_member', { p_id: b.dataset.id })); invalidate('members'); toast('Integrante restaurado.'); render(el, { params: [] }); } catch (e) { toast(e.message, 'bad'); } },
    archive: async (b) => {
      const m = L.memberById.get(b.dataset.id);
      if (!(await confirmDialog({ title: 'Arquivar integrante?', danger: true, confirmText: 'Arquivar',
        message: html`<p><strong>${m.full_name}</strong> sai das equipes e das listas de escolha. O nome continua nas escalas passadas. Você pode restaurar depois.</p>` }))) return;
      try {
        const r = await q(sb.rpc('archive_member', { p_id: m.id }));
        if (!r.ok) {
          await infoDialog({ title: 'Não dá para arquivar agora', body: html`<p><strong>${m.full_name}</strong> ainda está em escalas futuras. Substitua a pessoa nelas primeiro:</p>
            <ul>${r.events.map((e) => html`<li><a href="#/escalas/${e.event_id}">${evName(e)}</a> — ${evWhen(e)} (${statusLabel(e.status)})</li>`)}</ul>` });
          return;
        }
        invalidate('members', 'teams'); toast('Integrante arquivado.'); render(el, { params: [] });
      } catch (e) { toast(e.message, 'bad'); }
    },
  });
  actions(el, {
    search: (i) => { st.q = i.value; drawTable(); },
    flt: (s) => { st[s.dataset.k] = s.value; drawTable(); },
    access: async (s) => {
      try { await q(sb.from('memberships').update({ role: s.value }).eq('church_id', S.church.id).eq('user_id', s.dataset.uid)); access.set(s.dataset.uid, s.value); toast('Acesso atualizado.'); }
      catch (e) { toast(e.message, 'bad'); drawTable(); }
    },
  }, 'change');
  actions(el, { search: (i) => { st.q = i.value; drawTable(); } }, 'input');
}

const statusLabel = (s) => ({ pending: 'pendente', confirmed: 'confirmado', expired: 'sem resposta' }[s] ?? s);

async function profile(el, L, id) {
  const m = L.memberById.get(id);
  if (!m) { el.innerHTML = toStr(empty('Integrante não encontrado', '', html`<a class="btn" href="#/integrantes">Voltar</a>`)); return; }
  const [rows, loads, contacts] = await Promise.all([
    q(sb.from('assignments').select('*, events!inner(*)').eq('member_id', id).is('events.deleted_at', null)),
    q(sb.rpc('member_loads', { p_church: S.church.id })),
    getContacts(),
  ]);
  rows.sort((a, b) => b.events.starts_at.localeCompare(a.events.starts_at));
  const real = rows.filter((r) => !['replaced', 'cancelled'].includes(r.status));
  const ok = real.filter((r) => ['confirmed', 'closed'].includes(r.status)).length;
  const answered = real.filter((r) => ['confirmed', 'closed', 'declined', 'expired'].includes(r.status)).length;
  const byRole = new Map(); real.forEach((r) => byRole.set(r.role_id, (byRole.get(r.role_id) ?? 0) + 1));
  const load = loads.find((l) => l.member_id === id)?.load60 ?? 0;
  const c = contacts.get(id);
  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>${m.full_name}</h1>
      <p class="muted">${m.deleted_at ? 'Arquivado' : m.user_id ? 'Com conta' : 'Sem conta'}${c?.phone ? ' · ' + c.phone : ''}${c?.email ? ' · ' + c.email : ''}</p></div>
      <div class="actions"><a class="btn" href="#/integrantes">Voltar</a></div></div>
    <div class="cards">
      <div class="card"><h2>Resumo</h2><ul class="list">
        <li><span class="grow">Escalas nos últimos 60 dias</span><strong>${load}</strong></li>
        <li><span class="grow">Taxa de confirmação</span><strong>${answered ? Math.round((ok / answered) * 100) + '%' : '—'}</strong></li>
        <li><span class="grow">Total de escalações</span><strong>${real.length}</strong></li></ul>
        <h3>Funções mais exercidas</h3>
        ${byRole.size ? html`<div class="chips">${[...byRole].sort((a, b) => b[1] - a[1]).map(([r, n]) => html`<span class="chip"><span class="dot" style="background:${L.roleById.get(r)?.color}"></span>${L.roleById.get(r)?.name} · ${n}</span>`)}</div>` : html`<p class="muted">Ainda sem histórico.</p>`}
        ${c?.notes ? html`<h3>Observações</h3><p>${c.notes}</p>` : ''}</div>
      <div class="card"><h2>Histórico de escalas</h2>
        ${rows.length ? html`<ul class="list">${rows.slice(0, 30).map((r) => html`<li><div class="grow"><a href="#/escalas/${r.event_id}">${evName(r.events)}</a><br>
          <span class="muted small">${evWhen(r.events)} · ${L.roleById.get(r.role_id)?.name}</span></div>${statusChip(r.status)}</li>`)}</ul>` : html`<p class="muted">Nunca foi escalado(a).</p>`}</div></div>`);
}
