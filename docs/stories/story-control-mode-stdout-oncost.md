---
story_id: story-control-mode-stdout-oncost
title: Paste freezes terminal ~1min and drops the connection — O(n^2) control-mode stdout buffering
status: active
source_requirement:
  type: user_report
  detail: >
    ターミナルに長文（特に日本語）をペーストすると描画が呆れるほど遅く（1分近く）、サーバとの
    接続が不安定になる/落ちる。実測で node が CPU 100% を ~80秒張り付き、RSS 140→390MB churn、
    WebSocket 切断、プロセス再起動。
architecture_docs:
  - path: docs/specs/story-control-mode-stdout-oncost-spec.md
    status: referenced
    reason: tmux control-mode stdout のバッファリングを O(n^2) から O(n) にする局所修正。新規モジュール境界・依存・データフロー・公開API・イベント契約の変更はなく既存 TmuxControlClient 内で完結する。
---

## Background

ストリーミング(tmux control-mode)transport の `TmuxControlClient._handleStdout` は、stdout チャンク
ごとに `this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])` で**全バッファを再コピー**し、
**index 0 から全体を改行スキャン**していた。tmux control mode は pty 出力を `%output ...\n` の行で
送るが、TUI(Claude Code)の大きな再描画は**改行を含まない巨大な単一 `%output` 行**として届く。
その行が多数の TCP チャンクに跨って到着する間、毎チャンクで全バッファ再コピー+全再スキャン＝**O(n^2)**。

さらに消費が遅れると tmux が出力をまとめて行がさらに大きくなり、O(n^2) が悪化する**スパイラル**に陥る。
日本語は control mode が非ASCIIバイトを octal(`\NNN`)展開するため行サイズが約4倍になり悪化。

決定論ベンチ（実コード）:

| 単一 %output 行 | 修正前 O(n^2) | 修正後 O(n) |
|---|---|---|
| 5MB | 318ms | 2ms |
| 20MB | 7,257ms | 8ms |
| **50MB** | **102,627ms (102秒)** | **32ms** |

50MB行で102秒＝ユーザーの「1分近く」と一致。event loop を ~80秒ブロックするため WS keepalive が
返せず接続が落ちる。

## Scope

- `_handleStdout`: チャンクを**配列に蓄積**し、**新しいチャンクのみ改行スキャン**、改行が現れた時だけ
  1回 concat して行に分割する（O(n)）。pending メモリは行長で有界（旧実装と同じ）＝部分行を途中で
  flush/分割しない（分割すると continuation が `%output ` prefix を失い tail が落ちるため）。
- `decodeTmuxEscapes`: 非エスケープ run を**一括 slice コピー**（char-by-char の `result += value[i]` を
  廃止）。端末出力の大半は ASCII 制御列なので大行で桁違いに速い。
- out of scope（follow-up）: `flushOutputBatch` の per-flush `�` デバッグ全スキャン撤去（軽微）。
  ws.send の backpressure（O(n) 化でスパイラルが解消し行が小さく保たれるため本件では不要）。

### 変更しない既存分岐（out of scope, 挙動不変）

- `this._pendingLineBytes` / `this._pendingUtf8Bytes`（行跨ぎの不完全UTF-8キャリーオーバー）は従来どおり。
- `_handleLineBytes` の `%output` 以外の制御行処理は不変。

## Acceptance Criteria

- [x] A large single output line fed across many chunks is assembled and decoded in linear time so a paste-driven redraw flood no longer blocks the event loop for tens of seconds.
- [x] Output lines split across chunk boundaries including mid multibyte and mid escape decode to the same bytes as before with no correctness regression.

## Verification

- `tests/server/services/tmux-control-stdout-oncost.test.js`: multi-chunk reassembly correctness,
  mid-multibyte(日本語 octal) split correctness, and a 20MB single-line PERF guard (<1500ms; the
  O(n^2) code took ~7.3s).
- Existing `tests/server/services/tmux-control-client.test.js` (34) + terminal-transport suites stay
  green (82 passed). Real-code benchmark: 50MB line 102,627ms -> 32ms.
