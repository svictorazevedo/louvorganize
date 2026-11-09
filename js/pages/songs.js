// Biblioteca de músicas (RF-601). Líderes e admins editam; integrantes consultam.
import { sb, q, S, isManager, invalidate, lookups } from '../lib/api.js';
import { html, toStr, actions, empty, sortRows, sortTh, toggleSort, formDialog, confirmDialog, toast, safeUrl } from '../lib/ui.js';
import { norm, parseDuration, fmtDuration } from '../lib/time.js';

const KEYS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export default async function render(el) {
  const L = await lookups();
  const mgr = isManager();
  const st = { key: 'title', dir: 'asc', q: '', off: false };

  const drawList = () => {
    const needle = norm(st.q);
    const rows = sortRows(L.songs.filter((s) => (st.off ? !s.active : s.active) && (!needle || norm(`${s.title} ${s.artist ?? ''} ${(s.tags ?? []).join(' ')}`).includes(needle))), st.key, st.dir,
      { bpm: (s) => s.bpm ?? 0 });
    el.querySelector('#list').innerHTML = toStr(rows.length ? html`<div class="tablewrap"><table><thead><tr>
      ${sortTh('Título', 'title', st)}${sortTh('Artista', 'artist', st)}${sortTh('Tom', 'song_key', st)}${sortTh('BPM', 'bpm', st)}<th scope="col">Duração</th><th scope="col">Links</th>${mgr ? html`<th scope="col"><span class="sr-only">Ações</span></th>` : ''}</tr></thead><tbody>
      ${rows.map((s) => html`<tr><td><strong>${s.title}</strong>${(s.tags ?? []).length ? html`<br><span class="chips">${s.tags.map((t) => html`<span class="chip">${t}</span>`)}</span>` : ''}</td>
        <td>${s.artist ?? ''}</td><td>${s.song_key ?? ''}</td><td>${s.bpm ?? ''}</td><td>${fmtDuration(s.duration_sec)}</td>
        <td class="nowrap">${safeUrl(s.media_url) ? html`<a href="${safeUrl(s.media_url)}" target="_blank" rel="noopener">ouvir</a> ` : ''}${safeUrl(s.chart_url) ? html`<a href="${safeUrl(s.chart_url)}" target="_blank" rel="noopener">cifra</a>` : ''}
          ${s.lyrics ? html`<button class="btn link" data-act="lyrics" data-id="${s.id}">letra</button>` : ''}</td>
        ${mgr ? html`<td class="nowrap"><div class="actions"><button class="btn sm" data-act="edit" data-id="${s.id}">Editar</button>
          <button class="btn sm ${s.active ? 'danger' : ''}" data-act="toggle" data-id="${s.id}">${s.active ? 'Arquivar' : 'Reativar'}</button></div></td>` : ''}</tr>`)}</tbody></table></div>`
      : empty('Nenhuma música encontrada', mgr ? 'Cadastre as músicas que o ministério canta.' : 'A biblioteca ainda está vazia.',
          mgr ? html`<button class="btn primary" data-act="new">+ Cadastrar música</button>` : ''));
  };

  el.innerHTML = toStr(html`<div class="page-head"><div class="grow"><h1>Músicas</h1><p class="muted">Biblioteca reaproveitada nos setlists. O tom pode mudar em cada escala.</p></div>
      ${mgr ? html`<div class="actions"><button class="btn primary" data-act="new">+ Cadastrar música</button></div>` : ''}</div>
    <div class="filters"><div style="flex:3 1 240px"><label for="q">Buscar</label><input id="q" type="search" data-act="search" placeholder="Título, artista ou tag"></div>
      <div><label for="st">Situação</label><select id="st" data-act="state"><option value="0">Ativas</option><option value="1">Arquivadas</option></select></div></div>
    <div id="list"></div>`);
  drawList();

  async function form(s) {
    const ok = await formDialog({
      title: s ? 'Editar música' : 'Cadastrar música', wide: true,
      body: html`<div class="grid2">
        <div class="field"><label for="t">Título</label><input id="t" name="t" required maxlength="120" value="${s?.title ?? ''}"></div>
        <div class="field"><label for="a">Artista / autor</label><input id="a" name="a" maxlength="120" value="${s?.artist ?? ''}"></div>
        <div class="field"><label for="k">Tom original <span class="hint">Ex.: G, Bb, Am</span></label><input id="k" name="k" list="keys" maxlength="8" value="${s?.song_key ?? ''}">
          <datalist id="keys">${KEYS.flatMap((k) => [k, k + 'm']).map((k) => html`<option value="${k}">`)}</datalist></div>
        <div class="field"><label for="b">BPM</label><input id="b" name="b" type="number" min="30" max="240" value="${s?.bpm ?? ''}"></div>
        <div class="field"><label for="d">Duração <span class="hint">mm:ss</span></label><input id="d" name="d" placeholder="4:30" pattern="\\d{1,3}:[0-5]\\d" value="${fmtDuration(s?.duration_sec)}"></div>
        <div class="field"><label for="g">Tags <span class="hint">Separe por vírgula</span></label><input id="g" name="g" value="${(s?.tags ?? []).join(', ')}"></div>
        <div class="field"><label for="m">Link para ouvir <span class="hint">YouTube, Spotify, Deezer…</span></label><input id="m" name="m" type="url" placeholder="https://" value="${s?.media_url ?? ''}"></div>
        <div class="field"><label for="c">Link da cifra</label><input id="c" name="c" type="url" placeholder="https://" value="${s?.chart_url ?? ''}"></div></div>
        <div class="field"><label for="l">Letra / cifra em texto <span class="hint">Opcional</span></label><textarea id="l" name="l" maxlength="20000" rows="5">${s?.lyrics ?? ''}</textarea></div>`,
      onSubmit: async (fd) => {
        const dur = parseDuration(String(fd.get('d')));
        if (Number.isNaN(dur)) throw new Error('Duração inválida. Use o formato mm:ss, como 4:30.');
        const url = (v) => { const x = String(v).trim(); if (x && !/^https?:\/\//i.test(x)) throw new Error('Os links precisam começar com http:// ou https://.'); return x || null; };
        const row = {
          church_id: S.church.id, title: String(fd.get('t')).trim(), artist: String(fd.get('a')).trim() || null,
          song_key: String(fd.get('k')).trim() || null, bpm: fd.get('b') ? +fd.get('b') : null, duration_sec: dur,
          media_url: url(fd.get('m')), chart_url: url(fd.get('c')), lyrics: String(fd.get('l')).trim() || null,
          tags: String(fd.get('g')).split(',').map((x) => x.trim()).filter(Boolean),
        };
        await q(s ? sb.from('songs').update(row).eq('id', s.id) : sb.from('songs').insert(row));
        return true;
      },
    });
    if (ok) { invalidate('songs'); toast('Música salva.'); render(el); }
  }

  actions(el, {
    sort: (b) => { toggleSort(st, b.dataset.key); drawList(); },
    new: () => form(null),
    edit: (b) => form(L.songById.get(b.dataset.id)),
    lyrics: (b) => { const s = L.songById.get(b.dataset.id); formDialog({ title: s.title, submitText: 'Fechar', body: html`<pre style="white-space:pre-wrap;font-family:inherit">${s.lyrics}</pre>`, onSubmit: () => true }); },
    toggle: async (b) => {
      const s = L.songById.get(b.dataset.id);
      if (s.active && !(await confirmDialog({ title: 'Arquivar música?', danger: true, confirmText: 'Arquivar', message: html`<p><strong>${s.title}</strong> some das listas de escolha, mas continua nos setlists antigos.</p>` }))) return;
      try { await q(sb.from('songs').update({ active: !s.active }).eq('id', s.id)); invalidate('songs'); render(el); } catch (e) { toast(e.message, 'bad'); }
    },
  });
  actions(el, { search: (i) => { st.q = i.value; drawList(); } }, 'input');
  actions(el, { state: (s) => { st.off = s.value === '1'; drawList(); } }, 'change');
}
