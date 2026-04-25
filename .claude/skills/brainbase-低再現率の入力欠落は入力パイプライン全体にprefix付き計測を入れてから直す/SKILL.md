---
name: brainbase-低再現率の入力欠落は入力パイプライン全体にprefix付き計測を入れてから直す
description: 低再現率の入力欠落は入力パイプライン全体にprefix付き計測を入れてから直す
---

# brainbase-低再現率の入力欠落は入力パイプライン全体にprefix付き計測を入れてから直す

## Trigger
- Use when this pattern appears: 低再現率の入力欠落は入力パイプライン全体にprefix付き計測を入れてから直す

## Steps
- client: `onData` 発火、`sendText` entry、pending buffer長、dispatch sent/enqueued/droppedをログ
- client: websocket close時のpending buffer長とqueue sizeをログ
- client: reconnect/drain時に送れたか捨てたかをログ
- server: input message受信時にlen/owner/drop理由をログ
- prefix例: `[TTC-PROBE]` に統一してConsoleとserver logを突き合わせる

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/低再現率の入力欠落は入力パイプライン全体にprefix付き計測を入れてから直す

## Source
- Promoted from explicit_learn / success