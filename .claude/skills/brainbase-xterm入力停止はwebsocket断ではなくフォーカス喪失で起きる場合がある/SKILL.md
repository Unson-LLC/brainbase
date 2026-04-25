---
name: brainbase-xterm入力停止はwebsocket断ではなくフォーカス喪失で起きる場合がある
description: xterm入力停止はWebSocket断ではなくフォーカス喪失で起きる場合がある
---

# brainbase-xterm入力停止はwebsocket断ではなくフォーカス喪失で起きる場合がある

## Trigger
- Use when this pattern appears: xterm入力停止はWebSocket断ではなくフォーカス喪失で起きる場合がある

## Steps
- DevTools Consoleで `[TTC-PROBE]` を確認
- `onData` / `sendText` / `dispatch` / `focusin` / `focusout` を時系列で見る
- 最後が `focusout { relatedTarget: undefined }` で止まり、その後 `onData` が出ない場合はxterm focus復旧不備を疑う
- `window.focus` 復帰時とterminal host click時に `terminal.focus()` する経路を実装する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/xterm入力停止はwebsocket断ではなくフォーカス喪失で起きる場合がある

## Source
- Promoted from explicit_learn / success