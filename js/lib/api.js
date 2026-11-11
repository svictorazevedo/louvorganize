// Cliente Supabase, estado da sessão e cache de listas de referência.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

/** Recusa chaves secretas: elas ignoram o RLS e não podem ir para o navegador. */
function isSecretKey(k) {
  if (k.startsWith('sb_secret_')) return true;
  try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; } catch { return false; }
}
export const secretKeyError = isSecretKey(SUPABASE_ANON_KEY);
export const configured = !secretKeyError
  && /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 40;

export const sb = configured
  ? createClient(SUPABASE_URL.replace(/\/$/, ''), SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    })
  : null;

// ── erros em português, dizendo o que aconteceu e o que fazer (§6.1, §9) ───
const AUTH_MSG = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Confirme seu e-mail antes de entrar. Procure a mensagem na sua caixa de entrada (e no spam).'],
  [/user already registered/i, 'Este e-mail já tem cadastro. Use “Entrar” ou “Esqueci minha senha”.'],
  [/password should be at least/i, 'A senha precisa ter pelo menos 8 caracteres.'],
  [/rate limit|too many|over_email_send_rate_limit/i, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'],
  [/weak|pwned|easy to guess/i, 'Essa senha é fraca ou já apareceu em vazamentos. Escolha outra.'],
  [/failed to fetch|networkerror|load failed/i, 'Sem conexão com o servidor. Verifique a internet e tente de novo.'],
  [/jwt expired|invalid jwt|not authenticated/i, 'Sua sessão expirou. Entre novamente.'],
];
const CONSTRAINT_MSG = {
  event_title_required: 'Para escalas do tipo “Evento”, informe o nome do evento (mínimo 3 letras).',
  decline_needs_reason: 'Conte o motivo com pelo menos 10 caracteres.',
  roles_name_key: 'Já existe uma função com esse nome.',
  teams_name_key: 'Já existe uma equipe com esse nome.',
  songs_title_key: 'Esta música já está na biblioteca (mesmo título e artista).',
};
export function friendly(err) {
  const raw = String(err?.message ?? err ?? 'Erro desconhecido');
  for (const [re, msg] of AUTH_MSG) if (re.test(raw)) return Object.assign(new Error(msg), { cause: err });
  const text = `${err?.message ?? ''} ${err?.details ?? ''}`;
  for (const [k, msg] of Object.entries(CONSTRAINT_MSG)) if (text.includes(k)) return new Error(msg);
  if (err?.code === '23505') return new Error('Já existe um registro com esses dados.');
  if (err?.code === '23514') return new Error('Algum campo está fora do permitido. Revise os dados e tente de novo.');
  if (err?.code === '42501' || /row-level security/i.test(raw)) return new Error('Você não tem permissão para esta ação.');
  if (err?.code === '23503') return new Error('Este registro está em uso por outro cadastro e não pode ser alterado assim.');
  return err instanceof Error ? err : new Error(raw);
}
/** Executa uma chamada Supabase e devolve data, ou lança um erro amigável. */
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw friendly(error);
  return data;
}

// ── estado ──────────────────────────────────────────────────────────────────
export const S = { user: null, memberships: [], church: null, role: null, me: null, leads: false, ref: {} };
export const isAdmin = () => S.role === 'owner' || S.role === 'admin';
export const isManager = () => isAdmin() || S.leads;
export const tz = () => S.church?.timezone || 'America/Cuiaba';

const KEY = 'lo.church';
function remember(id) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
function remembered() { try { return localStorage.getItem(KEY); } catch { return null; } }

export async function loadContext() {
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user ?? null;
  S.memberships = []; S.church = null; S.role = null; S.me = null; S.leads = false; S.ref = {};
  if (!S.user) return;
  const ms = await q(sb.from('memberships')
    .select('id, church_id, role, churches(id, name, slug, timezone, public_mode, show_setlist_publicly)')
    .eq('user_id', S.user.id)            // o RLS deixa ver os acessos de toda a igreja; aqui só os meus
    .order('created_at'));
  S.memberships = ms.filter((m) => m.churches);
  if (!S.memberships.length) return;
  const pick = S.memberships.find((m) => m.church_id === remembered()) ?? S.memberships[0];
  await setChurch(pick.church_id);
}

export async function setChurch(id) {
  const m = S.memberships.find((x) => x.church_id === id);
  if (!m) return;
  S.church = m.churches; S.role = m.role; S.ref = {}; remember(id);
  const me = await q(sb.from('members').select('*').eq('church_id', id).eq('user_id', S.user.id).is('deleted_at', null).maybeSingle());
  S.me = me;
  S.leads = false;
  if (me) {
    const t = await q(sb.from('teams').select('id').eq('church_id', id).eq('leader_id', me.id).is('deleted_at', null).limit(1));
    S.leads = t.length > 0;
  }
  // estados que dependem do tempo (expiração a D-3, encerramento): idempotente
  try { await sb.rpc('refresh_states', { p_church: id }); } catch { /* não crítico */ }
}

// ── listas de referência em cache ──────────────────────────────────────────
async function cached(name, loader) {
  if (!S.ref[name]) S.ref[name] = loader();
  try { return await S.ref[name]; } catch (e) { delete S.ref[name]; throw e; }
}
export const invalidate = (...names) => names.forEach((n) => delete S.ref[n]);
export const getRoles = () => cached('roles', () => q(sb.from('roles').select('*').eq('church_id', S.church.id).order('name')));
export const getTeams = () => cached('teams', () =>
  q(sb.from('teams').select('*, team_members(member_id, role_id)').eq('church_id', S.church.id).is('deleted_at', null).order('name')));
export const getMembers = () => cached('members', () =>
  q(sb.from('members').select('*, member_roles(role_id, is_primary), team_members(team_id, role_id)')
    .eq('church_id', S.church.id).order('full_name')));
export const getSongs = () => cached('songs', () => q(sb.from('songs').select('*').eq('church_id', S.church.id).order('title')));
export async function getContacts() {
  if (!isManager()) return new Map();
  const rows = await cached('contacts', () => q(sb.from('member_contacts').select('*').eq('church_id', S.church.id)));
  return new Map(rows.map((r) => [r.member_id, r]));
}
export async function lookups() {
  const [roles, teams, members, songs] = await Promise.all([getRoles(), getTeams(), getMembers(), getSongs()]);
  return {
    roles, teams, members, songs,
    roleById: new Map(roles.map((r) => [r.id, r])),
    teamById: new Map(teams.map((t) => [t.id, t])),
    memberById: new Map(members.map((m) => [m.id, m])),
    songById: new Map(songs.map((s) => [s.id, s])),
  };
}

// ── vestimenta ──────────────────────────────────────────────────────────────
export const getDressCodes = () => cached('dress', () =>
  q(sb.from('dress_codes').select('*').eq('church_id', S.church.id).order('position').order('name')));
/** Semanas escaladas entre dois domingos (inclusive), já com o padrão atual: Map(week_start → código). */
export async function getDressWeeks(from, to) {
  const [codes, weeks] = await Promise.all([getDressCodes(),
    q(sb.from('dress_weeks').select('week_start, dress_code_id').eq('church_id', S.church.id).gte('week_start', from).lte('week_start', to))]);
  const byId = new Map(codes.map((c) => [c.id, c]));
  return new Map(weeks.filter((w) => byId.has(w.dress_code_id)).map((w) => [w.week_start, byId.get(w.dress_code_id)]));
}
