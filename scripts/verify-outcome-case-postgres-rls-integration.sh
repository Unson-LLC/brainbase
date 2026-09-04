#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="brainbase-outcome-case-rls-it-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm --name "$CONTAINER_NAME" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=brainbase postgres:16-alpine >/dev/null

for _ in {1..30}; do
  if docker exec "$CONTAINER_NAME" psql -X -Atq -U postgres -d brainbase -c 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

PORT="$(docker port "$CONTAINER_NAME" 5432/tcp | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -n 1)"
if [[ -z "$PORT" ]]; then
  echo 'could not resolve local PostgreSQL integration port' >&2
  exit 1
fi

cd "$REPO_ROOT"
RUN_OUTCOME_CASE_DB_TESTS=1 \
OUTCOME_CASE_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/brainbase" \
npm run test:run -- tests/server/services/outcome-case-postgres-rls.integration.test.js
echo OUTCOME_CASE_POSTGRES_RLS_INTEGRATION_OK
