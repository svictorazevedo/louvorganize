#!/bin/sh
# Integração com um PostgREST real (o mesmo motor da API do Supabase), em Docker.
# Sobe Postgres + PostgREST numa rede própria, carrega schema + dados de teste e roda tests/api/check.mjs.
set -e
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
HERE="$(pwd -W 2>/dev/null || pwd)"
docker network create lo-net >/dev/null 2>&1 || true
docker rm -f lo-pg lo-rest >/dev/null 2>&1 || true
docker run -d --name lo-pg --network lo-net -e POSTGRES_PASSWORD=x postgres:16-alpine >/dev/null
until docker exec lo-pg pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done; sleep 2
sh tests/run-tests.sh | tail -1
docker exec lo-pg psql -U postgres -d lo -q -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'x' noinherit; end if; end \$\$; grant anon, authenticated to authenticator;"
docker run -d --name lo-rest --network lo-net -e PGRST_DB_URI="postgres://authenticator:x@lo-pg:5432/lo" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="segredo-de-teste-com-pelo-menos-32-caracteres" postgrest/postgrest:v12.2.3 >/dev/null
sleep 4
docker run --rm --network lo-net -v "$HERE":/app node:20-alpine sh -c 'mkdir -p /tmp/x && cd /tmp/x && npm init -y >/dev/null && npm i --no-audit --no-fund @supabase/postgrest-js@2.118.0 >/dev/null 2>&1 && cp /app/tests/api/check.mjs . && node check.mjs'
