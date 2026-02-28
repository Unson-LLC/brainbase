---
name: contacts-to-salestailor
skill_id: contacts-to-salestailor
title: Postgresコンタクト→SalesTailor API一括送信
description: brainbase PostgresのcontactデータをSalesTailor APIにリード情報として一括登録
category: integration
tags:
  - postgres
  - salestailor
  - api
  - contact
  - lead
created: 2026-02-06
updated: 2026-02-06
---

# contacts-to-salestailor

brainbase Postgres（`brainbase_ssot`）の`graph_entities`テーブルからcontactデータを取得し、SalesTailor APIの`/api/v1/companies/batch`エンドポイントにリード情報として一括登録する。

---

## 目的

brainbaseに蓄積された名刺・コンタクト情報（5,000件以上）を、SalesTailorの営業パイプラインに自動投入し、リード獲得を効率化する。

---

## 使い方

### 基本実行

```bash
# 全contactデータを送信（company名とURLがあるもののみ）
node /Users/ksato/workspace/.claude/skills/contacts-to-salestailor/sync.js

# dry-runモード（送信せずに件数確認）
node /Users/ksato/workspace/.claude/skills/contacts-to-salestailor/sync.js --dry-run

# 件数制限（テスト用）
node /Users/ksato/workspace/.claude/skills/contacts-to-salestailor/sync.js --limit 10
```

---

## 処理フロー

1. **Postgresからcontactデータを取得**
   - データベース: `postgres://localhost/brainbase_ssot`
   - テーブル: `graph_entities`
   - 条件: `entity_type='contact'` かつ `payload->>'company' IS NOT NULL` かつ `payload->>'url' IS NOT NULL`

2. **SalesTailor API形式に変換**
   - `payload->>'company'` → `canonicalName`
   - `payload->>'url'` → `url`
   - その他のフィールド（location, companySize等）はオプショナル

3. **100件ずつバッチ送信**
   - エンドポイント: `POST /api/v1/companies/batch`
   - 認証: `Authorization: Bearer $SALESTAILOR_API_KEY`
   - レート制限対策: バッチ間で1秒待機

4. **結果レポート**
   - created: 新規作成件数
   - updated: 更新件数
   - failed: 失敗件数

---

## 環境変数

必須環境変数（`~/workspace/.env`に設定）：

```bash
# SalesTailor API
SALESTAILOR_API_KEY=st_api_xxxxx
SALESTAILOR_API_URL=https://salestailor-web-unson.fly.dev/api/v1

# brainbase Postgres
INFO_SSOT_DATABASE_URL=postgres://localhost/brainbase_ssot
```

---

## エラーハンドリング

- **API認証エラー（401）**: `SALESTAILOR_API_KEY`を確認
- **タイムアウト**: バッチサイズを減らす（100 → 50）
- **重複エラー**: 既存企業は`updated`としてカウント（エラーにならない）
- **データベース接続エラー**: `INFO_SSOT_DATABASE_URL`を確認

---

## 注意事項

1. **初回実行時は`--dry-run`で確認**
   - 送信対象件数を事前に確認
   - データの形式を確認

2. **重複チェック**
   - SalesTailor APIは`canonicalName`または`url`で重複を判定
   - 重複の場合は自動的に`updated`として処理される

3. **大量データ送信**
   - 5,000件の場合、約50回のAPIリクエスト（100件ずつ）
   - 完了まで約1分程度

---

## 実装ファイル

- `sync.js`: メインスクリプト（Node.js）
- `SKILL.md`: このドキュメント

---

## 更新履歴

- 2026-02-06: 初版作成
