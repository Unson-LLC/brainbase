---
story_id: story-judgment-portable-execution-outcome-v1
title: AI実行環境に依存しない判断結果
status: active
updated_at: 2026-09-08
---

# Story: AI実行環境に依存しない判断結果

## Problem

判断の中核とCodexのHook・JSONL検査が混ざっているため、Codexで動くことをBrainbase全体の成功と誤認しやすい。Claude Codeなど別の実行環境では同じログ形式を保証できず、失敗時にどこから再開すべきかも共通形式で残らない。

## Purpose

Brainbaseが保証するのは特定ツールの内部形式ではなく、依頼を判断し、実行結果を記録し、未完了なら原因と再開地点を説明できることとする。

## Acceptance criteria

1. CodexとClaude Codeの正規化済み会話文脈を、同じResolver契約が受理する。
2. 実行結果は `completed | partial | failed | blocked | unknown` を区別する。
3. 未完了結果には失敗段階、機械可読な理由、安全な説明、再試行可否、再開地点を必須とする。
4. 共通結果にJSONLやSQLiteなどホスト固有の保存場所を含めない。
5. 配信を伴う成功は、送信受付だけでなく受信側readbackが確認済みであることを証拠として持つ。
6. Codex/Claude Code固有のHookやログ検査は、共通成功条件ではなく各adapterの適合性検査として扱う。

## Non-goals

- Claude CodeのHook設定を、このStoryだけで本番配備済みとみなさない。
- HTTP 2xx、queue投入、CI成功だけを利用者価値の完了とみなさない。
