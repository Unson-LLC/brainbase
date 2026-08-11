#!/usr/bin/env bash
set -euo pipefail

environment_file="@ENVIRONMENT_FILE@"
claude_binary="@CLAUDE_BINARY@"

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a

unset OPENRYOKO_SLACK_APP_TOKEN OPENRYOKO_SLACK_BOT_TOKEN

exec "$claude_binary" "$@"
