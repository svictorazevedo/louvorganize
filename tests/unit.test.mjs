// Testes das funções puras do front-end. Rodar: npm test  (Node 20+)
import test from 'node:test';
import assert from 'node:assert/strict';
import { html, toStr, esc, safeUrl, raw } from '../js/lib/ui.js';
import {
  zonedToUtc, toLocalParts, fmtDate, fmtTime, addDays, addMonthsKeepWeekday, norm, toE164, parseDuration, fmtDuration,
} from '../js/lib/time.js';
import { parseCsv, toCsv } from '../js/lib/csv.js';
import { buildIcs } from '../js/lib/ics.js';

test('html`` escapa tudo que é interpolado (XSS)', () => {
  const evil = `<img src=x onerror=alert(1)>"'&`;
  assert.equal(toStr(html`<p>${evil}</p>`), '<p>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>');
  assert.equal(toStr(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
});
test('html`` aceita aninhamento, listas e ignora vazios', () => {
  assert.equal(toStr(html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>${null}${false}${undefined}`), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(toStr(html`${raw('<b>ok</b>')}`), '<b>ok</b>');
  assert.equal(toStr(html`${0}`), '0');
});
test('safeUrl só aceita http(s)', () => {
  assert.equal(safeUrl('https://youtu.be/x'), 'https://youtu.be/x');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl(null), '');
});

test('fuso: 19h em Cuiabá (UTC-4) = 23h UTC', () => {
  assert.equal(zonedToUtc('2026-09-20', '19:00', 'America/Cuiaba'), '2026-09-20T23:00:00.000Z');
  assert.equal(zonedToUtc('2026-09-20', '19:00', 'America/Sao_Paulo'), '2026-09-20T22:00:00.000Z');
});
test('fuso: ida e volta preserva data e hora', () => {
  for (const tz of ['America/Cuiaba', 'America/Sao_Paulo', 'America/Rio_Branco', 'America/Noronha']) {
    const iso = zonedToUtc('2026-12-31', '23:30', tz);
    assert.deepEqual(toLocalParts(iso, tz), { date: '2026-12-31', time: '23:30' });
  }
});
test('fuso: o mesmo instante tem datas diferentes em fusos diferentes (meia-noite)', () => {
  const iso = zonedToUtc('2026-09-21', '00:30', 'America/Sao_Paulo');
  assert.equal(fmtDate(iso, 'America/Sao_Paulo'), '21/09/2026');
  assert.equal(fmtDate(iso, 'America/Cuiaba'), '20/09/2026');
});
test('formatação de hora: 19h e 19h30', () => {
  assert.equal(fmtTime(zonedToUtc('2026-09-20', '19:00', 'America/Cuiaba'), 'America/Cuiaba'), '19h');
  assert.equal(fmtTime(zonedToUtc('2026-09-20', '19:30', 'America/Cuiaba'), 'America/Cuiaba'), '19h30');
});
test('datas: addDays atravessa mês e ano; recorrência mensal mantém o dia da semana', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  // 2º domingo de setembro/2026 = dia 13 -> 2º domingo de outubro = 11
  assert.equal(addMonthsKeepWeekday('2026-09-13', 1), '2026-10-11');
  // 5º domingo (30/08/2026) -> mês sem 5º domingo cai no último
  assert.equal(new Date(addMonthsKeepWeekday('2026-08-30', 1) + 'T00:00:00Z').getUTCDay(), 0);
});
test('busca sem acento e sem caixa', () => {
  assert.equal(norm('  João  AÇÃO '), 'joao  acao');
  assert.ok(norm('Conceição Álvares').includes(norm('conceicao')));
});
test('telefone para E.164', () => {
  assert.equal(toE164('(65) 99999-0001'), '+5565999990001');
  assert.equal(toE164('65 3333-4444'), '+556533334444');
  assert.equal(toE164('+55 65 99999-0001'), '+5565999990001');
  assert.equal(toE164('5565999990001'), '+5565999990001');
  assert.equal(toE164(''), '');
});
test('duração mm:ss', () => {
  assert.equal(parseDuration('4:30'), 270);
  assert.equal(parseDuration(''), null);
  assert.ok(Number.isNaN(parseDuration('4:75')));
  assert.equal(fmtDuration(270), '4:30');
  assert.equal(fmtDuration(null), '');
});

test('CSV: aspas, ; e vírgula, BOM, linhas em branco', () => {
  const r = parseCsv('﻿nome;email;funcoes\r\n"Silva, João";j@x.com;Vocal|Violão\r\n\r\nAna;;"Teclado"\r\n');
  assert.deepEqual(r, [['nome', 'email', 'funcoes'], ['Silva, João', 'j@x.com', 'Vocal|Violão'], ['Ana', '', 'Teclado']]);
  assert.deepEqual(parseCsv('a,b\n1,"x ""y"" z"'), [['a', 'b'], ['1', 'x "y" z']]);
});
test('CSV de saída neutraliza fórmulas de planilha', () => {
  assert.equal(toCsv([['=HYPERLINK("x")', '+1', 'ok']]), `"'=HYPERLINK(""x"")";"'+1";"ok"`);
});
test('ICS: estrutura mínima e escape', () => {
  const s = buildIcs([{ id: 'a1', title: 'Culto; Equipe A, vocal', starts_at: '2026-09-20T23:00:00.000Z', location: 'Templo' }], 'Igreja');
  assert.match(s, /BEGIN:VCALENDAR/); assert.match(s, /DTSTART:20260920T230000Z/); assert.match(s, /DTEND:20260921T010000Z/);
  assert.match(s, /SUMMARY:Culto\\; Equipe A\\, vocal/); assert.match(s, /END:VCALENDAR\r\n$/);
});
test('esc', () => assert.equal(esc(`<a href="x">'&</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;'));
