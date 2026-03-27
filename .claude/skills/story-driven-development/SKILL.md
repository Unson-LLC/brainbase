---
name: story-driven-development
description: "ストーリー駆動開発。トリガー: 「BFD-xxxをストーリーに」「STR-xxxを実装」「TSK-xxxを実装」「ストーリーに落とし込む」「タスク分解案をNocoDBに登録」「タスクをNocoDBに登録」。docs/management/stories/のストーリー作成と実装をサポート。"
---

# ストーリー駆動開発スキル

概念設計と実装タスクの橋渡しを行うストーリー駆動開発をサポートする。

## ディレクトリ構造

```
docs/management/
├── stories/          # ストーリー（STR-xxx）
└── architecture/     # ADR（ADR-xxx）
```

## 開発フロー

```
要求（NocoDB）→ ストーリー（Git）→ ADR（必要時）→ タスク（NocoDB）→ 実装
```

### 0. 要求→ストーリー変換

NocoDBの要求をストーリーに落とし込む手順。

```
1. NocoDBから要求を取得
   ./tools/nocodb/cli.sh get 要求 {番号}

2. 要求を分析し、技術的な実現方法を検討
   - ユーザーの価値（Why/What）を理解
   - 実現方法（How）を技術的に検討

3. ストーリーファイルを作成
   - docs/management/stories/STR-xxx-{概要}.md
   - フロントマターに元の要求IDを記載
   - 背景、現状、変更内容、受け入れ基準を記述

4. Gitコミット
   - ここで一度コミット！
   - 設計図をGitに残すことで、後の実装者が意図を理解できる
```

**使用例**:

```
BFD-xxx をストーリーに落とし込んでください
```

### 1. ストーリー作成

要求を技術的にどう実現するかを記述。

**場所**: `docs/management/stories/STR-xxx-{概要}.md`

**テンプレート**: `docs/templates/story-template.md`

**フロントマター**:

```markdown
---
story_id: STR-xxx
title: タイトル
source_requirement:
  nocodb_table: 要求
  requirement_id: BFD-xxx
  requirement_title: 元の要求タイトル
architecture_docs:
  - path: docs/management/architecture/ADR-xxx.md
    status: referenced | created
related_tasks:
  - task_source: NocoDB タスク管理
    task_ids: [TSK-xxx, ...]
status: draft | in_progress | done
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
---
```

### 2. ADR判定

ストーリーを実現するために「既存のアーキテクチャで対応可能か」を分析。

**ADRが必要な場合**:

- 「初めて」の実装（新ライブラリ、新インフラ構成）
- 「重要な分岐点」（パフォーマンス、セキュリティ、コストに影響）
- 「既存ルールからの逸脱」

**ADR不要な場合**:

- 既存の設計パターンで対応可能
- 単なるCRUD画面追加など

### 3. タスク分解（実装前必須）

**重要**: タスクは実装前に作成する。

```
私がストーリーを読み込み、以下を行う：
1. 既存のアーキテクチャで実現可能か、新しいADRが必要かを判断
2. NocoDBに登録するための具体的なタスク分解案を提示
3. ユーザーがタスク案にOKを出したら実装開始
```

**タスク登録時の必須項目**:

- タスク内容
- **ブランチ名**（NocoDBのタスクに必ず記載）

### 4. 実装と完了報告

実装完了後、NocoDBのタスクを「完了」に更新。

## 使用例

```
docs/stories/STR-001-xxx.md に基づいて実装します。
以下の手順でサポートしてください：
1. 分析: ストーリーを読み、既存のアーキテクチャで実現可能か、新しいADRが必要かを判断
2. タスク作成: NocoDBに登録するための具体的なタスク分解案を提示
3. 確認: 私がタスク案にOKを出したら、実際の実装を開始
```

## タスク分解のカテゴリ例

- `[FE]` フロントエンド実装
- `[BE]` バックエンド実装
- `[DB]` データベース変更
- `[RF]` リファクタリング
- `[QA]` 動作確認・テスト

## 注意事項

- **実装後のタスク作成は禁止**: 「やったことリスト」にならないよう、必ず実装前にタスク分解
- **スコープ管理**: タスク合意後は範囲内で実装し、逸脱しない
- **ストーリー参照**: 実装時は必ず対応するストーリーを読み込み、振る舞いの定義から逸脱しない

## 推奨ワークフロー

「アーキテクチャとタスク設計が完了し、GitコミットしてからWorktreeを作る」のがベスト。

### 手順

1. **メインブランチでの準備**
   - ストーリー、アーキテクチャ、タスク一覧をドキュメントとして作成
   - **ここで一度コミット！**
   - 設計図をコミットしておくことで、Worktree側でAIが「何をすべきか」を即座に理解

2. **Worktreeの作成とタスク実施**

   ```bash
   git worktree add ../work-<task-name>
   cd ../work-<task-name>
   ```

   - 設計図に従って、タスク1から順に実装

### なぜストーリーの段階でWorktreeを作らないのか？

- **コンテキストの同期**: ストーリーを練っている最中にWorktreeを作ると、メインブランチでの思考の断片がWorktree側に反映されず、AIが古い情報をもとに実装してしまう
- **AIのスコープ管理**: 設計が確定していない状態でWorktreeを渡すと、AIが勝手にアーキテクチャを推測し、意図しないライブラリを導入するリスクがある
- **クリーンな検証**: 設計が終わった状態でWorktreeを分ければ、実装が失敗してもそのWorktreeを削除するだけで済む
