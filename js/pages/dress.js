// Vestimenta: escala semanal do padrão de cores e cadastro dos padrões (com prévia dos bonequinhos).
import { sb, q, S, tz, isAdmin, isManager, invalidate, getDressCodes, getDressWeeks } from '../lib/api.js';
import { html, raw, toStr, actions, empty, formDialog, confirmDialog, toast, icon } from '../lib/ui.js';
import { addDays, todayIn } from '../lib/time.js';
import { weekStartOf, weekLabel, swatches, figures, dressCard, cleanColors } from '../lib/dress.js';

const PAGE = 12;   // semanas por página
const MAX_COLORS = 8;

export default async function render(el, { query = {} } = {}) {
  const admin = isAdmin(); const mgr = isManager();
  const cur = weekStartOf(todayIn(tz()));
  const off = Number.isInteger(+query.o) ? +query.o : 0;
  const start = addDays(cur, 7 * PAGE * off);
  const weeks = Array.from({ length: PAGE }, (_, i) => addDays(start, 7 * i));
  const end = weeks.at(-1);
  invalidate('dress');
  const [codes, sched] = await Promise.all([getDressCodes(), getDressWeeks(addDays(start, -7 * 26), end)]);
  const codeById = new Map(codes.map((c) => [c.id, c]));
  const link = (o) => '#/vestimentas' + (o ? '?o=' + o : '');

  el.innerHTML = toStr(html`
    <div class="page-head"><div class="grow"><h1>Vestimenta</h1>
      <p class="muted">Padrão de cores da equipe em cada semana (domingo a sábado). Os bonequinhos mostram uma ideia de como combinar as peças.</p></div>
      ${admin ? html`<div class="actions"><button class="btn primary" data-act="new">${icon('plus', 18)} Novo padrão</button></div>` : ''}</div>

    ${dressCard(sched.get(cur) ?? null, cur, { title: 'Esta semana' })}

    <section class="card" aria-labelledby="h-weeks">
      <div class="row" style="justify-content:space-between"><h2 id="h-weeks" style="margin:0">Escala das semanas</h2>
        <div class="actions">
          <a class="btn sm" href="${link(off - 1)}" aria-label="Semanas anteriores">‹</a>
          ${off ? html`<a class="btn sm" href="${link(0)}">Hoje</a>` : ''}
          <a class="btn sm" href="${link(off + 1)}" aria-label="Próximas semanas">›</a>
          ${mgr && codes.length ? html`<button class="btn sm" data-act="rotate" title="Preenche as semanas sem padrão seguindo a ordem da lista de padrões">Preencher em rodízio</button>` : ''}</div></div>
      ${codes.length ? html`<ul class="list dress-weeks" style="margin-top:.75rem">${weeks.map((w) => {
        const c = sched.get(w);
        return html`<li class="${w === cur ? 'is-now' : ''}"><div class="grow"><strong>${weekLabel(w)}</strong>${w === cur ? html` <span class="chip info">esta semana</span>` : ''}${w < cur ? html` <span class="chip">passou</span>` : ''}<br>
          ${c ? swatches(c.colors) : html`<span class="muted small">sem padrão</span>`}</div>
          ${mgr ? html`<div><label class="sr-only" for="w-${w}">Padrão da semana ${weekLabel(w)}</label>
            <select id="w-${w}" data-act="set" data-week="${w}"><option value="">— sem padrão —</option>
            ${codes.map((x) => html`<option value="${x.id}" ${c?.id === x.id ? raw('selected') : ''}>${x.name}</option>`)}</select></div>`
          : html`<span>${c ? c.name : ''}</span>`}</li>`;
      })}</ul>` : empty('Nenhum padrão cadastrado', admin ? 'Cadastre um padrão de cores para escalar as semanas.' : 'O administrador ainda não cadastrou padrões.')}
    </section>

    <section aria-labelledby="h-codes"><h2 id="h-codes">Padrões cadastrados</h2>
      ${codes.length ? html`<div class="cards">${codes.map((c) => html`<div class="card dress-code">
        <div class="row" style="justify-content:space-between;align-items:flex-start"><h3 style="margin:0" class="grow">${c.name}</h3>
          ${admin ? html`<div class="actions"><button class="btn sm" data-act="edit" data-id="${c.id}">Editar</button>
            <button class="btn sm danger" data-act="del" data-id="${c.id}" aria-label="Excluir ${c.name}">Excluir</button></div>` : ''}</div>
        ${swatches(c.colors, { labels: true })}
        ${figures(c, c.id, 96)}</div>`)}</div>` : ''}
    </section>`);

  async function save(week, codeId) {
    if (codeId) await q(sb.from('dress_weeks').upsert({ church_id: S.church.id, week_start: week, dress_code_id: codeId }, { onConflict: 'church_id,week_start' }));
    else await q(sb.from('dress_weeks').delete().eq('church_id', S.church.id).eq('week_start', week));
  }

  async function form(c) {
    const rows = (cl) => cl.map((x) => html`<div class="color-row">
        <input type="color" name="hex" value="${x.hex.toLowerCase()}" aria-label="Cor">
        <input name="cname" maxlength="40" placeholder="Nome da cor (opcional)" value="${x.name}" aria-label="Nome da cor">
        <button type="button" class="btn sm" data-rm aria-label="Remover cor">${icon('x', 16)}</button></div>`);
    const start0 = c ? cleanColors(c.colors) : [{ hex: '#000000', name: 'Preto' }, { hex: '#FFFFFF', name: 'Branco' }];
    const read = (root) => [...root.querySelectorAll('.color-row')].map((r) => ({ hex: r.querySelector('[name=hex]').value.toUpperCase(), name: r.querySelector('[name=cname]').value.trim() }));
    const ok = await formDialog({
      title: c ? 'Editar padrão' : 'Novo padrão de vestimenta', wide: true,
      body: html`<div class="field"><label for="dn">Nome</label><input id="dn" name="n" required minlength="2" maxlength="60" value="${c?.name ?? ''}" placeholder="Ex.: Preto e Vinho"></div>
        <fieldset><legend>Cores <span class="hint">(1 a ${MAX_COLORS}; a ordem não importa)</span></legend>
          <div id="crows">${rows(start0)}</div>
          <button type="button" class="btn sm" data-add>${icon('plus', 16)} Adicionar cor</button></fieldset>
        <h3 style="margin-bottom:.25rem">Prévia</h3><div id="prev"></div>
        ${c ? html`<p class="small muted">As semanas já escaladas com este padrão passam a mostrar as cores novas.</p>` : ''}`,
      onOpen: (dlg) => {
        const box = dlg.querySelector('#crows'); const prev = dlg.querySelector('#prev'); const add = dlg.querySelector('[data-add]');
        const refresh = () => {
          const cl = read(box);
          prev.innerHTML = toStr(cl.length ? figures({ colors: cl }, 'previa', 110) : html`<p class="muted">Adicione ao menos uma cor.</p>`);
          add.disabled = cl.length >= MAX_COLORS;
        };
        box.addEventListener('input', refresh);
        box.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { e.target.closest('.color-row').remove(); refresh(); } });
        add.addEventListener('click', () => { box.insertAdjacentHTML('beforeend', toStr(rows([{ hex: '#808080', name: '' }]))); refresh(); box.lastElementChild.querySelector('input').focus(); });
        refresh();
      },
      onSubmit: async (fd, dlg) => {
        const colors = cleanColors(read(dlg.querySelector('#crows')));
        if (!colors.length) throw new Error('Adicione pelo menos uma cor.');
        const row = { church_id: S.church.id, name: String(fd.get('n')).trim(), colors };
        if (!c) row.position = Math.max(0, ...codes.map((x) => x.position ?? 0)) + 1;
        try {
          await q(c ? sb.from('dress_codes').update(row).eq('id', c.id) : sb.from('dress_codes').insert(row));
        } catch (e) {
          throw /registro com esses dados|dress_codes_name_key/.test(e.message) ? new Error('Já existe um padrão com esse nome.') : e;
        }
        return true;
      },
    });
    if (ok) { invalidate('dress'); toast('Padrão salvo.'); render(el, { query }); }
  }

  actions(el, {
    new: () => form(null),
    edit: (b) => form(codeById.get(b.dataset.id)),
    del: async (b) => {
      const c = codeById.get(b.dataset.id);
      const future = [...sched].filter(([w, x]) => x.id === c.id && w >= cur).length;
      if (!(await confirmDialog({ title: 'Excluir padrão?', danger: true, confirmText: 'Excluir',
        message: html`<p>O padrão <strong>${c.name}</strong> será excluído${future ? html` e <strong>${future} semana(s)</strong> escalada(s) com ele ficarão sem padrão` : ''}.</p>` }))) return;
      try { await q(sb.from('dress_codes').delete().eq('id', c.id)); invalidate('dress'); toast('Padrão excluído.'); render(el, { query }); } catch (e) { toast(e.message, 'bad'); }
    },
    rotate: async (b) => {
      const empties = weeks.filter((w) => w >= cur && !sched.has(w));
      if (!empties.length) { toast('Todas as semanas a partir de hoje já têm padrão.'); return; }
      const before = [...sched].filter(([w]) => w < empties[0]).sort(([a], [z]) => a.localeCompare(z)).at(-1);
      let i = before ? codes.findIndex((x) => x.id === before[1].id) : -1;
      const rowsUp = empties.map((w) => { i = (i + 1) % codes.length; return { church_id: S.church.id, week_start: w, dress_code_id: codes[i].id }; });
      b.disabled = true;
      try { await q(sb.from('dress_weeks').upsert(rowsUp, { onConflict: 'church_id,week_start' })); toast(`${rowsUp.length} semana(s) preenchida(s).`); render(el, { query }); }
      catch (e) { toast(e.message, 'bad'); b.disabled = false; }
    },
  });
  actions(el, {
    set: async (s) => {
      s.disabled = true;
      try { await save(s.dataset.week, s.value); toast('Vestimenta da semana salva.'); render(el, { query }); }
      catch (e) { toast(e.message, 'bad'); s.disabled = false; }
    },
  }, 'change');
}
