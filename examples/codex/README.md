# examples/codex - brainbaseサンプルデータ

このディレクトリには、brainbase開発者向けのサンプルデータが含まれています。

## 📖 概要

`examples/codex/` は、brainbaseの構造とデータ形式を理解するためのサンプルです。実際の環境では、正本はグラフ（ポストグレス）で管理し、`_codex/` は可読ミラーとして扱います。このサンプルは開発・テスト・学習目的で使用します。

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

本番環境では、プライベート `_codex/` を使用:

```bash
# シンボリックリンク作成（ローカル環境のみ）
cd /path/to/workspace/brainbase-ui
ln -s ../_codex _codex

# .gitignoreで除外されているため、誤ってコミットされることはありません
```

### 3. 新規プロジェクト追加

新しいプロジェクトを追加する場合は、`examples/codex` を参照しつつ `_codex/projects/` を自分で作成:

```bash
# プロジェクトディレクトリ作成
mkdir -p _codex/projects/your-project

# examples/codex/common/meta/raci/example-project.md などを参考に作成
```

## 🔒 セキュリティ

- **公開データ**: `examples/codex/` はOSS公開されます
- **非公開データ**: `_codex/` は `.gitignore` で除外され、公開されません
- **環境変数**: 実際のAPIキー・トークンは `.env` で管理（コミット禁止）

## 📚 参照

- **brainbase運用ガイド**: `CLAUDE.md`（リポジトリルート）
- **Skills vs Codex**: `_codex/projects/brainbase/skills_concept.md`（本番環境のみ）
- **manaセットアップ**: 別プロジェクト（非公開）

## 🤝 コントリビューション

このサンプルを改善したい場合:

1. 実際のデータは含めない（架空の組織・人物のみ）
2. 日本語で記載
3. brainbaseの標準フォーマットに従う
4. プルリクエストを送る

---

最終更新: 2025-12-26
