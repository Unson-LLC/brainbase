#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="brainbase-outcome-case-rls-it-$$"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm --name "$CONTAINER_NAME" -p 127.0.0.1::5432 \
  -v "$REPO_ROOT:/workspace:ro" \
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

MIGRATION_ROLE="info_ssot_owner"
MIGRATION_PASSWORD="info_ssot_owner"
SUCCESS_DATABASE="brainbase_info_ssot_success"
DATABASE_URL="postgresql://${MIGRATION_ROLE}:${MIGRATION_PASSWORD}@127.0.0.1:${PORT}/${SUCCESS_DATABASE}"
ADMIN_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/${SUCCESS_DATABASE}"
FAILURE_DATABASE="brainbase_info_ssot_failure"
FAILURE_DATABASE_URL="postgresql://${MIGRATION_ROLE}:${MIGRATION_PASSWORD}@127.0.0.1:${PORT}/${FAILURE_DATABASE}"
MISMATCH_DATABASE="brainbase_info_ssot_mismatch"
MISMATCH_DATABASE_URL="postgresql://${MIGRATION_ROLE}:${MIGRATION_PASSWORD}@127.0.0.1:${PORT}/${MISMATCH_DATABASE}"
RECEIPT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/brainbase-info-ssot-it.XXXXXX")"
CURRENT_HEAD="$(git -C "$REPO_ROOT" rev-parse HEAD)"
trap 'rm -rf "$RECEIPT_DIR"; cleanup' EXIT

psql_in_container() {
  docker exec -i "$CONTAINER_NAME" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$1" "${@:2}"
}

psql_as_migration_owner() {
  PGPASSWORD="$MIGRATION_PASSWORD" docker exec -e PGPASSWORD -i "$CONTAINER_NAME" \
    psql -X -v ON_ERROR_STOP=1 -U "$MIGRATION_ROLE" -d "$1" "${@:2}"
}

seed_projects() {
  # `projects` is an existing application prerequisite. The Info SSOT schema
  # and RLS migration itself is exercised only by info-ssot-apply.sh below.
  psql_as_migration_owner "$1" <<'SQL'
CREATE TABLE projects (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  organization_id text
);
INSERT INTO projects (id, code, name, organization_id) VALUES
  ('proj_info_ssot_one', 'info-ssot-one', 'Info SSOT one', 'org_info_ssot'),
  ('proj_info_ssot_two', 'info-ssot-two', 'Info SSOT two', 'org_info_ssot');
SQL
}

run_info_ssot_apply() {
  local database_url="$1"
  local receipt_path="$2"
  INFO_SSOT_TEST_POSTGRES_CONTAINER="$CONTAINER_NAME" \
  INFO_SSOT_TEST_REPO_ROOT="$REPO_ROOT" \
  INFO_SSOT_DATABASE_URL="$database_url" \
  INFO_SSOT_GIT_SHA="$CURRENT_HEAD" \
  INFO_SSOT_ROLLBACK_SHA="$CURRENT_HEAD" \
  INFO_SSOT_APPLY_RECEIPT_PATH="$receipt_path" \
  INFO_SSOT_TEST_PSQL_LOG="$RECEIPT_DIR/psql.log" \
  PSQL_BIN="$REPO_ROOT/scripts/test-helpers/info-ssot-docker-psql.sh" \
  bash "$REPO_ROOT/scripts/info-ssot-apply.sh"
}

psql_in_container postgres -c "CREATE ROLE ${MIGRATION_ROLE} LOGIN PASSWORD '${MIGRATION_PASSWORD}'" >/dev/null
psql_in_container postgres -c "CREATE DATABASE ${SUCCESS_DATABASE} OWNER ${MIGRATION_ROLE}" >/dev/null

seed_projects "$SUCCESS_DATABASE"
if ! run_info_ssot_apply "$DATABASE_URL" "$RECEIPT_DIR/first.json"; then
  sed -n '1,240p' "$RECEIPT_DIR/psql.log" >&2 || true
  exit 1
fi
if ! run_info_ssot_apply "$DATABASE_URL" "$RECEIPT_DIR/second.json"; then
  sed -n '1,240p' "$RECEIPT_DIR/psql.log" >&2 || true
  exit 1
fi

node - "$RECEIPT_DIR/first.json" "$RECEIPT_DIR/second.json" "$CURRENT_HEAD" <<'NODE'
const { readFileSync } = require('node:fs');
const expectedHead = process.argv.at(-1);
for (const receiptPath of process.argv.slice(2, -1)) {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.status !== 'applied'
    || receipt.transaction !== 'single'
    || receipt.git_sha !== expectedHead
    || receipt.readback?.status !== 'passed'
    || receipt.readback?.scope !== 'in_transaction_and_post_commit'
    || receipt.readback?.marker !== 'INFO_SSOT_READBACK_OK'
    || receipt.negative_smoke?.status !== 'passed'
    || receipt.negative_smoke?.marker !== 'INFO_SSOT_NEGATIVE_SMOKE_OK') {
    throw new Error(`invalid Info SSOT apply receipt: ${receiptPath}`);
  }
}
NODE

psql_as_migration_owner "$SUCCESS_DATABASE" -Atq -f /workspace/server/sql/info-ssot-readback.sql | grep -Fx 'INFO_SSOT_READBACK_OK' >/dev/null

psql_in_container postgres -c "CREATE DATABASE ${MISMATCH_DATABASE} OWNER ${MIGRATION_ROLE}" >/dev/null
seed_projects "$MISMATCH_DATABASE"
run_info_ssot_apply "$MISMATCH_DATABASE_URL" "$RECEIPT_DIR/mismatch-baseline.json"
psql_in_container "$MISMATCH_DATABASE" <<'SQL'
INSERT INTO projects (id, code, name, organization_id)
VALUES ('proj_foreign', 'foreign-project', 'Foreign project', 'org_other');
INSERT INTO outcome_cases (
  case_id, organization_id, project_code, capability_id, user_observable_outcome,
  protected_constraints, non_goals, authority, selected_domain_pack,
  closure_status, current_external_state, technical_story_refs, run_receipt_refs,
  prior_attempt_refs, revision
) VALUES (
  'oc_project_owner_mismatch', 'org_info_ssot', 'foreign-project', 'cap_outcome_control',
  'must remain invisible', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'delivery-control/v1',
  'open', 'unknown', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 1
);
SQL
if run_info_ssot_apply "$MISMATCH_DATABASE_URL" "$RECEIPT_DIR/mismatch-failure.json"; then
  echo 'project-owner mismatch migration unexpectedly succeeded' >&2
  exit 1
fi
if ! grep -F 'OUTCOME_CASE_PROJECT_OWNERSHIP_MISMATCH' "$RECEIPT_DIR/psql.log" >/dev/null; then
  echo 'project-owner mismatch migration failed without the ownership guard' >&2
  exit 1
fi
if [[ -e "$RECEIPT_DIR/mismatch-failure.json" ]]; then
  echo 'project-owner mismatch migration wrote a receipt' >&2
  exit 1
fi
if [[ "$(psql_in_container "$MISMATCH_DATABASE" -Atq -c "SELECT count(*) FROM outcome_cases WHERE case_id='oc_project_owner_mismatch'")" != '1' ]]; then
  echo 'project-owner mismatch migration did not roll back safely' >&2
  exit 1
fi
if [[ "$(psql_in_container "$MISMATCH_DATABASE" -Atq -c "SELECT relforcerowsecurity FROM pg_class WHERE oid='outcome_cases'::regclass")" != 't' ]]; then
  echo 'project-owner mismatch migration left FORCE RLS disabled' >&2
  exit 1
fi

psql_in_container postgres -c "CREATE DATABASE ${FAILURE_DATABASE} OWNER ${MIGRATION_ROLE}" >/dev/null
seed_projects "$FAILURE_DATABASE"
# This deliberately pre-existing malformed legacy row makes the actual apply
# script fail after its initial transaction work, proving rollback/no-receipt.
psql_as_migration_owner "$FAILURE_DATABASE" <<'SQL'
CREATE TABLE outcome_cases (
  case_id text PRIMARY KEY,
  project_code text NOT NULL
);
INSERT INTO outcome_cases (case_id, project_code) VALUES ('oc_legacy_unowned', 'info-ssot-one');
SQL

if run_info_ssot_apply "$FAILURE_DATABASE_URL" "$RECEIPT_DIR/failure.json"; then
  echo 'controlled Info SSOT failure unexpectedly succeeded' >&2
  exit 1
fi
if [[ -e "$RECEIPT_DIR/failure.json" ]]; then
  echo 'failed Info SSOT apply wrote a receipt' >&2
  exit 1
fi
if [[ "$(psql_in_container "$FAILURE_DATABASE" -Atq -c "SELECT to_regclass('public.project_registry') IS NULL")" != 't' ]]; then
  echo 'failed Info SSOT apply left a transactional project_registry table' >&2
  exit 1
fi
if [[ "$(psql_in_container "$FAILURE_DATABASE" -Atq -c "SELECT to_regclass('public.graph_entities') IS NULL")" != 't' ]]; then
  echo 'failed Info SSOT apply left a transactional graph_entities table' >&2
  exit 1
fi

cd "$REPO_ROOT"
RUN_OUTCOME_CASE_DB_TESTS=1 \
OUTCOME_CASE_DATABASE_URL="$ADMIN_DATABASE_URL" \
npm run test:run -- tests/server/services/outcome-case-postgres-rls.integration.test.js
echo OUTCOME_CASE_POSTGRES_RLS_INTEGRATION_OK
echo INFO_SSOT_APPLY_REAL_POSTGRES_INTEGRATION_OK
