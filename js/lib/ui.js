// Utilitários de interface: template HTML com escape automático, diálogos e avisos.
import { iconSvg } from './icons.js';

const RAW = Symbol('raw');

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const raw = (s) => ({ [RAW]: true, s: String(s) });

function part(v) {
  if (v == null || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}
/** Tagged template: todo valor interpolado é escapado, exceto resultados de html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}
export const toStr = (node) => part(node);
/** Ícone SVG pronto para html``. */
export const icon = (name, size) => raw(iconSvg(name, size));

/** Só aceita http(s) em links vindos do usuário (evita javascript:). */
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? '')) ? String(u) : '');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegação de eventos por data-act. */
export function actions(root, map, type = 'click') {
  // um único ouvinte por elemento e tipo; chamadas seguintes (re-render) só trocam o mapa
  root._acts ??= {};
  const first = !root._acts[type];
  root._acts[type] = map;
  if (!first) return;
  root.addEventListener(type, (e) => {
    const t = e.target.closest('[data-act]');
    const h = root._acts[type];
    if (t && root.contains(t) && h[t.dataset.act]) h[t.dataset.act](t, e);
  });
}

export function initials(name) {
  const p = String(name ?? '?').trim().split(/\s+/);
  return ((p[0]?.[0] ?? '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

// ── avisos ──────────────────────────────────────────────────────────────────
export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = iconSvg(kind === 'bad' ? 'alert' : 'check', 18);
  el.append(document.createTextNode(msg));
  el.addEventListener('click', () => el.remove());          // toque para dispensar
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, kind === 'bad' ? 7000 : 3500);
}

// ── diálogos (no celular viram "folha" que sobe de baixo, via CSS) ──────────
function makeDialog(inner, { lightDismiss = true } = {}) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = toStr(inner);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  // tocar fora (no fundo escurecido) fecha — só em diálogos sem formulário a preencher
  if (lightDismiss) {
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close('cancel');
    });
  }
  document.documentElement.classList.add('dlg-open');
  dlg.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('dlg-open'); });
  dlg.showModal();
  return dlg;
}

/** Confirmação. O botão padrão (foco) é sempre "Cancelar", nunca o destrutivo. */
export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const dlg = makeDialog(html`<form method="dialog">
      <div class="dlg-body"><h2>${title}</h2><div>${message}</div></div>
      <div class="dlg-foot">
        <button class="btn" value="cancel" autofocus>Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${confirmText}</button>
      </div></form>`);
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'));
  });
}

export function infoDialog({ title, body }) {
  return new Promise((resolve) => {
    const dlg = makeDialog(html`<form method="dialog">
      <div class="dlg-body"><h2>${title}</h2><div>${body}</div></div>
      <div class="dlg-foot"><button class="btn primary" autofocus>Fechar</button></div></form>`);
    dlg.addEventListener('close', () => resolve());
  });
}

/**
 * Diálogo com formulário. onSubmit(formData, dlg) pode lançar erro (mostrado no próprio
 * diálogo) ou retornar normalmente para fechar. Retorna o valor de onSubmit, ou null se cancelado.
 */
export function formDialog({ title, body, submitText = 'Salvar', onSubmit, onOpen, danger = false, wide = false }) {
  return new Promise((resolve) => {
    const dlg = makeDialog(html`<form novalidate>
      <div class="dlg-body"><h2>${title}</h2><div class="dlg-error" role="alert"></div>${body}</div>
      <div class="dlg-foot">
        <button type="button" class="btn" data-close>Cancelar</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${submitText}</button>
      </div></form>`, { lightDismiss: false });
    if (wide) dlg.classList.add('wide');
    let result = null;
    const form = dlg.querySelector('form');
    const errBox = dlg.querySelector('.dlg-error');
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      errBox.innerHTML = ''; btn.disabled = true; btn.classList.add('loading');
      try {
        if (!form.reportValidity()) { btn.disabled = false; btn.classList.remove('loading'); return; }
        result = (await onSubmit(new FormData(form), dlg)) ?? true;
        dlg.close();
      } catch (err) {
        errBox.innerHTML = `<div class="alert bad">${esc(err.message || String(err))}</div>`;
        errBox.scrollIntoView?.({ block: 'nearest' });
        btn.disabled = false; btn.classList.remove('loading');
      }
    });
    dlg.addEventListener('close', () => resolve(result));
    onOpen?.(dlg);
    dlg.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  });
}

export function showDialog(inner) { return makeDialog(inner); }

// ── peças de tela reutilizáveis ─────────────────────────────────────────────
/** Esqueleto de carregamento: mostra a forma da página em vez de um “Carregando…” solto. */
export const spinner = () => html`<div class="skeleton" role="status" aria-label="Carregando">
  <div class="sk sk-title"></div><div class="sk sk-line" style="width:40%"></div>
  <div class="sk-cards"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div>
  <div class="sk sk-line"></div><div class="sk sk-line" style="width:85%"></div><div class="sk sk-line" style="width:70%"></div></div>`;
export const empty = (title, text, action = '', ic = 'inbox') =>
  html`<div class="empty"><span class="empty-ic">${icon(ic, 28)}</span><strong>${title}</strong>${text ? html`<span>${text}</span>` : ''}${action ? html`<div class="empty-act">${action}</div>` : ''}</div>`;
export const errorBox = (err) =>
  html`<div class="alert bad" role="alert"><strong>Não foi possível carregar.</strong> ${err.message || err}
    <div style="margin-top:.5rem"><button class="btn sm" data-reload>Tentar de novo</button></div></div>`;

export const STATUS = {
  pending:   { label: 'Pendente',   cls: 'warn' },
  confirmed: { label: 'Confirmado', cls: 'ok' },
  declined:  { label: 'Recusou',    cls: 'bad' },
  expired:   { label: 'Sem resposta', cls: 'bad' },
  replaced:  { label: 'Substituído', cls: '' },
  closed:    { label: 'Encerrada',  cls: '' },
  cancelled: { label: 'Cancelada',  cls: '' },
};
export const statusChip = (s) => html`<span class="chip ${STATUS[s]?.cls ?? ''}">${STATUS[s]?.label ?? s}</span>`;
export const EVENT_STATUS = {
  draft: { label: 'Rascunho', cls: 'warn' }, published: { label: 'Publicada', cls: 'ok' },
  closed: { label: 'Encerrada', cls: '' }, cancelled: { label: 'Cancelada', cls: 'bad' },
};
export const eventChip = (s) => html`<span class="chip ${EVENT_STATUS[s]?.cls ?? ''}">${EVENT_STATUS[s]?.label ?? s}</span>`;
export const KIND = { culto: 'Culto', evento: 'Evento', ensaio: 'Ensaio' };
export const KIND_COLOR = { culto: '#3446D4', evento: '#0E8A7E', ensaio: '#B7791F' };
export const CATEGORY = { voz: 'Voz', instrumento: 'Instrumento', tecnica: 'Técnica', lideranca: 'Liderança' };
export const MOMENT = { abertura: 'Abertura', adoracao: 'Adoração', ofertorio: 'Ofertório', ministracao: 'Ministração', encerramento: 'Encerramento' };

/** Barra de cobertura: confirmados / escalados ativos. */
export function coverage(rows) {
  const act = rows.filter((r) => !['replaced', 'cancelled', 'declined'].includes(r.status));
  const conf = act.filter((r) => r.status === 'confirmed' || r.status === 'closed').length;
  const total = rows.filter((r) => !['replaced', 'cancelled'].includes(r.status)).length;
  const declined = rows.filter((r) => r.status === 'declined').length;
  const pct = total ? Math.round((conf / total) * 100) : 0;
  return { conf, total, declined, pct, cls: pct >= 90 ? '' : pct >= 50 ? 'partial' : 'low' };
}
export const coverageBar = (c) => html`<div class="row" style="flex-wrap:nowrap"><div class="bar ${c.cls}" style="flex:1" role="img" aria-label="${c.conf} de ${c.total} confirmados"><span style="width:${c.pct}%"></span></div><span class="small nowrap">${c.conf}/${c.total}${c.declined ? html` · ${c.declined} recusa${c.declined > 1 ? 's' : ''}` : ''}</span></div>`;

/** Ordena uma tabela por coluna (RF-201). */
export function sortRows(rows, key, dir, getters = {}) {
  const get = getters[key] ?? ((r) => r[key]);
  const cmp = (a, b) => {
    const x = get(a), y = get(b);
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { sensitivity: 'base' });
  };
  return [...rows].sort((a, b) => (dir === 'desc' ? -cmp(a, b) : cmp(a, b)));
}
export const sortTh = (label, key, st) =>
  html`<th scope="col" ${st.key === key ? raw(`aria-sort="${st.dir === 'desc' ? 'descending' : 'ascending'}"`) : ''}><button type="button" data-act="sort" data-key="${key}">${label}</button></th>`;
export function toggleSort(st, key) {
  if (st.key === key) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.key = key; st.dir = 'asc'; }
}

export function download(filename, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado!'); } catch { toast('Não foi possível copiar. Selecione e copie manualmente.', 'bad'); }
}
