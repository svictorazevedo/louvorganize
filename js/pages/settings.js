// Configurações da igreja (RF-1004/1005), convites pendentes e auditoria (RN-011).
import { sb, q, S, setChurch, lookups } from '../lib/api.js';
import { html, toStr, actions, toast, confirmDialog, copyText } from '../lib/ui.js';
import { fmtDateTime } from '../lib/time.js';

const ZONES = [['America/Cuiaba', 'Cuiabá / Campo Grande (MT, MS) — UTC−4'], ['America/Sao_Paulo', 'Brasília (SP, RJ, MG, sul…) — UTC−3'],
  ['America/Manaus', 'Manaus (AM) — UTC−4'], ['America/Rio_Branco', 'Rio Branco (AC) — UTC−5'], ['America/Porto_Velho', 'Porto Velho (RO) — UTC−4'],
  ['America/Boa_Vista', 'Boa Vista (RR) — UTC−4'], ['America/Belem', 'Belém (PA, AP) — UTC−3'], ['America/Fortaleza', 'Fortaleza (CE, RN, PI, MA) — UTC−3'],
  ['America/Recife', 'Recife (PE, PB, AL) — UTC−3'], ['America/Bahia', 'Salvador (BA) — UTC−3'], ['America/Araguaina', 'Palmas (TO) — UTC−3'], ['America/Noronha', 'Fernando de Noronha — UTC−2']];

export default async function render(el) {
  const L = await lookups();
  const c = S.church;
  const [invites, audit] = await Promise.all([
    q(sb.from('invites').select('*').eq('church_id', c.id).is('accepted_at', null).order('created_at', { ascending: false })),
    q(sb.from('audit_log').select('*').eq('church_id', c.id).order('id', { ascending: false }).limit(60)),
  ]);
  const byUser = new Map(L.members.filter((m) => m.user_id).map((m) => [m.user_id, m.full_name]));
  const publicUrl = `${location.origin}${location.pathname}#/i/${c.slug}`;
  const ENT = { events: 'Escala', assignments: 'Escalação', members: 'Integrante', memberships: 'Acesso', teams: 'Equipe' };
  const ACT = { insert: 'criou', update: 'alterou', delete: 'excluiu' };

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>Configurações</h1></div></div>
    <form class="card" id="f" novalidate><h2>Igreja</h2>
      <div class="grid2">
        <div class="field"><label for="n">Nome</label><input id="n" name="n" required minlength="2" maxlength="120" value="${c.name}"></div>
        <div class="field"><label for="z">Fuso horário <span class="hint">Todas as datas e horas são mostradas neste fuso</span></label>
          <select id="z" name="z">${ZONES.map(([v, l]) => html`<option value="${v}" ${c.timezone === v ? 'selected' : ''}>${l}</option>`)}</select></div>
      </div>
      <h2>Página pública</h2>
      <p class="muted">Endereço (não pode ser alterado): <a href="${publicUrl}" target="_blank" rel="noopener">${publicUrl}</a>
        <button type="button" class="btn link" data-act="copy">copiar</button></p>
      <div class="field"><label for="m">Visibilidade</label><select id="m" name="m">
        <option value="public" ${c.public_mode === 'public' ? 'selected' : ''}>Pública</option>
        <option value="link" ${c.public_mode === 'link' ? 'selected' : ''}>Somente com o link (não aparece em buscas)</option>
        <option value="off" ${c.public_mode === 'off' ? 'selected' : ''}>Desativada</option></select></div>
      <label class="check"><input type="checkbox" name="s" ${c.show_setlist_publicly ? 'checked' : ''}> Mostrar o repertório (títulos e tons) na página pública</label>
      <p class="small muted">A página pública nunca mostra telefone, e-mail, situação de confirmação, justificativas ou observações internas.</p>
      <div class="actions" style="margin-top:1rem"><button class="btn primary" type="submit">Salvar</button></div></form>

    <section class="card"><h2>Convites pendentes</h2>
      ${invites.length ? html`<ul class="list">${invites.map((i) => html`<li><div class="grow"><strong>${L.memberById.get(i.member_id)?.full_name ?? '?'}</strong>
        <span class="muted small"> · acesso: ${i.role === 'admin' ? 'administrador' : 'integrante'} · ${new Date(i.expires_at) < new Date() ? 'expirado' : 'vence ' + fmtDateTime(i.expires_at, c.timezone)}</span></div>
        <button class="btn sm danger" data-act="revoke" data-id="${i.id}">Revogar</button></li>`)}</ul>`
        : html`<p class="muted">Nenhum convite em aberto. Gere convites em <a href="#/integrantes">Integrantes</a>.</p>`}</section>

    <details class="card"><summary><strong>Histórico de alterações (últimas ${audit.length})</strong></summary>
      <div class="tablewrap" style="margin-top:.75rem"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead><tbody>
      ${audit.map((a) => html`<tr><td class="nowrap">${fmtDateTime(a.created_at, c.timezone)}</td><td>${byUser.get(a.actor_user_id) ?? 'Sistema'}</td>
        <td>${ACT[a.action] ?? a.action} ${ENT[a.entity] ?? a.entity}${a.diff?.new?.status ? html` <span class="muted">(${a.diff.new.status})</span>` : ''}</td></tr>`)}</tbody></table></div></details>

    <section class="card"><h2>Seus dados (LGPD)</h2>
      <p class="muted small">Este sistema guarda nome, e-mail e telefone dos integrantes apenas para organizar as escalas. Para exportar ou excluir os dados de uma pessoa, use o painel do Supabase do seu projeto ou fale com o desenvolvedor. Publique uma política de privacidade antes de abrir o app para o público.</p></section>`);

  el.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; if (!f.reportValidity()) return;
    try {
      await q(sb.from('churches').update({ name: f.n.value.trim(), timezone: f.z.value, public_mode: f.m.value, show_setlist_publicly: f.s.checked }).eq('id', c.id));
      const m = S.memberships.find((x) => x.church_id === c.id);
      Object.assign(m.churches, { name: f.n.value.trim(), timezone: f.z.value, public_mode: f.m.value, show_setlist_publicly: f.s.checked });
      await setChurch(c.id);
      toast('Configurações salvas.');
      location.reload();
    } catch (err) { toast(err.message, 'bad'); }
  });
  actions(el, {
    copy: () => copyText(publicUrl),
    revoke: async (b) => {
      if (!(await confirmDialog({ title: 'Revogar convite?', danger: true, confirmText: 'Revogar', message: html`<p>O link deixa de funcionar. Você pode gerar outro depois.</p>` }))) return;
      try { await q(sb.from('invites').delete().eq('id', b.dataset.id)); toast('Convite revogado.'); render(el); } catch (e) { toast(e.message, 'bad'); }
    },
  });
}
