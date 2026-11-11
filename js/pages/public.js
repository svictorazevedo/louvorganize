// Página pública da igreja (RF-1001..1005): sem login; só nome e função, nunca contato nem status.
import { sb, configured } from '../lib/api.js';
import { html, raw, toStr, actions, empty, KIND, KIND_COLOR, MOMENT, showDialog, icon } from '../lib/ui.js';
import { fmtDate, fmtTime, fmtWeekday, toLocalParts, monthLabel, addMonthKey, addDays, todayIn, ymOf } from '../lib/time.js';
import { weekStartOf, dressCard, dressChip, figures } from '../lib/dress.js';

export default async function render(el, { params, query }) {
  const slug = params[0];
  const { data, error } = await sb.rpc('public_church', { p_slug: slug });
  if (error || !data) {
    el.innerHTML = toStr(html`<div class="auth"><div class="logo">LouvOrganize</div><div class="card"><h1>Página não encontrada</h1>
      <p>Esta igreja não existe ou desativou a página pública.</p><a class="btn" href="#/login">Ir para o início</a></div></div>`);
    return;
  }
  const tz = data.church.timezone;
  document.title = `${data.church.name} — escalas`;
  if (data.church.public_mode === 'link') {
    const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex,nofollow'; document.head.append(m);
  }
  const tab = query.t ?? 'cal';
  const today = todayIn(tz);
  const ym = /^\d{4}-\d{2}$/.test(query.m ?? '') ? query.m : today.slice(0, 7);
  const ev = data.events;
  const evName = (e) => (e.kind === 'evento' ? e.title : e.title ? `${KIND[e.kind]} · ${e.title}` : KIND[e.kind]);
  const dress = new Map((data.dress ?? []).map((d) => [d.week_start, d]));
  const weekOf = (e) => weekStartOf(toLocalParts(e.starts_at, tz).date);
  const dressOf = (e) => dress.get(weekOf(e)) ?? null;
  const dressBlock = (e) => (dressOf(e) ? html`<h4>Vestimenta: ${dressOf(e).name}</h4>${figures(dressOf(e), weekOf(e), 110)}` : '');
  const thisWeek = weekStartOf(today);
  const link = (o) => '#/i/' + slug + '?' + new URLSearchParams({ t: tab, m: ym, ...o });

  const rosterList = (e) => {
    const g = new Map(); e.roster.forEach((r) => (g.get(r.role) ?? g.set(r.role, []).get(r.role)).push(r.name));
    return g.size ? html`<ul>${[...g].map(([r, n]) => html`<li><strong>${r}:</strong> ${n.join(', ')}</li>`)}</ul>` : html`<p class="muted">Equipe a definir.</p>`;
  };
  const setlist = (e) => (e.setlist?.length ? html`<h4>Repertório</h4><ol>${e.setlist.map((s) => html`<li>${s.title}${s.key ? ` (${s.key})` : ''}${s.moment ? html` <span class="muted">· ${MOMENT[s.moment]}</span>` : ''}</li>`)}</ol>` : '');

  let body;
  if (tab === 'cal') {
    const first = `${ym}-01`; const start = addDays(first, -new Date(first + 'T00:00:00Z').getUTCDay());
    const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const by = new Map(); ev.forEach((e) => { const d = toLocalParts(e.starts_at, tz).date; (by.get(d) ?? by.set(d, []).get(d)).push(e); });
    body = html`<div class="page-head"><div class="grow"><h2 style="margin:0">${monthLabel(ym)}</h2></div><div class="actions">
        <a class="btn" href="${link({ m: addMonthKey(ym, -1) })}" aria-label="Mês anterior">‹</a><a class="btn" href="${link({ m: today.slice(0, 7) })}">Hoje</a>
        <a class="btn" href="${link({ m: addMonthKey(ym, 1) })}" aria-label="Próximo mês">›</a></div></div>
      <div class="cal-wrap-month"><div class="cal">${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => html`<div class="dow">${d}</div>`)}
        ${days.map((d) => html`<div class="day ${d.slice(0, 7) !== ym ? 'out' : ''} ${d === today ? 'today' : ''}"><span class="num">${+d.slice(8)}</span>
          ${(by.get(d) ?? []).map((e) => html`<button type="button" class="ev" style="border-left-color:${KIND_COLOR[e.kind]}" data-act="open" data-id="${e.id}">
            <b>${KIND[e.kind]} · <span class="tm">${fmtTime(e.starts_at, tz)}</span></b>${e.kind === 'evento' ? html`<span class="t">${e.title}</span>` : ''}${e.team ? html`<span class="t">${e.team}</span>` : ''}</button>`)}</div>`)}</div></div>
      <div class="cal-wrap-list-only">${ev.filter((e) => ymOf(e.starts_at, tz) === ym).map((e) => html`<div class="card"><strong>${evName(e)}</strong><br>
        <span class="muted">${fmtDate(e.starts_at, tz)} · ${fmtTime(e.starts_at, tz)}${e.team ? ' · ' + e.team : ''}</span> ${dressChip(dressOf(e))}${rosterList(e)}${setlist(e)}</div>`)}</div>`;
  } else if (tab === 'teams') {
    body = data.teams.length ? html`<div class="cards">${data.teams.map((t) => html`<div class="card"><h2><span class="dot lg" style="background:${t.color}"></span> ${t.name}</h2>
      <ul class="list">${t.members.map((m) => html`<li><span class="grow">${m.name}</span><span class="muted">${m.role}</span></li>`)}</ul></div>`)}</div>` : empty('Nenhuma equipe', '');
  } else {
    const up = ev.filter((e) => new Date(e.starts_at).getTime() + 4 * 3600e3 > Date.now());
    body = up.length ? html`${up.map((e) => html`<div class="card"><h2 style="margin-top:0">${evName(e)}</h2>
      <p class="muted">${fmtWeekday(e.starts_at, tz)}, ${fmtDate(e.starts_at, tz)} às ${fmtTime(e.starts_at, tz)}${e.location ? ' · ' + e.location : ''}${e.team ? ' · Equipe ' + e.team : ''}</p>
      ${dressOf(e) ? html`<p>${dressChip(dressOf(e))}</p>` : ''}${rosterList(e)}${setlist(e)}</div>`)}` : empty('Nenhuma escala publicada', 'Volte em breve.');
  }

  el.innerHTML = toStr(html`<main style="max-width:980px;margin:0 auto;padding:24px 16px 40px">
    <header class="page-head"><div class="grow row" style="flex-wrap:nowrap;gap:.85rem">
      <span class="brand-mark" style="width:48px;height:48px;border-radius:14px">${icon('note', 26)}</span>
      <div style="min-width:0"><h1>${data.church.name}</h1><p class="muted">Escalas do ministério de louvor</p></div></div></header>
    ${dress.has(thisWeek) ? dressCard(dress.get(thisWeek), thisWeek, { size: 120 }) : ''}
    <nav class="tabs" aria-label="Seções">
      ${[['cal', 'Calendário'], ['escalas', 'Escalas'], ['teams', 'Equipes']].map(([k, l]) => html`<a href="${link({ t: k })}" ${tab === k ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>
    ${body}
    <p class="small muted" style="margin-top:2rem">Página pública · mostra apenas nome e função. <a href="#/login">Sou do ministério</a></p></main>`);

  actions(el, {
    open: (b) => {
      const e = ev.find((x) => x.id === b.dataset.id);
      const dlg = showDialog(html`<form method="dialog"><div class="dlg-body"><h2>${evName(e)}</h2>
        <p class="muted">${fmtWeekday(e.starts_at, tz)}, ${fmtDate(e.starts_at, tz)} às ${fmtTime(e.starts_at, tz)}${e.location ? ' · ' + e.location : ''}${e.team ? ' · ' + e.team : ''}</p>
        ${rosterList(e)}${setlist(e)}${dressBlock(e)}</div><div class="dlg-foot"><button class="btn primary">Fechar</button></div></form>`);
      return dlg;
    },
  });
}
