---
name: salestailor-bulk-campaign
description: SalesTailor APIを使って大量営業キャンペーンを実行する統合ガイド。環境確認・既存配信先除外・新規企業抽出・プロジェクト作成・配信開始の完全フローを提供する。
---

# SalesTailor 一括営業キャンペーン実行ガイド

## 目的

SalesTailor の v1 API を使って、100社以上への一括営業キャンペーンを実行する。既存配信先を除外し、新規企業のみに効率的にアプローチする。

---

## 🚨 必須事前確認（絶対厳守）

作業開始前に以下を必ず確認すること。

### 1. 環境ファイル確認

```bash
# .env.local存在確認
ls -la .env.local

# APIキー確認
grep "SALESTAILOR_API_KEY" .env.local
```

**必須環境変数**:
- `SALESTAILOR_API_KEY`: `st_api_xxx...` 形式のAPIキー

### 2. 必須Skills確認

以下のSkillsが存在することを確認：
- `salestailor-company-api`
- `salestailor-project-api`
- `salestailor-product-api`

```bash
ls .claude/skills/salestailor-*-api
```

存在しない場合は、別セッションからコピー：
```bash
find /Users/ksato/workspace/brainbase-config/.worktrees -name "salestailor-*-api" -type d | head -1 | xargs -I {} cp -r {}/../../.claude/skills/salestailor-*-api .claude/skills/
```

### 3. BASE_URL設定

```bash
export SALESTAILOR_API_KEY=$(grep "SALESTAILOR_API_KEY" .env.local | cut -d'=' -f2 | tr -d '"')
export BASE_URL="https://salestailor-web-unson.fly.dev"
```

---

## 完全フロー（6ステップ）

### Step 1: 既存配信先の確認

既に送信済みの企業を特定する。

#### 1.1 プロジェクトID確認

ユーザーが「このプロジェクトで送った企業は除外」と指定した場合：
```bash
# プロジェクトURL例: https://salestailor-web-unson.fly.dev/projects/cmlsqit0500hpq3ke0f2bvm7j
PROJECT_ID="cmlsqit0500hpq3ke0f2bvm7j"
```

#### 1.2 配信先企業リスト取得（NocoDBまたはAPI経由）

**方法A: NocoDBから取得**（推奨・高速）
```bash
./tools/nocodb/cli.sh get プロジェクト ${PROJECT_ID} | jq '.sendingGroup.companies[].goldenCompanyId'
```

**方法B: ローカルDBから取得**
```bash
npx tsx -e "
import { db } from './src/server/db';
const project = await db.batchJob.findUnique({
  where: { id: '${PROJECT_ID}' },
  include: {
    sendingGroup: {
      include: {
        companies: {
          include: { userCompany: { include: { goldenCompany: true } } }
        }
      }
    }
  }
});
const excludeIds = project.sendingGroup.companies.map(c => c.userCompany.goldenCompany.canonicalName);
console.log(JSON.stringify(excludeIds, null, 2));
process.exit();
" | jq -r '.[]' > /tmp/exclude_companies.txt
```

---

### Step 2: 新規100社の抽出

GoldenCompanyから、Step 1で取得した企業を除外して100社を選定。

#### 2.1 対象企業の条件確認

ユーザーに以下を確認：
- 業界指定（IT・通信、製造業、等）
- 企業規模（SMALL/MEDIUM/LARGE/ENTERPRISE）
- 地域指定（東京都、大阪府、等）
- キーワード（例: VibePro、企業研修）

#### 2.2 GoldenCompanyからの抽出

**NocoDBから抽出**（推奨）:
```bash
# 例: IT・通信業界、中規模企業、東京都
./tools/nocodb/cli.sh list GoldenCompany 200 | jq -r '
  .list[] |
  select(.industryCategory == "IT・通信") |
  select(.companySize == "MEDIUM") |
  select(.location | contains("東京都")) |
  .canonicalName
' | head -100 > /tmp/target_companies.txt
```

**除外リストとの差分**:
```bash
comm -23 <(sort /tmp/target_companies.txt) <(sort /tmp/exclude_companies.txt) | head -100 > /tmp/final_companies.txt
```

#### 2.3 企業データJSON生成

```bash
cat /tmp/final_companies.txt | jq -R -s 'split("\n") | map(select(length > 0)) | map({canonicalName: ., url: ("https://" + . | ascii_downcase | gsub(" "; "-") + ".example.com"), companySize: "MEDIUM"})' > /tmp/companies_batch.json
```

---

### Step 3: 企業バッチ登録

#### 3.1 Prisma暖機（必須）

```bash
curl -s "${BASE_URL}/api/health-check"
sleep 3
```

#### 3.2 企業バッチ登録（最大100件）

```bash
BATCH_RESULT=$(curl -s -X POST "${BASE_URL}/api/v1/companies/batch" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"companies\":$(cat /tmp/companies_batch.json)}")

echo $BATCH_RESULT | jq '.'
```

#### 3.3 登録されたcompanyIds取得

```bash
echo $BATCH_RESULT | jq -r '.data[].userCompanyId' > /tmp/company_ids.txt
COMPANY_IDS=$(cat /tmp/company_ids.txt | jq -R . | jq -s .)
```

---

### Step 4: プロジェクト作成

#### 4.1 必須ID取得

**productId取得**:
```bash
curl -s "${BASE_URL}/api/v1/products" -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" > /dev/null
sleep 3
PRODUCT=$(curl -s "${BASE_URL}/api/v1/products" -H "Authorization: Bearer ${SALESTAILOR_API_KEY}")
PRODUCT_ID=$(echo $PRODUCT | jq -r '.data[0].id')
```

**templateId取得**:
```bash
curl -s "${BASE_URL}/api/v1/templates" -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" > /dev/null
sleep 3
TEMPLATES=$(curl -s "${BASE_URL}/api/v1/templates" -H "Authorization: Bearer ${SALESTAILOR_API_KEY}")
echo $TEMPLATES | jq '.data[] | {id, name}'
```

ユーザーに「VibePro + 企業研修」用のテンプレートIDを確認：
```bash
TEMPLATE_ID="cmlhmmh29001xszk65ejm23mn"  # 例
```

#### 4.2 プロジェクト作成

```bash
# 暖機
curl -s -X POST "${BASE_URL}/api/v1/projects" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"warmup\",\"productId\":\"${PRODUCT_ID}\",\"templateId\":\"${TEMPLATE_ID}\",\"companyIds\":${COMPANY_IDS}}" > /dev/null
sleep 3

# 本番作成
PROJECT_RESULT=$(curl -s -X POST "${BASE_URL}/api/v1/projects" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"VibePro + 企業研修キャンペーン\",
    \"productId\": \"${PRODUCT_ID}\",
    \"templateId\": \"${TEMPLATE_ID}\",
    \"companyIds\": ${COMPANY_IDS},
    \"preferredMethod\": \"FORM\"
  }")

echo $PROJECT_RESULT | jq '.'
NEW_PROJECT_ID=$(echo $PROJECT_RESULT | jq -r '.data.id')
```

---

### Step 5: メール生成と承認

#### 5.1 メール生成開始

```bash
# 暖機
curl -s -X POST "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/start" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" > /dev/null
sleep 3

# 本番実行
START_RESULT=$(curl -s -X POST "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/start" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}")

echo $START_RESULT | jq '.'
```

#### 5.2 生成完了待ち

生成タスクの完了を待つ（ポーリングまたはWebhook）：

```bash
# タスク状態確認（ポーリング例）
while true; do
  TASKS=$(curl -s "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/tasks" \
    -H "Authorization: Bearer ${SALESTAILOR_API_KEY}")

  REVIEWING_COUNT=$(echo $TASKS | jq '[.data[] | select(.status == "REVIEWING")] | length')

  if [ "$REVIEWING_COUNT" -gt 0 ]; then
    echo "✅ 生成完了: ${REVIEWING_COUNT}件のタスクがレビュー待ち"
    break
  fi

  echo "⏳ 生成中... (5秒後に再確認)"
  sleep 5
done
```

#### 5.3 生成内容承認 ✨

REVIEWING状態のタスクを一括承認：

```bash
# 暖機
curl -s -X POST "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/generation/approve" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" > /dev/null
sleep 3

# 本番承認
APPROVE_RESULT=$(curl -s -X POST "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/generation/approve" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}")

echo $APPROVE_RESULT | jq '.'
# 出力例: {"data":{"projectId":"xxx","approvedCount":100,"message":"100件の生成タスクを承認しました"}}
```

---

### Step 6: 配信開始

#### 6.1 配信開始

承認済みタスクの配信（メール送信・フォーム投稿）を開始：

```bash
# 暖機
curl -s -X POST "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/delivery/start" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" > /dev/null
sleep 3

# 本番実行
DELIVERY_RESULT=$(curl -s -X POST "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/delivery/start" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}")

echo $DELIVERY_RESULT | jq '.'
# 出力例: {"data":{"projectId":"xxx","phase":"delivery","message":"フォーム送信を開始しました","count":100}}
```

#### 6.2 配信状況確認

```bash
curl -s "${BASE_URL}/api/v1/projects/${NEW_PROJECT_ID}/tasks" \
  -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" | jq '.'
```

#### 6.3 プロジェクトURL

```
https://salestailor-web-unson.fly.dev/projects/${NEW_PROJECT_ID}
```

---

## トラブルシューティング

### エラー: 401 Authentication failed

**原因**: Prismaコールドスタート

**対処**:
```bash
curl -s "${BASE_URL}/api/health-check"
sleep 3
# リトライ
```

### エラー: 404 Template not found

**原因**: templateIdが存在しない

**対処**:
```bash
curl -s "${BASE_URL}/api/v1/templates" -H "Authorization: Bearer ${SALESTAILOR_API_KEY}" | jq '.data[] | {id, name}'
```

### エラー: 企業が重複登録される

**原因**: canonicalNameが既存企業と一致

**対処**: 既存企業リストとの差分を再確認

---

## ユースケース例

### 例1: VibePro営業100社キャンペーン

```bash
# 条件: IT・通信業界、中規模企業、東京都、過去プロジェクト cmlsqit0500hpq3ke0f2bvm7j の企業は除外

# Step 1: 既存配信先確認
PROJECT_ID="cmlsqit0500hpq3ke0f2bvm7j"
# （上記Step 1のコマンド実行）

# Step 2: 新規100社抽出
# （上記Step 2のコマンド実行、業界=IT・通信、規模=MEDIUM、地域=東京都）

# Step 3-6: 登録・作成・生成・承認・配信開始
# （上記Step 3-6のコマンド実行）
```

---

## 関連Skills

- `salestailor-company-api`: 企業管理API詳細
- `salestailor-project-api`: プロジェクト管理API詳細
- `salestailor-product-api`: プロダクト管理API詳細

---

最終更新: 2026-02-23
