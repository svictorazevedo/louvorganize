-- Testes das regras de negócio e do isolamento entre igrejas (RNF-01).
-- Rodar com:  sh tests/run-tests.sh
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create schema t;
grant usage on schema t to anon, authenticated;
create table t.ids (name text primary key, id uuid);
grant all on t.ids to anon, authenticated;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', u::text, false); execute 'set role authenticated'; end $$;
create function t.as_anon() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', false); execute 'set role anon'; end $$;
create function t.as_root() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', false); end $$;
create function t.id(n text) returns uuid language sql stable as $$ select id from t.ids where name = n $$;
create function t.put(n text, v uuid) returns void language sql as $$ insert into t.ids values (n, v) on conflict (name) do update set id = v $$;
create function t.expect_fail(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql;
  exception when others then
    if position(lower(needle) in lower(sqlerrm)) = 0 then
      raise exception 'FALHA: erro inesperado para [%]: %', sql, sqlerrm; end if;
    return;
  end;
  raise exception 'FALHA: deveria ter falhado: %', sql;
end $$;
create function t.eq(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALHA %: obtido=% esperado=%', label, got, want; end if;
  raise notice 'ok  %', label;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- usuários
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'ana@a.com'),
  ('b0000000-0000-0000-0000-00000000000b', 'bia@b.com'),
  ('c0000000-0000-0000-0000-00000000000c', 'caio@a.com'),
  ('d0000000-0000-0000-0000-00000000000d', 'duda@a.com');

-- ── Igrejas ────────────────────────────────────────────────────────────────
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.put('chA', create_church('Igreja A', 'igreja-a', 'Ana Souza'));
select t.as_user('b0000000-0000-0000-0000-00000000000b');
select t.put('chB', create_church('Igreja B', 'igreja-b', 'Bia Lima'));
select t.expect_fail($$select create_church('Outra', 'igreja-a', 'X Y Z')$$, 'já está em uso');
select t.expect_fail($$select create_church('Outra', 'A_b', 'X Y Z')$$, 'inválido');
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.eq('funções semeadas', (select count(*)::text from roles), '10');
select t.expect_fail($$update churches set slug = 'novo-slug' where true$$, 'não pode ser alterado');
select t.expect_fail($$insert into churches (name, slug) values ('Pirata','pirata')$$, 'permission denied');

-- ── Integrantes, funções, equipes ──────────────────────────────────────────
select t.put('rVocal',  (select id from roles where name = 'Vocal'));
select t.put('rViolao', (select id from roles where name = 'Violão'));
select t.put('rBat',    (select id from roles where name = 'Bateria'));
select t.expect_fail(format($$select save_member(null, %L, 'Fulano Sem Função', null, null, null, '{}', '{}')$$, t.id('chA')), 'pelo menos uma função');
select t.expect_fail(format($$select save_member(null, %L, 'Fu', null, null, null, %L::uuid[], '{}')$$, t.id('chA'), array[t.id('rVocal')]::text), 'violates check');
select t.expect_fail(format($$select save_member(null, %L, 'Telefone Ruim', '123', null, null, %L::uuid[], '{}')$$, t.id('chA'), array[t.id('rVocal')]::text), 'violates check');

select t.put('mCaio', save_member(null, t.id('chA'), 'Caio Mendes', '+5565999990001', 'caio@a.com', 'obs', array[t.id('rVocal'), t.id('rViolao')], '{}'));
select t.put('mDuda', save_member(null, t.id('chA'), 'Duda Rocha',  '+5565999990002', 'duda@a.com', null,  array[t.id('rVocal')], '{}'));
select t.put('mEdu',  save_member(null, t.id('chA'), 'Edu Pires',   null, null, null, array[t.id('rBat')], '{}'));
select t.put('mAna',  (select id from members where user_id = 'a0000000-0000-0000-0000-00000000000a'));
select t.eq('caio tem 2 funções', (select count(*)::text from member_roles where member_id = t.id('mCaio')), '2');

-- equipe: mínimo 1 / máximo 14
select t.expect_fail(format($$select save_team(null, %L, 'Vazia', '#2F5D62', null, '[]')$$, t.id('chA')), 'pelo menos 1 integrante');
select t.put('teamA', save_team(null, t.id('chA'), 'Equipe A', '#2F5D62', t.id('mCaio'),
  jsonb_build_array(
    jsonb_build_object('member_id', t.id('mCaio'), 'role_id', t.id('rVocal')),
    jsonb_build_object('member_id', t.id('mDuda'), 'role_id', t.id('rVocal')),
    jsonb_build_object('member_id', t.id('mEdu'),  'role_id', t.id('rBat')))));
select t.eq('equipe com 3', (select count(*)::text from team_members where team_id = t.id('teamA')), '3');
select t.expect_fail(format($$select save_team(null, %L, 'equipe a', '#2F5D62', null, %L::jsonb)$$, t.id('chA'),
  jsonb_build_array(jsonb_build_object('member_id', t.id('mEdu'), 'role_id', t.id('rBat')))::text), 'duplicate key');
do $$ declare big jsonb := '[]'; i int; mid uuid; begin
  for i in 1..15 loop
    mid := save_member(null, t.id('chA'), 'Extra Pessoa ' || i, null, null, null, array[t.id('rVocal')], '{}');
    big := big || jsonb_build_object('member_id', mid, 'role_id', t.id('rVocal'));
  end loop;
  begin perform save_team(null, t.id('chA'), 'Grande', '#2F5D62', null, big);
    raise exception 'FALHA: equipe de 15 deveria falhar';
  exception when others then
    if sqlerrm not like '%no máximo 14%' then raise; end if; raise notice 'ok  equipe de 15 bloqueada'; end;
end $$;

-- ── Escala: regras do banco ────────────────────────────────────────────────
select t.expect_fail(format($$insert into events (church_id, kind, starts_at) values (%L, 'evento', now() + interval '10 days')$$, t.id('chA')), 'event_title_required');
insert into events (church_id, team_id, kind, starts_at, created_by)
  values (t.id('chA'), t.id('teamA'), 'culto', now() + interval '10 days', 'a0000000-0000-0000-0000-00000000000a')
  returning id as ev1_id \gset
select t.put('ev1', :'ev1_id'::uuid);
select t.eq('apply_team cria 3 escalações', apply_team(t.id('ev1'), t.id('teamA'))::text, '3');
select t.eq('apply_team é idempotente', apply_team(t.id('ev1'), t.id('teamA'))::text, '0');

-- rascunho invisível para integrante comum (Duda, com conta)
select create_invite(t.id('mDuda'), 'member') as code_duda \gset
select create_invite(t.id('mCaio'), 'member') as code_caio \gset
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.eq('convite aceito (duda)', (accept_invite(:'code_duda') = t.id('chA'))::text, 'true');
select t.expect_fail(format($$select accept_invite(%L)$$, :'code_duda'), 'inválido ou já utilizado');
select t.expect_fail($$select accept_invite('codigo-que-nao-existe')$$, 'inválido ou já utilizado');
select t.eq('duda não vê rascunho', (select count(*)::text from events), '0');
select t.eq('duda não vê escalação de rascunho', (select count(*)::text from assignments), '0');
select t.eq('duda não vê contato de outros', (select count(*)::text from member_contacts where member_id <> t.id('mDuda')), '0');
select t.eq('duda vê o próprio contato', (select count(*)::text from member_contacts where member_id = t.id('mDuda')), '1');
select t.expect_fail(format($$insert into events (church_id, kind, starts_at) values (%L, 'culto', now() + interval '3 days')$$, t.id('chA')), 'row-level security');
select t.expect_fail(format($$select publish_event(%L)$$, t.id('ev1')), 'permissão');
select t.expect_fail(format($$select save_member(null, %L, 'Intruso Teste', null, null, null, %L::uuid[], '{}')$$, t.id('chA'), array[t.id('rVocal')]::text), 'Sem permissão');

-- Caio é líder da Equipe A (leader_id) => gerencia as escalas dela
select t.as_user('c0000000-0000-0000-0000-00000000000c');
select t.eq('convite aceito (caio)', (accept_invite(:'code_caio') = t.id('chA'))::text, 'true');
select t.eq('caio (líder da equipe) vê o rascunho', (select count(*)::text from events), '1');
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select publish_event(t.id('ev1'));
select t.expect_fail(format($$select publish_event(%L)$$, t.id('ev1')), 'Somente rascunhos');
select t.expect_fail(format($$update events set status = 'draft' where id = %L$$, t.id('ev1')), 'não volta a rascunho');
select t.expect_fail(format($$update events set deleted_at = now() where id = %L$$, t.id('ev1')), 'cancelada, não excluída');

-- ── Confirmação e recusa ───────────────────────────────────────────────────
select t.put('aCaio', (select id from assignments where event_id = t.id('ev1') and member_id = t.id('mCaio')));
select t.put('aDuda', (select id from assignments where event_id = t.id('ev1') and member_id = t.id('mDuda')));
select t.put('aEdu',  (select id from assignments where event_id = t.id('ev1') and member_id = t.id('mEdu')));
-- Duda ainda não tem conta; Ana (owner) responde por ela (RN-801)
select t.eq('admin confirma por Duda', (respond_assignment(t.id('aDuda'), 'confirm')->>'status'), 'confirmed');
select t.eq('responded_by registrado', (select (responded_by is not null)::text from assignments where id = t.id('aDuda')), 'true');
select t.expect_fail(format($$select respond_assignment(%L, 'decline', 'curto')$$, t.id('aEdu')), 'pelo menos 10 caracteres');
select t.expect_fail(format($$select respond_assignment(%L, 'confirm')$$, t.id('aDuda')), 'não está aguardando');

-- integrante com conta responde só a própria escalação
select t.as_user('c0000000-0000-0000-0000-00000000000c');
select t.eq('caio vê status só como gestor', (select count(distinct status)::text from event_roster(array[t.id('ev1')]) where status is not null), '2');
select t.eq('caio confirma a si', (respond_assignment(t.id('aCaio'), 'confirm')->>'status'), 'confirmed');

-- integrante comum não responde por outra pessoa
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.expect_fail(format($$select respond_assignment(%L, 'confirm')$$, t.id('aEdu')), 'permissão');
select t.expect_fail(format($$select respond_assignment(%L, 'confirm')$$, t.id('aCaio')), 'permissão');

-- recusa com justificativa => substitutos ranqueados (mesma função, sem conflito)
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.eq('recusa registrada', (respond_assignment(t.id('aDuda'), 'decline', 'Viagem a trabalho no fim de semana')->>'status'), 'declined');
select t.eq('substitutos de vocal (exclui quem já está escalado)',
  (select count(*)::text from substitutes(t.id('aDuda'))), '15');
select t.put('mDuda2', (select member_id from substitutes(t.id('aDuda')) limit 1));
select t.put('aDuda2', replace_assignment(t.id('aDuda'), t.id('mDuda2')));
select t.eq('original substituída', (select status from assignments where id = t.id('aDuda')), 'replaced');
select t.eq('nova pendente', (select status from assignments where id = t.id('aDuda2')), 'pending');

-- indisponibilidade tira do ranking
select t.as_root();
insert into unavailabilities (church_id, member_id, start_date, end_date, reason)
  select t.id('chA'), member_id, (now() + interval '9 days')::date, (now() + interval '11 days')::date, 'viagem'
    from _substitute_candidates(t.id('aCaio')) limit 1;
select t.as_user('a0000000-0000-0000-0000-00000000000a');

-- mudar data/hora reabre confirmações (RF-505)
select t.eq('antes: confirmadas', (select count(*)::text from assignments where event_id = t.id('ev1') and status = 'confirmed'), '1');
update events set starts_at = starts_at + interval '1 day' where id = t.id('ev1');
select t.eq('depois: reabertas', (select count(*)::text from assignments where event_id = t.id('ev1') and status = 'confirmed'), '0');

-- expiração D-3 (refresh_states)
insert into events (church_id, team_id, kind, starts_at, status, published_at)
  values (t.id('chA'), t.id('teamA'), 'ensaio', now() + interval '2 days', 'published', now());
select t.put('ev2', (select id from events where kind = 'ensaio'));
insert into assignments (church_id, event_id, member_id, role_id) values (t.id('chA'), t.id('ev2'), t.id('mEdu'), t.id('rBat'));
select refresh_states(t.id('chA'));
select t.eq('pendente a D-2 vira expirada', (select status from assignments where event_id = t.id('ev2')), 'expired');
select t.eq('expirada ainda pode confirmar', (respond_assignment((select id from assignments where event_id = t.id('ev2')), 'confirm')->>'status'), 'confirmed');

-- cancelar
select cancel_event(t.id('ev2'));
select t.eq('cancelamento propaga', (select status from assignments where event_id = t.id('ev2')), 'cancelled');
select t.expect_fail(format($$update events set status = 'published' where id = %L$$, t.id('ev2')), 'não pode mudar de situação');

-- arquivar integrante com escalação futura é bloqueado (RF-209)
select t.eq('arquivamento bloqueado', (archive_member(t.id('mEdu'))->>'ok'), 'false');

-- setlist
insert into songs (church_id, title, artist, song_key, bpm, media_url) values (t.id('chA'), 'Grande é o Senhor', 'Adhemar', 'G', 72, 'https://youtu.be/x');
select t.expect_fail(format($$insert into songs (church_id, title, media_url) values (%L, 'Perigo', 'javascript:alert(1)')$$, t.id('chA')), 'violates check');
select t.put('s1', (select id from songs limit 1));
select save_setlist(t.id('ev1'), jsonb_build_array(jsonb_build_object('song_id', t.id('s1'), 'key_override', 'A', 'moment', 'abertura')));
select save_setlist(t.id('ev1'), jsonb_build_array(jsonb_build_object('song_id', t.id('s1'), 'key_override', 'A', 'moment', 'abertura')));
select t.eq('setlist idempotente', (select count(*)::text from setlist_items where event_id = t.id('ev1')), '1');

-- último owner / papéis
select t.expect_fail(format($$update memberships set role = 'member' where church_id = %L and user_id = 'a0000000-0000-0000-0000-00000000000a'$$, t.id('chA')), 'ao menos um proprietário');
select t.expect_fail(format($$delete from memberships where church_id = %L and user_id = 'a0000000-0000-0000-0000-00000000000a'$$, t.id('chA')), 'ao menos um proprietário');

-- ── Vestimenta ─────────────────────────────────────────────────────────────
select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.eq('igreja nasce com os 10 padrões de vestimenta', (select count(*)::text from dress_codes where church_id = t.id('chA')), '10');
select t.expect_fail(format($$select seed_dress_codes(%L)$$, t.id('chA')), 'permission denied');
select t.as_root(); select seed_dress_codes(t.id('chA')); select t.as_user('a0000000-0000-0000-0000-00000000000a');
select t.eq('semear de novo não duplica', (select count(*)::text from dress_codes where church_id = t.id('chA')), '10');
select t.put('dVinho', (select id from dress_codes where church_id = t.id('chA') and name = 'Preto e Vinho'));
select t.expect_fail(format($$insert into dress_codes (church_id, name, colors) values (%L, 'Ruim', '[{"hex":"vermelho"}]')$$, t.id('chA')), 'dress_colors_check');
select t.expect_fail(format($$insert into dress_codes (church_id, name, colors) values (%L, 'Vazio', '[]')$$, t.id('chA')), 'dress_colors_check');
select t.expect_fail(format($$insert into dress_codes (church_id, name, colors) values (%L, 'preto e vinho', '[{"hex":"#000000"}]')$$, t.id('chA')), 'dress_codes_name_key');
select t.expect_fail(format($$insert into dress_weeks values (%L, current_date - extract(dow from current_date)::int + 1, %L)$$, t.id('chA'), t.id('dVinho')), 'dress_week_sunday');
insert into dress_weeks values (t.id('chA'), current_date - extract(dow from current_date)::int, t.id('dVinho'));
select t.expect_fail(format($$insert into dress_weeks values (%L, current_date - extract(dow from current_date)::int + 7, %L)$$, t.id('chB'), t.id('dVinho')), 'violates');
-- Caio (líder) escala a semana, mas não altera os padrões; Duda (integrante) só lê
select t.as_user('c0000000-0000-0000-0000-00000000000c');
insert into dress_weeks values (t.id('chA'), current_date - extract(dow from current_date)::int + 7, t.id('dVinho'));
select t.eq('líder escalou a semana', (select count(*)::text from dress_weeks), '2');
update dress_codes set name = 'Hackeado' where id = t.id('dVinho');
select t.eq('líder não altera padrão', (select name from dress_codes where id = t.id('dVinho')), 'Preto e Vinho');
select t.as_user('d0000000-0000-0000-0000-00000000000d');
select t.eq('integrante vê os padrões', (select count(*)::text from dress_codes), '10');
select t.expect_fail(format($$insert into dress_weeks values (%L, current_date - extract(dow from current_date)::int + 14, %L)$$, t.id('chA'), t.id('dVinho')), 'row-level security');
select t.as_user('a0000000-0000-0000-0000-00000000000a');
update dress_codes set colors = '[{"hex":"#000000","name":"Preto"},{"hex":"#123456","name":"Novo"}]' where id = t.id('dVinho');

-- ── Área pública: sem vazamento ────────────────────────────────────────────
select t.as_anon();
select t.eq('anon lê a área pública', (public_church('igreja-a') is not null)::text, 'true');
select t.eq('público sem telefone', (public_church('igreja-a')::text ~ '5565999')::text, 'false');
select t.eq('público sem e-mail', (public_church('igreja-a')::text ~ '@a.com')::text, 'false');
select t.eq('público sem status', (public_church('igreja-a')::text ~ 'confirmed|declined|decline_reason')::text, 'false');
select t.eq('público tem o setlist', (public_church('igreja-a')::text ~ 'Grande é o Senhor')::text, 'true');
select t.eq('público traz a vestimenta escalada com as cores atuais', (public_church('igreja-a')->'dress'->0->'colors'->1->>'hex'), '#123456');
select t.expect_fail($$select * from members$$, 'permission denied');
select t.expect_fail($$select * from events$$, 'permission denied');
select t.expect_fail($$select refresh_states(gen_random_uuid())$$, 'permission denied');

-- ── ISOLAMENTO ENTRE IGREJAS (RNF-01): B não enxerga nada de A ─────────────
select t.as_user('b0000000-0000-0000-0000-00000000000b');
do $$
declare tb text; n bigint; leaks text := '';
begin
  for tb in select unnest(array['churches','memberships','members','member_contacts','roles','member_roles','teams',
      'team_members','events','assignments','unavailabilities','songs','setlist_items','invites','audit_log','dress_codes','dress_weeks']) loop
    execute format('select count(*) from %I where %s = $1', tb,
                   case when tb = 'churches' then 'id::text' else 'church_id::text' end)
      into n using t.id('chA')::text;
    if n > 0 then leaks := leaks || tb || '(' || n || ') '; end if;
  end loop;
  if leaks <> '' then raise exception 'FALHA ISOLAMENTO: vazamento em %', leaks; end if;
  raise notice 'ok  isolamento: B não lê nenhuma linha de A em 17 tabelas';
end $$;
select t.eq('B vê só a própria igreja', (select count(*)::text from churches), '1');
select t.eq('B não vê funções de A', (select count(*)::text from roles where church_id = t.id('chA')), '0');
select t.expect_fail(format($$select publish_event(%L)$$, t.id('ev1')), 'permissão');
select t.expect_fail(format($$select refresh_states(%L)$$, t.id('chA')), 'Sem acesso');
select t.expect_fail(format($$select save_member(null, %L, 'Intruso Teste', null, null, null, %L::uuid[], '{}')$$, t.id('chA'), array[t.id('rVocal')]::text), 'Sem permissão');
select t.expect_fail(format($$insert into members (church_id, full_name) values (%L, 'Intruso Teste')$$, t.id('chA')), 'row-level security');
select t.expect_fail(format($$insert into assignments (church_id, event_id, member_id, role_id) values (%L, %L, %L, %L)$$,
  t.id('chB'), t.id('ev1'), t.id('mEdu'), t.id('rBat')), 'violates');
select t.eq('B não lê respostas de A', (select count(*)::text from event_roster(array[t.id('ev1')])), '0');
select t.eq('B não vê cargas de A', (select count(*)::text from member_loads(t.id('chA'))), '0');

select t.as_root();
\echo
\echo '=== TODOS OS TESTES PASSARAM ==='
