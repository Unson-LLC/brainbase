---
name: learning-extraction
description: セッションからの学習自動抽出システムの操作・トラブルシューティング
---

## Triggers

以下の状況で使用：
- 学習候補をレビュー・適用したいとき（/learn-skills）
- extract-learnings.shを手動実行したいとき
- 学習抽出が失敗している際のトラブルシューティング

# 学習抽出システム

セッション履歴から学習候補を自動抽出し、brainbaseに蓄積するシステム。

## システムアーキテクチャ

3段階の自動学習フロー：

```
1. tool-result.sh (hook)
   ↓ 実行内容を自動キャプチャ

2. .claude/learning/learning_queue/
   ↓ 学習候補を蓄積

3. /learn-skills
   ↓ 差分検出 → 更新案生成

4. /approve-skill
   ↓ 承認・適用

5. .claude/learning/history/
   ↓ バックアップと履歴保存
```

この3段階構成により、手動介入を最小限にしながら継続的な学習サイクルを実現。

### 学習hooks改善（2025-12-25）

学習hooksに以下の機能が実装されました：

- **重複排除**: 同一内容の学習候補を自動検出・除外
- **ブロック通知**: hook実行がブロックされた場合に通知

これにより、`.claude/learning/learning_queue/` に蓄積される学習内容の品質が向上。

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

## 抽出基準（2025-12-26更新）

### Tier 1: 思考パターン・判断基準（Skills設計の核心）
- **philosophy**: なぜそうするのか（例: コミットは歴史書）
- **thinking_framework**: どう考えるか（例: WHOとWHATを先に決める）
- **skills_design**: Philosophy/Framework/Implementationの発見

### Tier 2: 作業効率化
- **navigation**: 探索結果（「XはYにある」）
- **shortcut**: ショートカット手順
- **gotcha**: ハマりポイント・エラー解決
- **config**: 設定・制限値

### Tier 3: 概念理解・設計パターン
- **orchestration**: Subagents統合パターン
- **architecture**: アーキテクチャ決定（意図を含む）

### Tier 4: 運用・技術
- **workflow**: 運用ルール・ワークフロー

## 入力制限

- **2025-12-26更新**: 500KB / 実質無制限メッセージ（全文読み取り）
  - 修正前: 15メッセージ / 4000文字 → **98%の情報を廃棄していた**
  - 修正後: 99,999メッセージ / 500KB → セッション全体を読み取り
  - 実測改善: 4,000文字 → 54,000文字（約13.5倍）
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
