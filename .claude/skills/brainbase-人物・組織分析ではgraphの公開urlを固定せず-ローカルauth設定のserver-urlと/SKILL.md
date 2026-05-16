---
name: brainbase-人物・組織分析ではgraphの公開urlを固定せず-ローカルauth設定のserver-urlと
description: 人物・組織分析ではGraphの公開URLを固定せず、ローカルauth設定のserver_urlと権限ヘッダーを正とする
---

# brainbase-人物・組織分析ではgraphの公開urlを固定せず-ローカルauth設定のserver-urlと

## Trigger
- Use when this pattern appears: 人物・組織分析ではGraphの公開URLを固定せず、ローカルauth設定のserver_urlと権限ヘッダーを正とする

## Steps
- jq '.server_url' ~/.brainbase/config.json ~/.brainbase/auth.json
- jq '{role,projects,clearance,server_url}' ~/.brainbase/auth.json
- curl -s \
- H "Authorization: Bearer $TOKEN" \
- H "x-brainbase-role: $ROLE" \
- H "x-brainbase-projects: $PROJECTS_JSON" \
- H "x-brainbase-clearance: $CLEARANCE_JSON" \
- "$SERVER_URL/api/info/graph/entities?type=person&limit=500"

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/人物・組織分析ではgraphの公開urlを固定せず-ローカルauth設定のserver-urlと

## Source
- Promoted from explicit_learn / success