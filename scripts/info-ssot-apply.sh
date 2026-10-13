#!/usr/bin/env bash
# Apply the graph-entity list fix.
# Indexes run outside a transaction. ANALYZE runs after the RLS functions.
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
INDEX_SQL="$REPO_ROOT/server/sql/info-ssot-graph-indexes.sql"
RLS_SQL="$REPO_ROOT/server/sql/info-ssot-rls.sql"

if [[ -z "${INFO_SSOT_DATABASE_URL:-}" ]]; then
  echo "INFO_SSOT_DATABASE_URL is not set" >&2
  exit 1
fi

PSQL_BIN="${PSQL_BIN:-psql}"
if ! command -v "$PSQL_BIN" >/dev/null 2>&1; then
  echo "psql not found. Set PSQL_BIN or install PostgreSQL." >&2
  exit 1
fi

for sql_file in "$INDEX_SQL" "$RLS_SQL"; do
  if [[ ! -r "$sql_file" ]]; then
    echo "Info SSOT SQL file is missing or unreadable: ${sql_file#"$REPO_ROOT/"}" >&2
    exit 1
  fi
done

run_psql() {
  "$PSQL_BIN" "$INFO_SSOT_DATABASE_URL" -X -v ON_ERROR_STOP=1 "$@"
}

# Concurrent indexes use autocommit. The RLS file is the one wrapped below.
if ! run_psql -f "$INDEX_SQL"; then
  echo "Graph entity index migration failed; do not restart the API" >&2
  exit 1
fi

if ! run_psql --single-transaction -f "$RLS_SQL"; then
  echo "Graph entity RLS migration failed; do not restart the API" >&2
  exit 1
fi

if ! run_psql -c "ANALYZE public.graph_entities; ANALYZE public.graph_edges;"; then
  echo "ANALYZE public.graph_entities / public.graph_edges failed" >&2
  exit 1
fi

echo "Info SSOT graph entity list migration applied"
