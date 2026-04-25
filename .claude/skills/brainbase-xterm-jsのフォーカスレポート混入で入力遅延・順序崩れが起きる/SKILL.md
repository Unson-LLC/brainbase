---
name: brainbase-xterm-jsのフォーカスレポート混入で入力遅延・順序崩れが起きる
description: xterm.jsのフォーカスレポート混入で入力遅延・順序崩れが起きる
---

# brainbase-xterm-jsのフォーカスレポート混入で入力遅延・順序崩れが起きる

## Trigger
- Use when this pattern appears: xterm.jsのフォーカスレポート混入で入力遅延・順序崩れが起きる

## Steps
- 1. クライアントのsendText/onDataで \x1b[I と \x1b[O を検出する
- 2. 通常テキストだけをバッチ送信・ローカルエコー対象にする
- 3. フォーカスレポートは即時送信または無視する
- 4. サーバー側sendInputでもフォーカスのみ入力は早期returnする
- 5. 高速タイピング、フォーカス切替混入、Backspaceを含む回帰テストを追加する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/xterm-jsのフォーカスレポート混入で入力遅延・順序崩れが起きる

## Source
- Promoted from explicit_learn / success