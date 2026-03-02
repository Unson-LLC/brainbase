---
name: salestailor-company-api
description: SalesTailor の v1 API（APIキー認証）で企業管理を操作する。企業の一覧（cursor pagination）、一括登録、詳細取得、更新、削除を curl で実行する手順を提供する。
---

# SalesTailor Company API ガイド

## 目的

SalesTailor の外部向け v1 API（Bearer APIキー認証）を使って、企業情報（UserCompany + GoldenCompany）を管理する。

## 認証

```bash
API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
BASE_URL="https://salestailor-web-unson.fly.dev"
```

`Authorization: Bearer ${API_KEY}` を全リクエストで付与する。

## エンドポイント一覧

| メソッド | パス                              | 説明                                     |
| -------- | --------------------------------- | ---------------------------------------- |
| GET      | `/api/v1/companies`               | 企業一覧取得（検索 + cursor pagination） |
| POST     | `/api/v1/companies/batch`         | 企業バッチ登録（同名存在時は更新）       |
| POST     | `/api/v1/companies/golden/search` | 企業マスター検索                         |
| GET      | `/api/v1/companies/{companyId}`   | 企業詳細取得                             |
| PUT      | `/api/v1/companies/{companyId}`   | 企業更新                                 |
| DELETE   | `/api/v1/companies/{companyId}`   | 企業削除                                 |

## 一覧取得（GET /api/v1/companies）

### クエリパラメータ

| パラメータ | 型     | 必須 | 説明                                         |
| ---------- | ------ | ---- | -------------------------------------------- |
| `q`        | string | -    | 部分一致検索（企業名・カスタム名・ドメイン） |
| `limit`    | number | -    | 1-200（デフォルト: 50）                      |
| `cursor`   | string | -    | 前ページの `pageInfo.nextCursor`             |

### 実行例

```bash
curl -s "${BASE_URL}/api/v1/companies?limit=20&q=unson" \
  -H "Authorization: Bearer ${API_KEY}"
```

### レスポンス例

```json
{
  "data": [
    {
      "id": "company_user_xxx",
      "userId": "user_xxx",
      "goldenCompanyId": "golden_xxx",
      "customName": null,
      "notes": "テスト企業",
      "goldenCompany": {
        "id": "golden_xxx",
        "canonicalName": "株式会社テスト",
        "url": "https://example.com",
        "companySize": "MEDIUM",
        "industryCategory": {
          "id": "industry_xxx",
          "name": "IT・通信"
        }
      }
    }
  ],
  "pageInfo": {
    "hasNext": true,
    "nextCursor": "eyJpZCI6ImNvbXBhbnlfdXNlcl94eHgifQ"
  }
}
```

## バッチ登録（POST /api/v1/companies/batch）

同名企業（`canonicalName`）が存在する場合は更新、存在しない場合は新規作成。

```bash
curl -s -X POST "${BASE_URL}/api/v1/companies/batch" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "companies": [
      {
        "canonicalName": "株式会社テスト商事",
        "url": "https://test-shoji.example.com",
        "location": "東京都",
        "companySize": "MEDIUM",
        "industryCategoryName": "IT・通信",
        "notes": "初回登録"
      }
    ]
  }'
```

## 詳細取得（GET /api/v1/companies/{companyId}）

```bash
COMPANY_ID="company_user_xxx"
curl -s "${BASE_URL}/api/v1/companies/${COMPANY_ID}" \
  -H "Authorization: Bearer ${API_KEY}"
```

## 更新（PUT /api/v1/companies/{companyId}）

```bash
COMPANY_ID="company_user_xxx"
curl -s -X PUT "${BASE_URL}/api/v1/companies/${COMPANY_ID}" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "customName": "SalesTeam向け表示名",
    "notes": "担当者更新済み"
  }'
```

## 削除（DELETE /api/v1/companies/{companyId}）

```bash
COMPANY_ID="company_user_xxx"
curl -s -X DELETE "${BASE_URL}/api/v1/companies/${COMPANY_ID}" \
  -H "Authorization: Bearer ${API_KEY}"
```

レスポンス:

```json
{
  "data": {
    "id": "company_user_xxx",
    "deleted": true
  }
}
```

## 運用上の注意

- 一覧系は `limit` を小さめ（20-50）から使い、`nextCursor` でページングする。
- 初回アクセス直後に 401 が出る場合は `GET /api/health-check` のあと再試行する。

## エラー一覧

| ステータス | 原因                                          | 対処                       |
| ---------- | --------------------------------------------- | -------------------------- |
| 400        | リクエストボディ不正 / limit不正 / cursor不正 | パラメータとJSON形式を確認 |
| 401        | APIキー未設定・無効                           | APIキー再生成              |
| 404        | `companyId` が存在しない or 権限なし          | 一覧でIDを再確認           |
| 500        | サーバー内部エラー                            | ログとヘルスチェックを確認 |

## 環境別 BASE_URL

| 環境              | URL                                     |
| ----------------- | --------------------------------------- |
| 本番（Fly.io）    | `https://salestailor-web-unson.fly.dev` |
| Preview（Vercel） | `https://salestailor.vercel.app`        |
| ローカル          | `http://localhost:3000`                 |
