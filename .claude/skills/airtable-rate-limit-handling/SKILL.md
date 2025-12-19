---
name: airtable-rate-limit-handling
description: Airtable APIレート制限対策の設計パターン。Promise.raceタイムアウト、エクスポネンシャルバックオフリトライ、ページングスロットリングの実装方法。manaプロジェクトでのAirtable連携時に参照。
---

## Triggers

以下の状況で使用：
- Airtable API連携で429エラーが発生したとき
- manaプロジェクトでAirtable操作の実装・デバッグ時
- ページング処理でレート制限を回避したいとき

# Airtable APIレート制限対策

## レート制限の仕様

**重要**: ワークスペース単位で適用（PATではなく）

| プラン | リクエスト/秒 | リクエスト/月 |
|--------|--------------|--------------|
| Free | 5 req/sec | 1,000 req/month |
| Team | 5 req/sec | 無制限 |
| Business/Enterprise | 10 req/sec | 無制限 |

エラー: `429 Too Many Requests`

## 実装パターン

### 1. タイムアウト処理（Promise.race）

```javascript
async listRecords(options = {}) {
  const timeout = options.timeout || 30000;
  const fetchPromise = this._fetchRecords(options);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
  });
  return Promise.race([fetchPromise, timeoutPromise]);
}
```

### 2. エクスポネンシャルバックオフ

```javascript
async listRecords(options = {}) {
  const maxRetries = options.maxRetries || 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this._fetchRecords(options, timeout);
    } catch (err) {
      const isRateLimit = err.statusCode === 429 || err.message.includes('rate limit');
      if (isRateLimit && attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000); // 1秒 → 2秒 → 4秒（最大10秒）
        console.log(`[Airtable] Rate limit, retry in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw err;
      }
    }
  }
}
```

### 3. ページングスロットリング

```javascript
base(this.tableId)
  .select({ maxRecords: 100, pageSize: 100 })
  .eachPage(
    (pageRecords, fetchNextPage) => {
      records.push(...pageRecords.map(r => ({ id: r.id, fields: r.fields })));
      // 200ms待機で5 req/sec以内に抑える
      setTimeout(() => fetchNextPage(), 200);
    },
    (err) => {
      if (err) reject(err);
      else resolve({ records });
    }
  );
```

## 完全実装例

`/Users/ksato/workspace/mana/api/airtable-mcp-client.js`:

```javascript
class AirtableMCPClient {
  async listRecords(options = {}) {
    const timeout = options.timeout || 30000;
    const maxRetries = options.maxRetries || 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._fetchRecords(options, timeout);
      } catch (err) {
        const isRateLimit = err.statusCode === 429 || err.message.includes('rate limit');
        if (isRateLimit && attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[Airtable] Retry in ${waitTime}ms (${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw err;
        }
      }
    }
  }

  async _fetchRecords(options, timeout) {
    const fetchPromise = new Promise((resolve, reject) => {
      const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(this.baseId);
      const records = [];
      let isResolved = false;

      base(this.tableId)
        .select({ maxRecords: options.maxRecords || 100, pageSize: 100 })
        .eachPage(
          (pageRecords, fetchNextPage) => {
            if (isResolved) return;
            records.push(...pageRecords.map(r => ({ id: r.id, fields: r.fields })));
            setTimeout(() => { if (!isResolved) fetchNextPage(); }, 200);
          },
          (err) => {
            if (isResolved) return;
            isResolved = true;
            if (err) reject(err);
            else resolve({ records });
          }
        );
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
    });

    return Promise.race([fetchPromise, timeoutPromise]);
  }
}
```

## トラブルシューティング

### エラー: `PUBLIC_API_BILLING_LIMIT_EXCEEDED`

```
Error: 1,363/1,000 API calls per month
```

**対策**:
1. 別ワークスペースに移行（例: Unson → BAAO）
2. Team/Businessプランにアップグレード
3. キャッシュ・バッチ処理でAPI削減

**確認**:
```bash
node _ops/check-airtable-usage.js
```

### エラー: `INVALID_FILTER_BY_FORMULA: Unknown field names`

**原因**: フィールド名が日本語/英語で異なる

**対策**:
```javascript
// フィールド名マッピング
.map(record => ({
  id: record.id,
  task_name: record.fields['タイトル'] || record.fields['task_name'],
  assignee: record.fields['担当者'] || record.fields['assignee'],
}))

// フィルタ式は日本語名を使用
filterByFormula: 'AND({ステータス}!="完了", {期限}!="")'
```

## ベストプラクティス

1. **デフォルト**: タイムアウト30秒、リトライ3回
2. **ログ**: リトライ時は必ずログ出力
3. **ページサイズ**: `pageSize: 100` で過度な一括取得回避
4. **待機時間**: 200ms待機で5 req/sec以内
5. **エラー判定**: `statusCode === 429` と `message.includes('rate limit')` 両方チェック

## 参照ファイル

- 実装: `/Users/ksato/workspace/mana/api/airtable-mcp-client.js`
- 使用状況確認: `/Users/ksato/workspace/_ops/check-airtable-usage.js`
- Base/Table列挙: `/Users/ksato/workspace/_ops/list-airtable-bases-tables.js`

## 環境変数

```bash
AIRTABLE_API_KEY=patXXXXXXXXXXXX
AIRTABLE_BASE_ID=appCysQGZowfOd58i  # BAAO Workspace
AIRTABLE_TASKS_TABLE_ID=tblvy8OoX0threCD7
```

---
最終更新: 2025-12-19
