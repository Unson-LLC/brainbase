---
name: brainbase-ui状態の検証でapiを自作シミュレートすると実hooksの不具合を見逃す
description: UI状態の検証でAPIを自作シミュレートすると実hooksの不具合を見逃す
---

# brainbase-ui状態の検証でapiを自作シミュレートすると実hooksの不具合を見逃す

## Trigger
- Use when this pattern appears: UI状態の検証でAPIを自作シミュレートすると実hooksの不具合を見逃す

## Steps
- 1. ユーザーが開いているURLを確認する（例: localhost / bb.brain-base.work / bb.unson.jp）
- 2. そのURLのstatus APIとWebSocket endpointを直接確認する
- 3. サーバーログで実hookイベントが届いているか確認する
- 4. PlaywrightでDOM上のindicator classとAPI状態を比較する
- 5. DNS/Cloudflare/nginx経由が別インスタンスを向いていないか確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/ui状態の検証でapiを自作シミュレートすると実hooksの不具合を見逃す

## Source
- Promoted from explicit_learn / success