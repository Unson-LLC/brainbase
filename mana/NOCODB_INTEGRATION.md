# mana NocoDB統合ガイド

## 概要

manaのAirtable依存をNocoDBに移行するためのハイブリッドクライアント実装。

## アーキテクチャ

```
┌─────────────────────┐
│   mana (Slack Bot)  │
└──────────┬──────────┘
           │
           ▼
  ┌────────────────────┐
  │  HybridClient      │  ← USE_NOCODB=true/false
  │  (hybrid-client.js)│  ← FALLBACK_TO_AIRTABLE=true/false
  └─────┬────────┬─────┘
        │        │
  ┌─────▼──┐  ┌─▼─────────┐
  │ NocoDB │  │ Airtable  │
  │ Client │  │ (fallback)│
  └────────┘  └───────────┘
```

## 環境変数設定

### 必須環境変数

```bash
# NocoDB接続情報
NOCODB_URL=https://noco.unson.jp
NOCODB_TOKEN=your_nocodb_token

# Hybrid Client制御
USE_NOCODB=true              # NocoDBを使用するか（true/false）
FALLBACK_TO_AIRTABLE=true    # エラー時にAirtableにフォールバックするか

# Airtable（フォールバック用）
AIRTABLE_TOKEN=your_airtable_token
```

### Lambda環境変数設定

以下の3つのLambda関数に環境変数を追加：

1. **mana-unson**
2. **mana-salestailor**
3. **mana-techknight**

```bash
# AWS CLIで設定
aws lambda update-function-configuration \
  --function-name mana-unson \
  --environment "Variables={
    NOCODB_URL=https://noco.unson.jp,
    NOCODB_TOKEN=<token>,
    USE_NOCODB=true,
    FALLBACK_TO_AIRTABLE=true,
    AIRTABLE_TOKEN=<token>
  }"
```

## 段階的移行プラン

### Phase 1: テスト環境（現在）
```bash
USE_NOCODB=false
FALLBACK_TO_AIRTABLE=false
```
→ 既存のAirtableのみ使用（変更なし）

### Phase 2: NocoDB優先 + フォールバック（Day 1-2）
```bash
USE_NOCODB=true
FALLBACK_TO_AIRTABLE=true
```
→ NocoDBを優先使用、エラー時はAirtableにフォールバック

### Phase 3: NocoDB単独（Day 3-5）
```bash
USE_NOCODB=true
FALLBACK_TO_AIRTABLE=true
```
→ 継続監視、フォールバック頻度を確認

### Phase 4: Airtable完全停止（Day 6-7）
```bash
USE_NOCODB=true
FALLBACK_TO_AIRTABLE=false
```
→ NocoDBのみ使用、Airtable完全停止確認

## テーブル名マッピング

NocoDBでは `{BaseName}_{TableName}` 形式でテーブルが作成されています。

| Airtable | NocoDB |
|----------|--------|
| SalesTailor/要求 | SalesTailor_要求 |
| BAAO/マイルストーン | BAAO_マイルストーン |
| NCOM/タスク | NCOM_タスク |

マッピング設定ファイル：
- `_codex/common/ops/nocodb-project-mapping.json` - base_id → project_id
- `_codex/common/ops/nocodb-basename-mapping.json` - base_id → base_name

## 使用方法

### 既存コード（Airtable）

```javascript
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base('app8uhkD8PcnxPvVx');
const records = await base('要求').select().all();
```

### 新コード（Hybrid Client）

```javascript
const HybridClient = require('./hybrid-client');
const client = new HybridClient();

// 同じインターフェース
const records = await client.list('app8uhkD8PcnxPvVx', '要求');
```

## メトリクス監視

HybridClientは使用状況メトリクスを自動収集：

```javascript
const metrics = client.getMetrics();
console.log(metrics);
// {
//   nocodbRequests: 100,
//   airtableRequests: 5,
//   nocodbErrors: 2,
//   fallbackActivations: 2,
//   nocodbSuccessRate: '98.00%',
//   fallbackRate: '2.00%'
// }
```

## トラブルシューティング

### NocoDB接続エラー

```
Error: NocoDB list error: connect ETIMEDOUT
```

→ `NOCODB_URL` とファイアウォール設定を確認

### テーブル名が見つからない

```
Error: NocoDB list error: 404 Table not found
```

→ `nocodb-basename-mapping.json` の base_name を確認
→ NocoDBで `{BaseName}_{TableName}` テーブルが存在するか確認

### フォールバックが頻繁に発生

```
[HybridClient] Falling back to Airtable (10 times in 1 hour)
```

→ NocoDBのステータスとログを確認
→ `docker logs nocodb` で詳細確認

## 関連ファイル

- `mana/api/nocodb-client.js` - NocoDB APIクライアント
- `mana/api/hybrid-client.js` - ハイブリッドクライアント
- `_codex/common/ops/nocodb-project-mapping.json` - プロジェクトマッピング
- `_codex/common/ops/nocodb-basename-mapping.json` - ベース名マッピング
