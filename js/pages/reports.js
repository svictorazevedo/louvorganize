// Relatório de distribuição (RF-905): quem serviu quanto, por integrante e por função.
import { sb, q, S, tz, lookups } from '../lib/api.js';
import { html, toStr, actions, empty, sortRows, sortTh, toggleSort, download } from '../lib/ui.js';
import { addDays, todayIn } from '../lib/time.js';
import { toCsv } from '../lib/csv.js';

export default async function render(el, { query }) {
  const L = await lookups();
  const from = query.from ?? addDays(todayIn(tz()), -90);
  const to = query.to ?? todayIn(tz());
  const rows = await q(sb.from('assignments').select('member_id, role_id, status, attended, events!inner(starts_at, status, deleted_at)')
    .eq('church_id', S.church.id).is('events.deleted_at', null).in('events.status', ['published', 'closed'])
    .gte('events.starts_at', `${from}T00:00:00Z`).lt('events.starts_at', `${addDays(to, 1)}T00:00:00Z`)
    .not('status', 'in', '(replaced,cancelled)'));

  const per = new Map(); const perRole = new Map();
  for (const r of rows) {
    const m = per.get(r.member_id) ?? { member_id: r.member_id, total: 0, ok: 0, declined: 0, absent: 0 };
    m.total++;
    if (['confirmed', 'closed'].includes(r.status)) m.ok++;
    if (r.status === 'declined') m.declined++;
    if (r.attended === false) m.absent++;
    per.set(r.member_id, m);
    perRole.set(r.role_id, (perRole.get(r.role_id) ?? 0) + 1);
  }
  // quem ficou de fora do período aparece com zero (ociosidade)
  L.members.filter((m) => !m.deleted_at && !per.has(m.id)).forEach((m) => per.set(m.id, { member_id: m.id, total: 0, ok: 0, declined: 0, absent: 0 }));
  const data = [...per.values()].map((x) => ({ ...x, name: L.memberById.get(x.member_id)?.full_name ?? '?' }));
  const max = Math.max(1, ...data.map((d) => d.total));
  const st = { key: 'total', dir: 'desc' };

  const draw = () => {
    const sorted = sortRows(data, st.key, st.dir);
    el.querySelector('#tbl').innerHTML = toStr(data.length ? html`<div class="tablewrap"><table><thead><tr>
      ${sortTh('Integrante', 'name', st)}${sortTh('Escalas', 'total', st)}<th scope="col">Distribuição</th>${sortTh('Confirmadas', 'ok', st)}${sortTh('Recusas', 'declined', st)}${sortTh('Faltas', 'absent', st)}</tr></thead><tbody>
      ${sorted.map((d) => html`<tr><td><a href="#/integrantes/${d.member_id}">${d.name}</a></td><td><strong>${d.total}</strong></td>
        <td style="min-width:140px"><div class="bar ${d.total === 0 ? 'low' : ''}" role="img" aria-label="${d.total} escalas"><span style="width:${Math.round((d.total / max) * 100)}%"></span></div></td>
        <td>${d.ok}</td><td>${d.declined}</td><td>${d.absent}</td></tr>`)}</tbody></table></div>` : empty('Sem dados no período', 'Ajuste as datas.'));
  };

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>Relatórios</h1><p class="muted">Distribuição do serviço, para equilibrar a carga e achar quem está ocioso.</p></div>
      <div class="actions"><button class="btn" data-act="csv">Baixar CSV</button></div></div>
    <form class="filters" id="f"><div><label for="a">De</label><input id="a" type="date" name="from" value="${from}"></div>
      <div><label for="b">Até</label><input id="b" type="date" name="to" value="${to}"></div></form>
    <div id="tbl"></div>
    <h2>Por função</h2>
    ${perRole.size ? html`<div class="chips">${[...perRole].sort((a, b) => b[1] - a[1]).map(([r, n]) => html`<span class="chip"><span class="dot" style="background:${L.roleById.get(r)?.color}"></span>${L.roleById.get(r)?.name}: ${n}</span>`)}</div>` : html`<p class="muted">Sem dados.</p>`}`);
  draw();
  el.querySelector('#f').addEventListener('change', (e) => {
    const fd = new FormData(e.currentTarget);
    location.hash = `#/relatorios?from=${fd.get('from') || from}&to=${fd.get('to') || to}`;
  });
  actions(el, {
    sort: (b) => { toggleSort(st, b.dataset.key); draw(); },
    csv: () => download(`distribuicao-${from}-${to}.csv`, toCsv([['Integrante', 'Escalas', 'Confirmadas', 'Recusas', 'Faltas'], ...sortRows(data, 'name', 'asc').map((d) => [d.name, d.total, d.ok, d.declined, d.absent])]), 'text/csv'),
  });
}
