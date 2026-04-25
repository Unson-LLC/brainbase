---
name: brainbase-活動状態管理ではturn-startedで前回done情報を消すと復元不能になる
description: 活動状態管理ではturn_startedで前回done情報を消すと復元不能になる
---

# brainbase-活動状態管理ではturn-startedで前回done情報を消すと復元不能になる

## Trigger
- Use when this pattern appears: 活動状態管理ではturn_startedで前回done情報を消すと復元不能になる

## Steps
- 1. turn_startedではlastWorkingAtとactiveTurnIdsを更新し、lastDoneAtは保持する
- 2. turn_completedではClaude形式以外のturnIdでも残留activeTurnIdsを安全にクリアする
- 3. restoreHookStatusではlastDoneAtがあるstale workingをdoneへ復元する
- 4. 昇格対象は直近24時間などの上限を設け、古すぎるworkingは破棄する
- 5. state永続化は競合リトライを入れ、再起動後もhookStatusが残ることを確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/活動状態管理ではturn-startedで前回done情報を消すと復元不能になる

## Source
- Promoted from explicit_learn / success