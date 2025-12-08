# brainbase運用ガイド（コア）

全事業を統一OSで動かす内部運用システム。詳細は参照先を確認。

## 絶対ルール

1. **日本語**で応答・ドキュメント化
2. **正本編集**: `_codex/` 配下のみ編集（プロジェクト側はリンクのみ）
3. **秘密情報禁止**: APIキー・トークン・認証情報はコミットしない
4. **破壊的変更確認**: 大規模削除・`git reset --hard` は実行前に確認
5. **worktree注意**: 正本パスは常に `/Users/ksato/workspace/` を使用

## パス解決（クイックリファレンス）

| 種別 | パス |
|------|------|
| 正本（_codex） | `/Users/ksato/workspace/_codex/` |
| タスク | `/Users/ksato/workspace/_tasks/index.md` |
| 受信箱 | `/Users/ksato/workspace/_inbox/pending.md` |
| スケジュール | `/Users/ksato/workspace/_schedules/` |
| 共通スクリプト | `/Users/ksato/workspace/_ops/` |
| 設定 | `/Users/ksato/workspace/config.yml` |

## 主要プロジェクト

`salestailor` / `zeims` / `tech-knight` / `baao` / `unson` / `ai-wolf` / `sato-portfolio`

※ 詳細は `config.yml` の `projects[].id` と `local.path` を確認

## 4大原則

1. **情報の一本化**: ナレッジ・判断基準は `_codex` に集約
2. **タスクの正本化**: タスクは `_tasks/index.md` を唯一の正とする
3. **RACI明確化**: 役割・責任は `_codex/common/meta/raci/` で一意管理
4. **90日仕組み化**: 新規事業は90日以内に自律運転できる状態をつくる

## 詳細参照先

| やりたいこと | 参照先 |
|-------------|--------|
| Git操作・コミット | `skill: git-commit-rules` |
| ブランチ・worktree | `skill: branch-worktree-rules` |
| タスク管理 | `skill: task-format` |
| 会議管理 | `_codex/common/templates/meeting_template.md` |
| ディレクトリ構造 | `_codex/common/architecture_map.md` |
| RACI定義 | `skill: raci-format` |
| KPI計算 | `skill: kpi-calculation` |
| 新規事業チェック | `skill: 90day-checklist` |
| 戦略テンプレート | `skill: strategy-template` |

## よく使うコマンド

| コマンド | 用途 |
|---------|------|
| `/ohayo` | 朝のダッシュボード |
| `/commit` | 標準コミット |
| `/compact` | コンテキスト圧縮 |

---
最終更新: 2025-12-09
