---
name: brainbase-mana-meetings-discovery
description: mana管理の議事録探索はGitHub repo名の推測ではなくchannels.jsonとproject設定から洗う
---

# brainbase-mana管理の議事録探索はgithub-repo名の推測ではなくchannels-jsonとproject設定から洗う

## Trigger
- Use when this pattern appears: mana管理の議事録探索はGitHub repo名の推測ではなくchannels.jsonとproject設定から洗う

## Steps
- aws s3 cp s3://brainbase-context-593793022993/channels.json /tmp/channels.json
- jq -r '.channels[] | "\(.channel_id)\t\(.channel_name)\t\(.project_id)\t\(.workspace)"' /tmp/channels.json
- # mana側の解決ロジック確認
- gh api repos/Unson-LLC/mana/contents/api/channel-project-resolver.js | jq -r '.content' | base64 -d
- # 保存先候補repoを洗う
- gh repo list Unson-LLC --limit 200 --json name,description

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/mana管理の議事録探索はgithub-repo名の推測ではなくchannels-jsonとproject設定から洗う

## Source
- Promoted from explicit_learn / success