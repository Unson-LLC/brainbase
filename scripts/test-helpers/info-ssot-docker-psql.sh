#!/usr/bin/env bash
set -Eeuo pipefail

: "${INFO_SSOT_TEST_POSTGRES_CONTAINER:?INFO_SSOT_TEST_POSTGRES_CONTAINER is required}"
: "${INFO_SSOT_TEST_REPO_ROOT:?INFO_SSOT_TEST_REPO_ROOT is required}"

# info-ssot-apply.sh passes the connection URL as psql's first argument. This
# forwards that invocation to psql inside the disposable PostgreSQL container;
# it does not emulate psql or execute SQL itself.
database_url="${1:?PostgreSQL connection URL is required}"
shift
# The host-side integration URL reaches Docker through a dynamically published
# port. Inside the same PostgreSQL container it must target the local server.
database_url="${database_url%@*}@localhost:5432/${database_url##*/}"

psql_args=()
for argument in "$@"; do
  psql_args+=("${argument/#$INFO_SSOT_TEST_REPO_ROOT//workspace}")
done

if [[ -n "${INFO_SSOT_TEST_PSQL_LOG:-}" ]]; then
  docker exec -i "$INFO_SSOT_TEST_POSTGRES_CONTAINER" psql "$database_url" "${psql_args[@]}" \
    2> >(tee -a "$INFO_SSOT_TEST_PSQL_LOG" >&2)
else
  exec docker exec -i "$INFO_SSOT_TEST_POSTGRES_CONTAINER" psql "$database_url" "${psql_args[@]}"
fi
