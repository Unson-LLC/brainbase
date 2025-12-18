---
name: airtable-rate-limit-handling
description: Airtable APIレート制限対策の設計パターン。Promise.raceタイムアウト、エクスポネンシャルバックオフリトライ、ページングスロットリングの実装方法。manaプロジェクトでのAirtable連携時に参照。
---

# Airtable APIレート制限対策ガイド

## 概要
Airtable APIのレート制限に対応するための設計パターンと実装ガイド。manaプロジェクトで実装し、GitHub Actions運用で検証済み。

## Airtableレート制限の仕様

### ワークスペース単位の制限
**重要**: レート制限はPAT（Personal Access Token）単位ではなく、**ワークスペース単位**で適用される。

| プラン | リクエスト/秒 | リクエスト/月 |
|--------|--------------|--------------|
| Free | 5 req/sec | 1,000 req/month |
| Team | 5 req/sec | 無制限 |
| Business/Enterprise | 10 req/sec | 無制限 |

### エラー応答
- **429 Too Many Requests**: レート制限超過時
- ヘッダー情報（実際には返されないケースも多い）:
  - `x-ratelimit-limit`: 制限値
  - `x-ratelimit-remaining`: 残りリクエスト数
  - `x-ratelimit-reset`: リセット時刻
  - `retry-after`: リトライまでの秒数

## 実装パターン

### 1. タイムアウト処理（Promise.race）

レスポンスが返らない場合に備え、タイムアウトを実装:

```javascript
async listRecords(options = {}) {
  const timeout = options.timeout || 30000; // デフォルト30秒
  const fetchPromise = this._fetchRecords(options);

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Airtable API timeout after ${timeout}ms`));
    }, timeout);
  });

  return Promise.race([fetchPromise, timeoutPromise]);
}
```

### 2. エクスポネンシャルバックオフ

レート制限エラー時に指数関数的に待機時間を増やしてリトライ:

```javascript
async listRecords(options = {}) {
  const maxRetries = options.maxRetries || 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await this._fetchRecords(options, timeout);
      return result;
    } catch (err) {
      const isRateLimit = err.statusCode === 429 ||
                          err.message.includes('rate limit');
      const isLastAttempt = attempt === maxRetries;

      if (isRateLimit && !isLastAttempt) {
        // エクスポネンシャルバックオフ: 1秒 → 2秒 → 4秒（最大10秒）
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`[Airtable] Rate limit hit, retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw err;
      }
    }
  }
}
```

### 3. ページング時のスロットリング

Airtableの`eachPage`で複数ページを取得する際、ページ間に待機時間を挟む:

```javascript
base(this.tableId)
  .select({
    maxRecords: options.maxRecords || 100,
    filterByFormula: options.filterByFormula || '',
    pageSize: 100 // ページサイズを制限
  })
  .eachPage(
    (pageRecords, fetchNextPage) => {
      records.push(...pageRecords.map(r => ({ id: r.id, fields: r.fields })));

      // ページ間で200ms待機（5 req/secを超えないように）
      setTimeout(() => {
        fetchNextPage();
      }, 200);
    },
    (err) => {
      if (err) reject(err);
      else resolve({ records });
    }
  );
```

## 実装ファイル

### `/Users/ksato/workspace/mana/api/airtable-mcp-client.js`

上記3つのパターンを組み合わせた完全な実装:

```javascript
class AirtableMCPClient {
  async listRecords(options = {}) {
    const timeout = options.timeout || 30000;
    const maxRetries = options.maxRetries || 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._fetchRecords(options, timeout);
        return result;
      } catch (err) {
        const isRateLimit = err.statusCode === 429 || err.message.includes('rate limit');
        const isLastAttempt = attempt === maxRetries;

        if (isRateLimit && !isLastAttempt) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`[Airtable] Rate limit hit, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw err;
        }
      }
    }
  }

  async _fetchRecords(options, timeout) {
    const fetchPromise = new Promise((resolve, reject) => {
      const Airtable = require('airtable');
      const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(this.baseId);

      const records = [];
      let isResolved = false;

      base(this.tableId)
        .select({
          maxRecords: options.maxRecords || 100,
          filterByFormula: options.filterByFormula || '',
          pageSize: 100
        })
        .eachPage(
          (pageRecords, fetchNextPage) => {
            if (isResolved) return;

            try {
              records.push(...pageRecords.map(r => ({ id: r.id, fields: r.fields })));

              setTimeout(() => {
                if (!isResolved) fetchNextPage();
              }, 200);
            } catch (err) {
              isResolved = true;
              reject(new Error(`Error processing page: ${err.message}`));
            }
          },
          (err) => {
            if (isResolved) return;

            isResolved = true;
            if (err) {
              reject(err);
              return;
            }
            resolve({ records });
          }
        );
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Airtable API timeout after ${timeout}ms`));
      }, timeout);
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

**原因**: ワークスペースの月間API制限を超過

**対策**:
1. 別のワークスペースに移行（例: Unson → BAAO）
2. Team/Businessプランにアップグレード
3. API呼び出しを削減（キャッシュ、バッチ処理等）

**確認方法**:
```javascript
// _ops/check-airtable-usage.js を実行
node _ops/check-airtable-usage.js
```

### エラー: `INVALID_FILTER_BY_FORMULA: Unknown field names`

**原因**: フィールド名が日本語/英語で異なる

**対策**: フィールド名マッピングを実装
```javascript
// task-fetcher.js
.map(record => ({
  id: record.id,
  task_name: record.fields['タイトル'] || record.fields['task_name'],
  assignee: record.fields['担当者'] || record.fields['assignee'],
  due_date: record.fields['期限'] || record.fields['due_date'],
  // ...
}))
```

フィルタ式では日本語フィールド名を使用:
```javascript
filterByFormula: 'AND({ステータス}!="完了", {期限}!="")'
```

## API使用状況の確認

### Meta API経由での確認
```bash
node _ops/list-airtable-bases-tables.js
```

### GUI上での確認
1. https://airtable.com/account にアクセス
2. Workspace設定を開く
3. "Usage" または "API" セクションを確認
4. または https://airtable.com/create/apiKey から確認

## ベストプラクティス

1. **デフォルト値の設定**: タイムアウト30秒、リトライ3回を標準に
2. **ログ出力**: リトライ時は必ずログを出力して診断可能にする
3. **ページサイズ制限**: `pageSize: 100` で過度な一括取得を避ける
4. **ページ間待機**: 200ms待機で5 req/sec以内に抑える
5. **エラー判定**: `statusCode === 429` と `message.includes('rate limit')` の両方をチェック

## 参考情報

- Airtable API公式ドキュメント: https://airtable.com/developers/web/api/rate-limits
- 実装ファイル: `/Users/ksato/workspace/mana/api/airtable-mcp-client.js`
- 調査スクリプト: `/Users/ksato/workspace/_ops/check-airtable-usage.js`
- Base/Table列挙: `/Users/ksato/workspace/_ops/list-airtable-bases-tables.js`

## 環境変数

```bash
# ~/.env または .github/workflows/*.yml
AIRTABLE_API_KEY=patXXXXXXXXXXXX
AIRTABLE_BASE_ID=appCysQGZowfOd58i  # BAAO Workspace
AIRTABLE_TASKS_TABLE_ID=tblvy8OoX0threCD7
```

---
最終更新: 2025-12-18
作成者: 佐藤圭吾
プロジェクト: mana, brainbase
