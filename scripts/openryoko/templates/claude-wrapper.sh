#!/usr/bin/env bash
set -euo pipefail

environment_file="@ENVIRONMENT_FILE@"
claude_binary="@CLAUDE_BINARY@"

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a

for variable_name in "${!OPENRYOKO_SLACK_@}"; do
  unset "$variable_name"
done

exec "$claude_binary" "$@"
