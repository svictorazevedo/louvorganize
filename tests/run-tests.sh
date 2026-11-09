#!/bin/sh
# Requer: docker run -d --name lo-pg -e POSTGRES_PASSWORD=x postgres:16-alpine
set -e
cd "$(dirname "$0")/.."
sh tests/reset-db.sh
docker exec -i lo-pg psql -U postgres -d lo -v ON_ERROR_STOP=1 < tests/01_rules.sql 2>&1 | grep -v '^$' 
