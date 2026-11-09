// Exporta escalas como arquivo .ics (RF-706 — versão estática, sem assinatura).
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line) => {
  const out = []; let s = line;
  while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); }
  out.push(s); return out.join('\r\n');
};

/** items: [{ id, title, starts_at, location, description, durationMin }] */
export function buildIcs(items, calName = 'LouvOrganize') {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LouvOrganize//PT-BR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(calName)}`];
  for (const it of items) {
    const end = new Date(new Date(it.starts_at).getTime() + (it.durationMin ?? 120) * 60000);
    lines.push('BEGIN:VEVENT', `UID:${it.id}@louvorganize`, `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(it.starts_at)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(it.title)}`);
    if (it.location) lines.push(`LOCATION:${esc(it.location)}`);
    if (it.description) lines.push(`DESCRIPTION:${esc(it.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
