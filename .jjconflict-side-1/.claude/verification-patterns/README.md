# 実装検証パターン定義

このディレクトリには、要件ごとの実装検証パターンを定義するJSONファイルを配置します。

## ファイル命名規則

- `{要件ID}.json` (例: `REQ-041.json`, `US-041.json`, `TASK-041.json`)

## パターンファイル構造

```json
{
  "requirementId": "REQ-041",
  "description": "要件の説明",
  "verificationPatterns": [
    {
      "requirement": "検証する要件項目",
      "files": [
        "src/lib/services/**/*.ts",
        "src/app/api/**/*.ts"
      ],
      "codePattern": [
        "user.create",
        "createUser",
        "newUser"
      ],
      "description": "この検証の説明"
    }
  ]
}
```

## フィールド説明

- **requirementId**: 要件ID
- **description**: 要件全体の説明
- **verificationPatterns**: 検証パターンの配列
  - **requirement**: 検証する具体的な要件項目
  - **files**: 検証対象ファイルのパス（glob パターン対応）
  - **codePattern**: 検索するコードパターン（正規表現対応）
  - **description**: この検証項目の説明

## 使用方法

1. 新しい要件を実装する際、対応する検証パターンファイルを作成
2. 実装検証システムが自動的にこのファイルを読み込んで検証を実行
3. 検証結果に基づいて要件のチェックボックスが自動更新される

## 利点

- **汎用性**: どんな要件でも対応可能
- **明確性**: 検証基準が明文化される
- **保守性**: 要件ごとに独立して管理可能
- **拡張性**: 新しい検証パターンの追加が容易