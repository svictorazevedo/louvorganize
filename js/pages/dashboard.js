// Início: o que exige ação agora (§12 — tela mais importante para o líder).
import { sb, q, S, tz, isManager, lookups } from '../lib/api.js';
import { html, toStr, actions, empty, statusChip, coverage, coverageBar, eventChip, toast, icon } from '../lib/ui.js';
import { toLocalParts, fmtWeekday, fmtTime } from '../lib/time.js';
import { evName, evWhen, loadRoster, confirmAssignment, declineFlow, substituteFlow } from '../lib/shared.js';

export default async function render(el) {
  const nowIso = new Date().toISOString();
  const L = await lookups();
  const mgr = isManager();

  const [mine, upcoming, problems] = await Promise.all([
    S.me
      ? q(sb.from('assignments').select('*, events!inner(*)').eq('member_id', S.me.id)
          .in('status', ['pending', 'expired', 'confirmed']).eq('events.status', 'published')
          .is('events.deleted_at', null).gt('events.starts_at', nowIso))
      : [],
    q(sb.from('events').select('*, setlist_items(count)').eq('church_id', S.church.id).is('deleted_at', null)
      .in('status', mgr ? ['draft', 'published'] : ['published']).gt('starts_at', nowIso).order('starts_at').limit(6)),
    mgr
      ? q(sb.from('assignments').select('*, events!inner(*)').in('status', ['declined', 'expired'])
          .eq('events.status', 'published').is('events.deleted_at', null).gt('events.starts_at', nowIso))
      : [],
  ]);
  mine.sort((a, b) => a.events.starts_at.localeCompare(b.events.starts_at));
  problems.sort((a, b) => a.events.starts_at.localeCompare(b.events.starts_at));
  const rosters = await loadRoster(upcoming.map((e) => e.id));
  const noSetlist = upcoming.filter((e) => e.status === 'published' && (e.setlist_items?.[0]?.count ?? 0) === 0);
  const memberName = (id) => L.memberById.get(id)?.full_name ?? '—';
  const roleName = (id) => L.roleById.get(id)?.name ?? '—';

  const firstRun = mgr && L.members.filter((m) => !m.deleted_at).length <= 1 && L.teams.length === 0 && upcoming.length === 0;

  const toAnswer = mine.filter((a) => a.status !== 'confirmed').length;
  const hour = +new Intl.DateTimeFormat('en-US', { timeZone: tz(), hour: 'numeric', hourCycle: 'h23' }).format(new Date());
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const today = new Intl.DateTimeFormat('pt-BR', { timeZone: tz(), weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  el.innerHTML = toStr(html`
    <div class="page-head hero"><div class="grow"><div class="date">${today}</div>
      <h1>${hello}${S.me ? ', ' + S.me.full_name.split(' ')[0] : ''}!</h1></div>
      ${mgr ? html`<div class="actions"><a class="btn primary" href="#/escalas/nova">${icon('plus', 18)} Nova escala</a></div>` : ''}</div>

    <div class="stats">
      ${S.me ? html`<a class="stat ${toAnswer ? 'hot' : ''}" href="#/minhas"><span class="n">${toAnswer}</span><span class="l">${icon('check', 16)} Para eu responder</span></a>` : ''}
      ${mgr ? html`<button type="button" class="stat ${problems.length ? 'hot' : ''}" data-act="scroll" data-to="h-pend"><span class="n">${problems.length}</span><span class="l">${icon('alert', 16)} Pendências do líder</span></button>` : ''}
      <a class="stat" href="#/escalas"><span class="n">${upcoming.filter((e) => e.status === 'published').length}</span><span class="l">${icon('calendar', 16)} Próximas escalas</span></a>
      ${mgr && noSetlist.length ? html`<button type="button" class="stat" data-act="scroll" data-to="h-noset"><span class="n">${noSetlist.length}</span><span class="l">${icon('music', 16)} Sem repertório</span></button>` : ''}
    </div>

    ${firstRun ? html`<div class="card"><h2>Vamos começar?</h2>
      <p>Siga esta ordem — cada passo depende do anterior:</p>
      <ol>
        <li><a href="#/funcoes">Funções</a>: já criamos as mais comuns (Vocal, Violão, Bateria…). Ajuste se precisar.</li>
        <li><a href="#/integrantes">Integrantes</a>: cadastre quem serve no ministério.</li>
        <li><a href="#/equipes/nova">Equipes</a>: monte os grupos fixos (opcional, mas acelera as escalas).</li>
        <li><a href="#/escalas/nova">Escala</a>: crie a primeira e publique.</li>
      </ol></div>` : ''}

    ${mine.length ? html`<section class="card" aria-labelledby="h-mine"><h2 id="h-mine">Minhas próximas escalas</h2>
      <ul class="list" id="mine">${mine.slice(0, 5).map((a) => html`<li>
        <span class="when"><b>${+toLocalParts(a.events.starts_at, tz()).date.slice(8)}</b><small>${fmtWeekday(a.events.starts_at, tz())}</small></span>
        <div class="grow"><strong>${evName(a.events)}</strong> ${statusChip(a.status)}<br>
          <span class="muted">${evWhen(a.events)} · ${roleName(a.role_id)}</span></div>
        <div class="actions">
          ${a.status !== 'confirmed' ? html`<button class="btn ok sm" data-act="confirm" data-id="${a.id}">Confirmar</button>` : ''}
          <button class="btn sm danger" data-act="decline" data-id="${a.id}">Não posso</button>
        </div></li>`)}</ul>
      ${mine.length > 5 ? html`<p><a href="#/minhas">Ver todas (${mine.length})</a></p>` : ''}</section>` : ''}

    ${mgr ? html`<section class="card" aria-labelledby="h-pend"><h2 id="h-pend">Pendências do líder</h2>
      ${problems.length ? html`<ul class="list" id="problems">${problems.map((a) => html`<li>
          <div class="grow"><strong>${memberName(a.member_id)}</strong> · ${roleName(a.role_id)} ${statusChip(a.status)}<br>
            <span class="muted">${evName(a.events)} — ${evWhen(a.events)}</span>
            ${a.status === 'declined' && a.decline_reason ? html`<br><span class="small">“${a.decline_reason}”</span>` : ''}
            ${a.status === 'declined' && a.suggested_substitute_id ? html`<br><span class="small muted">Sugeriu: ${memberName(a.suggested_substitute_id)}</span>` : ''}</div>
          <div class="actions">
            <button class="btn sm primary" data-act="sub" data-id="${a.id}">Buscar substituto</button>
            ${a.status === 'expired' ? html`<button class="btn sm" data-act="confirm-for" data-id="${a.id}">Confirmar por ele(a)</button>` : ''}
            <a class="btn sm" href="#/escalas/${a.event_id}">Abrir escala</a>
          </div></li>`)}</ul>`
        : empty('Nada pendente 🎉', 'Nenhuma recusa nem falta de resposta nas próximas escalas.')}</section>` : ''}

    <section aria-labelledby="h-next"><h2 id="h-next">Próximas escalas</h2>
      ${upcoming.length ? html`<div class="cards">${upcoming.slice(0, 4).map((e) => {
        const cov = coverage(rosters.get(e.id) ?? []);
        const t = L.teamById.get(e.team_id);
        const d = toLocalParts(e.starts_at, tz()).date;
        return html`<div class="card"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">
            <span class="when"><b>${+d.slice(8)}</b><small>${fmtWeekday(e.starts_at, tz())}</small></span>
            <div class="grow"><strong><a href="#/escalas/${e.id}">${evName(e)}</a></strong>
              <div class="muted small">${fmtTime(e.starts_at, tz())}${t ? html` · ${t.name}` : ''} · ♪ ${e.setlist_items?.[0]?.count ?? 0}</div></div>
            ${e.status !== 'published' ? eventChip(e.status) : ''}</div>
          ${mgr && e.status === 'published' ? html`<div style="margin-top:.75rem">${coverageBar(cov)}</div>` : ''}</div>`;
      })}</div>`
        : empty('Nenhuma escala à frente', mgr ? 'Crie a próxima escala para começar.' : 'Quando o líder publicar, ela aparece aqui.',
            mgr ? html`<a class="btn primary" href="#/escalas/nova">+ Nova escala</a>` : '')}
    </section>

    ${mgr && noSetlist.length ? html`<section class="card" style="margin-top:1rem"><h2 id="h-noset">Escalas sem repertório</h2><ul class="list">
      ${noSetlist.map((e) => html`<li><div class="grow"><a href="#/escalas/${e.id}">${evName(e)}</a> <span class="muted">· ${evWhen(e)}</span></div>
        <a class="btn sm" href="#/escalas/${e.id}">Montar setlist</a></li>`)}</ul></section>` : ''}
    `);

  const byId = new Map([...mine, ...problems].map((a) => [a.id, a]));
  actions(el, {
    scroll: (b) => document.getElementById(b.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    confirm: async (b) => { b.disabled = true; try { await confirmAssignment(b.dataset.id); render(el); } catch (e) { toast(e.message, 'bad'); b.disabled = false; } },
    'confirm-for': async (b) => { b.disabled = true; try { await confirmAssignment(b.dataset.id); render(el); } catch (e) { toast(e.message, 'bad'); b.disabled = false; } },
    decline: async (b) => { if (await declineFlow(byId.get(b.dataset.id))) render(el); },
    sub: async (b) => {
      const a = byId.get(b.dataset.id);
      if (await substituteFlow(a, `${memberName(a.member_id)} — ${evName(a.events)}, ${evWhen(a.events)}`)) render(el);
    },
  });
}
