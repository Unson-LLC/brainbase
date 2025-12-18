# タスク管理 (_tasks)

brainbaseのタスク正本ディレクトリ。

## ディレクトリ構造

```
_tasks/
├── README.md           # このファイル
├── index.md            # 共有タスク（Airtable同期対象）
└── personal/           # 個人タスク（Airtable非同期）
    └── k.sato.md       # 佐藤圭吾の個人タスク
```

## 運用ルール

### 共有タスク (`index.md`)
- チームで共有するタスク
- Airtableと双方向同期（将来実装）
- Slackからの自動取り込み対象
- プロジェクトに紐づくタスク

### 個人タスク (`personal/{user}.md`)
- 個人専用のタスク
- Airtableには同期しない
- プライベートな作業、個人的なリマインダー等
- 他メンバーに見せる必要がないもの

## タスクフォーマット

YAML front matter形式で統一:

```yaml
---
id: SLACK-2025-12-09-XXXXX
title: タスクタイトル
project_id: salestailor  # または personal
status: todo | in-progress | done
owner: 佐藤-圭吾
priority: high | medium | low
due: 2025-12-15
tags: [slack, auto-import]
links: []
---

- 日付 詳細説明
- 担当: 担当者名
- 背景: 背景情報
```

## mana連携

manaは以下のファイルを読み取り可能:
- `_tasks/index.md` - 共有タスク一覧
- `_tasks/personal/{user}.md` - 該当ユーザーの個人タスク

個人タスクは該当ユーザーへのDMでのみ参照・操作可能（将来実装）。
