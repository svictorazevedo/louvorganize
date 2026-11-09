// Calendário (RF-700): mês e lista, popover com elenco, cobertura para líderes.
import { sb, q, S, tz, isManager, lookups } from '../lib/api.js';
import { html, toStr, actions, empty, coverage, KIND, KIND_COLOR, showDialog, eventChip, download } from '../lib/ui.js';
import { evName, loadRoster } from '../lib/shared.js';
import { toLocalParts, fmtTime, fmtDate, fmtWeekday, monthLabel, addMonthKey, addDays, todayIn } from '../lib/time.js';
import { buildIcs } from '../lib/ics.js';

const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MARK = { confirmed: '✔ confirmado', closed: '✔ presente', pending: '… pendente', expired: '! sem resposta', declined: '✕ recusou' };

export default async function render(el, { query }) {
  const mgr = isManager();
  const today = todayIn(tz());
  const ym = /^\d{4}-\d{2}$/.test(query.m ?? '') ? query.m : today.slice(0, 7);
  const view = query.v ?? (window.innerWidth <= 720 ? 'list' : 'month');
  const f = { team: query.team ?? '', kind: query.kind ?? '' };
  const L = await lookups();

  // grade de 6 semanas começando no domingo
  const first = `${ym}-01`;
  const dow = new Date(first + 'T00:00:00Z').getUTCDay();
  const gridStart = addDays(first, -dow);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const gridEnd = addDays(gridStart, 42);

  let req = sb.from('events').select('*, setlist_items(count)').eq('church_id', S.church.id).is('deleted_at', null)
    .gte('starts_at', `${addDays(gridStart, -1)}T00:00:00Z`).lt('starts_at', `${addDays(gridEnd, 1)}T00:00:00Z`).order('starts_at');
  if (f.team) req = req.eq('team_id', f.team);
  if (f.kind) req = req.eq('kind', f.kind);
  const all = await q(req);
  const events = all.filter((e) => days.includes(toLocalParts(e.starts_at, tz()).date));
  const rosters = await loadRoster(events.map((e) => e.id));
  const byDay = new Map();
  events.forEach((e) => { const d = toLocalParts(e.starts_at, tz()).date; (byDay.get(d) ?? byDay.set(d, []).get(d)).push(e); });
  const inMonth = events.filter((e) => toLocalParts(e.starts_at, tz()).date.startsWith(ym));

  const href = (o) => {
    const p = new URLSearchParams({ m: ym, v: view, ...f, ...o });
    [...p].forEach(([k, v]) => { if (!v) p.delete(k); });
    return '#/calendario?' + p;
  };

  const rosterHtml = (e) => {
    const rows = rosters.get(e.id) ?? [];
    const act = rows.filter((r) => !['replaced', 'cancelled'].includes(r.status));
    if (!act.length) return html`<p class="muted">Ninguém escalado.</p>`;
    const groups = new Map();
    act.forEach((r) => (groups.get(r.role_name) ?? groups.set(r.role_name, []).get(r.role_name)).push(r));
    return html`<ul>${[...groups].map(([role, rs]) => html`<li><strong>${role}:</strong> ${rs.map((r, i) =>
      html`${i ? ', ' : ''}${r.member_name}${mgr && r.status ? html` <span class="muted">(${MARK[r.status] ?? r.status})</span>` : ''}`)}</li>`)}</ul>`;
  };

  const cell = (e) => {
    const t = L.teamById.get(e.team_id); const cov = coverage(rosters.get(e.id) ?? []); const n = e.setlist_items?.[0]?.count ?? 0;
    const label = `${KIND[e.kind]}${e.kind === 'evento' && e.title ? ': ' + e.title : ''}, ${fmtTime(e.starts_at, tz())}${t ? ', ' + t.name : ''}`;
    return html`<button type="button" class="ev ${e.status}" style="border-left-color:${KIND_COLOR[e.kind]}" data-act="open" data-id="${e.id}" aria-label="${label}">
      <b>${KIND[e.kind]} · ${fmtTime(e.starts_at, tz())}${e.status === 'draft' ? ' · rascunho' : ''}${e.status === 'cancelled' ? ' · cancelada' : ''}</b>
      ${e.kind === 'evento' ? html`<span class="t">${e.title}</span>` : ''}
      ${t ? html`<span class="t">${t.name}${mgr && e.status !== 'draft' ? html` <span title="confirmados / escalados">ⓘ ${cov.conf}/${cov.total}</span>` : ''}</span>` : ''}
      ${n ? html`<span class="t">♪ Setlist (${n})</span>` : ''}</button>`;
  };

  const grid = html`<div class="cal-wrap-month" role="group" aria-label="Calendário de ${monthLabel(ym)}"><div class="cal">
    ${DOW.map((d) => html`<div class="dow">${d}</div>`)}
    ${days.map((d) => html`<div class="day ${d.slice(0, 7) !== ym ? 'out' : ''} ${d === today ? 'today' : ''}">
      <span class="num">${+d.slice(8)}</span>${(byDay.get(d) ?? []).map(cell)}</div>`)}</div></div>`;

  const list = html`<div class="${view === 'list' ? '' : 'cal-wrap-list-only'}">${inMonth.length ? html`<ul class="list card" style="padding:.25rem 1rem">
    ${inMonth.map((e) => { const t = L.teamById.get(e.team_id); const cov = coverage(rosters.get(e.id) ?? []);
      return html`<li><div style="min-width:64px;text-align:center"><strong style="font-size:1.3rem">${+toLocalParts(e.starts_at, tz()).date.slice(8)}</strong><br>
          <span class="muted small">${fmtWeekday(e.starts_at, tz())}</span></div>
        <div class="grow"><button type="button" class="btn link" style="text-align:left" data-act="open" data-id="${e.id}"><strong>${evName(e)}</strong></button>
          ${e.status !== 'published' ? eventChip(e.status) : ''}<br>
          <span class="muted">${fmtTime(e.starts_at, tz())}${t ? ' · ' + t.name : ''}${mgr && e.status === 'published' ? ` · ${cov.conf}/${cov.total} confirmados` : ''}${(e.setlist_items?.[0]?.count ?? 0) ? ` · ♪ ${e.setlist_items[0].count}` : ''}</span></div></li>`; })}</ul>`
    : empty('Nada neste mês', mgr ? 'Cadastre uma escala para ela aparecer aqui.' : 'Nenhuma escala publicada neste mês.')}</div>`;

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>${monthLabel(ym)}</h1></div>
      <div class="actions">
        <a class="btn" href="${href({ m: addMonthKey(ym, -1) })}" aria-label="Mês anterior">‹</a>
        <a class="btn" href="${href({ m: today.slice(0, 7) })}">Hoje</a>
        <a class="btn" href="${href({ m: addMonthKey(ym, 1) })}" aria-label="Próximo mês">›</a>
        ${inMonth.length ? html`<button class="btn" data-act="ics">.ics</button>` : ''}
        ${mgr ? html`<a class="btn primary" href="#/escalas/nova">+ Nova escala</a>` : ''}</div></div>
    <div class="filters">
      <div class="tabs" style="margin:0;flex:0 0 auto" role="group" aria-label="Visualização">
        <button type="button" data-act="view" data-v="month" aria-pressed="${String(view === 'month')}" class="cal-wrap-month">Mês</button>
        <button type="button" data-act="view" data-v="list" aria-pressed="${String(view === 'list')}">Lista</button></div>
      <div><label for="ft">Equipe</label><select id="ft" data-act="filter" data-k="team"><option value="">Todas</option>
        ${L.teams.map((t) => html`<option value="${t.id}" ${f.team === t.id ? 'selected' : ''}>${t.name}</option>`)}</select></div>
      <div><label for="fk">Tipo</label><select id="fk" data-act="filter" data-k="kind"><option value="">Todos</option>
        ${Object.entries(KIND).map(([k, v]) => html`<option value="${k}" ${f.kind === k ? 'selected' : ''}>${v}</option>`)}</select></div></div>
    <p class="small muted">Cores indicam o tipo (borda), sempre acompanhadas do nome: ${Object.entries(KIND).map(([k, v]) => html`<span class="chip" style="border-left:4px solid ${KIND_COLOR[k]}">${v}</span> `)}</p>
    ${view === 'month' ? grid : ''}${view === 'list' || window.innerWidth <= 720 ? list : ''}`);

  // ── popover ao passar o mouse / focar ──────────────────────────────────────
  let pop = null;
  const hidePop = () => { pop?.remove(); pop = null; };
  const showPop = (btn) => {
    const e = events.find((x) => x.id === btn.dataset.id); if (!e) return;
    hidePop();
    pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'tooltip');
    pop.innerHTML = toStr(html`<h4>${evName(e)}</h4><div class="muted">${fmtDate(e.starts_at, tz())} ${fmtTime(e.starts_at, tz())}</div>${rosterHtml(e)}`);
    document.body.append(pop);
    const r = btn.getBoundingClientRect(); const w = pop.offsetWidth; const h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    pop.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 4) + 'px';
  };
  el.addEventListener('mouseover', (ev) => { const b = ev.target.closest('.cal .ev'); if (b) showPop(b); });
  el.addEventListener('mouseout', (ev) => { if (ev.target.closest('.cal .ev')) hidePop(); });
  el.addEventListener('focusin', (ev) => { const b = ev.target.closest('.cal .ev'); if (b) showPop(b); });
  el.addEventListener('focusout', hidePop);

  actions(el, {
    open: (b) => {
      hidePop();
      const e = events.find((x) => x.id === b.dataset.id); const t = L.teamById.get(e.team_id);
      const dlg = showDialog(html`<form method="dialog"><div class="dlg-body">
        <h2>${evName(e)} ${eventChip(e.status)}</h2>
        <p class="muted">${fmtWeekday(e.starts_at, tz())}, ${fmtDate(e.starts_at, tz())} às ${fmtTime(e.starts_at, tz())}${e.location ? ' · ' + e.location : ''}${t ? ' · Equipe ' + t.name : ''}</p>
        <h3>Escalados</h3>${rosterHtml(e)}
        <p class="small muted">♪ ${(e.setlist_items?.[0]?.count ?? 0)} música(s) no setlist</p></div>
        <div class="dlg-foot"><button class="btn" value="x">Fechar</button><a class="btn primary" href="#/escalas/${e.id}" data-close>Abrir escala</a></div></form>`);
      dlg.querySelector('[data-close]')?.addEventListener('click', () => dlg.close());
    },
    view: (b) => { location.hash = href({ v: b.dataset.v }); },
    ics: () => download(`escalas-${ym}.ics`, buildIcs(inMonth.filter((e) => e.status === 'published').map((e) => ({
      id: e.id, title: evName(e) + (L.teamById.get(e.team_id) ? ` — ${L.teamById.get(e.team_id).name}` : ''), starts_at: e.starts_at, location: e.location,
    })), S.church.name), 'text/calendar'),
  });
  actions(el, { filter: (s) => { location.hash = href({ [s.dataset.k]: s.value }); } }, 'change');
}
