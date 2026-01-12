# Implementation Plan: Kiro Task Format Activation

## Overview

Kiro形式タスクの有効化と検証を4フェーズで実施する。

## Phase 1: 本番有効化 (P)

- [ ] 1.1 環境変数の設定と検証
  - `.env.example`に`KIRO_TASK_FORMAT=true`を追加
  - server.jsのログ出力を確認
  - _Requirements: 1_

- [ ] 1.2 ディレクトリ自動作成の確認
  - `_tasks/brainbase/`が存在しない場合の挙動確認
  - TaskFileManager.ensureProjectDir()の動作確認
  - _Requirements: 1_

## Phase 2: マイグレーション実行

- [ ] 2.1 バックアップ作成
  - `_tasks/index.md` → `_tasks/index.md.backup.{timestamp}`
  - _Requirements: 2_

- [ ] 2.2 マイグレーションスクリプト実行
  - `npm run migrate:tasks`の実行
  - 出力ログの確認
  - _Requirements: 2_

- [ ] 2.3 マイグレーション結果の検証
  - 各プロジェクトディレクトリの確認
  - tasks.mdとdone.mdの内容確認
  - タスク数の整合性確認
  - _Requirements: 2_

## Phase 3: UI動作検証

- [ ] 3.1 タスク完了フローの検証
  - チェックボックスクリック → tasks.md → done.md
  - EventBus: TASK_COMPLETED発火確認
  - _Requirements: 3_

- [ ] 3.2 タスク復元フローの検証
  - 完了タスクモーダル → 復元ボタン → done.md → tasks.md
  - EventBus: TASK_UPDATED発火確認
  - _Requirements: 3_

- [ ] 3.3 タスク追加フローの検証
  - 新規タスク追加 → 正しいproject/tasks.mdに追記
  - ID生成（task-{timestamp}）確認
  - _Requirements: 3_

- [ ] 3.4 タスク編集フローの検証
  - タスク名、優先度、期日の編集
  - 保存後のファイル内容確認
  - _Requirements: 3_

## Phase 4: ドキュメント更新 (P)

- [ ] 4.1 README.md更新
  - Kiro形式の説明追加
  - ディレクトリ構造の説明
  - _Requirements: 4_

- [ ] 4.2 環境設定ドキュメント
  - KIRO_TASK_FORMAT環境変数の説明
  - マイグレーション手順
  - _Requirements: 4_

## npm scripts追加

```json
{
  "scripts": {
    "migrate:tasks": "node scripts/migrate-tasks-to-kiro.js"
  }
}
```

## Rollback Plan

Kiro形式で問題が発生した場合:
1. `KIRO_TASK_FORMAT=false`に設定（即座にYAML形式に戻る）
2. バックアップから`_tasks/index.md`を復元
3. 問題を修正後、再度マイグレーション

## 推定所要時間

| Phase | 内容 | 見積もり |
|-------|------|----------|
| 1 | 本番有効化 | 15分 |
| 2 | マイグレーション | 30分 |
| 3 | UI動作検証 | 45分 |
| 4 | ドキュメント | 30分 |
| **合計** | | **2時間** |

## Parallel Execution

- Phase 1.1と1.2は並列実行可能 (P)
- Phase 4.1と4.2は並列実行可能 (P)
- Phase 2と3は順次実行必須

## Coverage Target
- [ ] Test coverage >= 80% (既存テストでカバー済み)
- [ ] マイグレーション後のデータ整合性確認
