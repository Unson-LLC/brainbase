#!/usr/bin/env bash
set -euo pipefail

mcp_url="${GROWIN_BRAINBASE_MCP_URL:-https://brainbase-mcp-lmc74punpa-an.a.run.app/mcp}"
api_url="${GROWIN_BRAINBASE_API_URL:-https://brainbase-api-lmc74punpa-an.a.run.app}"
token_file="${GROWIN_BRAINBASE_TOKEN_FILE:-${HOME}/.brainbase/growin/tokens.json}"

command -v claude >/dev/null || { echo "Claude Code が必要です" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq が必要です" >&2; exit 1; }

if [[ ! -f "$token_file" ]]; then
  echo "Growin専用の個人認証を開始します。ブラウザでSlack認証を完了してください。"
  BRAINBASE_API_URL="$api_url" BRAINBASE_TOKEN_FILE="$token_file" node scripts/auth-setup.mjs
fi
token="$(jq -er '.access_token | select(type == "string" and length > 0)' "$token_file")" || {
  echo "Growin専用の個人トークンを読み込めません。再認証してください: $token_file" >&2
  exit 1
}

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
