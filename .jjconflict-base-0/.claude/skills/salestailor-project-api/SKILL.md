---
name: salestailor-project-api
description: SalesTailor の v1 API（APIキー認証）でプロジェクト運用を操作する。プロジェクトCRUD、ステータス更新、タスク再実行、フォームプレビュー、一覧のcursor paginationを提供する。
---

# SalesTailor Project API ガイド

## 目的

SalesTailor の v1 API で、プロジェクト（BatchJob）と関連タスクの運用を行う。

## 認証

```bash
API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
BASE_URL="https://salestailor-web-unson.fly.dev"
```

すべて `Authorization: Bearer ${API_KEY}` を付与する。

## エンドポイント一覧

### プロジェクト

| メソッド | パス                                        | 説明                                                                   |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| GET      | `/api/v1/projects`                          | プロジェクト一覧取得（検索 + cursor pagination）                       |
| POST     | `/api/v1/projects`                          | プロジェクト作成                                                       |
| GET      | `/api/v1/projects/{projectId}`              | プロジェクト詳細取得                                                   |
| PATCH    | `/api/v1/projects/{projectId}`              | プロジェクト部分更新（`name` / `messageStrategy` / `sendingStrategy`） |
| DELETE   | `/api/v1/projects/{projectId}`              | プロジェクト削除（関連ジョブ掃除付き）                                 |
| PUT      | `/api/v1/projects/{projectId}/status`       | プロジェクトステータス更新                                             |
| POST     | `/api/v1/projects/{projectId}/start`        | 生成開始                                                               |
| GET      | `/api/v1/projects/{projectId}/analysis`     | 分析取得                                                               |
| GET      | `/api/v1/projects/{projectId}/improvements` | 改善提案取得                                                           |

### テンプレート

| メソッド | パス                             | 説明                                             |
| -------- | -------------------------------- | ------------------------------------------------ |
| GET      | `/api/v1/templates`              | テンプレート一覧取得（検索 + cursor pagination） |
| POST     | `/api/v1/templates`              | テンプレート作成                                 |
| GET      | `/api/v1/templates/{templateId}` | テンプレート詳細取得                             |
| PUT      | `/api/v1/templates/{templateId}` | テンプレート更新                                 |
| DELETE   | `/api/v1/templates/{templateId}` | テンプレート削除（soft delete）                  |

### タスク

| メソッド | パス                                                 | 説明                                      |
| -------- | ---------------------------------------------------- | ----------------------------------------- |
| GET      | `/api/v1/projects/{projectId}/tasks`                 | タスク一覧取得（generation/delivery/all） |
| POST     | `/api/v1/projects/{projectId}/tasks/approve`         | タスク一括承認                            |
| PATCH    | `/api/v1/projects/{projectId}/tasks/{taskId}/review` | レビュー更新                              |
| POST     | `/api/v1/projects/{projectId}/tasks/{taskId}/retry`  | 失敗/キャンセル生成タスク再実行           |
| POST     | `/api/v1/projects/{projectId}/generation/approve`    | 生成タスク一括承認（REVIEWING→APPROVED）  |

### 配信/フォームプレビュー

| メソッド | パス                                                        | 説明                         |
| -------- | ----------------------------------------------------------- | ---------------------------- |
| POST     | `/api/v1/projects/{projectId}/delivery/start`               | 配信開始（簡易）             |
| POST     | `/api/v1/projects/{projectId}/delivery-tasks/start`         | 配信開始（詳細）             |
| POST     | `/api/v1/projects/{projectId}/delivery-tasks/approve`       | フォーム検出プレビュー確定   |
| GET      | `/api/v1/projects/{projectId}/form-preview/summary`         | プレビュー進捗サマリ取得     |
| POST     | `/api/v1/projects/{projectId}/form-preview/retry-detection` | フォーム検出の再試行         |
| POST     | `/api/v1/projects/{projectId}/form-preview/cancel`          | プレビュー中断・状態リセット |

## 一覧系の pagination 仕様

`/projects`, `/templates`, `/projects/{projectId}/tasks` は `limit/cursor` を使う。

| パラメータ | 型     | 必須 | 説明                             |
| ---------- | ------ | ---- | -------------------------------- |
| `limit`    | number | -    | 1-200（デフォルト: 50）          |
| `cursor`   | string | -    | 前ページの `pageInfo.nextCursor` |

### `/api/v1/projects` 追加クエリ

| パラメータ | 説明                        |
| ---------- | --------------------------- |
| `q`        | プロジェクト名部分一致      |
| `status`   | `BatchJobStatus` で絞り込み |

### `/api/v1/projects/{projectId}/tasks` 追加クエリ

| パラメータ | 説明                                                          |
| ---------- | ------------------------------------------------------------- |
| `type`     | `generation` / `delivery` / `all`（デフォルト: `generation`） |
| `status`   | generation タスクのステータス絞り込み                         |
| `offset`   | 非cursor時のオフセット（`cursor` と併用不可）                 |

注意:

- `type=all` では `cursor` は使えない。
- `cursor` と `offset` は同時指定不可。

## 実行例

### 1. プロジェクト作成

```bash
curl -s -X POST "${BASE_URL}/api/v1/projects" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "新規アウトバウンド施策",
    "productId": "product_xxx",
    "templateId": "template_xxx",
    "companyIds": ["company_user_xxx"],
    "preferredMethod": "EMAIL"
  }'
```

### 2. プロジェクト一覧（cursor）

```bash
# 1ページ目
PAGE1=$(curl -s "${BASE_URL}/api/v1/projects?limit=20" \
  -H "Authorization: Bearer ${API_KEY}")
echo "$PAGE1"

# 2ページ目（nextCursorを利用）
CURSOR=$(echo "$PAGE1" | jq -r '.pageInfo.nextCursor')
curl -s "${BASE_URL}/api/v1/projects?limit=20&cursor=${CURSOR}" \
  -H "Authorization: Bearer ${API_KEY}"
```

### 3. プロジェクト状態更新（PAUSED）

```bash
PROJECT_ID="project_xxx"
curl -s -X PUT "${BASE_URL}/api/v1/projects/${PROJECT_ID}/status" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"newStatus":"PAUSED"}'
```

### 4. 生成タスク再実行

```bash
PROJECT_ID="project_xxx"
TASK_ID="task_xxx"
curl -s -X POST "${BASE_URL}/api/v1/projects/${PROJECT_ID}/tasks/${TASK_ID}/retry" \
  -H "Authorization: Bearer ${API_KEY}"
```

### 5. フォームプレビュー再試行

```bash
PROJECT_ID="project_xxx"
curl -s -X POST "${BASE_URL}/api/v1/projects/${PROJECT_ID}/form-preview/retry-detection" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "statuses": ["DNS_ERROR","TIMEOUT"]
  }'
```

## よく使う状態値

### BatchJobStatus（抜粋）

`DRAFT`, `PLAN`, `PENDING`, `PROCESSING`, `PAUSED`, `COMPLETED`, `FAILED`, `ERROR`, `CANCELLED`

### GenerationTaskStatus（抜粋）

`PENDING`, `PROCESSING`, `REVIEWING`, `COMPLETED`, `FAILED`, `CANCELED`, `APPROVED`

### FormSubmissionPhaseType

`NONE`, `PREVIEW`, `DELIVERY`

## エラー一覧

| ステータス | 原因                                              | 対処                          |
| ---------- | ------------------------------------------------- | ----------------------------- |
| 400        | パラメータ/ボディ不正（status値、cursor形式など） | リクエスト形式を修正          |
| 401        | APIキー未設定・無効                               | APIキー再生成                 |
| 403        | 他ユーザーのデータへのアクセス                    | APIキー所有者のデータIDを使用 |
| 404        | `projectId` / `taskId` / `templateId` 不存在      | 一覧でIDを再確認              |
| 500        | サーバー内部エラー                                | ヘルスチェックとログ確認      |
