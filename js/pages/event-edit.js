// Escala: cadastro/edição, escalações individuais, painel de status e setlist (RF-500, RF-600, RF-800).
import { sb, q, S, tz, isAdmin, isManager, lookups } from '../lib/api.js';
import {
  html, raw, toStr, esc, actions, empty, statusChip, eventChip, confirmDialog, infoDialog, formDialog, toast,
  KIND, MOMENT, copyText, safeUrl,
} from '../lib/ui.js';
import { evName, evWhen, confirmAssignment, declineFlow, substituteFlow } from '../lib/shared.js';
import {
  zonedToUtc, toLocalParts, fmtDate, fmtTime, fmtWeekday, addDays, addMonthsKeepWeekday, fmtDuration, fmtTotal, fmtDateTime, todayIn,
} from '../lib/time.js';

const MAX_RECURRENCE = 12;

export default async function render(el, { params, query, go }) {
  const id = params[0] ?? null;
  const L = await lookups();
  const st = { id, ev: null, roster: [], setlist: [], setDirty: false, loads: new Map(), unav: new Map(), recent: new Map(), canEdit: false };

  // ── carga de dados ───────────────────────────────────────────────────────
  async function load() {
    if (!id) {
      st.canEdit = isManager();
      return true;
    }
    st.ev = await q(sb.from('events').select('*').eq('id', id).eq('church_id', S.church.id).maybeSingle());
    if (!st.ev || st.ev.deleted_at) {
      el.innerHTML = toStr(empty('Escala não encontrada', 'Ela pode ter sido excluída ou você não tem acesso.', html`<a class="btn" href="#/escalas">Voltar às escalas</a>`));
      return false;
    }
    st.canEdit = isAdmin() || !!(st.ev.team_id && L.teamById.get(st.ev.team_id)?.leader_id === S.me?.id);
    const day = toLocalParts(st.ev.starts_at, tz()).date;
    const base = new Date(st.ev.starts_at);
    const [roster, items, loads, unav, recent] = await Promise.all([
      q(sb.rpc('event_roster', { p_event_ids: [id] })),
      q(sb.from('setlist_items').select('*').eq('event_id', id).order('position')),
      st.canEdit ? q(sb.rpc('member_loads', { p_church: S.church.id })) : [],
      st.canEdit ? q(sb.from('unavailabilities').select('member_id, reason').eq('church_id', S.church.id).lte('start_date', day).gte('end_date', day)) : [],
      st.canEdit
        ? q(sb.from('setlist_items').select('song_id, event_id, events!inner(starts_at, status, deleted_at)').eq('church_id', S.church.id)
            .in('events.status', ['published', 'closed']).gte('events.starts_at', new Date(base - 21 * 864e5).toISOString())
            .lt('events.starts_at', base.toISOString()).neq('event_id', id))
        : [],
    ]);
    st.roster = roster;
    st.setlist = items.map(({ song_id, key_override, bpm_override, moment }) => ({ song_id, key_override, bpm_override, moment }));
    st.setDirty = false;
    st.loads = new Map(loads.map((r) => [r.member_id, r.load60]));
    st.unav = new Map(unav.map((r) => [r.member_id, r.reason]));
    st.recent = new Map();
    recent.forEach((r) => { const cur = st.recent.get(r.song_id); if (!cur || r.events.starts_at > cur) st.recent.set(r.song_id, r.events.starts_at); });
    return true;
  }

  const isPast = () => st.ev && new Date(st.ev.starts_at) <= Date.now();
  const locked = () => st.ev && ['closed', 'cancelled'].includes(st.ev.status);
  const mName = (mid) => L.memberById.get(mid)?.full_name ?? '—';
  const live = () => st.roster.filter((r) => !['replaced', 'cancelled'].includes(r.status));

  // ── mensagem para colar no WhatsApp (o app não envia notificações) ───────
  function shareText() {
    const e = st.ev; const t = L.teamById.get(e.team_id);
    const byRole = live().map((r) => `• ${r.member_name} — ${r.role_name}`).join('\n');
    const songs = st.setlist.map((s, i) => {
      const sg = L.songById.get(s.song_id);
      const key = s.key_override || sg?.song_key;
      return `${i + 1}. ${sg?.title ?? '?'}${key ? ` (${key})` : ''}`;
    }).join('\n');
    return [`*${evName(e)}* — ${fmtDate(e.starts_at, tz())} (${fmtWeekday(e.starts_at, tz())}) às ${fmtTime(e.starts_at, tz())}`,
      t ? `Equipe: ${t.name}` : '', e.location ? `Local: ${e.location}` : '', '', 'Escalados:', byRole,
      songs ? `\nRepertório:\n${songs}` : '', `\nConfirme sua presença: ${location.origin}${location.pathname}#/minhas`].filter((x) => x !== '').join('\n');
  }
  async function shareDialog(title) {
    const text = shareText();
    const dlg = infoDialog({
      title,
      body: html`<p>Este app <strong>não envia notificações</strong>. Copie a mensagem abaixo e envie no grupo do ministério:</p>
        <textarea readonly rows="9" style="font-family:monospace;font-size:.85rem">${text}</textarea>
        <div class="row" style="margin-top:.5rem">
          <button class="btn" type="button" id="cp">Copiar mensagem</button>
          <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Abrir no WhatsApp</a></div>`,
    });
    setTimeout(() => document.getElementById('cp')?.addEventListener('click', () => copyText(text)), 0);
    return dlg;
  }

  // ── seções ───────────────────────────────────────────────────────────────
  function headerHtml() {
    const e = st.ev;
    if (!e) return html`<div class="page-head"><div class="grow"><h1>Nova escala</h1><p class="muted">Comece pelo rascunho. Nada é visto pelos integrantes até você publicar.</p></div>
      <div class="actions"><a class="btn" href="#/escalas">Cancelar</a></div></div>`;
    return html`<div class="page-head no-print"><div class="grow"><h1>${evName(e)} ${eventChip(e.status)}</h1>
        <p class="muted">${evWhen(e)}${e.location ? ' · ' + e.location : ''}${e.team_id ? html` · <a href="#/equipes/${e.team_id}">${L.teamById.get(e.team_id)?.name ?? ''}</a>` : ''}</p></div>
      <div class="actions">
        ${st.canEdit && e.status === 'draft' ? html`<button class="btn primary" data-act="publish">Publicar</button>` : ''}
        ${st.canEdit && e.status === 'published' ? html`<button class="btn" data-act="share">Mensagem p/ WhatsApp</button><button class="btn danger" data-act="cancel">Cancelar escala</button>` : ''}
        ${st.canEdit && e.status === 'draft' ? html`<button class="btn danger" data-act="delete">Excluir rascunho</button>` : ''}
        <a class="btn" href="#/escalas">Voltar</a></div></div>
      ${e.status === 'cancelled' ? html`<div class="alert bad">Esta escala foi cancelada.</div>` : ''}
      ${e.status === 'closed' ? html`<div class="alert info">Escala encerrada. Registre presença ou falta de cada integrante abaixo.</div>` : ''}`;
  }

  function formHtml() {
    const e = st.ev;
    const p = e ? toLocalParts(e.starts_at, tz()) : { date: addDays(todayIn(tz()), 7), time: '19:00' };
    const kind = e?.kind ?? 'culto';
    const teams = isAdmin() ? L.teams : L.teams.filter((t) => t.leader_id === S.me?.id);
    const dis = locked() ? raw('disabled') : '';
    return html`<form class="card no-print" id="evform" novalidate data-act="save-event">
      <h2>Dados da escala</h2>
      <div class="grid2">
        <div class="field"><label for="d">Data</label><input id="d" name="d" type="date" required value="${p.date}" ${dis}></div>
        <div class="field"><label for="t">Hora</label><input id="t" name="t" type="time" required value="${p.time}" ${dis}></div>
        <div class="field"><label for="k">Tipo</label><select id="k" name="k" data-act="kind" ${dis}>
          ${Object.entries(KIND).map(([k, v]) => html`<option value="${k}" ${kind === k ? 'selected' : ''}>${v}</option>`)}</select></div>
        <div class="field" id="titlefield" ${kind === 'evento' ? '' : raw('hidden')}><label for="title">Nome do evento</label>
          <input id="title" name="title" maxlength="120" minlength="3" value="${e?.title ?? ''}" ${kind === 'evento' ? 'required' : ''} ${dis}></div>
        <div class="field"><label for="loc">Local <span class="hint">Opcional</span></label><input id="loc" name="loc" maxlength="200" value="${e?.location ?? ''}" ${dis}></div>
        <div class="field"><label for="team">Equipe base ${isAdmin() ? '' : html`<span class="hint">Você só pode escolher equipes que lidera</span>`}</label>
          <select id="team" name="team" ${isAdmin() ? '' : 'required'} ${dis}>${isAdmin() ? html`<option value="">Sem equipe (escalar manualmente)</option>` : html`<option value="">Escolha…</option>`}
            ${teams.map((t) => html`<option value="${t.id}" ${e?.team_id === t.id ? 'selected' : ''}>${t.name}</option>`)}</select></div>
      </div>
      ${locked() ? '' : html`<div class="alert info" id="clonebox" ${kind === 'ensaio' ? '' : raw('hidden')}>
        <p style="margin:0 0 .5rem"><strong>Ensaio para qual culto ou evento?</strong> Informe a data para copiar a equipe (integrantes e funções) e o setlist.</p>
        <div class="grid2">
          <div class="field"><label for="cd">Data do culto/evento</label><input id="cd" name="cd" type="date" data-act="clone-date"></div>
          <div class="field"><label for="cs">Culto ou evento</label><select id="cs" name="cs"><option value="">Escolha a data primeiro…</option></select></div>
        </div>
        <div class="row"><button class="btn" type="button" data-act="clone">Clonar equipe e setlist</button>
          <span class="hint small">${e ? 'Quem já está escalado e as músicas já no setlist são mantidos.' : 'A escala de ensaio é salva e as informações são copiadas.'}</span></div>
      </div>`}
      <div class="field"><label for="notes">Observações internas <span class="hint">Não aparecem na página pública</span></label>
        <textarea id="notes" name="notes" maxlength="1000" ${dis}>${e?.notes ?? ''}</textarea></div>
      ${!e ? html`<div class="grid2"><div class="field"><label for="rec">Repetir</label><select id="rec" name="rec">
          <option value="">Não repetir</option><option value="w">Toda semana</option><option value="q">A cada 2 semanas</option><option value="m">Todo mês (mesmo dia da semana)</option></select></div>
        <div class="field"><label for="recn">Quantas ocorrências no total <span class="hint">Máximo ${MAX_RECURRENCE}. Todas ficam como rascunho.</span></label>
          <input id="recn" name="recn" type="number" min="2" max="${MAX_RECURRENCE}" value="4"></div></div>` : ''}
      ${e?.status === 'published' ? html`<div class="alert warn">Se você mudar a <strong>data ou a hora</strong>, todas as confirmações voltam para “pendente”. Os integrantes precisam confirmar de novo.</div>` : ''}
      ${locked() ? '' : html`<div class="actions"><button class="btn primary" type="submit">Salvar</button><a class="btn" href="#/escalas">Cancelar</a></div>`}
    </form>`;
  }

  function assignHtml() {
    const e = st.ev;
    if (!e) return '';
    const rows = st.roster;
    const cnt = (...s) => rows.filter((r) => s.includes(r.status)).length;
    const canAct = st.canEdit && !locked();
    const future = !isPast();
    const members = L.members.filter((m) => !m.deleted_at);
    const shown = rows.filter((r) => st.canEdit ? true : !['replaced', 'cancelled'].includes(r.status));

    const actionsFor = (r) => {
      if (!canAct) return '';
      const b = [];
      if (e.status === 'published' && future) {
        if (r.status === 'pending' || r.status === 'expired') b.push(html`<button class="btn sm" data-act="confirm-for" data-id="${r.assignment_id}">Confirmar por ele(a)</button>`);
        if (['pending', 'expired', 'confirmed'].includes(r.status)) b.push(html`<button class="btn sm" data-act="decline-for" data-id="${r.assignment_id}">Registrar recusa</button>`);
        if (['pending', 'expired', 'confirmed', 'declined'].includes(r.status)) b.push(html`<button class="btn sm primary" data-act="sub" data-id="${r.assignment_id}">Substituir</button>`);
      }
      if (isPast() && ['confirmed', 'closed', 'pending', 'expired'].includes(r.status)) {
        b.push(html`<button class="btn sm ${r.attended === true ? 'ok' : ''}" data-act="att" data-v="1" data-id="${r.assignment_id}">Presente</button>`);
        b.push(html`<button class="btn sm ${r.attended === false ? 'danger' : ''}" data-act="att" data-v="0" data-id="${r.assignment_id}">Faltou</button>`);
      }
      if (!['replaced', 'cancelled'].includes(r.status) && (e.status === 'draft' || future)) b.push(html`<button class="btn sm danger" data-act="remove" data-id="${r.assignment_id}" aria-label="Remover ${r.member_name}">Remover</button>`);
      return b;
    };

    const essentialMissing = L.roles.filter((r) => r.is_essential && r.active && !live().some((x) => x.role_id === r.id));

    return html`<section class="card no-print" id="assign-card" aria-labelledby="h-asg"><div class="row"><h2 id="h-asg" class="grow" style="margin:0">Escalações</h2>
        ${canAct && e.team_id ? html`<button class="btn sm" data-act="apply-team">Aplicar equipe base</button>` : ''}</div>
      ${e.status !== 'draft' || rows.length ? html`<div class="chips" style="margin:.6rem 0">
        <span class="chip ok">${cnt('confirmed', 'closed')} confirmado(s)</span><span class="chip warn">${cnt('pending')} pendente(s)</span>
        <span class="chip bad">${cnt('declined')} recusa(s)</span><span class="chip bad">${cnt('expired')} sem resposta</span>
        ${cnt('replaced') ? html`<span class="chip">${cnt('replaced')} substituído(s)</span>` : ''}</div>` : ''}
      ${st.canEdit && essentialMissing.length ? html`<div class="alert warn">Falta cobrir função essencial: <strong>${essentialMissing.map((r) => r.name).join(', ')}</strong>. Isto é só um alerta — você ainda pode publicar.</div>` : ''}
      ${shown.length ? html`<div class="tablewrap"><table><thead><tr><th>Integrante</th><th>Função</th>${st.canEdit ? html`<th>Situação</th><th></th>` : ''}</tr></thead><tbody>
        ${shown.map((r) => html`<tr><td><strong>${r.member_name}</strong>
            ${st.canEdit && st.loads.has(r.member_id) ? html`<br><span class="muted small">${st.loads.get(r.member_id)} escala(s) em 60 dias</span>` : ''}</td>
          <td><span class="chip"><span class="dot" style="background:${r.role_color}"></span>${r.role_name}</span></td>
          ${st.canEdit ? html`<td>${statusChip(r.status)}${r.attended === true ? html` <span class="chip ok">Presente</span>` : r.attended === false ? html` <span class="chip bad">Faltou</span>` : ''}
            ${r.responded_by_name && r.status !== 'pending' ? html`<br><span class="muted small">por ${r.responded_by_name}</span>` : ''}
            ${r.decline_reason ? html`<br><span class="small">“${r.decline_reason}”</span>` : ''}</td>
            <td><div class="actions">${actionsFor(r)}</div></td>` : ''}</tr>`)}
      </tbody></table></div>` : empty('Ninguém escalado ainda', canAct ? 'Escolha uma equipe base acima ou adicione integrantes abaixo.' : '')}
      ${canAct ? html`<form id="addasg" class="filters" style="margin-top:1rem" data-act="add-asg" novalidate>
        <div><label for="am">Adicionar integrante</label><select id="am" name="m" data-act="pick-member" required><option value="">Escolha…</option>
          ${members.map((m) => html`<option value="${m.id}">${m.full_name}${st.unav.has(m.id) ? ' (indisponível)' : ''}${st.loads.has(m.id) ? ` · ${st.loads.get(m.id)} em 60d` : ''}</option>`)}</select></div>
        <div><label for="ar">Função</label><select id="ar" name="r" required><option value="">Escolha o integrante…</option></select></div>
        <div style="flex:0 0 auto"><button class="btn" type="submit">Adicionar</button></div></form>` : ''}
    </section>`;
  }

  function setlistHtml() {
    const e = st.ev;
    if (!e) return '';
    const canAct = st.canEdit && !locked();
    const total = st.setlist.reduce((n, it) => n + (L.songById.get(it.song_id)?.duration_sec ?? 0), 0);
    const songs = L.songs.filter((s) => s.active);
    return html`<section class="card" id="setlist-card" aria-labelledby="h-set">
      <div class="row"><h2 id="h-set" class="grow" style="margin:0">Setlist${st.setlist.length ? html` <span class="muted small">(${st.setlist.length} · ${total ? fmtTotal(total) : 'duração não informada'})</span>` : ''}</h2>
        <div class="actions no-print">${st.setlist.length ? html`<button class="btn sm" data-act="copy-set">Copiar</button><button class="btn sm" data-act="print-set">Imprimir / PDF</button>` : ''}</div></div>
      ${st.setlist.length ? html`<ol style="padding:0;list-style:none;margin:.75rem 0">${st.setlist.map((it, i) => {
        const sg = L.songById.get(it.song_id); const key = it.key_override || sg?.song_key; const bpm = it.bpm_override || sg?.bpm;
        return html`<li class="setlist-item"><div class="ord">${i + 1}</div><div>
          <div class="row"><strong class="grow">${sg?.title ?? '(música removida)'}</strong>
            ${canAct ? html`<span class="actions no-print">
              <button class="btn sm" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${sg?.title}">↑</button>
              <button class="btn sm" data-act="down" data-i="${i}" ${i === st.setlist.length - 1 ? 'disabled' : ''} aria-label="Descer ${sg?.title}">↓</button>
              <button class="btn sm danger" data-act="rm-song" data-i="${i}" aria-label="Tirar ${sg?.title}">✕</button></span>` : ''}</div>
          <div class="muted small">${sg?.artist ?? ''}${key ? ` · Tom ${key}` : ''}${bpm ? ` · ${bpm} BPM` : ''}${sg?.duration_sec ? ` · ${fmtDuration(sg.duration_sec)}` : ''}${it.moment ? ` · ${MOMENT[it.moment]}` : ''}
            ${safeUrl(sg?.media_url) ? html` · <a href="${safeUrl(sg.media_url)}" target="_blank" rel="noopener">ouvir</a>` : ''}${safeUrl(sg?.chart_url) ? html` · <a href="${safeUrl(sg.chart_url)}" target="_blank" rel="noopener">cifra</a>` : ''}</div>
          ${canAct ? html`<div class="row no-print" style="margin-top:.4rem">
            <div style="width:90px"><label class="sr-only" for="k${i}">Tom nesta escala</label><input id="k${i}" data-act="set-key" data-i="${i}" placeholder="Tom" maxlength="8" value="${it.key_override ?? ''}"></div>
            <div style="width:90px"><label class="sr-only" for="b${i}">BPM nesta escala</label><input id="b${i}" data-act="set-bpm" data-i="${i}" type="number" min="30" max="240" placeholder="BPM" value="${it.bpm_override ?? ''}"></div>
            <div style="flex:1 1 140px"><label class="sr-only" for="m${i}">Momento</label><select id="m${i}" data-act="set-moment" data-i="${i}"><option value="">Momento…</option>
              ${Object.entries(MOMENT).map(([k, v]) => html`<option value="${k}" ${it.moment === k ? 'selected' : ''}>${v}</option>`)}</select></div></div>` : ''}
        </div></li>`;
      })}</ol>` : empty('Setlist vazio', canAct ? 'Adicione músicas da biblioteca abaixo.' : 'O líder ainda não publicou o repertório.')}
      ${canAct ? html`<form id="addsong" class="filters no-print" data-act="add-song" novalidate>
        <div style="flex:3 1 240px"><label for="as">Adicionar música</label><select id="as" name="s" required><option value="">Escolha da biblioteca…</option>
          ${songs.map((s) => html`<option value="${s.id}">${s.title}${s.artist ? ' — ' + s.artist : ''}${s.song_key ? ' (' + s.song_key + ')' : ''}</option>`)}</select></div>
        <div style="flex:0 0 auto"><button class="btn" type="submit">Adicionar</button></div>
        <div style="flex:0 0 auto"><button class="btn primary" type="button" data-act="save-set" ${st.setDirty ? '' : 'disabled'}>Salvar setlist</button></div></form>
        ${!songs.length ? html`<p class="small muted">Sua biblioteca está vazia. Cadastre músicas em <a href="#/musicas">Músicas</a>.</p>` : ''}
        ${st.setDirty ? html`<div class="alert warn">Há alterações no setlist ainda não salvas.</div>` : ''}` : ''}
    </section>`;
  }

  function readonlyHtml() {
    // visão do integrante: sem edição, sem status dos colegas (RF-703)
    return html`${headerHtml()}<section class="card"><h2>Quem está escalado</h2>
      ${live().length ? html`<ul class="list">${live().map((r) => html`<li><span class="grow"><strong>${r.member_name}</strong></span>
        <span class="chip"><span class="dot" style="background:${r.role_color}"></span>${r.role_name}</span></li>`)}</ul>` : '<p class="muted">Ninguém escalado ainda.</p>'}
      ${(() => {
        const mine = S.me && st.roster.find((r) => r.member_id === S.me.id);
        return mine ? html`<div class="alert info">Você está nesta escala como <strong>${mine.role_name}</strong>. Responda em <a href="#/minhas">Minhas escalas</a>.</div>` : '';
      })()}</section>${setlistHtml()}`;
  }

  // ── desenho ──────────────────────────────────────────────────────────────
  function draw() {
    if (!st.canEdit && id) { el.innerHTML = toStr(readonlyHtml()); return; }
    el.innerHTML = toStr(html`<div id="s-head">${headerHtml()}</div><div id="s-form">${formHtml()}</div>
      <div id="s-asg">${assignHtml()}</div><div id="s-set">${setlistHtml()}</div>`);
  }
  const redrawSet = () => { const box = el.querySelector('#s-set'); if (box) box.innerHTML = toStr(setlistHtml()); };

  async function reload() { if (await load()) draw(); }

  // ── utilidades de ação ───────────────────────────────────────────────────
  const asgById = (aid) => st.roster.find((r) => r.assignment_id === aid);
  const asArg = (r) => ({ id: r.assignment_id, role_id: r.role_id, member_id: r.member_id });
  const fail = (e) => toast(e.message || String(e), 'bad');

  // ── ensaio: clonar equipe e setlist de um culto/evento ───────────────────
  async function cloneOptions(date) {
    const from = zonedToUtc(date, '00:00', tz()); const to = zonedToUtc(addDays(date, 1), '00:00', tz());
    const rows = await q(sb.from('events').select('id, kind, title, starts_at, status, team_id').eq('church_id', S.church.id)
      .in('kind', ['culto', 'evento']).is('deleted_at', null).neq('status', 'cancelled')
      .gte('starts_at', from).lt('starts_at', to).order('starts_at'));
    return rows.filter((r) => r.id !== st.id);
  }
  /** Copia escalados (como pendentes) e setlist da escala de origem; mantém o que o destino já tem. */
  async function cloneInto(targetId, sourceId) {
    const cols = 'song_id, key_override, bpm_override, moment';
    const [asg, items, cur] = await Promise.all([
      q(sb.from('assignments').select('member_id, role_id').eq('event_id', sourceId).not('status', 'in', '(declined,replaced,cancelled)')),
      q(sb.from('setlist_items').select(cols).eq('event_id', sourceId).order('position')),
      q(sb.from('setlist_items').select(cols).eq('event_id', targetId).order('position')),
    ]);
    if (asg.length) {
      await q(sb.from('assignments').upsert(asg.map((a) => ({ church_id: S.church.id, event_id: targetId, member_id: a.member_id, role_id: a.role_id, status: 'pending' })),
        { onConflict: 'event_id,member_id,role_id', ignoreDuplicates: true }));
    }
    const have = new Set(cur.map((x) => x.song_id));
    const add = items.filter((x) => !have.has(x.song_id));
    if (add.length) await q(sb.rpc('save_setlist', { p_event: targetId, p_items: [...cur, ...add] }));
    return { people: asg.length, songs: add.length };
  }
  const cloneMsg = (r) => `Copiados do culto/evento: ${r.people} escalação(ões) e ${r.songs} música(s) novas no setlist.`;
  const canUseTeam = (tid) => tid && (isAdmin() || L.teamById.get(tid)?.leader_id === S.me?.id);

  async function cloneNow() {
    const form = el.querySelector('#evform');
    const sid = form.querySelector('#cs').value;
    if (!sid) { toast('Informe a data e escolha o culto ou evento a copiar.', 'bad'); form.querySelector(form.querySelector('#cd').value ? '#cs' : '#cd').focus(); return; }
    if (!st.ev) { if (form.reportValidity()) saveEvent(form); return; }   // novo ensaio: salva e clona
    if (st.setDirty && !(await confirmDialog({ title: 'Descartar alterações do setlist?', confirmText: 'Clonar mesmo assim', danger: true,
      message: html`<p>Há alterações no setlist ainda não salvas. Elas serão perdidas.</p>` }))) return;
    try {
      const src = await q(sb.from('events').select('team_id').eq('id', sid).single());
      if (!st.ev.team_id && canUseTeam(src.team_id)) await q(sb.from('events').update({ team_id: src.team_id }).eq('id', st.ev.id));
      toast(cloneMsg(await cloneInto(st.ev.id, sid)));
      await reload();
    } catch (e) { fail(e); }
  }

  async function saveEvent(form) {
    const fd = new FormData(form);
    const kind = fd.get('k'); const title = String(fd.get('title') ?? '').trim();
    if (kind === 'evento' && title.length < 3) { toast('Para escalas do tipo “Evento”, informe o nome do evento (mínimo 3 letras).', 'bad'); return; }
    let team = fd.get('team') || null;
    const cloneSrc = !st.ev && kind === 'ensaio' ? (fd.get('cs') || null) : null;
    if (cloneSrc && !team) {
      try { const src = await q(sb.from('events').select('team_id').eq('id', cloneSrc).single()); if (canUseTeam(src.team_id)) team = src.team_id; } catch (e) { fail(e); return; }
    }
    const base = {
      church_id: S.church.id, kind, title: kind === 'evento' ? title : null,
      location: String(fd.get('loc')).trim() || null, notes: String(fd.get('notes')).trim() || null, team_id: team,
    };
    const startsAt = zonedToUtc(fd.get('d'), fd.get('t'), tz());
    try {
      if (!st.ev) {
        const rec = fd.get('rec'); const n = rec ? Math.min(MAX_RECURRENCE, Math.max(2, +fd.get('recn') || 2)) : 1;
        const dates = [fd.get('d')];
        for (let i = 1; i < n; i++) dates.push(rec === 'w' ? addDays(fd.get('d'), 7 * i) : rec === 'q' ? addDays(fd.get('d'), 14 * i) : addMonthsKeepWeekday(fd.get('d'), i));
        const recurrence_id = n > 1 ? crypto.randomUUID() : null;
        const created = []; let cloned = null;
        for (const d of dates) {
          const ev = await q(sb.from('events').insert({ ...base, starts_at: zonedToUtc(d, fd.get('t'), tz()), recurrence_id, created_by: S.user.id }).select('id').single());
          if (team) await q(sb.rpc('apply_team', { p_event: ev.id, p_team: team }));
          if (cloneSrc) cloned = await cloneInto(ev.id, cloneSrc);
          created.push(ev.id);
        }
        toast(cloned ? (n > 1 ? `${n} rascunhos criados. ` : 'Rascunho salvo. ') + cloneMsg(cloned)
          : n > 1 ? `${n} rascunhos criados.` : 'Rascunho salvo. Agora ajuste as escalações e o setlist.');
        go(n > 1 ? '/escalas' : '/escalas/' + created[0]);
      } else {
        const timeChanged = startsAt !== new Date(st.ev.starts_at).toISOString();
        if (st.ev.status === 'published' && timeChanged) {
          const ok = await confirmDialog({ title: 'Mudar data ou hora?', confirmText: 'Mudar e reabrir confirmações',
            message: html`<p>Todas as confirmações desta escala voltarão para <strong>pendente</strong>. Lembre de avisar a equipe.</p>` });
          if (!ok) return;
        }
        const teamChanged = (st.ev.team_id ?? null) !== team;
        await q(sb.from('events').update({ ...base, starts_at: startsAt, team_id: st.ev.team_id }).eq('id', st.ev.id));
        if (teamChanged && team) {
          const ok = await confirmDialog({ title: 'Escalar a equipe nova?', confirmText: 'Escalar integrantes',
            message: html`<p>Você trocou a equipe base para <strong>${L.teamById.get(team)?.name}</strong>. Quer escalar os integrantes dela agora? (Quem já está escalado é mantido.)</p>` });
          if (ok) await q(sb.rpc('apply_team', { p_event: st.ev.id, p_team: team }));
          else await q(sb.from('events').update({ team_id: team }).eq('id', st.ev.id));
        } else if (teamChanged) await q(sb.from('events').update({ team_id: null }).eq('id', st.ev.id));
        toast('Escala salva.');
        await reload();
      }
    } catch (e) { fail(e); }
  }

  async function addAssignment(form) {
    const fd = new FormData(form); const mid = fd.get('m'); const rid = fd.get('r');
    if (!mid || !rid) { toast('Escolha o integrante e a função.', 'bad'); return; }
    const name = mName(mid);
    const already = live().filter((r) => r.member_id === mid);
    if (already.some((r) => r.role_id === rid)) { toast(`${name} já está escalado(a) nesta função.`, 'bad'); return; }
    // acumular uma função que já está no cadastro da pessoa (ex.: Vocal + Violão) não precisa de confirmação
    const registered = (L.memberById.get(mid)?.member_roles ?? []).some((x) => x.role_id === rid);
    if (already.length && !registered && !(await confirmDialog({ title: 'Já escalado(a) nesta escala', confirmText: 'Escalar também nesta função',
      message: html`<p><strong>${name}</strong> já está como <strong>${already.map((r) => r.role_name).join(', ')}</strong>. Escalar em mais uma função?</p>` }))) return;
    if (st.unav.has(mid) && !(await confirmDialog({ title: 'Integrante indisponível', confirmText: 'Escalar mesmo assim', danger: true,
      message: html`<p><strong>${name}</strong> registrou que não pode servir nesta data${st.unav.get(mid) ? html`: “${st.unav.get(mid)}”` : ''}. Escalar mesmo assim?</p>` }))) return;
    try {
      const t = new Date(st.ev.starts_at).getTime();
      const clash = await q(sb.from('assignments').select('id, events!inner(id, kind, title, starts_at, status, deleted_at)').eq('member_id', mid)
        .not('status', 'in', '(declined,replaced,cancelled)').neq('event_id', st.ev.id).is('events.deleted_at', null)
        .neq('events.status', 'cancelled')
        .gte('events.starts_at', new Date(t - 3 * 3600e3).toISOString()).lte('events.starts_at', new Date(t + 3 * 3600e3).toISOString()));
      if (clash.length && !(await confirmDialog({ title: 'Conflito de horário', confirmText: 'Escalar mesmo assim', danger: true,
        message: html`<p><strong>${name}</strong> já está em: ${clash.map((c) => html`<br>• ${evName(c.events)} — ${evWhen(c.events)}`)}</p>` }))) return;
      await q(sb.from('assignments').upsert({ church_id: S.church.id, event_id: st.ev.id, member_id: mid, role_id: rid, status: 'pending',
        responded_at: null, responded_by: null, decline_reason: null, replaced_by_assignment_id: null }, { onConflict: 'event_id,member_id,role_id' }));
      toast(`${name} escalado(a).`);
      await reload();
    } catch (e) { fail(e); }
  }

  async function publish() {
    const warn = [];
    if (!live().length) warn.push(html`<li>Ninguém está escalado.</li>`);
    const miss = L.roles.filter((r) => r.is_essential && r.active && !live().some((x) => x.role_id === r.id));
    if (miss.length) warn.push(html`<li>Falta cobrir: <strong>${miss.map((r) => r.name).join(', ')}</strong>.</li>`);
    if (!st.setlist.length) warn.push(html`<li>O setlist está vazio.</li>`);
    const ok = await confirmDialog({ title: 'Publicar a escala?', confirmText: 'Publicar',
      message: html`<p>Os escalados passam a ver esta escala em <em>Minhas escalas</em> e poderão confirmar ou recusar.</p>
        ${warn.length ? html`<div class="alert warn"><strong>Atenção:</strong><ul style="margin:.3rem 0 0;padding-left:1.2rem">${warn}</ul></div>` : ''}
        <p class="small muted">Este app não envia notificações: depois de publicar, você receberá uma mensagem pronta para o WhatsApp.</p>` });
    if (!ok) return;
    try { await q(sb.rpc('publish_event', { p_event: st.ev.id })); toast('Escala publicada.'); await reload(); await shareDialog('Escala publicada — avise a equipe'); }
    catch (e) { fail(e); }
  }

  // ── ações ────────────────────────────────────────────────────────────────
  actions(el, {
    publish,
    clone: cloneNow,
    share: () => shareDialog('Mensagem para o grupo'),
    cancel: async () => {
      if (!(await confirmDialog({ title: 'Cancelar esta escala?', danger: true, confirmText: 'Cancelar escala',
        message: html`<p>A escala <strong>${evName(st.ev)}</strong> de ${evWhen(st.ev)} será cancelada para todos os escalados. Isto não pode ser desfeito.</p>` }))) return;
      try { await q(sb.rpc('cancel_event', { p_event: st.ev.id })); toast('Escala cancelada.'); await reload(); } catch (e) { fail(e); }
    },
    delete: async () => {
      if (!(await confirmDialog({ title: 'Excluir este rascunho?', danger: true, confirmText: 'Excluir',
        message: html`<p>O rascunho <strong>${evName(st.ev)}</strong> de ${evWhen(st.ev)} será excluído.</p>` }))) return;
      try { await q(sb.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', st.ev.id)); toast('Rascunho excluído.'); go('/escalas'); } catch (e) { fail(e); }
    },
    'apply-team': async () => {
      try { const n = await q(sb.rpc('apply_team', { p_event: st.ev.id, p_team: st.ev.team_id })); toast(n ? `${n} integrante(s) escalado(s).` : 'Todos da equipe já estavam escalados.'); await reload(); } catch (e) { fail(e); }
    },
    'confirm-for': async (b) => { try { await confirmAssignment(b.dataset.id); await reload(); } catch (e) { fail(e); } },
    'decline-for': async (b) => { if (await declineFlow(asArg(asgById(b.dataset.id)))) await reload(); },
    sub: async (b) => {
      const r = asgById(b.dataset.id);
      if (await substituteFlow(asArg(r), `${r.member_name} — ${evName(st.ev)}, ${evWhen(st.ev)}`)) await reload();
    },
    att: async (b) => { try { await q(sb.rpc('mark_attendance', { p_assignment: b.dataset.id, p_attended: b.dataset.v === '1' })); await reload(); } catch (e) { fail(e); } },
    remove: async (b) => {
      const r = asgById(b.dataset.id);
      if (!(await confirmDialog({ title: 'Remover da escala?', danger: true, confirmText: 'Remover',
        message: html`<p>Tirar <strong>${r.member_name}</strong> (${r.role_name}) desta escala?</p>` }))) return;
      try {
        if (st.ev.status === 'draft') await q(sb.from('assignments').delete().eq('id', r.assignment_id));
        else await q(sb.from('assignments').update({ status: 'cancelled' }).eq('id', r.assignment_id));
        toast('Removido(a).'); await reload();
      } catch (e) { fail(e); }
    },
    // setlist
    up: (b) => { const i = +b.dataset.i; [st.setlist[i - 1], st.setlist[i]] = [st.setlist[i], st.setlist[i - 1]]; st.setDirty = true; redrawSet(); },
    down: (b) => { const i = +b.dataset.i; [st.setlist[i + 1], st.setlist[i]] = [st.setlist[i], st.setlist[i + 1]]; st.setDirty = true; redrawSet(); },
    'rm-song': (b) => { st.setlist.splice(+b.dataset.i, 1); st.setDirty = true; redrawSet(); },
    'save-set': async () => {
      try { await q(sb.rpc('save_setlist', { p_event: st.ev.id, p_items: st.setlist })); toast('Setlist salvo.'); await reload(); } catch (e) { fail(e); }
    },
    'copy-set': () => copyText(st.setlist.map((it, i) => {
      const sg = L.songById.get(it.song_id); const key = it.key_override || sg?.song_key;
      return `${i + 1}. ${sg?.title}${key ? ` (${key})` : ''}${(it.bpm_override || sg?.bpm) ? ` - ${it.bpm_override || sg.bpm} BPM` : ''}${it.moment ? ` [${MOMENT[it.moment]}]` : ''}`;
    }).join('\n')),
    'print-set': () => { el.classList.add('only-setlist'); window.print(); setTimeout(() => el.classList.remove('only-setlist'), 300); },
  });
  actions(el, {
    'set-key': (i) => { st.setlist[+i.dataset.i].key_override = i.value.trim() || null; st.setDirty = true; markDirty(); },
    'set-bpm': (i) => { st.setlist[+i.dataset.i].bpm_override = i.value ? +i.value : null; st.setDirty = true; markDirty(); },
    'set-moment': (i) => { st.setlist[+i.dataset.i].moment = i.value || null; st.setDirty = true; markDirty(); },
    kind: (s) => {
      const on = s.value === 'evento'; el.querySelector('#titlefield').hidden = !on; el.querySelector('#title').required = on;
      const box = el.querySelector('#clonebox');
      if (box) { box.hidden = s.value !== 'ensaio'; if (!box.hidden && !el.querySelector('#cd').value) el.querySelector('#cd').focus(); }
    },
    'clone-date': async (inp) => {
      const sel = el.querySelector('#cs');
      if (!inp.value) { sel.innerHTML = '<option value="">Escolha a data primeiro…</option>'; return; }
      sel.innerHTML = '<option value="">Carregando…</option>';
      try {
        const rows = await cloneOptions(inp.value);
        sel.innerHTML = !rows.length ? '<option value="">Nenhum culto ou evento nesta data</option>'
          : (rows.length > 1 ? '<option value="">Escolha…</option>' : '')
            + rows.map((r) => `<option value="${esc(r.id)}">${esc(evName(r))} — ${esc(fmtTime(r.starts_at, tz()))}${r.status === 'draft' ? ' (rascunho)' : ''}</option>`).join('');
      } catch (e) { sel.innerHTML = '<option value="">Erro ao carregar</option>'; fail(e); }
    },
    'pick-member': (sel) => {
      const m = L.memberById.get(sel.value); const r = el.querySelector('#ar');
      const opts = (m?.member_roles ?? []).map((x) => L.roleById.get(x.role_id)).filter((x) => x?.active);
      r.innerHTML = (opts.length > 1 ? '<option value="">Escolha…</option>' : '') + opts.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
      if (!opts.length) r.innerHTML = '<option value="">Escolha o integrante…</option>';
    },
  }, 'change');
  actions(el, {
    'save-event': (f, e) => { e.preventDefault(); if (f.reportValidity()) saveEvent(f); },
    'add-asg': (f, e) => { e.preventDefault(); addAssignment(f); },
    'add-song': async (f, e) => {
      e.preventDefault();
      const sid = new FormData(f).get('s'); if (!sid) return toast('Escolha uma música.', 'bad');
      const last = st.recent.get(sid);
      if (last) {
        const days = Math.round((new Date(st.ev.starts_at) - new Date(last)) / 864e5);
        toast(`Atenção: “${L.songById.get(sid)?.title}” foi cantada em ${fmtDate(last, tz())} (há ${days} dia${days === 1 ? '' : 's'}).`);
      }
      if (st.setlist.some((x) => x.song_id === sid) && !(await confirmDialog({ title: 'Música repetida', confirmText: 'Adicionar de novo',
        message: html`<p>Esta música já está no setlist. Adicionar outra vez?</p>` }))) return;
      st.setlist.push({ song_id: sid, key_override: null, bpm_override: null, moment: null }); st.setDirty = true; redrawSet();
    },
  }, 'submit');

  function markDirty() {
    const b = el.querySelector('[data-act="save-set"]'); if (b) b.disabled = false;
  }
  window.addEventListener('beforeunload', (e) => { if (st.setDirty && el.isConnected) { e.preventDefault(); e.returnValue = ''; } });

  if (await load()) {
    draw();
    if (query.tab === 'setlist') el.querySelector('#setlist-card')?.scrollIntoView();
  }
}
