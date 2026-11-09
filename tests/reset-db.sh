#!/bin/sh
# Recria um banco limpo no container lo-pg e aplica stub + schema.
set -e
P="docker exec -i lo-pg psql -U postgres -v ON_ERROR_STOP=1 -q"
docker exec lo-pg psql -U postgres -q -c "drop database if exists lo" -c "create database lo" >/dev/null
docker exec lo-pg psql -U postgres -q -c "drop role if exists anon" >/dev/null 2>&1 || true
P="docker exec -i lo-pg psql -U postgres -d lo -v ON_ERROR_STOP=1 -q"
$P -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end \$\$;"
sed -e '/^create role/d' tests/00_stub_supabase.sql | $P
$P < supabase/schema.sql
