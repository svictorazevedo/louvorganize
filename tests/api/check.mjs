// Integração: roda as MESMAS consultas do app contra um PostgREST real (o motor da API do Supabase).
// Pré-requisito: tests/run-api.sh (sobe Postgres + PostgREST com os dados de tests/01_rules.sql).
import { createHmac } from 'node:crypto';
import { PostgrestClient } from '@supabase/postgrest-js';

const URL_ = process.env.PGRST_URL ?? 'http://lo-rest:3000';
const SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, role = 'authenticated') => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ sub, role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};
const as = (sub) => new PostgrestClient(URL_, { headers: sub ? { Authorization: `Bearer ${jwt(sub)}` } : {} });
const ANA = 'a0000000-0000-0000-0000-00000000000a', DUDA = 'd0000000-0000-0000-0000-00000000000d', CAIO = 'c0000000-0000-0000-0000-00000000000c', BIA = 'b0000000-0000-0000-0000-00000000000b';

let fails = 0;
async function check(name, fn) {
  try { const r = await fn(); console.log('  ok    ', name, r ? `— ${r}` : ''); } catch (e) { fails++; console.log('  FALHOU', name, '—', e.message); }
}
const ok = async (p) => { const { data, error } = await p; if (error) throw new Error(`${error.code} ${error.message} ${error.details ?? ''} ${error.hint ?? ''}`); return data; };
const must = (c, msg) => { if (!c) throw new Error(msg); };

const ana = as(ANA);
const ms = await ok(ana.from('memberships').select('id, church_id, role, churches(id, name, slug, timezone, public_mode, show_setlist_publicly)').eq('user_id', ANA).order('created_at'));
const C = ms[0].church_id;
const now = new Date().toISOString();

await check('contexto: memberships + churches', () => { must(ms.length === 1 && ms[0].churches?.slug === 'igreja-a' && ms[0].role === 'owner', JSON.stringify(ms)); return ms[0].churches.name; });
await check('contexto: meu integrante (maybeSingle)', async () => { const me = await ok(ana.from('members').select('*').eq('church_id', C).eq('user_id', ANA).is('deleted_at', null).maybeSingle()); must(me?.full_name === 'Ana Souza', 'sem me'); });
await check('lista: roles', async () => `${(await ok(ana.from('roles').select('*').eq('church_id', C).order('name'))).length} funções`);
await check('lista: teams + team_members (FK composta)', async () => {
  const t = await ok(ana.from('teams').select('*, team_members(member_id, role_id)').eq('church_id', C).is('deleted_at', null).order('name'));
  must(t[0].team_members.length === 3, JSON.stringify(t[0].team_members)); return `${t.length} equipe(s)`;
});
await check('lista: members + member_roles + team_members', async () => {
  const m = await ok(ana.from('members').select('*, member_roles(role_id, is_primary), team_members(team_id, role_id)').eq('church_id', C).order('full_name'));
  const caio = m.find((x) => x.full_name === 'Caio Mendes'); must(caio.member_roles.length === 2 && caio.team_members.length === 1, JSON.stringify(caio)); return `${m.length} integrantes`;
});
await check('lista: songs e contatos (gestor)', async () => { await ok(ana.from('songs').select('*').eq('church_id', C).order('title')); return `${(await ok(ana.from('member_contacts').select('*').eq('church_id', C))).length} contatos`; });
await check('rpc: refresh_states', () => ok(ana.rpc('refresh_states', { p_church: C })));
await check('início: minhas escalações com events!inner + filtros no embed', async () => {
  const caio = as(CAIO); const me = await ok(caio.from('members').select('id').eq('user_id', CAIO).maybeSingle());
  const r = await ok(caio.from('assignments').select('*, events!inner(*)').eq('member_id', me.id).in('status', ['pending', 'expired', 'confirmed'])
    .eq('events.status', 'published').is('events.deleted_at', null).gt('events.starts_at', now));
  return `${r.length} linha(s)`;
});
await check('início: escalas futuras com setlist_items(count)', async () => {
  const e = await ok(ana.from('events').select('*, setlist_items(count)').eq('church_id', C).is('deleted_at', null).in('status', ['draft', 'published']).gt('starts_at', now).order('starts_at').limit(6));
  must(e.some((x) => x.setlist_items?.[0]?.count === 1), JSON.stringify(e.map((x) => x.setlist_items))); return `${e.length} escala(s)`;
});
await check('início: pendências (recusas/expiradas)', async () => `${(await ok(ana.from('assignments').select('*, events!inner(*)').in('status', ['declined', 'expired']).eq('events.status', 'published').is('events.deleted_at', null).gt('events.starts_at', now))).length} pendência(s)`);
const ev = (await ok(ana.from('events').select('id, starts_at, team_id').eq('church_id', C).eq('kind', 'culto').maybeSingle()));
await check('escala: event_roster (rpc com array)', async () => { const r = await ok(ana.rpc('event_roster', { p_event_ids: [ev.id] })); must(r.length >= 3 && r[0].status, JSON.stringify(r[0])); return `${r.length} escalação(ões)`; });
await check('escala: member_loads, indisponibilidades do dia, músicas recentes', async () => {
  await ok(ana.rpc('member_loads', { p_church: C }));
  await ok(ana.from('unavailabilities').select('member_id, reason').eq('church_id', C).lte('start_date', '2026-12-01').gte('end_date', '2026-12-01'));
  await ok(ana.from('setlist_items').select('song_id, event_id, events!inner(starts_at, status, deleted_at)').eq('church_id', C).in('events.status', ['published', 'closed'])
    .gte('events.starts_at', new Date(Date.now() - 30 * 864e5).toISOString()).lt('events.starts_at', ev.starts_at).neq('event_id', ev.id));
});
await check('escala: conflito de horário (not in + embed)', async () => {
  const t = new Date(ev.starts_at).getTime();
  await ok(ana.from('assignments').select('id, events!inner(id, kind, title, starts_at, status, deleted_at)').eq('member_id', (await ok(ana.from('members').select('id').eq('user_id', ANA).maybeSingle())).id)
    .not('status', 'in', '(declined,replaced,cancelled)').neq('event_id', ev.id).is('events.deleted_at', null).neq('events.status', 'cancelled')
    .gte('events.starts_at', new Date(t - 3 * 3600e3).toISOString()).lte('events.starts_at', new Date(t + 3 * 3600e3).toISOString()));
});
await check('escala: upsert de escalação com onConflict', async () => {
  const m = await ok(ana.from('members').select('id, member_roles(role_id)').eq('church_id', C).eq('full_name', 'Extra Pessoa 9').maybeSingle());
  const row = { church_id: C, event_id: ev.id, member_id: m.id, role_id: m.member_roles[0].role_id, status: 'pending', responded_at: null, responded_by: null, decline_reason: null, replaced_by_assignment_id: null };
  await ok(ana.from('assignments').upsert(row, { onConflict: 'event_id,member_id,role_id' }));
  await ok(ana.from('assignments').upsert(row, { onConflict: 'event_id,member_id,role_id' }));
});
await check('escala: criar rascunho (insert + select single) e aplicar equipe', async () => {
  const e = await ok(ana.from('events').insert({ church_id: C, kind: 'culto', title: null, location: null, notes: null, team_id: ev.team_id, starts_at: new Date(Date.now() + 40 * 864e5).toISOString(), recurrence_id: null, created_by: ANA }).select('id').single());
  return `${await ok(ana.rpc('apply_team', { p_event: e.id, p_team: ev.team_id }))} escalação(ões) criadas`;
});
await check('líder (Caio) cria escala da equipe dele', async () => {
  const e = await ok(as(CAIO).from('events').insert({ church_id: C, kind: 'ensaio', team_id: ev.team_id, starts_at: new Date(Date.now() + 41 * 864e5).toISOString(), created_by: CAIO }).select('id').single());
  must(e.id, 'sem id');
});
await check('ensaio: clonar equipe e setlist de um culto (líder Caio)', async () => {
  const caio = as(CAIO); const cols = 'song_id, key_override, bpm_override, moment';
  const d = new Date(ev.starts_at); const from = new Date(d - 12 * 3600e3).toISOString(); const to = new Date(+d + 12 * 3600e3).toISOString();
  const opts = await ok(caio.from('events').select('id, kind, title, starts_at, status, team_id').eq('church_id', C).in('kind', ['culto', 'evento'])
    .is('deleted_at', null).neq('status', 'cancelled').gte('starts_at', from).lt('starts_at', to).order('starts_at'));
  must(opts.some((o) => o.id === ev.id), 'culto não listado na data');
  const e = await ok(caio.from('events').insert({ church_id: C, kind: 'ensaio', team_id: ev.team_id, starts_at: new Date(d - 3 * 864e5).toISOString(), created_by: CAIO }).select('id').single());
  const clone = async () => {
    const [asg, items, cur] = await Promise.all([
      ok(caio.from('assignments').select('member_id, role_id').eq('event_id', ev.id).not('status', 'in', '(declined,replaced,cancelled)')),
      ok(caio.from('setlist_items').select(cols).eq('event_id', ev.id).order('position')),
      ok(caio.from('setlist_items').select(cols).eq('event_id', e.id).order('position')),
    ]);
    await ok(caio.from('assignments').upsert(asg.map((a) => ({ church_id: C, event_id: e.id, member_id: a.member_id, role_id: a.role_id, status: 'pending' })),
      { onConflict: 'event_id,member_id,role_id', ignoreDuplicates: true }));
    const have = new Set(cur.map((x) => x.song_id)); const add = items.filter((x) => !have.has(x.song_id));
    if (add.length) await ok(caio.rpc('save_setlist', { p_event: e.id, p_items: [...cur, ...add] }));
    return asg.length;
  };
  const n = await clone(); await clone();   // segunda vez não duplica
  const [a2, s1, s2] = await Promise.all([ok(caio.from('assignments').select('id').eq('event_id', e.id)),
    ok(caio.from('setlist_items').select('song_id').eq('event_id', ev.id)), ok(caio.from('setlist_items').select('song_id').eq('event_id', e.id))]);
  must(n > 0 && a2.length === n && s2.length === s1.length && s1.length > 0, `asg ${n}/${a2.length} set ${s1.length}/${s2.length}`);
  return `${n} escalação(ões), ${s2.length} música(s)`;
});
await check('integrante comum (Duda) NÃO cria escala', async () => {
  const { error } = await as(DUDA).from('events').insert({ church_id: C, kind: 'ensaio', starts_at: now }).select('id').single();
  must(error, 'deveria falhar');
});
await check('perfil: histórico com events!inner', async () => `${(await ok(ana.from('assignments').select('*, events!inner(*)').eq('member_id', (await ok(ana.from('members').select('id').eq('user_id', CAIO).maybeSingle())).id).is('events.deleted_at', null))).length} linha(s)`);
await check('relatório: assignments por período', async () => `${(await ok(ana.from('assignments').select('member_id, role_id, status, attended, events!inner(starts_at, status, deleted_at)').eq('church_id', C).is('events.deleted_at', null).in('events.status', ['published', 'closed']).gte('events.starts_at', '2026-01-01T00:00:00Z').lt('events.starts_at', '2027-12-31T00:00:00Z').not('status', 'in', '(replaced,cancelled)'))).length} linha(s)`);
await check('configurações: convites, auditoria, salvar igreja', async () => {
  await ok(ana.from('invites').select('*').eq('church_id', C).is('accepted_at', null).order('created_at', { ascending: false }));
  const a = await ok(ana.from('audit_log').select('*').eq('church_id', C).order('id', { ascending: false }).limit(60));
  await ok(ana.from('churches').update({ name: 'Igreja A', timezone: 'America/Cuiaba', public_mode: 'link', show_setlist_publicly: true }).eq('id', C));
  return `${a.length} registros de auditoria`;
});
await check('minhas: indisponibilidade e contato próprio (Duda)', async () => {
  const d = as(DUDA); const me = await ok(d.from('members').select('id').eq('user_id', DUDA).maybeSingle());
  await ok(d.from('unavailabilities').insert({ church_id: C, member_id: me.id, start_date: '2027-01-10', end_date: '2027-01-12', reason: 'férias' }));
  await ok(d.from('member_contacts').upsert({ member_id: me.id, church_id: C, phone: '+5565988887777', email: 'duda@a.com', notes: null }));
  const others = await ok(d.from('member_contacts').select('*'));
  must(others.length === 1, `Duda vê ${others.length} contatos`);
});
await check('público (anon): public_church sem dados privados', async () => {
  const p = await ok(as(null).rpc('public_church', { p_slug: 'igreja-a' }));
  must(p?.church?.name && !JSON.stringify(p).includes('5565'), 'vazou ou vazio'); return `${p.events.length} escala(s), ${p.teams.length} equipe(s)`;
});
await check('isolamento via API: Bia (Igreja B) não vê nada da A', async () => {
  const b = as(BIA);
  for (const t of ['members', 'events', 'assignments', 'member_contacts', 'teams', 'roles', 'songs']) {
    const r = await ok(b.from(t).select('church_id').eq('church_id', C)); must(r.length === 0, `${t}: ${r.length}`);
  }
});
await check('anon não lê tabelas', async () => { const { error } = await as(null).from('members').select('*'); must(error, 'anon leu members'); });

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODAS AS CONSULTAS DO APP FUNCIONAM NO POSTGREST');
process.exit(fails ? 1 : 0);
