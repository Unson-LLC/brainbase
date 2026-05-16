---
name: brainbase-loki-でログが-0-件の時は検索語ではなく時間窓・label・収集範囲を先に疑う
description: Loki でログが 0 件の時は検索語ではなく時間窓・label・収集範囲を先に疑う
---

# brainbase-loki-でログが-0-件の時は検索語ではなく時間窓・label・収集範囲を先に疑う

## Trigger
- Use when this pattern appears: Loki でログが 0 件の時は検索語ではなく時間窓・label・収集範囲を先に疑う

## Steps
- curl -sf http://localhost:3100/ready
- curl -sf http://localhost:3100/loki/api/v1/labels
- curl -sf http://localhost:3100/loki/api/v1/label/app/values
- まず {app="brainbase-ui"} だけで対象時間帯にログがあるか確認
- 検索語付き query はその後に実行する
- 0件なら直近1時間などで最新ログの timestamp を取り、session 作成時刻とのずれを確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/loki-でログが-0-件の時は検索語ではなく時間窓・label・収集範囲を先に疑う

## Source
- Promoted from explicit_learn / success