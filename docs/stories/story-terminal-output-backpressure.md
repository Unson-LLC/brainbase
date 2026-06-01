---
story_id: story-terminal-output-backpressure
title: Long-paste hang + server instability — terminal output backpressure
status: active
source_requirement:
  type: user_report
  detail: >
    長文（特に日本語）をターミナルにペーストすると ~1分かかり、サーバとの接続が不安定になる/
    落ちる。実測: node CPU 100%×~80秒、RSS 140→390MB churn、WS切断、プロセス再起動。
architecture_docs:
  - path: docs/specs/story-terminal-output-backpressure-spec.md
    status: referenced
    reason: streaming transport の出力フラッシュに backpressure（drop+snapshot resync）を足し、debug の FFFD 全文字列スキャンを撤去する局所修正。新規モジュール境界・依存・公開API・イベント契約の変更はなく既存 TerminalTransportService._startStreaming 内で完結する。
---

## Background

長文ペースト時、対話 TUI (Claude Code) が**巨大な再描画出力フラッド**を流す。streaming 経路の
`_startStreaming` の出力フラッシュは **(1) `ws.bufferedAmount` を見ずに `ws.send` し続ける**ため
in-flight バッファが無制限に膨張し event loop を ~80秒ブロック、**(2) フラッシュ毎に
`flushed.includes('�')` で全文字列をスキャン**していた。結果＝1分の固まり＋WS keepalive
が返せず接続断＋メモリ churn でサーバ不安定/再起動。日本語で悪化するのは control-mode が非ASCII
バイトを octal 展開し出力量が数倍になるため。

切り分け（実測で確定）: クライアント(1メッセージpaste)・サーバ送信(temp-file)・control-mode
octalデコーダ(~50MB/s)はいずれも無実。真因は**出力フラッド転送の backpressure 欠如**。

## Scope

- `_startStreaming` の出力経路に **backpressure（drop + snapshot resync）** を追加: `ws.bufferedAmount`
  が高水位(4MB)を超えたら client が追いつけていないので、**溜まった中間ストリームを破棄**して
  event loop とメモリを守り、ドレイン後に **fresh snapshot で現在画面へ resync**（端末バイトは
  部分 drop すると状態が壊れるが、snapshot は現在画面の正本なので破綻しない）。
- 1メッセージで巨大バッチを作らないよう `OUTPUT_BATCH_MAX_CHARS`(1M) で即フラッシュ。
- フラッシュ毎の debug FFFD 全文字列スキャンを撤去。
- out of scope: クライアント側の描画（#922 coalesce 済）、TUI(Claude Code)側の再描画量そのもの。

### 変更しない既存分岐（out of scope, 挙動不変）

- snapshot/polling transport 経路（`_startSnapshotPolling` / `_pollConnection`）。
- `handleFailure`(error/exit) → `_fallbackToPolling` 経路。

## Acceptance Criteria

- [x] Under normal load the streaming transport forwards terminal output to the client unchanged, without scanning every flush for replacement characters.
- [x] When the WebSocket in-flight buffer exceeds the high water mark the client is too far behind, so the backed-up output flood is dropped and the client is resynced to the current screen with a fresh snapshot once the socket drains.
- [x] A single oversized output chunk is flushed immediately rather than buffered into one unbounded batch string.

## Verification

- `tests/server/services/terminal-transport-backpressure.test.js`: normal forward (FFFD passthrough,
  no scan), behind -> flood dropped + snapshot resync, oversized chunk immediate flush.
- Existing `tests/server/services/terminal-transport-service.test.js` (42) stay green.
- Real-world before/after: paste a long Japanese text; the server must no longer peg CPU ~80s,
  drop the WS, or restart.
