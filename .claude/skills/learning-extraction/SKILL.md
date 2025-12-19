---
name: learning-extraction
description: セッションからの学習自動抽出システムの操作・トラブルシューティング
tags: [brainbase, automation, learning]
updated: 2025-12-11
---

## Triggers

以下の状況で使用：
- 学習候補をレビュー・適用したいとき（/learn-skills）
- extract-learnings.shを手動実行したいとき
- 学習抽出が失敗している際のトラブルシューティング

# 学習抽出システム

セッション履歴から学習候補を自動抽出し、brainbaseに蓄積するシステム。

## ファイル構成

| 用途 | パス |
|------|------|
| 抽出スクリプト | `_codex/common/ops/scripts/extract-learnings.sh` |
| 抽出基準（プロンプト） | 同ファイル内 100行目付近のHEREDOC |
| 学習キュー | `.claude/learning/learning_queue/` |
| 処理済みログ | `.claude/learning/.processed_sessions` |
| デバッグ出力 | `.claude/learning/debug_*.txt`, `last_result_*.txt` |
| GitHub Actions | `.github/workflows/extract-learnings.yml` |

## 操作コマンド

| やりたいこと | コマンド |
|-------------|---------|
| 学習候補をレビュー・適用 | `/learn-skills` |
| 手動で抽出実行 | `bash _codex/common/ops/scripts/extract-learnings.sh` |
| 実行状況確認 | `gh run list --limit 10` |
| 処理済みセッション確認 | `wc -l .claude/learning/.processed_sessions` |

## 抽出基準（2025-12-11更新）

### 最優先: 次回の作業効率化
- **navigation**: 探索結果（「XはYにある」）
- **shortcut**: ショートカット手順
- **gotcha**: ハマりポイント・エラー解決
- **config**: 設定・制限値

### その他
- workflow: 運用ルール・ワークフロー
- architecture: アーキテクチャ決定理由

## 入力制限

- 15メッセージ / 4000文字に切り詰め
- 10KB未満のセッションはスキップ

## トラブルシューティング

### 「JSONの抽出に失敗」ログが出る

**原因**: Claude出力の `⏺` マーカー行が複数行にわたる

**確認**: `cat .claude/learning/debug_<session_id>.txt` で出力を確認

**解決済み**: 2025-12-11修正。⏺から区切り線まで読み込んで結合する方式

### 学習抽出件数が少ない

**原因**: 基準が限定的すぎた

**確認**: `extract-learnings.sh` 内のプロンプト（100行目付近）を確認

**解決済み**: 2025-12-11に「探索結果」「ハマりポイント」を最優先に変更

### 自動実行されない

**確認**: `gh run list | grep "Extract Learnings"`

**原因候補**:
- self-hosted runnerが停止している
- cronスケジュール問題（UTC 15,21,3,9 = JST 0,6,12,18時）
