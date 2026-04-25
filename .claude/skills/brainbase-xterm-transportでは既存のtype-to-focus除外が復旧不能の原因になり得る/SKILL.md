---
name: brainbase-xterm-transportでは既存のtype-to-focus除外が復旧不能の原因になり得る
description: xterm transportでは既存のtype-to-focus除外が復旧不能の原因になり得る
---

# brainbase-xterm-transportでは既存のtype-to-focus除外が復旧不能の原因になり得る

## Trigger
- Use when this pattern appears: xterm transportでは既存のtype-to-focus除外が復旧不能の原因になり得る

## Steps
- `this._isXtermTransportActive(sessionId)` の早期returnを確認
- xtermがfocusedか判定する
- unfocusedなら `focusTerminal()` / `terminal.focus()` を実行
- トリガーキーは `terminalTransportClient.sendKey()` または `sendText()` で送信
- HTTP post経路と二重送信しない

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/xterm-transportでは既存のtype-to-focus除外が復旧不能の原因になり得る

## Source
- Promoted from explicit_learn / success