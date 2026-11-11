import { dressFixture } from '../smoke/dress-fixture.mjs';
// Dados fictícios para a prévia visual (mesmos do teste de fumaça).
// ── dados falsos ─────────────────────────────────────────────────────────────
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = id(1), U = id(2);
const DF = dressFixture(C, id);
const church = { id: C, name: 'Igreja Teste', slug: 'teste', timezone: 'America/Cuiaba', public_mode: 'link', show_setlist_publicly: true };
const inDays = (n, h = 23) => new Date(Date.now() + n * 864e5).toISOString().replace(/T\d\d/, `T${h}`);
const roles = [
  { id: id(10), church_id: C, name: 'Vocal', category: 'voz', color: '#7C5CD6', is_essential: true, active: true },
  { id: id(11), church_id: C, name: 'Violão', category: 'instrumento', color: '#B8860B', is_essential: false, active: true },
  { id: id(12), church_id: C, name: 'Bateria', category: 'instrumento', color: '#4A5D23', is_essential: true, active: false },
];
const members = [
  { id: id(20), church_id: C, user_id: U, full_name: 'Ana Souza', status: 'active', deleted_at: null, member_roles: [{ role_id: id(10), is_primary: true }], team_members: [{ team_id: id(30), role_id: id(10) }] },
  { id: id(21), church_id: C, user_id: null, full_name: 'Caio Mendes', status: 'active', deleted_at: null, member_roles: [{ role_id: id(11), is_primary: true }, { role_id: id(10), is_primary: false }], team_members: [{ team_id: id(30), role_id: id(11) }] },
  { id: id(22), church_id: C, user_id: null, full_name: 'Duda Arquivada', status: 'archived', deleted_at: '2026-01-01T00:00:00Z', member_roles: [{ role_id: id(10), is_primary: true }], team_members: [] },
];
const teams = [{ id: id(30), church_id: C, name: 'Equipe A', color: '#2F5D62', leader_id: id(20), deleted_at: null, team_members: [{ member_id: id(20), role_id: id(10) }, { member_id: id(21), role_id: id(11) }] }];
const songs = [{ id: id(40), church_id: C, title: 'Grande é o Senhor', artist: 'Adhemar', song_key: 'G', bpm: 72, duration_sec: 270, media_url: 'https://youtu.be/x', chart_url: null, lyrics: 'letra', tags: ['adoração'], active: true }];
const ev1 = { id: id(50), church_id: C, team_id: id(30), kind: 'evento', title: 'Batismo no Rio', starts_at: inDays(10), location: 'Rio', status: 'published', notes: null, deleted_at: null, setlist_items: [{ count: 1 }] };
const ev2 = { id: id(51), church_id: C, team_id: id(30), kind: 'culto', title: null, starts_at: inDays(17), location: null, status: 'draft', notes: 'interno', deleted_at: null, setlist_items: [{ count: 0 }] };
const asg = (n, member, role, status, extra = {}) => ({ id: id(n), church_id: C, event_id: ev1.id, member_id: member, role_id: role, status, decline_reason: null, suggested_substitute_id: null, attended: null, events: ev1, ...extra });
const roster = [
  { event_id: ev1.id, assignment_id: id(60), member_id: id(20), member_name: 'Ana Souza', role_id: id(10), role_name: 'Vocal', role_color: '#7C5CD6', role_category: 'voz', status: 'pending', responded_by_name: null, decline_reason: null, attended: null },
  { event_id: ev1.id, assignment_id: id(61), member_id: id(21), member_name: 'Caio Mendes', role_id: id(11), role_name: 'Violão', role_color: '#B8860B', role_category: 'instrumento', status: 'declined', responded_by_name: 'Ana Souza', decline_reason: 'Viagem a trabalho no fim de semana', attended: null },
];
const pub = { church: { name: 'Igreja Teste', timezone: 'America/Cuiaba', public_mode: 'link' },
  events: [{ id: ev1.id, kind: 'evento', title: 'Batismo no Rio', starts_at: ev1.starts_at, location: 'Rio', team: 'Equipe A', team_color: '#2F5D62', roster: [{ name: 'Ana Souza', role: 'Vocal' }], setlist: [{ title: 'Grande é o Senhor', key: 'G', moment: 'abertura' }] }],
  teams: [{ name: 'Equipe A', color: '#2F5D62', members: [{ name: 'Ana Souza', role: 'Vocal' }] }], dress: DF.pub };

globalThis.__DB = {
  writes: [], rpcs: [],
  session: { user: { id: U, email: 'ana@x.com', user_metadata: { full_name: 'Ana Souza' } } },
  tables: {
    memberships: [{ id: id(3), church_id: C, user_id: U, role: 'owner', churches: church }],
    members, roles, teams, songs, events: [ev1, ev2],
    dress_codes: DF.codes, dress_weeks: DF.weeks,
    assignments: [asg(60, id(20), id(10), 'pending'), asg(61, id(21), id(11), 'declined', { decline_reason: 'Viagem', suggested_substitute_id: id(20) })],
    setlist_items: [{ song_id: id(40), position: 1, key_override: 'A', bpm_override: null, moment: 'abertura', event_id: ev1.id, events: { starts_at: inDays(-3), status: 'closed' } }],
    member_contacts: [{ member_id: id(20), church_id: C, phone: '+5565999990001', email: 'ana@x.com', notes: 'obs' }],
    unavailabilities: [{ id: id(70), member_id: id(20), start_date: '2026-10-01', end_date: '2026-10-03', reason: 'viagem' }],
    invites: [{ id: id(71), member_id: id(21), role: 'member', expires_at: inDays(5), accepted_at: null }],
    audit_log: [{ id: 1, entity: 'events', action: 'update', actor_user_id: U, created_at: inDays(-1), diff: { new: { status: 'published' } } }],
  },
  rpc: {
    event_roster: () => roster, member_loads: () => [{ member_id: id(20), load60: 3 }, { member_id: id(21), load60: 0 }],
    substitutes: () => [{ member_id: id(21), full_name: 'Caio Mendes', load60: 1 }], public_church: () => pub,
    archive_member: () => ({ ok: false, events: [{ event_id: ev1.id, kind: 'evento', title: 'Batismo no Rio', starts_at: ev1.starts_at, status: 'pending' }] }),
    archive_team: () => ({ ok: false, events: 2 }),
    respond_assignment: (a) => ({ id: a.p_id, status: a.p_action === 'confirm' ? 'confirmed' : 'declined', substitutes_available: 1 }),
    create_invite: () => 'abc123def456',
  },
};

