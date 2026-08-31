#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SCHEMA_SQL="$REPO_ROOT/server/sql/info-ssot-schema.sql"
RLS_SQL="$REPO_ROOT/server/sql/info-ssot-rls.sql"
READBACK_SQL="$REPO_ROOT/server/sql/info-ssot-readback.sql"
NEGATIVE_SMOKE_SQL="$REPO_ROOT/server/sql/info-ssot-negative-smoke.sql"

if [[ -z "${INFO_SSOT_DATABASE_URL:-}" ]]; then
  echo "INFO_SSOT_DATABASE_URL is not set" >&2
  exit 1
fi

PSQL_BIN="${PSQL_BIN:-}"
if [[ -z "$PSQL_BIN" ]]; then
  if command -v psql >/dev/null 2>&1; then
    PSQL_BIN="psql"
  elif [[ -x "/usr/local/opt/postgresql@16/bin/psql" ]]; then
    PSQL_BIN="/usr/local/opt/postgresql@16/bin/psql"
  else
    echo "psql not found. Set PSQL_BIN or install PostgreSQL." >&2
    exit 1
  fi
fi

for sql_file in "$SCHEMA_SQL" "$RLS_SQL" "$READBACK_SQL" "$NEGATIVE_SMOKE_SQL"; do
  if [[ ! -r "$sql_file" ]]; then
    echo "Info SSOT SQL file is missing or unreadable: ${sql_file#"$REPO_ROOT/"}" >&2
    exit 1
  fi
done

GIT_SHA="${INFO_SSOT_GIT_SHA:-}"
if [[ -z "$GIT_SHA" ]]; then
  GIT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
fi
if [[ ! "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "INFO_SSOT_GIT_SHA must be a 40-character commit SHA" >&2
  exit 1
fi

ROLLBACK_SHA="${INFO_SSOT_ROLLBACK_SHA:-}"
if [[ -z "$ROLLBACK_SHA" ]]; then
  echo "INFO_SSOT_ROLLBACK_SHA is required for deployment evidence" >&2
  exit 1
fi
if [[ ! "$ROLLBACK_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "INFO_SSOT_ROLLBACK_SHA must be a 40-character commit SHA" >&2
  exit 1
fi

OPERATION_MODE="${INFO_SSOT_OPERATION_MODE:-apply}"
if [[ "$OPERATION_MODE" != "apply" && "$OPERATION_MODE" != "rollback_prepare" ]]; then
  echo "INFO_SSOT_OPERATION_MODE must be apply or rollback_prepare" >&2
  exit 1
fi
SERVICE_TARGET_SHA="$GIT_SHA"
if [[ "$OPERATION_MODE" == "rollback_prepare" ]]; then
  SERVICE_TARGET_SHA="$ROLLBACK_SHA"
fi

RECEIPT_PATH="${INFO_SSOT_APPLY_RECEIPT_PATH:-$REPO_ROOT/var/info-ssot-apply-receipt.json}"
if [[ "$RECEIPT_PATH" != /* ]]; then
  RECEIPT_PATH="$REPO_ROOT/$RECEIPT_PATH"
fi
mkdir -p "$(dirname -- "$RECEIPT_PATH")"
umask 077

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/info-ssot-apply.XXXXXXXX")"
RECEIPT_TMP=""
cleanup() {
  rm -rf -- "$TMP_DIR"
  if [[ -n "$RECEIPT_TMP" ]]; then
    rm -f -- "$RECEIPT_TMP"
  fi
}
trap cleanup EXIT

run_psql() {
  "$PSQL_BIN" "$INFO_SSOT_DATABASE_URL" -X -v ON_ERROR_STOP=1 "$@"
}

MIGRATION_OUTPUT="$TMP_DIR/migration.log"
if ! run_psql \
  -Atq \
  --single-transaction \
  -f "$SCHEMA_SQL" \
  -f "$RLS_SQL" \
  -f "$READBACK_SQL" \
  -f "$NEGATIVE_SMOKE_SQL" >"$MIGRATION_OUTPUT" 2>&1; then
  tail -n 40 "$MIGRATION_OUTPUT" >&2
  echo "Info SSOT schema/RLS transaction failed; do not restart or switch API/MCP, and verify the current service state" >&2
  exit 1
fi
if ! grep -Fqx 'INFO_SSOT_READBACK_OK' "$MIGRATION_OUTPUT"; then
  echo "Info SSOT in-transaction readback marker is missing; do not restart or switch API/MCP, and verify the current service state" >&2
  exit 1
fi
if ! grep -Fqx 'INFO_SSOT_NEGATIVE_SMOKE_OK' "$MIGRATION_OUTPUT"; then
  echo "Info SSOT in-transaction negative smoke marker is missing; do not restart or switch API/MCP, and verify the current service state" >&2
  exit 1
fi

READBACK_OUTPUT="$TMP_DIR/readback.log"
if ! run_psql -Atq -f "$READBACK_SQL" >"$READBACK_OUTPUT" 2>&1; then
  echo "Info SSOT post-commit readback failed; do not restart or switch API/MCP, and verify the current service state" >&2
  exit 1
fi
if ! grep -Fqx 'INFO_SSOT_READBACK_OK' "$READBACK_OUTPUT"; then
  echo "Info SSOT post-commit readback marker is missing; do not restart or switch API/MCP, and verify the current service state" >&2
  exit 1
fi

SERVER_VERSION="$(run_psql -Atqc "SHOW server_version;" | tr -d '\r\n')"
if [[ -z "$SERVER_VERSION" || ${#SERVER_VERSION} -gt 128 || "$SERVER_VERSION" =~ [^[:print:]] ]]; then
  echo "Info SSOT PostgreSQL server_version readback is invalid" >&2
  exit 1
fi

DB_FINGERPRINT="$(run_psql -Atqc "SELECT current_database() || '@' || COALESCE(inet_server_addr()::text, 'local') || ':' || COALESCE(inet_server_port()::text, '');" | tr -d '\r\n')"
if [[ -z "$DB_FINGERPRINT" || ! "$DB_FINGERPRINT" =~ ^[A-Za-z0-9_.:@/+-]+$ ]]; then
  echo "Info SSOT database identity readback is invalid" >&2
  exit 1
fi

RECEIPT_TMP="$(mktemp "${RECEIPT_PATH}.tmp.XXXXXXXX")"
node - "$RECEIPT_TMP" "$GIT_SHA" "$DB_FINGERPRINT" "$SERVER_VERSION" "$ROLLBACK_SHA" "$OPERATION_MODE" "$SERVICE_TARGET_SHA" <<'NODE'
import { writeFileSync } from 'node:fs';

const [, , outputPath, gitSha, database, serverVersion, rollbackSha, operationMode, serviceTargetSha] = process.argv;
const receipt = {
  status: 'applied',
  migration_id: 'info-ssot-schema+rls',
  operation_mode: operationMode,
  database_bundle_sha: gitSha,
  service_target_sha: serviceTargetSha,
  apply_commit_sha: gitSha,
  git_sha: gitSha,
  database,
  server_version: serverVersion,
  transaction: 'single',
  on_error_stop: true,
  readback: {
    status: 'passed',
    marker: 'INFO_SSOT_READBACK_OK',
    scope: 'in_transaction_and_post_commit',
  },
  negative_smoke: {
    status: 'passed',
    marker: 'INFO_SSOT_NEGATIVE_SMOKE_OK',
    scope: 'transaction_local',
  },
  rollback: {
    status: 'documented',
    rollback_sha: rollbackSha || null,
    database_strategy: 'forward_only_rls',
    service_strategy: 'switch_to_recorded_sha',
    runbook: 'docs/runbooks/info-ssot-rls-deployment.md',
  },
  completed_at: new Date().toISOString(),
};
writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
NODE
mv -f -- "$RECEIPT_TMP" "$RECEIPT_PATH"
RECEIPT_TMP=""

echo "Info SSOT schema + RLS applied; receipt=${RECEIPT_PATH#"$REPO_ROOT/"}"
