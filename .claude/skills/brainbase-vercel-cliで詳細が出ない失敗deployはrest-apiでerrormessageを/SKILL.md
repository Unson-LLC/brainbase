---
name: brainbase-vercel-cliで詳細が出ない失敗deployはrest-apiでerrormessageを
description: Vercel CLIで詳細が出ない失敗deployはREST APIでerrorMessageを確認する
---

# brainbase-vercel-cliで詳細が出ない失敗deployはrest-apiでerrormessageを

## Trigger
- Use when this pattern appears: Vercel CLIで詳細が出ない失敗deployはREST APIでerrorMessageを確認する

## Steps
- TOKEN=$(jq -r .token ~/Library/Application\ Support/com.vercel.cli/auth.json)
- TEAM_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v2/teams?slug=<team-slug>" | jq -r '.id')
- curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects?teamId=$TEAM_ID&search=<project>" | jq '.projects[] | {id,name}'
- curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v6/deployments?projectId=<projectId>&teamId=$TEAM_ID&state=ERROR&limit=10" | jq '.deployments[] | {uid, branch:.meta.githubCommitRef, state:.readyState, errorMessage}'

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/vercel-cliで詳細が出ない失敗deployはrest-apiでerrormessageを

## Source
- Promoted from explicit_learn / success