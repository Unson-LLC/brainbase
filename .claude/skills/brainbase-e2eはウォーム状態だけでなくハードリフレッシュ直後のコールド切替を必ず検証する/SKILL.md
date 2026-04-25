---
name: brainbase-e2eはウォーム状態だけでなくハードリフレッシュ直後のコールド切替を必ず検証する
description: E2Eはウォーム状態だけでなくハードリフレッシュ直後のコールド切替を必ず検証する
---

# brainbase-e2eはウォーム状態だけでなくハードリフレッシュ直後のコールド切替を必ず検証する

## Trigger
- Use when this pattern appears: E2Eはウォーム状態だけでなくハードリフレッシュ直後のコールド切替を必ず検証する

## Steps
- 1. Playwrightでページをhard reload相当に再読み込みする
- 2. 事前に全セッションを開かず、未ウォームのセッションへ切り替える
- 3. 期待するセッション固有の文字列が表示されることを確認する
- 4. 旧セッション固有文字列が残っていないことを確認する
- 5. 一定時間後もblank/blackのままではないことを確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- spikes/e2eはウォーム状態だけでなくハードリフレッシュ直後のコールド切替を必ず検証する

## Source
- Promoted from explicit_learn / success