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
  | jq -e '. as $response | all("resolve_entity", "list_entities"; . as $required | any($response.result.tools[]?; .name == $required))' >/dev/null

growin="$(rpc '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"resolve_entity","arguments":{"query":"グローウィン・パートナーズ株式会社 Growin"}}}')"
unson="$(rpc '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"resolve_entity","arguments":{"query":"合同会社雲孫 Unson"}}}')"
foreign="$(rpc '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"resolve_entity","arguments":{"query":"Aitle HOTEL555 SalesTailor"}}}')"

candidates() {
  sed -n 's/^data: //p' \
    | jq -c '[.result.content[]?.text | fromjson? | .candidates[]?]'
}

growin_candidates="$(printf '%s' "$growin" | candidates)"
unson_candidates="$(printf '%s' "$unson" | candidates)"
foreign_candidates="$(printf '%s' "$foreign" | candidates)"

if ! jq -e 'any(.[]; .type == "org" and .name == "グローウィン・パートナーズ株式会社" and .project_code == "growin")' \
  <<<"$growin_candidates" >/dev/null; then
  echo "失敗: Growinの会社エンティティを取得できません" >&2
  exit 1
fi
if ! jq -e 'any(.[]; .type == "org" and .name == "合同会社雲孫" and .project_code == "growin")' \
  <<<"$unson_candidates" >/dev/null; then
  echo "失敗: Growin案件の提供元コンテキストとして雲孫を取得できません" >&2
  exit 1
fi
if ! jq -e 'length == 0' <<<"$foreign_candidates" >/dev/null; then
  echo "失敗: Growin専用環境から他案件エンティティを参照できました" >&2
  exit 1
fi

list_entities() {
  local id="$1"
  local type="$2"
  local payload
  payload="$(jq -nc --argjson id "$id" --arg type "$type" \
    '{jsonrpc:"2.0",id:$id,method:"tools/call",params:{name:"list_entities",arguments:{type:$type,project:"growin"}}}')"
  rpc "$payload" | sed -n 's/^data: //p' | jq -r '.result.content[]?.text'
}

decisions="$(list_entities 6 decision)"
people="$(list_entities 7 person)"
apps="$(list_entities 8 app)"

decision_count="$(printf '%s\n' "$decisions" | sed -n 's/^# decision entities (\([0-9][0-9]*\)).*/\1/p')"
people_count="$(printf '%s\n' "$people" | sed -n 's/^# person entities (\([0-9][0-9]*\)).*/\1/p')"
planned_count="$(printf '%s\n' "$apps" | grep -c '\[planned\]$' || true)"

test "${decision_count:-0}" -gt 0 || { echo '失敗: 会議前に参照する決定記録がありません' >&2; exit 1; }
test "${people_count:-0}" -gt 0 || { echo '失敗: 会議前に参照する関係者がいません' >&2; exit 1; }
test "$planned_count" -gt 0 || { echo '失敗: 会議前に確認する未解決・計画中項目がありません' >&2; exit 1; }
printf '%s\n' "$people" | grep -Fq '**加藤 真太郎**' || { echo '失敗: 加藤さんを確認できません' >&2; exit 1; }
printf '%s\n' "$people" | grep -Fq '**川村 達見**' || { echo '失敗: 川村さんを確認できません' >&2; exit 1; }

jq -nc \
  --arg status ok \
  --arg scenario '会議前に、過去の決定・関係者・未解決事項を確認する' \
  --argjson decisions "$decision_count" \
  --argjson people "$people_count" \
  --argjson open_items "$planned_count" \
  '{status:$status,scenario:$scenario,counts:{decisions:$decisions,people:$people,open_items:$open_items},tenant_isolation:true}'
