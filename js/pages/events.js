// Lista de escalas (RF-501): ordenada por data real, agrupada por mês, passadas recolhidas.
import { sb, q, S, tz, isManager, lookups } from '../lib/api.js';
import { html, toStr, actions, empty, eventChip, coverage, coverageBar, KIND } from '../lib/ui.js';
import { evName, loadRoster } from '../lib/shared.js';
import { fmtDate, fmtTime, fmtWeekday, ymOf, monthLabel, addDays, todayIn } from '../lib/time.js';

export default async function render(el, { query }) {
  const mgr = isManager();
  const f = { team: query.team ?? '', kind: query.kind ?? '', from: query.from ?? addDays(todayIn(tz()), -60), to: query.to ?? '' };
  const L = await lookups();

  let req = sb.from('events').select('*, setlist_items(count)').eq('church_id', S.church.id).is('deleted_at', null)
    .gte('starts_at', `${f.from}T00:00:00Z`).order('starts_at');
  if (f.to) req = req.lte('starts_at', `${addDays(f.to, 1)}T00:00:00Z`);
  if (f.team) req = req.eq('team_id', f.team);
  if (f.kind) req = req.eq('kind', f.kind);
  const events = await q(req);
  const rosters = await loadRoster(events.map((e) => e.id));

  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.starts_at).getTime() + 4 * 3600e3 > now);
  const past = events.filter((e) => !upcoming.includes(e)).reverse();

  const row = (e) => {
    const t = L.teamById.get(e.team_id);
    const cov = coverage(rosters.get(e.id) ?? []);
    const n = e.setlist_items?.[0]?.count ?? 0;
    return html`<tr>
      <td class="nowrap"><a href="#/escalas/${e.id}"><strong>${fmtDate(e.starts_at, tz())}</strong></a><br>
        <span class="muted small">${fmtWeekday(e.starts_at, tz())} ${fmtTime(e.starts_at, tz())}</span></td>
      <td><span class="chip"><span class="dot" style="background:${KIND_COLORS[e.kind]}"></span>${KIND[e.kind]}</span></td>
      <td>${e.kind === 'evento' ? e.title : e.title ?? ''}</td>
      <td>${t ? html`<a href="#/equipes/${t.id}">${t.name}</a>` : html`<span class="muted">—</span>`}</td>
      <td class="nowrap">${n ? html`<a href="#/escalas/${e.id}?tab=setlist">♪ Setlist (${n})</a>` : html`<span class="muted">♪ —</span>`}</td>
      ${mgr ? html`<td style="min-width:150px">${e.status === 'draft' ? html`<span class="muted small">não publicada</span>` : coverageBar(cov)}</td>` : ''}
      <td>${eventChip(e.status)}</td></tr>`;
  };
  const head = html`<thead><tr><th>Data</th><th>Tipo</th><th>Nome</th><th>Equipe</th><th>Repertório</th>${mgr ? html`<th>Confirmações</th>` : ''}<th>Situação</th></tr></thead>`;
  const table = (list) => {
    const groups = [];
    list.forEach((e) => {
      const ym = ymOf(e.starts_at, tz());
      let g = groups.find((x) => x.ym === ym);
      if (!g) groups.push((g = { ym, items: [] }));
      g.items.push(e);
    });
    return groups.map((g) => html`<div class="month-title">${monthLabel(g.ym)}</div>
      <div class="tablewrap"><table>${head}<tbody>${g.items.map(row)}</tbody></table></div>`);
  };

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>Escalas</h1><p class="muted">${events.length} escala(s) no período</p></div>
      ${mgr ? html`<div class="actions"><a class="btn primary" href="#/escalas/nova">+ Cadastrar escala</a></div>` : ''}</div>
    <form class="filters" id="flt">
      <div><label for="f-team">Equipe</label><select id="f-team" name="team"><option value="">Todas</option>
        ${L.teams.map((t) => html`<option value="${t.id}" ${f.team === t.id ? 'selected' : ''}>${t.name}</option>`)}</select></div>
      <div><label for="f-kind">Tipo</label><select id="f-kind" name="kind"><option value="">Todos</option>
        ${Object.entries(KIND).map(([k, v]) => html`<option value="${k}" ${f.kind === k ? 'selected' : ''}>${v}</option>`)}</select></div>
      <div><label for="f-from">De</label><input id="f-from" type="date" name="from" value="${f.from}"></div>
      <div><label for="f-to">Até</label><input id="f-to" type="date" name="to" value="${f.to}"></div>
    </form>
    ${upcoming.length ? table(upcoming) : empty('Nenhuma escala encontrada',
        mgr ? 'Cadastre a primeira escala ou ajuste os filtros.' : 'Quando o líder publicar escalas, elas aparecem aqui.',
        mgr ? html`<a class="btn primary" href="#/escalas/nova">+ Cadastrar escala</a>` : '')}
    ${past.length ? html`<details style="margin-top:1.5rem"><summary><strong>Escalas passadas (${past.length})</strong></summary>${table(past)}</details>` : ''}`);

  el.querySelector('#flt').addEventListener('change', (e) => {
    const fd = new FormData(e.currentTarget);
    const p = new URLSearchParams([...fd].filter(([, v]) => v));
    location.hash = '#/escalas' + (p.toString() ? '?' + p : '');
  });
  actions(el, {});
}

const KIND_COLORS = { culto: '#7A1F3D', evento: '#2F5D62', ensaio: '#B8860B' };
