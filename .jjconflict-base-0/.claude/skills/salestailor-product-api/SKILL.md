---
name: salestailor-product-api
description: SalesTailor の v1 API（APIキー認証）でプロダクト管理を操作する。一覧（cursor pagination）、作成/更新、詳細取得、削除を curl で実行する手順を提供する。
---

# SalesTailor Product API ガイド

## 目的

SalesTailor の外部向け v1 API（Bearer APIキー認証）を使って、プロダクト（製品・サービス情報）を管理する。

## 認証

```bash
API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
BASE_URL="https://salestailor-web-unson.fly.dev"
```

## エンドポイント一覧

| メソッド | パス                           | 説明                                           |
| -------- | ------------------------------ | ---------------------------------------------- |
| GET      | `/api/v1/products`             | プロダクト一覧取得（検索 + cursor pagination） |
| POST     | `/api/v1/products`             | プロダクト作成（同名存在時は更新）             |
| GET      | `/api/v1/products/{productId}` | プロダクト詳細取得                             |
| PUT      | `/api/v1/products/{productId}` | プロダクト更新                                 |
| DELETE   | `/api/v1/products/{productId}` | プロダクト削除                                 |

## 一覧取得（GET /api/v1/products）

### クエリパラメータ

| パラメータ | 型     | 必須 | 説明                                 |
| ---------- | ------ | ---- | ------------------------------------ |
| `q`        | string | -    | 部分一致検索（name/description/usp） |
| `limit`    | number | -    | 1-200（デフォルト: 50）              |
| `cursor`   | string | -    | 前ページの `pageInfo.nextCursor`     |

### 実行例

```bash
curl -s "${BASE_URL}/api/v1/products?limit=20&q=Sales" \
  -H "Authorization: Bearer ${API_KEY}"
```

### レスポンス例

```json
{
  "data": [
    {
      "id": "product_xxx",
      "name": "SalesTailor",
      "description": "AI搭載営業支援システム",
      "priceRange": "月額SaaS",
      "usp": "営業自動化",
      "challenges": "新規開拓工数が重い",
      "benefits": ["工数削減"],
      "solutions": ["メール生成"],
      "inputType": "text",
      "textContent": "詳細説明...",
      "caseStudies": null
    }
  ],
  "pageInfo": {
    "hasNext": false,
    "nextCursor": null
  }
}
```

## 作成（POST /api/v1/products）

`name` は必須。同名プロダクトが存在する場合は更新（upsert）として処理される。

```bash
curl -s -X POST "${BASE_URL}/api/v1/products" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SalesTailor",
    "description": "AI搭載営業支援システム",
    "priceRange": "月額SaaS",
    "usp": "高品質メール生成",
    "benefits": ["工数削減", "品質平準化"],
    "solutions": ["営業メール自動生成"],
    "inputType": "text",
    "textContent": "営業活動を自動化する..."
  }'
```

## 詳細取得（GET /api/v1/products/{productId}）

```bash
PRODUCT_ID="product_xxx"
curl -s "${BASE_URL}/api/v1/products/${PRODUCT_ID}" \
  -H "Authorization: Bearer ${API_KEY}"
```

## 更新（PUT /api/v1/products/{productId}）

部分更新。指定したフィールドのみ更新される。

```bash
PRODUCT_ID="product_xxx"
curl -s -X PUT "${BASE_URL}/api/v1/products/${PRODUCT_ID}" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "説明を更新",
    "benefits": ["工数削減", "受注率改善"]
  }'
```

## 削除（DELETE /api/v1/products/{productId}）

```bash
PRODUCT_ID="product_xxx"
curl -s -X DELETE "${BASE_URL}/api/v1/products/${PRODUCT_ID}" \
  -H "Authorization: Bearer ${API_KEY}"
```

## 運用上の注意

- 一覧系は `limit` を固定し、`nextCursor` を保存して追いかける。
- `inputType: "text"` で `textContent` を更新すると、関連する `productSource` も同期される。

## エラー一覧

| ステータス | 原因                                         | 対処                     |
| ---------- | -------------------------------------------- | ------------------------ |
| 400        | `name` 未指定 / `limit` 不正 / `cursor` 不正 | リクエスト内容を確認     |
| 401        | APIキー未設定・無効                          | APIキー再生成            |
| 404        | `productId` が存在しない                     | 一覧からID再取得         |
| 500        | サーバー内部エラー                           | ヘルスチェック・ログ確認 |

## 環境別 BASE_URL

| 環境              | URL                                     |
| ----------------- | --------------------------------------- |
| 本番（Fly.io）    | `https://salestailor-web-unson.fly.dev` |
| Preview（Vercel） | `https://salestailor.vercel.app`        |
| ローカル          | `http://localhost:3000`                 |
