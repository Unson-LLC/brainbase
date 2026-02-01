#!/usr/bin/env bash
set -euo pipefail

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

"$PSQL_BIN" "$INFO_SSOT_DATABASE_URL" -f server/sql/info-ssot-schema.sql
"$PSQL_BIN" "$INFO_SSOT_DATABASE_URL" -f server/sql/info-ssot-rls.sql

echo "Info SSOT schema + RLS applied"
