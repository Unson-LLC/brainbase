#!/usr/bin/env bash
set -euo pipefail

project_id="${GROWIN_GCP_PROJECT_ID:-brainbase-505912}"
account="${GROWIN_GCP_ACCOUNT:-k.sato.unson@gmail.com}"
mcp_url="${GROWIN_BRAINBASE_MCP_URL:-https://brainbase-mcp-lmc74punpa-an.a.run.app/mcp}"
secret_name="${GROWIN_MCP_SECRET_NAME:-brainbase-mcp-http-bearer-token}"

command -v gcloud >/dev/null || { echo "gcloud が必要です" >&2; exit 1; }
command -v claude >/dev/null || { echo "Claude Code が必要です" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq が必要です" >&2; exit 1; }

token="$(gcloud secrets versions access latest --secret="$secret_name" --project="$project_id" --account="$account")"
test -n "$token" || { echo "Growin MCPトークンを取得できません" >&2; exit 1; }

config_file="$(mktemp "${TMPDIR:-/tmp}/growin-brainbase-mcp.XXXXXX.json")"
chmod 600 "$config_file"
cleanup() {
  case "$config_file" in
    "${TMPDIR:-/tmp}"/growin-brainbase-mcp.*.json) rm -f -- "$config_file" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

jq -n --arg url "$mcp_url" --arg authorization "Bearer $token" \
  '{mcpServers:{"brainbase-growin":{type:"http",url:$url,headers:{Authorization:$authorization}}}}' \
  >"$config_file"
unset token

echo "Growin専用Brainbaseだけを有効にしてClaude Codeを起動します。"
set +e
claude --strict-mcp-config --mcp-config "$config_file" "$@"
exit_code=$?
set -e
exit "$exit_code"
