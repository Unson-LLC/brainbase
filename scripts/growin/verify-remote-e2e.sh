#!/usr/bin/env bash
set -euo pipefail

project_id="${GROWIN_GCP_PROJECT_ID:-brainbase-505912}"
account="${GROWIN_GCP_ACCOUNT:-k.sato.unson@gmail.com}"
api_url="${GROWIN_BRAINBASE_API_URL:-https://brainbase-api-lmc74punpa-an.a.run.app}"
mcp_url="${GROWIN_BRAINBASE_MCP_URL:-https://brainbase-mcp-lmc74punpa-an.a.run.app/mcp}"

command -v gcloud >/dev/null || { echo "gcloud が必要です" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl が必要です" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq が必要です" >&2; exit 1; }

assert_growin_endpoint() {
  local kind="$1"
  local url="$2"
  case "$url" in
    https://brainbase-"$kind"-*.run.app|https://brainbase-"$kind"-*.run.app/*) ;;
    *) echo "失敗: Growin Cloud Run以外の${kind}接続先は検証できません: $url" >&2; exit 1 ;;
  esac
  case "$url" in
    *localhost*|*127.0.0.1*|*unson*) echo "失敗: 分離対象外の接続先です: $url" >&2; exit 1 ;;
  esac
}

assert_growin_endpoint api "$api_url"
assert_growin_endpoint mcp "$mcp_url"
token="$(gcloud secrets versions access latest --secret=brainbase-mcp-http-bearer-token --project="$project_id" --account="$account")"
trap 'unset token' EXIT HUP INT TERM

test "$(curl -sS -o /dev/null -w '%{http_code}' "$api_url/health/ready")" = 200
test "$(curl -sS -o /dev/null -w '%{http_code}' "${mcp_url%/mcp}/health")" = 200
test "$(curl -sS -o /dev/null -w '%{http_code}' "$mcp_url")" = 401

rpc() {
  curl -fsS "$mcp_url" -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data "$1"
}

initialize='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"growin-e2e","version":"1.0"}}}'
rpc "$initialize" | sed -n 's/^data: //p' | jq -e '.result' >/dev/null
rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | sed -n 's/^data: //p' \
  | jq -e 'any(.result.tools[]?; .name == "resolve_entity")' >/dev/null

growin="$(rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"resolve_entity","arguments":{"query":"グローウィン・パートナーズ株式会社 Growin"}}}')"
unson="$(rpc '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"resolve_entity","arguments":{"query":"合同会社雲孫 Unson"}}}')"

candidates() {
  sed -n 's/^data: //p' \
    | jq -c '[.result.content[]?.text | fromjson? | .candidates[]?]'
}

growin_candidates="$(printf '%s' "$growin" | candidates)"
unson_candidates="$(printf '%s' "$unson" | candidates)"

if ! jq -e 'any(.[]; .entity_id == "org_growin_partners" and .project_code == "growin")' \
  <<<"$growin_candidates" >/dev/null; then
  echo "失敗: Growinの会社エンティティを取得できません" >&2
  exit 1
fi
if ! jq -e 'length == 0' <<<"$unson_candidates" >/dev/null; then
  echo "失敗: Growin専用環境から雲孫エンティティが参照できました" >&2
  exit 1
fi
echo 'Growin E2E OK: Growinを取得し、雲孫を取得しないことを確認しました'
