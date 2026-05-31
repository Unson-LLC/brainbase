---
story_id: story-terminal-write-coalesce
title: Terminal input echo lag — coalesce the serialized write queue
status: active
source_requirement:
  type: user_report
  detail: >
    ターミナル入力欄の文字入力後の描画が 10〜20 秒遅れることがある。特に長文コピペで深刻。
architecture_docs:
  - path: docs/specs/story-terminal-write-coalesce-spec.md
    status: referenced
    reason: 既存のシリアライズ write キュー（_drainTerminalWriteQueue）を、連続する同世代 op を1回の terminal.write へ束ねるよう変更する局所修正。新規モジュール境界・依存・データフロー・公開API・イベント契約の変更はなく既存 TerminalTransportClient 内で完結する。
---

## Background

`_drainTerminalWriteQueue` は WS の `output` メッセージ **1件ごとに** `terminal.write` を1回呼び、
xterm の write-callback を待ってから次へ進む（+ メッセージごとに viewport capture/restore と
render refresh）。長文ペーストは pty から**数百〜数千の小さな chunk** としてエコーバックされ、
キューが「1 write / callback」ペースで drain するため秒〜十数秒遅延する。

決定論ハーネス（実ブラウザ + FakeWebSocket, 同一 125KB）で実測:

| 形 | drain |
|---|---|
| 2000 個の小 output メッセージ（実際の長文ペースト形） | **54,915ms** |
| 同バイトを1メッセージ | 1,030ms |
| **penalty** | **53×** |

## Scope

- `_drainTerminalWriteQueue` で、**連続する同世代・非 reset の op を1回の `terminal.write` へ
  coalesce** する（viewport restore と render refresh も batch あたり1回）。バイト順は保持。
- `resetTerminal` op は hard boundary（reset() が画面をクリアするので前の op を跨いで束ねない）。
- 修正後ハーネス: 2000 メッセージ drain **54,915ms → 4,280ms（~13×）**、`terminal.write` 2000→**2 回**、
  2000 行すべて正しく描画。
- out of scope（follow-up）: メッセージごとの `_captureViewportState` 呼び出し（2000回）の削減＝
  残る ~4s の主因。本 Story は「1 write / message」の 53× 問題に限定。

### 変更しない既存分岐（out of scope, 挙動不変）

- `operation.resetTerminal` 経路は batch の先頭境界として温存（reset 前後は混ざらない）。
- stale generation（`_cancelTerminalWriteQueue` 後）の op は従来どおり破棄。

## Acceptance Criteria

- [x] A burst of many output messages is coalesced into far fewer terminal write calls while preserving byte order and full content, so a long paste echo no longer drains one terminal write per message.
- [x] A reset terminal write stays a batch boundary so content before and after a reset is never merged into the same terminal write.

## Verification

- `tests/unit/terminal-write-coalesce.test.js`: 500 msgs -> <=3 write calls with identical
  concatenated content; reset boundary keeps order + reset() once; afterWrite callbacks all fire.
- `tests/e2e/story-terminal-write-coalesce-xterm.spec.js`: real-browser xterm, a burst of output
  messages collapses to a tiny terminal.write count with all lines rendered; reset boundary holds.
- Existing transport + snapshot-handoff suites (115) green.
