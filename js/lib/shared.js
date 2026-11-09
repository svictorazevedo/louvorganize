// Fluxos reutilizados por várias telas: responder escalação, substituir, elenco.
import { sb, q, S, tz, lookups } from './api.js';
import { html, esc, formDialog, toast, KIND } from './ui.js';
import { fmtDateTime } from './time.js';

export const evName = (e) =>
  e.kind === 'evento' ? e.title : e.title ? `${KIND[e.kind]} · ${e.title}` : KIND[e.kind];
export const evWhen = (e) => fmtDateTime(e.starts_at, tz());

/** Elenco por escala: Map(eventId -> linhas de event_roster). Status só vem para quem gerencia. */
export async function loadRoster(eventIds) {
  const map = new Map(eventIds.map((id) => [id, []]));
  if (!eventIds.length) return map;
  const rows = await q(sb.rpc('event_roster', { p_event_ids: eventIds }));
  rows.forEach((r) => map.get(r.event_id)?.push(r));
  return map;
}

export async function confirmAssignment(id) {
  await q(sb.rpc('respond_assignment', { p_id: id, p_action: 'confirm' }));
  toast('Presença confirmada. Obrigado!');
}

const QUICK = ['Viagem', 'Trabalho', 'Saúde', 'Compromisso familiar', 'Outro motivo'];

/** RF-803: justificativa obrigatória, motivos rápidos e sugestão de substituto. */
export async function declineFlow(a, onDone) {
  const L = await lookups();
  const cands = L.members.filter((m) => !m.deleted_at && m.id !== a.member_id && m.member_roles.some((r) => r.role_id === a.role_id));
  return formDialog({
    title: 'Não posso servir',
    submitText: 'Enviar recusa',
    danger: true,
    body: html`
      <p class="muted">Sua recusa chega imediatamente ao líder, com o motivo. Quanto mais cedo, mais fácil achar um substituto.</p>
      <div class="field"><label for="quick">Motivo rápido</label>
        <select id="quick" name="quick"><option value="">Escolha…</option>${QUICK.map((x) => html`<option>${x}</option>`)}</select></div>
      <div class="field"><label for="reason">Explique em poucas palavras
        <span class="hint">Obrigatório, de 10 a 500 caracteres.</span></label>
        <textarea id="reason" name="reason" required minlength="10" maxlength="500"></textarea></div>
      ${cands.length ? html`<div class="field"><label for="sub">Sugerir um substituto <span class="hint">Opcional</span></label>
        <select id="sub" name="sub"><option value="">Não sugerir</option>${cands.map((m) => html`<option value="${m.id}">${m.full_name}</option>`)}</select></div>` : ''}`,
    onOpen: (dlg) => {
      const quick = dlg.querySelector('#quick'); const reason = dlg.querySelector('#reason');
      quick.addEventListener('change', () => {
        if (quick.value && !reason.value.trim()) { reason.value = quick.value + ': '; reason.focus(); }
      });
    },
    onSubmit: async (fd) => {
      const reason = String(fd.get('reason')).trim();
      if (reason.length < 10) throw new Error('Conte o motivo com pelo menos 10 caracteres.');
      const res = await q(sb.rpc('respond_assignment', {
        p_id: a.id, p_action: 'decline', p_reason: reason, p_substitute: fd.get('sub') || null,
      }));
      toast('Recusa enviada ao líder.');
      onDone?.(res);
      return res;
    },
  });
}

/** RF-806: candidatos ranqueados por menor carga; efetiva a troca. */
export async function substituteFlow(a, label) {
  const [cands, L] = await Promise.all([q(sb.rpc('substitutes', { p_assignment: a.id })), lookups()]);
  const role = L.roleById.get(a.role_id)?.name ?? 'esta função';
  const others = L.members.filter((m) => !m.deleted_at && m.id !== a.member_id && !cands.some((c) => c.member_id === m.id));
  return formDialog({
    title: 'Buscar substituto',
    submitText: 'Escalar substituto',
    body: html`
      <p>${label}<br><span class="muted">Função: <strong>${role}</strong>. A lista traz quem tem essa função, está livre nesta data e serviu menos nos últimos 60 dias.</span></p>
      ${cands.length ? html`<fieldset style="border:0;padding:0;margin:0"><legend class="sr-only">Candidatos</legend>
        ${cands.map((c, i) => html`<label class="check"><input type="radio" name="pick" value="${c.member_id}" ${i === 0 ? 'checked' : ''}>
          <span><strong>${c.full_name}</strong> <span class="muted small">· ${c.load60} escala${c.load60 === 1 ? '' : 's'} em 60 dias</span></span></label>`)}</fieldset>`
        : html`<div class="alert warn">Ninguém com a função “${role}” está livre nesta data. Escolha manualmente abaixo.</div>`}
      <div class="field" style="margin-top:.75rem"><label for="manual">Ou escolher manualmente <span class="hint">Sem checar função nem disponibilidade</span></label>
        <select id="manual" name="manual"><option value="">—</option>${others.map((m) => html`<option value="${m.id}">${m.full_name}</option>`)}</select></div>`,
    onSubmit: async (fd) => {
      const pick = fd.get('manual') || fd.get('pick');
      if (!pick) throw new Error('Escolha quem vai substituir.');
      await q(sb.rpc('replace_assignment', { p_assignment: a.id, p_member: pick }));
      toast('Substituto escalado. A vaga volta a ficar pendente até ele responder.');
      return true;
    },
  });
}

export const initialsOf = (n) => esc(String(n).split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase());
