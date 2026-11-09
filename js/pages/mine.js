// Minhas escalas, disponibilidade e meu contato (app do integrante — §12).
import { sb, q, S, tz, lookups, invalidate } from '../lib/api.js';
import { html, toStr, esc, actions, empty, statusChip, confirmDialog, toast, download } from '../lib/ui.js';
import { evName, evWhen, confirmAssignment, declineFlow } from '../lib/shared.js';
import { fmtDate, toE164, todayIn } from '../lib/time.js';
import { buildIcs } from '../lib/ics.js';

export default async function render(el) {
  if (!S.me) {
    el.innerHTML = toStr(empty('Você ainda não está vinculado a um integrante', 'Peça ao líder um convite para ligar sua conta ao seu cadastro.'));
    return;
  }
  const L = await lookups();
  const [rows, unav, contact] = await Promise.all([
    q(sb.from('assignments').select('*, events!inner(*)').eq('member_id', S.me.id).is('events.deleted_at', null)),
    q(sb.from('unavailabilities').select('*').eq('member_id', S.me.id).order('start_date')),
    q(sb.from('member_contacts').select('*').eq('member_id', S.me.id).maybeSingle()),
  ]);
  const now = Date.now();
  const live = rows.filter((a) => !['replaced', 'cancelled'].includes(a.status));
  const next = live.filter((a) => new Date(a.events.starts_at) > now && a.events.status === 'published')
    .sort((a, b) => a.events.starts_at.localeCompare(b.events.starts_at));
  const past = live.filter((a) => new Date(a.events.starts_at) <= now).sort((a, b) => b.events.starts_at.localeCompare(a.events.starts_at));
  const roleName = (id) => L.roleById.get(id)?.name ?? '—';
  const today = todayIn(tz());

  const answered = live.filter((a) => a.status === 'confirmed' || a.status === 'closed' || a.status === 'declined').length;
  const confirmedN = live.filter((a) => a.status === 'confirmed' || a.status === 'closed').length;

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>Minhas escalas</h1>
      <p class="muted">${answered ? `Você já confirmou ${confirmedN} de ${answered} respondidas.` : 'Confirme ou recuse com um toque.'}</p></div>
      <div class="actions">${next.length ? html`<button class="btn" data-act="ics">Exportar para a agenda (.ics)</button>` : ''}</div></div>

    <section class="card"><h2>Próximas</h2>
      ${next.length ? html`<ul class="list">${next.map((a) => html`<li>
        <div class="grow"><strong>${evName(a.events)}</strong> ${statusChip(a.status)}<br>
          <span class="muted">${evWhen(a.events)} · ${roleName(a.role_id)}${a.events.location ? ' · ' + a.events.location : ''}</span>
          ${a.status === 'declined' ? html`<br><span class="small muted">Você recusou: “${a.decline_reason}”</span>` : ''}</div>
        <div class="actions">
          ${a.status === 'pending' || a.status === 'expired' ? html`<button class="btn ok sm" data-act="confirm" data-id="${a.id}">Confirmar</button>` : ''}
          ${a.status !== 'declined' ? html`<button class="btn danger sm" data-act="decline" data-id="${a.id}">Não posso</button>` : ''}
          <a class="btn sm" href="#/escalas/${a.event_id}">Detalhes</a>
        </div></li>`)}</ul>`
        : empty('Nenhuma escala à vista', 'Quando o líder publicar uma escala com você, ela aparece aqui.')}
    </section>

    <section class="card"><h2>Minha disponibilidade</h2>
      <p class="muted">Avise com antecedência os períodos em que você não pode servir. O líder verá isso ao montar a escala.</p>
      <form id="unav" class="filters" novalidate>
        <div><label for="u1">De</label><input id="u1" type="date" name="s" min="${today}" required></div>
        <div><label for="u2">Até</label><input id="u2" type="date" name="e" min="${today}" required></div>
        <div style="flex:2 1 220px"><label for="u3">Motivo (opcional)</label><input id="u3" name="r" maxlength="200"></div>
        <div style="flex:0 0 auto"><button class="btn primary" type="submit">Registrar</button></div>
      </form>
      ${unav.length ? html`<ul class="list">${unav.map((u) => html`<li>
        <div class="grow">${fmtDate(u.start_date + 'T12:00:00Z', 'UTC')}${u.end_date !== u.start_date ? ' a ' + fmtDate(u.end_date + 'T12:00:00Z', 'UTC') : ''}
          ${u.reason ? html`<span class="muted"> · ${u.reason}</span>` : ''}</div>
        <button class="btn sm danger" data-act="unav-del" data-id="${u.id}">Remover</button></li>`)}</ul>`
        : html`<p class="muted">Nenhum período registrado.</p>`}
    </section>

    <section class="card"><h2>Meu contato</h2>
      <p class="muted small">Só você e os líderes veem estes dados.</p>
      <form id="contact" novalidate class="grid2">
        <div class="field"><label for="c1">Telefone / WhatsApp</label><input id="c1" name="phone" value="${contact?.phone ?? ''}" inputmode="tel" autocomplete="tel" placeholder="(65) 99999-0000"></div>
        <div class="field"><label for="c2">E-mail</label><input id="c2" name="email" type="email" value="${contact?.email ?? S.user.email ?? ''}" autocomplete="email"></div>
        <div><button class="btn" type="submit">Salvar contato</button></div>
      </form>
    </section>

    ${past.length ? html`<details class="card"><summary><strong>Histórico (${past.length})</strong></summary>
      <ul class="list">${past.slice(0, 40).map((a) => html`<li><div class="grow">${evName(a.events)} <span class="muted">· ${evWhen(a.events)} · ${roleName(a.role_id)}</span></div>
        ${statusChip(a.status)}${a.attended === true ? html` <span class="chip ok">Presente</span>` : a.attended === false ? html` <span class="chip bad">Faltou</span>` : ''}</li>`)}</ul></details>` : ''}`);

  const byId = new Map(rows.map((a) => [a.id, a]));
  actions(el, {
    confirm: async (b) => { b.disabled = true; try { await confirmAssignment(b.dataset.id); render(el); } catch (e) { toast(e.message, 'bad'); b.disabled = false; } },
    decline: async (b) => { if (await declineFlow(byId.get(b.dataset.id))) render(el); },
    ics: () => download('minhas-escalas.ics', buildIcs(next.map((a) => ({
      id: a.id, title: `${evName(a.events)} — ${roleName(a.role_id)}`, starts_at: a.events.starts_at, location: a.events.location,
    })), `Escalas de ${S.me.full_name}`), 'text/calendar'),
    'unav-del': async (b) => {
      if (!(await confirmDialog({ title: 'Remover período?', message: html`<p>O líder voltará a poder te escalar nessas datas.</p>`, confirmText: 'Remover', danger: true }))) return;
      try { await q(sb.from('unavailabilities').delete().eq('id', b.dataset.id)); toast('Período removido.'); render(el); } catch (e) { toast(e.message, 'bad'); }
    },
  });
  el.querySelector('#unav').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; if (!f.reportValidity()) return;
    if (f.e.value < f.s.value) return toast('A data final precisa ser igual ou posterior à inicial.', 'bad');
    try {
      await q(sb.from('unavailabilities').insert({ church_id: S.church.id, member_id: S.me.id, start_date: f.s.value, end_date: f.e.value, reason: f.r.value.trim() || null }));
      toast('Período registrado.'); render(el);
    } catch (err) { toast(err.message, 'bad'); }
  });
  el.querySelector('#contact').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    const phone = toE164(f.phone.value);
    if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) return toast('Telefone inválido. Use DDD + número, ex.: (65) 99999-0000.', 'bad');
    try {
      await q(sb.from('member_contacts').upsert({ member_id: S.me.id, church_id: S.church.id, phone: phone || null, email: f.email.value.trim() || null, notes: contact?.notes ?? null }));
      invalidate('contacts'); toast('Contato salvo.');
    } catch (err) { toast(err.message, 'bad'); }
  });
}
