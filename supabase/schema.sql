-- ============================================================================
-- LouvOrganize — esquema do banco (Supabase / PostgreSQL 15+)
--
-- Como usar: Supabase > SQL Editor > New query > cole TUDO > Run.
-- É seguro rodar em um projeto novo. Para recriar do zero, rode antes:
--   drop schema public cascade; create schema public;
--   grant usage on schema public to anon, authenticated, service_role;
--   alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
--   alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
--
-- Princípios (ver louvorganize-spec.md):
--  * Multi-igreja: toda tabela de domínio tem church_id e RLS (RNF-01).
--  * Exclusão lógica (deleted_at / status), nunca física, para dados de histórico.
--  * Regras de negócio vivem no banco (checks, triggers e funções), a interface só as espelha.
--  * Notificações estão FORA desta versão (nenhuma tabela/envio de notificação).
-- ============================================================================

-- ─── Tenancy ────────────────────────────────────────────────────────────────
create table churches (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 2 and 120),
  slug          text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  timezone      text not null default 'America/Cuiaba',
  public_mode   text not null default 'link' check (public_mode in ('public','link','off')),
  show_setlist_publicly boolean not null default true,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index churches_slug_key on churches (slug);

create table memberships (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'member' check (role in ('owner','admin','leader','member')),
  created_at    timestamptz not null default now(),
  unique (church_id, user_id)
);
create index on memberships (user_id);

-- ─── Pessoas, funções, equipes ──────────────────────────────────────────────
create table members (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,   -- nulo = sem conta
  full_name     text not null check (char_length(btrim(full_name)) between 3 and 120),
  status        text not null default 'active' check (status in ('active','invited','archived')),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (id, church_id),
  unique (church_id, user_id)
);
create index on members (church_id, status);

-- Dados de contato ficam separados: só líderes/admins (e o próprio dono) leem (LGPD).
create table member_contacts (
  member_id     uuid primary key,
  church_id     uuid not null,
  phone         text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),   -- E.164
  email         text check (email is null or char_length(email) <= 254),
  notes         text check (notes is null or char_length(notes) <= 500),
  foreign key (member_id, church_id) references members(id, church_id) on delete cascade
);

create table roles (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 60),
  category      text not null default 'instrumento'
                check (category in ('voz','instrumento','tecnica','lideranca')),
  color         text not null default '#7A1F3D' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_essential  boolean not null default false,
  active        boolean not null default true,
  unique (id, church_id)
);
create unique index roles_name_key on roles (church_id, lower(btrim(name))) where active;

create table member_roles (   -- N:N — um integrante pode ter várias funções
  member_id     uuid not null,
  role_id       uuid not null,
  church_id     uuid not null,
  is_primary    boolean not null default false,
  primary key (member_id, role_id),
  foreign key (member_id, church_id) references members(id, church_id) on delete cascade,
  foreign key (role_id, church_id)   references roles(id, church_id)   on delete cascade
);

create table teams (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 60),
  color         text not null default '#2F5D62' check (color ~ '^#[0-9a-fA-F]{6}$'),
  leader_id     uuid,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (id, church_id),
  foreign key (leader_id, church_id) references members(id, church_id)
);
create unique index teams_name_key on teams (church_id, lower(btrim(name))) where deleted_at is null;

create table team_members (
  team_id       uuid not null,
  member_id     uuid not null,
  role_id       uuid not null,
  church_id     uuid not null,
  primary key (team_id, member_id, role_id),
  foreign key (team_id, church_id)   references teams(id, church_id)   on delete cascade,
  foreign key (member_id, church_id) references members(id, church_id) on delete cascade,
  foreign key (role_id, church_id)   references roles(id, church_id)
);

-- ─── Escalas e escalações ───────────────────────────────────────────────────
create table events (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  team_id       uuid,                                  -- equipe base (modelo)
  kind          text not null check (kind in ('culto','evento','ensaio')),
  title         text check (title is null or char_length(title) <= 120),
  starts_at     timestamptz not null,
  location      text check (location is null or char_length(location) <= 200),
  status        text not null default 'draft' check (status in ('draft','published','closed','cancelled')),
  notes         text check (notes is null or char_length(notes) <= 1000),   -- interno
  recurrence_id uuid,
  published_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (id, church_id),
  foreign key (team_id, church_id) references teams(id, church_id),
  constraint event_title_required                       -- RN-008
    check (kind <> 'evento' or (title is not null and char_length(btrim(title)) >= 3))
);
create index on events (church_id, starts_at);

create table assignments (    -- a unidade que se confirma ou recusa
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null,
  event_id      uuid not null,
  member_id     uuid not null,
  role_id       uuid not null,
  status        text not null default 'pending'
                check (status in ('pending','confirmed','declined','expired','replaced','closed','cancelled')),
  responded_at  timestamptz,
  responded_by  uuid references auth.users(id) on delete set null,   -- RN-801
  decline_reason text check (decline_reason is null or char_length(decline_reason) between 10 and 500),  -- RN-010
  suggested_substitute_id uuid,
  replaced_by_assignment_id uuid references assignments(id) on delete set null,
  attended      boolean,
  created_at    timestamptz not null default now(),
  unique (event_id, member_id, role_id),
  foreign key (event_id, church_id)  references events(id, church_id)  on delete cascade,
  foreign key (member_id, church_id) references members(id, church_id),
  foreign key (role_id, church_id)   references roles(id, church_id),
  foreign key (suggested_substitute_id, church_id) references members(id, church_id),
  constraint decline_needs_reason check (status <> 'declined' or decline_reason is not null)
);
create index on assignments (church_id, status, event_id);
create index on assignments (member_id);

create table unavailabilities (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null,
  member_id     uuid not null,
  start_date    date not null,
  end_date      date not null,
  reason        text check (reason is null or char_length(reason) <= 200),
  foreign key (member_id, church_id) references members(id, church_id) on delete cascade,
  check (end_date >= start_date)
);
create index on unavailabilities (member_id, start_date, end_date);

-- ─── Repertório ─────────────────────────────────────────────────────────────
create table songs (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  artist        text check (artist is null or char_length(artist) <= 120),
  song_key      text check (song_key is null or char_length(song_key) <= 8),
  bpm           int check (bpm between 30 and 240),
  duration_sec  int check (duration_sec between 1 and 7200),
  media_url     text check (media_url is null or media_url ~* '^https?://'),
  chart_url     text check (chart_url is null or chart_url ~* '^https?://'),
  lyrics        text check (lyrics is null or char_length(lyrics) <= 20000),
  tags          text[] not null default '{}',
  active        boolean not null default true,
  unique (id, church_id)
);
create unique index songs_title_key on songs (church_id, lower(btrim(title)), lower(coalesce(artist,'')));

create table setlist_items (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null,
  event_id      uuid not null,
  song_id       uuid not null,
  position      int not null,
  key_override  text check (key_override is null or char_length(key_override) <= 8),
  bpm_override  int check (bpm_override between 30 and 240),
  moment        text check (moment in ('abertura','adoracao','ofertorio','ministracao','encerramento')),
  unique (event_id, position),
  foreign key (event_id, church_id) references events(id, church_id) on delete cascade,
  foreign key (song_id, church_id)  references songs(id, church_id)
);

-- ─── Convites e auditoria ───────────────────────────────────────────────────
create table invites (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null,
  member_id     uuid not null,
  token_hash    text not null unique,                 -- só o hash é guardado
  role          text not null default 'member' check (role in ('admin','member')),
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (member_id, church_id) references members(id, church_id) on delete cascade
);

create table audit_log (
  id            bigserial primary key,
  church_id     uuid not null,
  actor_user_id uuid,
  entity        text not null,
  entity_id     uuid not null,
  action        text not null,
  diff          jsonb,
  created_at    timestamptz not null default now()
);
create index on audit_log (church_id, created_at desc);

-- ============================================================================
-- Funções auxiliares de autorização (usadas pelas políticas de RLS)
-- ============================================================================
create function current_church_ids() returns setof uuid
language sql stable security definer set search_path = public as
$fn$ select church_id from memberships where user_id = auth.uid() $fn$;

create function has_role(p_church uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public as
$fn$ select exists (select 1 from memberships
        where church_id = p_church and user_id = auth.uid() and role = any(p_roles)) $fn$;

create function is_admin(p_church uuid) returns boolean
language sql stable security definer set search_path = public as
$fn$ select has_role(p_church, array['owner','admin']) $fn$;

create function my_member_id(p_church uuid) returns uuid
language sql stable security definer set search_path = public as
$fn$ select id from members
      where church_id = p_church and user_id = auth.uid() and deleted_at is null limit 1 $fn$;

create function leads_team(p_team uuid) returns boolean            -- RN-203: papel derivado
language sql stable security definer set search_path = public as
$fn$ select exists (select 1 from teams t
      where t.id = p_team and t.deleted_at is null and t.leader_id is not null
        and t.leader_id = my_member_id(t.church_id)) $fn$;

create function leads_any_team(p_church uuid) returns boolean
language sql stable security definer set search_path = public as
$fn$ select exists (select 1 from teams t
      where t.church_id = p_church and t.deleted_at is null and t.leader_id is not null
        and t.leader_id = my_member_id(p_church)) $fn$;

create function is_manager(p_church uuid) returns boolean
language sql stable security definer set search_path = public as
$fn$ select is_admin(p_church) or leads_any_team(p_church) $fn$;

create function can_manage_event(p_church uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public as
$fn$ select is_admin(p_church) or (p_team is not null and leads_team(p_team)) $fn$;

create function can_manage_event_id(p_event uuid) returns boolean
language sql stable security definer set search_path = public as
$fn$ select coalesce((select can_manage_event(e.church_id, e.team_id) from events e where e.id = p_event), false) $fn$;

create function event_status(p_event uuid) returns text
language sql stable security definer set search_path = public as
$fn$ select status from events where id = p_event $fn$;

-- ============================================================================
-- Triggers de regras de negócio
-- ============================================================================

-- RN-502: slug imutável
create function trg_church_slug() returns trigger language plpgsql as
$fn$ begin
  if new.slug <> old.slug then raise exception 'O endereço (slug) da igreja não pode ser alterado.'; end if;
  return new;
end $fn$;
create trigger church_slug before update on churches for each row execute function trg_church_slug();

-- RN-006 / RF-402: equipe com 1 a 14 integrantes (validado ao final da transação)
create function check_team_size() returns trigger language plpgsql as
$fn$
declare v_team uuid; n int; t_deleted timestamptz; t_exists boolean;
begin
  if tg_table_name = 'teams' then v_team := new.id; else v_team := coalesce(new.team_id, old.team_id); end if;
  select true, deleted_at into t_exists, t_deleted from teams where id = v_team;
  if not coalesce(t_exists, false) or t_deleted is not null then return null; end if;
  select count(distinct member_id) into n from team_members where team_id = v_team;
  if n > 14 then raise exception 'Uma equipe pode ter no máximo 14 integrantes. Remova alguém antes de salvar.'; end if;
  if n < 1 then raise exception 'Uma equipe precisa ter pelo menos 1 integrante.'; end if;
  return null;
end $fn$;
create constraint trigger team_size_tm after insert or update or delete on team_members
  deferrable initially deferred for each row execute function check_team_size();
create constraint trigger team_size_t after insert or update on teams
  deferrable initially deferred for each row execute function check_team_size();

-- RN-009 e RF-505: transições da escala; mudar data/hora reabre confirmações
create function trg_event_rules() returns trigger language plpgsql as
$fn$
begin
  if old.status in ('closed','cancelled') and new.status <> old.status then
    raise exception 'Uma escala % não pode mudar de situação.', case old.status when 'closed' then 'encerrada' else 'cancelada' end;
  end if;
  if old.status = 'published' and new.status = 'draft' then
    raise exception 'Uma escala publicada não volta a rascunho. Cancele-a se necessário.';
  end if;
  if new.deleted_at is not null and old.deleted_at is null and old.status in ('published','closed') then
    raise exception 'Escala publicada deve ser cancelada, não excluída.';
  end if;
  if new.status = 'published' and old.status = 'published' and new.starts_at <> old.starts_at then
    update assignments
       set status = 'pending', responded_at = null, responded_by = null, decline_reason = null
     where event_id = new.id and status in ('confirmed','expired');
  end if;
  return new;
end $fn$;
create trigger event_rules before update on events for each row execute function trg_event_rules();

-- RN-013 e RF-106: último owner protegido; só owner mexe em owner/admin
create function trg_membership_guard() returns trigger language plpgsql security definer set search_path = public as
$fn$
declare other_owners int;
begin
  if tg_op = 'UPDATE' and new.role <> old.role and auth.uid() is not null
     and (new.role in ('owner','admin') or old.role in ('owner','admin'))
     and not has_role(old.church_id, array['owner']) then
    raise exception 'Somente o proprietário da igreja pode promover ou rebaixar administradores.';
  end if;
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from churches where id = old.church_id) then
    select count(*) into other_owners from memberships
      where church_id = old.church_id and role = 'owner' and id <> old.id;
    if other_owners = 0 then
      raise exception 'A igreja precisa ter ao menos um proprietário. Promova outra pessoa antes.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $fn$;
create trigger membership_guard before update or delete on memberships
  for each row execute function trg_membership_guard();

-- RN-011: auditoria genérica
create function trg_audit() returns trigger language plpgsql security definer set search_path = public as
$fn$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into audit_log (church_id, actor_user_id, entity, entity_id, action, diff)
  values (r.church_id, auth.uid(), tg_table_name, r.id, lower(tg_op),
          case tg_op when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
                     when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
                     else jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) end);
  return null;
end $fn$;
create trigger audit_events      after insert or update or delete on events      for each row execute function trg_audit();
create trigger audit_assignments after insert or update or delete on assignments for each row execute function trg_audit();
create trigger audit_members     after insert or update or delete on members     for each row execute function trg_audit();
create trigger audit_memberships after insert or update or delete on memberships for each row execute function trg_audit();
create trigger audit_teams       after insert or update or delete on teams       for each row execute function trg_audit();

-- ============================================================================
-- RLS (RNF-01) — toda tabela nasce com RLS ligada
-- ============================================================================
alter table churches          enable row level security;
alter table memberships       enable row level security;
alter table members           enable row level security;
alter table member_contacts   enable row level security;
alter table roles             enable row level security;
alter table member_roles      enable row level security;
alter table teams             enable row level security;
alter table team_members      enable row level security;
alter table events            enable row level security;
alter table assignments       enable row level security;
alter table unavailabilities  enable row level security;
alter table songs             enable row level security;
alter table setlist_items     enable row level security;
alter table invites           enable row level security;
alter table audit_log         enable row level security;

-- churches (criação só pela função create_church)
create policy churches_read on churches for select using (id in (select current_church_ids()));
create policy churches_upd  on churches for update using (is_admin(id)) with check (is_admin(id));

-- memberships (criação só por create_church / accept_invite)
create policy memberships_read on memberships for select using (church_id in (select current_church_ids()));
create policy memberships_upd  on memberships for update using (is_admin(church_id)) with check (is_admin(church_id));
create policy memberships_del  on memberships for delete using (is_admin(church_id));

-- members / contatos / funções
create policy members_read on members for select using (church_id in (select current_church_ids()));
create policy members_write on members for all using (is_admin(church_id)) with check (is_admin(church_id));

create policy contacts_read on member_contacts for select
  using (is_manager(church_id) or member_id = my_member_id(church_id));
create policy contacts_write on member_contacts for all
  using (is_admin(church_id) or member_id = my_member_id(church_id))
  with check (is_admin(church_id) or member_id = my_member_id(church_id));

create policy roles_read on roles for select using (church_id in (select current_church_ids()));
create policy roles_write on roles for all using (is_admin(church_id)) with check (is_admin(church_id));

create policy member_roles_read on member_roles for select using (church_id in (select current_church_ids()));
create policy member_roles_write on member_roles for all using (is_admin(church_id)) with check (is_admin(church_id));

-- equipes
create policy teams_read on teams for select using (church_id in (select current_church_ids()));
create policy teams_write on teams for all using (is_admin(church_id)) with check (is_admin(church_id));
create policy team_members_read on team_members for select using (church_id in (select current_church_ids()));
create policy team_members_write on team_members for all
  using (is_admin(church_id) or leads_team(team_id)) with check (is_admin(church_id) or leads_team(team_id));

-- escalas (rascunho só para quem gerencia; exclusão é lógica, via update)
create policy events_read on events for select
  using (church_id in (select current_church_ids()) and (status <> 'draft' or can_manage_event(church_id, team_id)));
create policy events_ins on events for insert with check (can_manage_event(church_id, team_id));
create policy events_upd on events for update
  using (can_manage_event(church_id, team_id)) with check (can_manage_event(church_id, team_id));

-- escalações: gestor vê todas; integrante vê só as suas (de escalas não-rascunho)
create policy assignments_read on assignments for select using (
  can_manage_event_id(event_id)
  or (member_id = my_member_id(church_id) and event_status(event_id) <> 'draft'));
create policy assignments_write on assignments for all
  using (can_manage_event_id(event_id)) with check (can_manage_event_id(event_id));

create policy unav_read on unavailabilities for select
  using (is_manager(church_id) or member_id = my_member_id(church_id));
create policy unav_write on unavailabilities for all
  using (is_admin(church_id) or member_id = my_member_id(church_id))
  with check (is_admin(church_id) or member_id = my_member_id(church_id));

-- repertório
create policy songs_read on songs for select using (church_id in (select current_church_ids()));
create policy songs_write on songs for all using (is_manager(church_id)) with check (is_manager(church_id));
create policy setlist_read on setlist_items for select using (
  church_id in (select current_church_ids())
  and (event_status(event_id) <> 'draft' or can_manage_event_id(event_id)));
create policy setlist_write on setlist_items for all
  using (can_manage_event_id(event_id)) with check (can_manage_event_id(event_id));

-- convites e auditoria
create policy invites_read on invites for select using (is_admin(church_id));
create policy invites_del  on invites for delete using (is_admin(church_id));
create policy audit_read   on audit_log for select using (is_admin(church_id));

-- ============================================================================
-- Funções de negócio (RPC) — chamadas pelo aplicativo
-- ============================================================================

-- Cria a igreja, torna o usuário owner, cria o integrante dele e semeia funções (RF-102b, RF-304)
create function create_church(p_name text, p_slug text, p_member_name text) returns uuid
language plpgsql security definer set search_path = public as
$fn$
declare c uuid; m uuid; v_slug text := lower(btrim(p_slug));
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para criar uma igreja.'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    raise exception 'Endereço inválido. Use de 3 a 40 letras minúsculas, números e hífen.';
  end if;
  if exists (select 1 from churches where slug = v_slug) then
    raise exception 'Este endereço já está em uso. Escolha outro.';
  end if;
  insert into churches (name, slug) values (btrim(p_name), v_slug) returning id into c;
  insert into memberships (church_id, user_id, role) values (c, auth.uid(), 'owner');
  insert into members (church_id, user_id, full_name) values (c, auth.uid(), btrim(p_member_name)) returning id into m;
  insert into roles (church_id, name, category, color, is_essential) values
    (c, 'Ministro',            'lideranca',   '#7A1F3D', true),
    (c, 'Vocal',               'voz',         '#B5446E', false),
    (c, 'Violão',              'instrumento', '#B8860B', false),
    (c, 'Guitarra',            'instrumento', '#C2571A', false),
    (c, 'Contrabaixo',         'instrumento', '#2F5D62', false),
    (c, 'Bateria',             'instrumento', '#4A5D23', false),
    (c, 'Teclado',             'instrumento', '#3B5BA5', false),
    (c, 'Percussão',           'instrumento', '#8A5A44', false),
    (c, 'Som',                 'tecnica',     '#5B5F66', false),
    (c, 'Projeção/Multimídia', 'tecnica',     '#6B4C9A', false);
  return c;
end $fn$;

-- Convites (RF-206/207): o código só existe na resposta; no banco fica o hash
create function create_invite(p_member_id uuid, p_role text default 'member') returns text
language plpgsql security definer set search_path = public as
$fn$
declare m members; code text;
begin
  select * into m from members where id = p_member_id and deleted_at is null;
  if not found or not is_admin(m.church_id) then raise exception 'Sem permissão para convidar este integrante.'; end if;
  if m.user_id is not null then raise exception 'Este integrante já tem conta.'; end if;
  if p_role not in ('admin','member') then raise exception 'Papel inválido.'; end if;
  delete from invites where member_id = m.id and accepted_at is null;
  code := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 20);
  insert into invites (church_id, member_id, token_hash, role)
    values (m.church_id, m.id, encode(sha256(convert_to(code, 'UTF8')), 'hex'), p_role);
  update members set status = 'invited' where id = m.id and status = 'active';
  return code;
end $fn$;

create function accept_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as
$fn$
declare i invites; v_hash text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para aceitar o convite.'; end if;
  v_hash := encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex');
  select * into i from invites where token_hash = v_hash;
  if not found or i.accepted_at is not null then
    raise exception 'Código de convite inválido ou já utilizado. Peça um novo ao líder.';
  end if;
  if i.expires_at < now() then
    raise exception 'Este convite expirou. Peça um novo ao líder.';
  end if;
  if exists (select 1 from members where church_id = i.church_id and user_id = auth.uid()) then
    raise exception 'Você já faz parte desta igreja.';
  end if;
  update members set user_id = auth.uid(), status = 'active' where id = i.member_id;
  insert into memberships (church_id, user_id, role) values (i.church_id, auth.uid(), i.role)
    on conflict (church_id, user_id) do nothing;
  update invites set accepted_at = now() where id = i.id;
  return i.church_id;
end $fn$;

-- Integrante: cadastro/edição atômicos (funções N:N, contato, equipes) — RF-204/205, RN-007
create function save_member(p_id uuid, p_church uuid, p_name text, p_phone text, p_email text,
                            p_notes text, p_role_ids uuid[], p_team_ids uuid[]) returns uuid
language plpgsql security definer set search_path = public as
$fn$
declare v_id uuid := p_id; r uuid; t uuid; first_role uuid;
begin
  if not is_admin(p_church) then raise exception 'Sem permissão para gerenciar integrantes.'; end if;
  if p_role_ids is null or cardinality(p_role_ids) = 0 then
    raise exception 'Escolha pelo menos uma função para o integrante.';
  end if;
  if v_id is null then
    insert into members (church_id, full_name) values (p_church, btrim(p_name)) returning id into v_id;
  else
    update members set full_name = btrim(p_name) where id = v_id and church_id = p_church and deleted_at is null;
    if not found then raise exception 'Integrante não encontrado.'; end if;
  end if;
  insert into member_contacts (member_id, church_id, phone, email, notes)
    values (v_id, p_church, nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), nullif(btrim(p_notes), ''))
    on conflict (member_id) do update set phone = excluded.phone, email = excluded.email, notes = excluded.notes;

  delete from member_roles where member_id = v_id and not (role_id = any(p_role_ids));
  first_role := p_role_ids[1];
  foreach r in array p_role_ids loop
    insert into member_roles (member_id, role_id, church_id, is_primary)
      values (v_id, r, p_church, r = first_role)
      on conflict (member_id, role_id) do update set is_primary = (excluded.role_id = first_role);
  end loop;

  -- equipes: sai das desmarcadas; entra nas marcadas com a função principal (ajuste fino na tela da equipe)
  delete from team_members where member_id = v_id and not (team_id = any(coalesce(p_team_ids, '{}')));
  foreach t in array coalesce(p_team_ids, '{}') loop
    if not exists (select 1 from team_members where team_id = t and member_id = v_id) then
      insert into team_members (team_id, member_id, role_id, church_id) values (t, v_id, first_role, p_church);
    end if;
  end loop;
  -- remove vínculos de equipe com função que o integrante deixou de ter
  delete from team_members tm where tm.member_id = v_id and not (tm.role_id = any(p_role_ids));
  return v_id;
end $fn$;

-- RF-208/209: arquivar, bloqueado se houver escalação futura ativa
create function archive_member(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as
$fn$
declare m members; blockers jsonb;
begin
  select * into m from members where id = p_id and deleted_at is null;
  if not found or not is_admin(m.church_id) then raise exception 'Sem permissão ou integrante não encontrado.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('event_id', e.id, 'kind', e.kind, 'title', e.title,
                                               'starts_at', e.starts_at, 'status', a.status) order by e.starts_at), '[]')
    into blockers
    from assignments a join events e on e.id = a.event_id
   where a.member_id = p_id and e.starts_at > now() and e.deleted_at is null
     and e.status in ('draft','published') and a.status in ('pending','confirmed','expired');
  if jsonb_array_length(blockers) > 0 then
    return jsonb_build_object('ok', false, 'events', blockers);
  end if;
  delete from team_members where member_id = p_id;
  update teams set leader_id = null where leader_id = p_id;
  update members set status = 'archived', deleted_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $fn$;

create function restore_member(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$fn$
declare m members;
begin
  select * into m from members where id = p_id;
  if not found or not is_admin(m.church_id) then raise exception 'Sem permissão.'; end if;
  update members set status = case when user_id is null then 'active' else 'active' end, deleted_at = null where id = p_id;
end $fn$;

-- RF-303: função em uso é substituída por outra ou arquivada
create function retire_role(p_id uuid, p_replace uuid default null) returns void
language plpgsql security definer set search_path = public as
$fn$
declare r roles;
begin
  select * into r from roles where id = p_id;
  if not found or not is_admin(r.church_id) then raise exception 'Sem permissão ou função não encontrada.'; end if;
  if p_replace is not null then
    if p_replace = p_id or not exists (select 1 from roles where id = p_replace and church_id = r.church_id and active) then
      raise exception 'Escolha outra função ativa para substituir.';
    end if;
    insert into member_roles (member_id, role_id, church_id, is_primary)
      select member_id, p_replace, church_id, is_primary from member_roles where role_id = p_id
      on conflict (member_id, role_id) do nothing;
    delete from member_roles where role_id = p_id;
    insert into team_members (team_id, member_id, role_id, church_id)
      select team_id, member_id, p_replace, church_id from team_members where role_id = p_id
      on conflict do nothing;
    delete from team_members where role_id = p_id;
    update assignments a set role_id = p_replace
      where a.role_id = p_id
        and not exists (select 1 from assignments b where b.event_id = a.event_id
                         and b.member_id = a.member_id and b.role_id = p_replace);
  end if;
  update roles set active = false where id = p_id;
end $fn$;

-- Equipe: cadastro/edição atômicos (RF-401..403)
create function save_team(p_id uuid, p_church uuid, p_name text, p_color text, p_leader uuid, p_members jsonb) returns uuid
language plpgsql security definer set search_path = public as
$fn$
declare v_id uuid := p_id;
begin
  if p_id is null then
    if not is_admin(p_church) then raise exception 'Sem permissão para criar equipes.'; end if;
    insert into teams (church_id, name, color, leader_id) values (p_church, btrim(p_name), p_color, p_leader)
      returning id into v_id;
  else
    if not (is_admin(p_church) or leads_team(p_id)) then raise exception 'Sem permissão para editar esta equipe.'; end if;
    update teams set name = btrim(p_name), color = p_color,
                     leader_id = case when is_admin(p_church) then p_leader else leader_id end
      where id = p_id and church_id = p_church and deleted_at is null;
    if not found then raise exception 'Equipe não encontrada.'; end if;
  end if;
  delete from team_members where team_id = v_id;
  insert into team_members (team_id, member_id, role_id, church_id)
    select v_id, x.member_id, x.role_id, p_church
      from jsonb_to_recordset(coalesce(p_members, '[]'::jsonb)) as x(member_id uuid, role_id uuid)
    on conflict do nothing;
  set constraints team_size_tm, team_size_t immediate;   -- erro claro já nesta chamada (1 a 14)
  return v_id;
end $fn$;

-- RF-406: excluir equipe (lógico), bloqueado se houver escala futura publicada
create function archive_team(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as
$fn$
declare t teams; n int;
begin
  select * into t from teams where id = p_id and deleted_at is null;
  if not found or not is_admin(t.church_id) then raise exception 'Sem permissão ou equipe não encontrada.'; end if;
  select count(*) into n from events
    where team_id = p_id and status = 'published' and starts_at > now() and deleted_at is null;
  if n > 0 then
    return jsonb_build_object('ok', false, 'events', n);
  end if;
  update teams set deleted_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $fn$;

-- RF-503: materializa uma escalação por membro da equipe
create function apply_team(p_event uuid, p_team uuid) returns int
language plpgsql security definer set search_path = public as
$fn$
declare e events; n int;
begin
  select * into e from events where id = p_event and deleted_at is null;
  if not found or not can_manage_event(e.church_id, e.team_id) then raise exception 'Sem permissão para alterar esta escala.'; end if;
  if e.status in ('closed','cancelled') then raise exception 'Esta escala não aceita mais alterações.'; end if;
  if not exists (select 1 from teams where id = p_team and church_id = e.church_id and deleted_at is null) then
    raise exception 'Equipe não encontrada.';
  end if;
  if not can_manage_event(e.church_id, p_team) then raise exception 'Você não lidera esta equipe.'; end if;
  update events set team_id = p_team where id = p_event;
  insert into assignments (church_id, event_id, member_id, role_id)
    select e.church_id, p_event, tm.member_id, tm.role_id
      from team_members tm join members m on m.id = tm.member_id and m.deleted_at is null
     where tm.team_id = p_team
    on conflict (event_id, member_id, role_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $fn$;

create function publish_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as
$fn$
declare e events;
begin
  select * into e from events where id = p_event and deleted_at is null;
  if not found or not can_manage_event(e.church_id, e.team_id) then raise exception 'Sem permissão para publicar esta escala.'; end if;
  if e.status <> 'draft' then raise exception 'Somente rascunhos podem ser publicados.'; end if;
  update events set status = 'published', published_at = now() where id = p_event;
end $fn$;

create function cancel_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as
$fn$
declare e events;
begin
  select * into e from events where id = p_event and deleted_at is null;
  if not found or not can_manage_event(e.church_id, e.team_id) then raise exception 'Sem permissão para cancelar esta escala.'; end if;
  if e.status in ('closed','cancelled') then raise exception 'Esta escala já está encerrada ou cancelada.'; end if;
  update events set status = 'cancelled' where id = p_event;
  update assignments set status = 'cancelled'
    where event_id = p_event and status in ('pending','confirmed','declined','expired');
end $fn$;

-- Núcleo do ranking de substitutos (RF-806): mesma função, disponível, menor carga em 60 dias
create function _substitute_candidates(p_assignment uuid)
returns table (member_id uuid, full_name text, load60 int)
language sql stable security definer set search_path = public as
$fn$
  select m.id, m.full_name,
         (select count(*) from assignments x join events ex on ex.id = x.event_id
           where x.member_id = m.id and ex.status in ('published','closed') and ex.deleted_at is null
             and ex.starts_at between now() - interval '60 days' and now()
             and x.status in ('confirmed','closed','pending','expired'))::int as load60
    from assignments a
    join events e on e.id = a.event_id
    join members m on m.church_id = a.church_id and m.deleted_at is null
   where a.id = p_assignment
     and m.id <> a.member_id
     and exists (select 1 from member_roles mr where mr.member_id = m.id and mr.role_id = a.role_id)
     and not exists (select 1 from assignments y where y.event_id = a.event_id and y.member_id = m.id
                      and y.status not in ('declined','replaced','cancelled'))
     and not exists (select 1 from unavailabilities u
                      where u.member_id = m.id
                        and (e.starts_at at time zone (select timezone from churches where id = e.church_id))::date
                            between u.start_date and u.end_date)
   order by 3, 2
$fn$;

create function substitutes(p_assignment uuid) returns table (member_id uuid, full_name text, load60 int)
language plpgsql stable security definer set search_path = public as
$fn$
begin
  if not can_manage_event_id((select event_id from assignments where id = p_assignment)) then
    raise exception 'Sem permissão para buscar substitutos.';
  end if;
  return query select * from _substitute_candidates(p_assignment);
end $fn$;

-- RF-801..804, RN-801..803: confirmar / recusar
create function respond_assignment(p_id uuid, p_action text, p_reason text default null, p_substitute uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as
$fn$
declare a assignments; e events; mgr boolean; own boolean; subs int := 0; v_status text;
begin
  select * into a from assignments where id = p_id;
  if not found then raise exception 'Escalação não encontrada.'; end if;
  select * into e from events where id = a.event_id;
  mgr := can_manage_event(e.church_id, e.team_id);
  own := a.member_id = my_member_id(a.church_id);
  if not (mgr or own) then raise exception 'Você não tem permissão para responder por este integrante.'; end if;
  if e.status <> 'published' then raise exception 'Esta escala não está publicada.'; end if;
  if e.starts_at <= now() then
    raise exception 'Esta escala já começou. O líder registra presença ou falta.';
  end if;

  if p_action = 'confirm' then
    if a.status not in ('pending','expired') then
      raise exception 'Esta escalação não está aguardando confirmação.';
    end if;
    update assignments set status = 'confirmed', responded_at = now(), responded_by = auth.uid(),
           decline_reason = null, suggested_substitute_id = null where id = p_id;
    v_status := 'confirmed';
  elsif p_action = 'decline' then
    if a.status not in ('pending','expired','confirmed') then
      raise exception 'Esta escalação não pode mais ser recusada.';
    end if;
    if a.status = 'confirmed' and not mgr and e.starts_at <= now() + interval '1 day' then
      raise exception 'Faltando menos de 1 dia, só o líder pode alterar uma confirmação. Fale com ele.';
    end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then
      raise exception 'Conte o motivo com pelo menos 10 caracteres.';
    end if;
    update assignments set status = 'declined', responded_at = now(), responded_by = auth.uid(),
           decline_reason = left(btrim(p_reason), 500), suggested_substitute_id = p_substitute where id = p_id;
    v_status := 'declined';
    select count(*) into subs from _substitute_candidates(p_id);
  else
    raise exception 'Ação inválida.';
  end if;
  return jsonb_build_object('id', p_id, 'status', v_status, 'substitutes_available', subs);
end $fn$;

-- RF-806: efetiva a substituição
create function replace_assignment(p_assignment uuid, p_member uuid) returns uuid
language plpgsql security definer set search_path = public as
$fn$
declare a assignments; e events; new_id uuid;
begin
  select * into a from assignments where id = p_assignment;
  if not found then raise exception 'Escalação não encontrada.'; end if;
  select * into e from events where id = a.event_id;
  if not can_manage_event(e.church_id, e.team_id) then raise exception 'Sem permissão para substituir.'; end if;
  if e.status in ('closed','cancelled') then raise exception 'Esta escala não aceita mais alterações.'; end if;
  if a.status not in ('pending','confirmed','declined','expired') then
    raise exception 'Esta escalação não pode ser substituída.';
  end if;
  if not exists (select 1 from members where id = p_member and church_id = a.church_id and deleted_at is null) then
    raise exception 'Integrante não encontrado.';
  end if;
  insert into assignments (church_id, event_id, member_id, role_id)
    values (a.church_id, a.event_id, p_member, a.role_id)
    on conflict (event_id, member_id, role_id) do update
      set status = 'pending', responded_at = null, responded_by = null, decline_reason = null,
          suggested_substitute_id = null
    returning id into new_id;
  update assignments set status = 'replaced', replaced_by_assignment_id = new_id where id = p_assignment;
  return new_id;
end $fn$;

-- Líder registra presença/falta depois da escala (RN-802)
create function mark_attendance(p_assignment uuid, p_attended boolean) returns void
language plpgsql security definer set search_path = public as
$fn$
declare a assignments; e events;
begin
  select * into a from assignments where id = p_assignment;
  if not found then raise exception 'Escalação não encontrada.'; end if;
  select * into e from events where id = a.event_id;
  if not can_manage_event(e.church_id, e.team_id) then raise exception 'Sem permissão.'; end if;
  if e.starts_at > now() then raise exception 'A escala ainda não aconteceu.'; end if;
  update assignments set attended = p_attended where id = p_assignment and status in ('confirmed','closed','pending','expired');
end $fn$;

-- Setlist (RF-602): substitui a lista inteira, de forma atômica
create function save_setlist(p_event uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public as
$fn$
declare e events;
begin
  select * into e from events where id = p_event and deleted_at is null;
  if not found or not can_manage_event(e.church_id, e.team_id) then raise exception 'Sem permissão para editar o setlist.'; end if;
  if e.status in ('closed','cancelled') then raise exception 'Esta escala não aceita mais alterações.'; end if;
  delete from setlist_items where event_id = p_event;
  insert into setlist_items (church_id, event_id, song_id, position, key_override, bpm_override, moment)
    select e.church_id, p_event, (x.item->>'song_id')::uuid, x.ord::int,
           nullif(btrim(x.item->>'key_override'), ''), nullif(x.item->>'bpm_override', '')::int,
           nullif(x.item->>'moment', '')
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as x(item, ord);
end $fn$;

-- Estados dependentes do tempo, calculados quando alguém abre o app (sem cron)
-- RF-805: pendente vira expirada a D-3.  Escala vira encerrada algumas horas após o início.
create function refresh_states(p_church uuid) returns void
language plpgsql security definer set search_path = public as
$fn$
begin
  if p_church not in (select current_church_ids()) then raise exception 'Sem acesso a esta igreja.'; end if;
  update assignments a set status = 'expired'
    from events e
   where a.event_id = e.id and e.church_id = p_church and e.status = 'published' and e.deleted_at is null
     and a.status = 'pending' and e.starts_at > now() and e.starts_at <= now() + interval '3 days';
  update assignments a set status = 'closed'
    from events e
   where a.event_id = e.id and e.church_id = p_church and e.status = 'published'
     and a.status in ('pending','confirmed','expired') and e.starts_at <= now() - interval '4 hours';
  update events set status = 'closed'
   where church_id = p_church and status = 'published' and starts_at <= now() - interval '4 hours';
end $fn$;

-- Quem está escalado (nome e função). O status só é revelado a quem gerencia (RF-703)
create function event_roster(p_event_ids uuid[])
returns table (event_id uuid, assignment_id uuid, member_id uuid, member_name text, role_id uuid,
               role_name text, role_color text, role_category text, status text,
               responded_by_name text, decline_reason text, attended boolean)
language sql stable security definer set search_path = public as
$fn$
  select a.event_id, a.id, a.member_id, m.full_name, r.id, r.name, r.color, r.category,
         case when x.mg then a.status end,
         case when x.mg then (select m2.full_name from members m2
                               where m2.user_id = a.responded_by and m2.church_id = a.church_id limit 1) end,
         case when x.mg then a.decline_reason end,
         case when x.mg then a.attended end
    from assignments a
    join events e  on e.id = a.event_id
    join members m on m.id = a.member_id
    join roles r   on r.id = a.role_id
    cross join lateral (select can_manage_event(e.church_id, e.team_id) as mg) x
   where a.event_id = any(p_event_ids)
     and e.deleted_at is null
     and e.church_id in (select current_church_ids())
     and (x.mg or (e.status in ('published','closed') and a.status in ('pending','confirmed','expired','closed')))
   order by r.category, r.name, m.full_name
$fn$;

-- Carga dos últimos 60 dias por integrante (RF-904)
create function member_loads(p_church uuid) returns table (member_id uuid, load60 int)
language sql stable security definer set search_path = public as
$fn$
  select m.id,
         (select count(*) from assignments x join events ex on ex.id = x.event_id
           where x.member_id = m.id and ex.status in ('published','closed') and ex.deleted_at is null
             and ex.starts_at between now() - interval '60 days' and now()
             and x.status in ('confirmed','closed','pending','expired'))::int
    from members m
   where m.church_id = p_church and m.deleted_at is null and is_manager(p_church)
$fn$;

-- Área pública (RF-1001..1005): sem login, sem dados de contato nem status
create function public_church(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as
$fn$
declare c churches; res jsonb;
begin
  select * into c from churches where slug = lower(btrim(p_slug)) and deleted_at is null;
  if not found or c.public_mode = 'off' then return null; end if;
  select jsonb_build_object(
    'church', jsonb_build_object('name', c.name, 'timezone', c.timezone, 'public_mode', c.public_mode),
    'events', coalesce((
      select jsonb_agg(q.ev order by q.ev->>'starts_at') from (
        select jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'title', e.title, 'starts_at', e.starts_at, 'location', e.location,
          'team', t.name, 'team_color', t.color,
          'roster', coalesce((
             select jsonb_agg(jsonb_build_object('name', m.full_name, 'role', r.name) order by r.name, m.full_name)
               from assignments a join members m on m.id = a.member_id join roles r on r.id = a.role_id
              where a.event_id = e.id and a.status in ('pending','confirmed','expired','closed')), '[]'::jsonb),
          'setlist', case when c.show_setlist_publicly then coalesce((
             select jsonb_agg(jsonb_build_object('title', s.title, 'key', coalesce(si.key_override, s.song_key),
                                                 'moment', si.moment) order by si.position)
               from setlist_items si join songs s on s.id = si.song_id where si.event_id = e.id), '[]'::jsonb) end
        ) as ev
        from events e left join teams t on t.id = e.team_id
       where e.church_id = c.id and e.status in ('published','closed') and e.deleted_at is null
         and e.starts_at >= now() - interval '30 days'
      ) q), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'color', t.color, 'members', coalesce((
          select jsonb_agg(jsonb_build_object('name', m.full_name, 'role', r.name) order by m.full_name)
            from team_members tm join members m on m.id = tm.member_id and m.deleted_at is null
            join roles r on r.id = tm.role_id where tm.team_id = t.id), '[]'::jsonb)) order by t.name)
        from teams t where t.church_id = c.id and t.deleted_at is null), '[]'::jsonb)
  ) into res;
  return res;
end $fn$;

-- ============================================================================
-- Permissões (anon quase nada; authenticated só passa pelas políticas de RLS)
-- ============================================================================
grant usage on schema public to anon, authenticated;
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, delete on churches    from authenticated;     -- só create_church cria
revoke insert         on memberships from authenticated;     -- só create_church / accept_invite
revoke insert, update, delete on audit_log from authenticated;
revoke insert, update on invites from authenticated;
grant select on audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- funções usadas pelas políticas de RLS e RPCs do aplicativo
grant execute on function
  current_church_ids(), has_role(uuid, text[]), is_admin(uuid), my_member_id(uuid), leads_team(uuid),
  leads_any_team(uuid), is_manager(uuid), can_manage_event(uuid, uuid), can_manage_event_id(uuid), event_status(uuid),
  create_church(text, text, text), create_invite(uuid, text), accept_invite(text),
  save_member(uuid, uuid, text, text, text, text, uuid[], uuid[]), archive_member(uuid), restore_member(uuid),
  retire_role(uuid, uuid), save_team(uuid, uuid, text, text, uuid, jsonb), archive_team(uuid),
  apply_team(uuid, uuid), publish_event(uuid), cancel_event(uuid), substitutes(uuid),
  respond_assignment(uuid, text, text, uuid), replace_assignment(uuid, uuid), mark_attendance(uuid, boolean),
  save_setlist(uuid, jsonb), refresh_states(uuid), event_roster(uuid[]), member_loads(uuid)
  to authenticated;

grant execute on function public_church(text) to anon, authenticated;
