// Datas e horas sempre no fuso da igreja (RN-003). Sem dependências.

function offsetMs(ts, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}

/** '2026-09-20' + '19:00' no fuso tz -> ISO UTC. */
export function zonedToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(guess, tz);
  return new Date(guess - offsetMs(first, tz)).toISOString();
}

/** ISO UTC -> { date:'2026-09-20', time:'19:00' } no fuso tz. */
export function toLocalParts(iso, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const fmtDate = (iso, tz) => {
  const { date } = toLocalParts(iso, tz); const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
};
export const fmtTime = (iso, tz) => {
  const { time } = toLocalParts(iso, tz);
  return time.endsWith(':00') ? `${time.slice(0, 2)}h` : time.replace(':', 'h');
};
export const fmtWeekday = (iso, tz) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'short' }).format(new Date(iso)).replace('.', '');
export const fmtDateTime = (iso, tz) => `${fmtDate(iso, tz)} · ${fmtWeekday(iso, tz)} ${fmtTime(iso, tz)}`;
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const ymOf = (iso, tz) => toLocalParts(iso, tz).date.slice(0, 7);
export const todayIn = (tz) => toLocalParts(new Date().toISOString(), tz).date;

/** Soma dias a 'YYYY-MM-DD' (calendário civil, imune a horário de verão). */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function addMonthsKeepWeekday(date, n) {
  // mesma ocorrência do dia da semana (ex.: 2º domingo) no mês seguinte
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const nth = Math.ceil(d / 7);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const shift = (dow - first.getUTCDay() + 7) % 7;
  const day = 1 + shift + (nth - 1) * 7;
  const res = new Date(Date.UTC(y, m - 1 + n, day));
  if (res.getUTCMonth() !== ((m - 1 + n) % 12 + 12) % 12) return addDays(res.toISOString().slice(0, 10), -7);
  return res.toISOString().slice(0, 10);
}
export const addMonthKey = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

/** 'mm:ss' <-> segundos */
export const parseDuration = (s) => {
  if (!s) return null;
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(s.trim());
  return m ? +m[1] * 60 + +m[2] : NaN;
};
export const fmtDuration = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
export const fmtTotal = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
};

/** Normaliza para busca sem acento e sem caixa (RF-202). */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Telefone BR digitado -> E.164 (assume +55 quando faltar o código do país). */
export function toE164(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return '+' + digits;
  if (digits.length === 10 || digits.length === 11) return '+55' + digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return '+' + digits;
  return '+' + digits;
}
