-- ============================================================================
-- LouvOrganize 1.2.0 — migração: padrões de vestimenta e escala semanal
-- Para um projeto Supabase que JÁ rodou o schema.sql da versão 1.1.x.
-- Como usar: Supabase > SQL Editor > New query > cole TUDO > Run. Rode uma vez só.
-- (Projeto novo não precisa disto: o schema.sql já inclui tudo.)
-- ============================================================================
begin;

-- ─── Vestimenta (padrões de cores e escala semanal) ────────────────────────
-- colors = [{"hex":"#000000","name":"Preto"}, ...] (1 a 8 cores). A escala aponta para o
-- padrão: se as cores do padrão mudarem, todas as semanas escaladas com ele mudam junto.
create function dress_colors_ok(p jsonb) returns boolean
language sql immutable as
$fn$ select jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 8
       and not exists (select 1 from jsonb_array_elements(p) x
                        where jsonb_typeof(x) <> 'object' or coalesce(x->>'hex', '') !~ '^#[0-9A-Fa-f]{6}$'
                           or char_length(coalesce(x->>'name', '')) > 40) $fn$;

create table dress_codes (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 60),
  colors        jsonb not null constraint dress_colors_check check (dress_colors_ok(colors)),
  position      int not null default 0,
  created_at    timestamptz not null default now(),
  unique (id, church_id)
);
create unique index dress_codes_name_key on dress_codes (church_id, lower(name));

create table dress_weeks (    -- semana começa no domingo (igual ao calendário)
  church_id     uuid not null references churches(id) on delete cascade,
  week_start    date not null constraint dress_week_sunday check (extract(dow from week_start) = 0),
  dress_code_id uuid not null,
  primary key (church_id, week_start),
  foreign key (dress_code_id, church_id) references dress_codes(id, church_id) on delete cascade
);


alter table dress_codes enable row level security;
alter table dress_weeks enable row level security;

-- vestimenta: todos da igreja veem; admin cadastra padrões; líder/admin escala as semanas
create policy dress_codes_read  on dress_codes for select using (church_id in (select current_church_ids()));
create policy dress_codes_write on dress_codes for all using (is_admin(church_id)) with check (is_admin(church_id));
create policy dress_weeks_read  on dress_weeks for select using (church_id in (select current_church_ids()));
create policy dress_weeks_write on dress_weeks for all using (is_manager(church_id)) with check (is_manager(church_id));

create function seed_dress_codes(p_church uuid) returns void
language plpgsql security definer set search_path = public as
$fn$
begin
  if exists (select 1 from dress_codes where church_id = p_church) then return; end if;
  insert into dress_codes (church_id, position, name, colors) values
    (p_church, 1, 'All Black', '[{"hex":"#000000","name":"Preto"}]'),
    (p_church, 2, 'Preto e Branco', '[{"hex":"#000000","name":"Preto"},{"hex":"#FFFFFF","name":"Branco"}]'),
    (p_church, 3, 'Bege e Verde', '[{"hex":"#DBCDB5","name":"Pale Oak"},{"hex":"#E8E0D0","name":"Bone"},{"hex":"#DED7C2","name":"Bone"},{"hex":"#516B4B","name":"Hunter Green"},{"hex":"#334E2D","name":"Dark Spruce"}]'),
    (p_church, 4, 'Bege e Marrom', '[{"hex":"#DBCDB5","name":"Pale Oak"},{"hex":"#E8E0D0","name":"Bone"},{"hex":"#DED7C2","name":"Bone"},{"hex":"#4D3B34","name":"Deep Mocha"},{"hex":"#3A2F2F","name":"Deep Mocha"}]'),
    (p_church, 5, 'Preto e Verde', '[{"hex":"#000000","name":"Preto"},{"hex":"#293727","name":"Evergreen"},{"hex":"#72956E","name":"Sage Green"},{"hex":"#516B4B","name":"Hunter Green"},{"hex":"#334E2D","name":"Dark Spruce"}]'),
    (p_church, 6, 'Branco e Bege', '[{"hex":"#FFFFFF","name":"Branco"},{"hex":"#EFE5D9","name":"Linen"},{"hex":"#DBCDB5","name":"Pale Oak"},{"hex":"#E8E0D0","name":"Bone"},{"hex":"#DED7C2","name":"Bone"}]'),
    (p_church, 7, 'Preto, Marrom e Bege', '[{"hex":"#000000","name":"Preto"},{"hex":"#281F12","name":"Dark Coffee"},{"hex":"#433030","name":"Deep Mocha"},{"hex":"#4D3B34","name":"Deep Mocha"},{"hex":"#857C62","name":"Grey Olive"}]'),
    (p_church, 8, 'Branco e Azul', '[{"hex":"#FFFFFF","name":"Branco"},{"hex":"#ACDDFF","name":"Icy Blue"},{"hex":"#28587A","name":"Baltic Blue"},{"hex":"#436781","name":"Blue Slate"},{"hex":"#16344B","name":"Deep Space Blue"}]'),
    (p_church, 9, 'Preto e Vinho', '[{"hex":"#000000","name":"Preto"},{"hex":"#722F37","name":"Wine Plum"},{"hex":"#551B21","name":"Night Bordeaux"},{"hex":"#3F1419","name":"Rich Mahogany"}]'),
    (p_church, 10, 'Branco e Cinza', '[{"hex":"#FFFFFF","name":"Branco"},{"hex":"#C0C0C0","name":"Silver"},{"hex":"#757575","name":"Grey"},{"hex":"#575757","name":"Charcoal"},{"hex":"#ECECEC","name":"Platinum"}]');
end $fn$;

-- create_church passa a semear os padrões de vestimenta
create or replace function create_church(p_name text, p_slug text, p_member_name text) returns uuid
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
    (c, 'Ministro',            'lideranca',   '#3446D4', true),
    (c, 'Vocal',               'voz',         '#7C5CD6', false),
    (c, 'Violão',              'instrumento', '#B8860B', false),
    (c, 'Guitarra',            'instrumento', '#C2571A', false),
    (c, 'Contrabaixo',         'instrumento', '#2F5D62', false),
    (c, 'Bateria',             'instrumento', '#4A5D23', false),
    (c, 'Teclado',             'instrumento', '#3B5BA5', false),
    (c, 'Percussão',           'instrumento', '#8A5A44', false),
    (c, 'Som',                 'tecnica',     '#5B5F66', false),
    (c, 'Projeção/Multimídia', 'tecnica',     '#6B4C9A', false);
  perform seed_dress_codes(c);
  return c;
end $fn$;

-- página pública passa a trazer a vestimenta das semanas
create or replace function public_church(p_slug text) returns jsonb
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
        from teams t where t.church_id = c.id and t.deleted_at is null), '[]'::jsonb),
    'dress', coalesce((
      select jsonb_agg(jsonb_build_object('week_start', w.week_start, 'name', d.name, 'colors', d.colors) order by w.week_start)
        from dress_weeks w join dress_codes d on d.id = w.dress_code_id
       where w.church_id = c.id
         and w.week_start between (now() at time zone c.timezone)::date - 42 and (now() at time zone c.timezone)::date + 120), '[]'::jsonb)
  ) into res;
  return res;
end $fn$;

grant select, insert, update, delete on dress_codes, dress_weeks to authenticated;
revoke all on dress_codes, dress_weeks from anon;
revoke execute on function dress_colors_ok(jsonb), seed_dress_codes(uuid) from public, anon, authenticated;
grant execute on function dress_colors_ok(jsonb) to authenticated;
grant execute on function public_church(text) to anon, authenticated;

-- igrejas que já existem recebem os 10 padrões iniciais
select seed_dress_codes(id) from churches;

commit;
