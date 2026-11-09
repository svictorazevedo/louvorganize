// Funções (RF-300): CRUD, ordenação, arquivar/substituir quando em uso (RF-303).
import { sb, q, S, invalidate, lookups } from '../lib/api.js';
import { html, toStr, actions, empty, sortRows, sortTh, toggleSort, formDialog, confirmDialog, toast, CATEGORY } from '../lib/ui.js';

export default async function render(el) {
  const L = await lookups();
  const st = { key: 'name', dir: 'asc', archived: false };
  const usage = (r) => L.members.filter((m) => !m.deleted_at && m.member_roles.some((x) => x.role_id === r.id)).length;

  const draw = () => {
    const rows = sortRows(L.roles.filter((r) => st.archived ? !r.active : r.active), st.key, st.dir,
      { count: usage, category: (r) => CATEGORY[r.category] });
    el.innerHTML = toStr(html`
      <div class="page-head"><div class="grow"><h1>Funções</h1>
        <p class="muted">Papéis musicais e técnicos. Marque como <em>essencial</em> as que não podem faltar numa escala (só gera alerta).</p></div>
        <div class="actions"><button class="btn primary" data-act="new">+ Cadastrar função</button></div></div>
      <div class="tabs" role="group" aria-label="Filtro">
        <button type="button" data-act="tab" data-v="0" aria-pressed="${String(!st.archived)}">Ativas</button>
        <button type="button" data-act="tab" data-v="1" aria-pressed="${String(st.archived)}">Arquivadas</button></div>
      ${rows.length ? html`<div class="tablewrap"><table><thead><tr>${sortTh('Nome', 'name', st)}${sortTh('Categoria', 'category', st)}<th scope="col">Cor</th>${sortTh('Integrantes', 'count', st)}<th scope="col"><span class="sr-only">Ações</span></th></tr></thead><tbody>
        ${rows.map((r) => html`<tr><td><strong>${r.name}</strong> ${r.is_essential ? html`<span class="chip warn">essencial</span>` : ''}</td><td>${CATEGORY[r.category]}</td>
          <td><span class="chip"><span class="dot" style="background:${r.color}"></span>${r.color}</span></td><td>${usage(r)}</td>
          <td class="nowrap"><div class="actions">
            ${r.active ? html`<button class="btn sm" data-act="edit" data-id="${r.id}">Editar</button><button class="btn sm danger" data-act="del" data-id="${r.id}" aria-label="Excluir ${r.name}">Excluir</button>`
              : html`<button class="btn sm" data-act="reactivate" data-id="${r.id}">Reativar</button>`}</div></td></tr>`)}</tbody></table></div>`
        : empty(st.archived ? 'Nenhuma função arquivada' : 'Nenhuma função ativa', 'Cadastre as funções do seu ministério.')}`);
  };
  draw();

  async function form(r) {
    const ok = await formDialog({
      title: r ? 'Editar função' : 'Cadastrar função',
      body: html`<div class="field"><label for="n">Nome</label><input id="n" name="n" required minlength="2" maxlength="60" value="${r?.name ?? ''}"></div>
        <div class="grid2"><div class="field"><label for="c">Categoria</label><select id="c" name="c">
          ${Object.entries(CATEGORY).map(([k, v]) => html`<option value="${k}" ${(r?.category ?? 'instrumento') === k ? 'selected' : ''}>${v}</option>`)}</select></div>
          <div class="field"><label for="k">Cor</label><input id="k" name="k" type="color" value="${r?.color ?? '#7A1F3D'}"></div></div>
        <label class="check"><input type="checkbox" name="e" ${r?.is_essential ? 'checked' : ''}> Função essencial (alerta se faltar na escala)</label>`,
      onSubmit: async (fd) => {
        const row = { church_id: S.church.id, name: String(fd.get('n')).trim(), category: fd.get('c'), color: fd.get('k'), is_essential: fd.get('e') === 'on' };
        await q(r ? sb.from('roles').update(row).eq('id', r.id) : sb.from('roles').insert(row));
        return true;
      },
    });
    if (ok) { invalidate('roles'); toast('Função salva.'); render(el); }
  }

  actions(el, {
    sort: (b) => { toggleSort(st, b.dataset.key); draw(); },
    tab: (b) => { st.archived = b.dataset.v === '1'; draw(); },
    new: () => form(null),
    edit: (b) => form(L.roleById.get(b.dataset.id)),
    reactivate: async (b) => {
      try { await q(sb.from('roles').update({ active: true }).eq('id', b.dataset.id)); invalidate('roles'); toast('Função reativada.'); render(el); } catch (e) { toast(e.message, 'bad'); }
    },
    del: async (b) => {
      const r = L.roleById.get(b.dataset.id); const n = usage(r);
      const others = L.roles.filter((x) => x.active && x.id !== r.id);
      if (!n) {
        if (!(await confirmDialog({ title: 'Arquivar função?', danger: true, confirmText: 'Arquivar',
          message: html`<p>A função <strong>${r.name}</strong> não está em uso. Ela some das listas de escolha, mas o histórico é mantido.</p>` }))) return;
        try { await q(sb.rpc('retire_role', { p_id: r.id, p_replace: null })); invalidate('roles'); toast('Função arquivada.'); render(el); } catch (e) { toast(e.message, 'bad'); }
        return;
      }
      const ok = await formDialog({
        title: `“${r.name}” está em uso`, submitText: 'Continuar', danger: true,
        body: html`<p><strong>${n}</strong> integrante(s) têm esta função. Escolha o que fazer:</p>
          <label class="check"><input type="radio" name="how" value="archive" checked> Arquivar (mantém o histórico; quem a tem continua com ela nas escalas antigas)</label>
          <label class="check"><input type="radio" name="how" value="replace"> Substituir por outra função em todos os cadastros e equipes:</label>
          <div class="field" style="margin-left:1.6rem"><label class="sr-only" for="rep">Nova função</label><select id="rep" name="rep"><option value="">—</option>
            ${others.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></div>`,
        onSubmit: async (fd) => {
          const replace = fd.get('how') === 'replace' ? fd.get('rep') : null;
          if (fd.get('how') === 'replace' && !replace) throw new Error('Escolha a função que vai substituir.');
          await q(sb.rpc('retire_role', { p_id: r.id, p_replace: replace || null })); return true;
        },
      });
      if (ok) { invalidate('roles', 'members', 'teams'); toast('Pronto.'); render(el); }
    },
  });
}
