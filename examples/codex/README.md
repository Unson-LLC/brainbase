# examples/codex - brainbaseサンプルデータ

このディレクトリには、brainbase開発者向けのサンプルデータが含まれています。

## 📖 概要

`examples/codex/` は、旧ファイル形式からGraphへ移行する処理を理解・検証するためのサンプルです。現行環境の正本はGraphであり、`_codex/` を本番の正本や可読ミラーとして新規作成しません。

**重要**: このディレクトリはOSS公開用のサンプルです。実際のプロジェクト・組織・人物データは含まれていません。
**補足**: 情報SSOT（Decision/RACI/Policy）はポストグレスが正本であり、`examples/codex` は人間向けビューのサンプルとして扱います。

## 🗂️ ディレクトリ構造

```
examples/codex/
├── README.md                    # このファイル
├── orgs/                        # 組織情報
│   └── example-org.md           # 組織プロファイル
└── common/                      # 共通メタデータ
    └── meta/
        ├── people/              # 人物情報
        │   ├── alice.md         # アリス（PM）
        │   └── bob.md           # ボブ（開発者）
        └── raci/                # RACI定義
            └── example-project.md  # プロジェクトRACIマトリックス
```

## 🎯 各ファイルの役割

### orgs/

組織（法人・チーム）のプロファイル:

- 組織概要
- ビジョン・ミッション
- 主要メンバー
- 関連プロジェクト

### common/meta/people/

人物プロファイル:

- 名前・役割
- スキル・専門性
- 所属組織・プロジェクト
- 連絡先（サンプルではダミー）

### common/meta/raci/

RACI（責任分担）マトリックス:

- R (Responsible): 実行責任者
- A (Accountable): 説明責任者
- C (Consulted): 相談先
- I (Informed): 報告先

## 🚀 使い方

### 1. 開発環境での利用

brainbase-uiやmanaを開発する際、このサンプルデータを使ってテスト:

```bash
# 環境変数でサンプルcodexを指定
export CODEX_PATH=/path/to/workspace/brainbase/examples/codex

# brainbase-ui起動
npm run dev
```

### 2. 本番環境への移行

このサンプルを本番へコピーしたり、`_codex/` のシンボリックリンクを作ったりしません。移行ツールの入力fixtureとして使い、移行後はGraph APIからreadbackして確認します。

### 3. 新規プロジェクト追加

新しいプロジェクトは、正式なプロジェクト作成経路からGraphへ登録します。このディレクトリを複製して新規プロジェクトを作りません。

## 🔒 セキュリティ

- **公開データ**: `examples/codex/` はOSS公開されます
- **非公開データ**: 個人ホーム、顧客repo、Graphの権限境界に置き、このサンプルへコピーしません
- **環境変数**: 実際のAPIキー・トークンは `.env` で管理（コミット禁止）

## 📚 参照

- **brainbase運用ガイド**: `CLAUDE.md`（リポジトリルート）
- **リポジトリ分類**: `docs/policies/repository-classification.md`
- **manaセットアップ**: 別プロジェクト（非公開）

## 🤝 コントリビューション

このサンプルを改善したい場合:

1. 実際のデータは含めない（架空の組織・人物のみ）
2. 日本語で記載
3. brainbaseの標準フォーマットに従う
4. プルリクエストを送る

---

最終更新: 2026-09-20
