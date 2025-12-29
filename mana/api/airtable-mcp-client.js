/**
 * airtable-mcp-client.js
 * HybridClient (NocoDB + Airtable) ラッパー
 *
 * 本番環境ではMCPツールを直接呼び出すため、このクライアントは
 * テスト用のモック境界として機能する。
 *
 * Phase 4-B: HybridClient統合版
 */

const HybridClient = require('./hybrid-client');

// デフォルトはBAAO Workspace（API制限回避のため）
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE || 'appCysQGZowfOd58i';
// テーブル名（NocoDBでも同じ名前を使用）
const DEFAULT_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'タスク';

/**
 * AirtableレコードURLを生成
 * @param {Object} params - パラメータ
 * @param {string} [params.baseId] - Base ID（省略時は環境変数のデフォルト値）
 * @param {string} [params.tableId] - Table ID（省略時は環境変数のデフォルト値）
 * @param {string|null} [params.recordId] - Record ID（nullの場合はテーブルURLを返す）
 * @returns {string} - Airtable URL
 */
function buildAirtableRecordUrl({ baseId, tableId, recordId } = {}) {
  const base = baseId || AIRTABLE_BASE_ID;
  const table = tableId || process.env.AIRTABLE_TASKS_TABLE_ID || 'tblvy8OoX0threCD7';

  if (recordId) {
    return `https://airtable.com/${base}/${table}/${recordId}`;
  }
  return `https://airtable.com/${base}/${table}`;
}

class AirtableMCPClient {
  constructor(options = {}) {
    this.baseId = options.baseId || AIRTABLE_BASE_ID;
    // テーブル名（HybridClient用）
    this.tableName = options.tableName || DEFAULT_TABLE_NAME;
    // 後方互換性のためtableIdも保持（URL生成用）
    this.tableId = options.tableId || process.env.AIRTABLE_TASKS_TABLE_ID || 'tblvy8OoX0threCD7';

    // HybridClientインスタンス化
    this.client = new HybridClient();
  }

  /**
   * レコードを作成する
   * @param {Object} fields - レコードのフィールド
   * @returns {Promise<Object>} - 作成されたレコード
   */
  async createRecord(fields) {
    try {
      const record = await this.client.create(this.baseId, this.tableName, fields);

      return {
        id: record.id,
        fields: record.fields,
        recordUrl: buildAirtableRecordUrl({
          baseId: this.baseId,
          tableId: this.tableId,
          recordId: record.id
        })
      };
    } catch (err) {
      console.error(`[AirtableMCPClient] Create error: ${err.message}`);
      throw err;
    }
  }

  /**
   * レコードを更新する
   * @param {Array<{id: string, fields: Object}>} records - 更新するレコード
   * @returns {Promise<Object>} - 更新結果
   */
  async updateRecords(records) {
    try {
      // HybridClientは単一レコード更新のみサポートするため、ループで処理
      const updatedRecords = [];

      for (const record of records) {
        const updated = await this.client.update(
          this.baseId,
          this.tableName,
          record.id,
          record.fields
        );
        updatedRecords.push({ id: updated.id, fields: updated.fields });
      }

      return { records: updatedRecords };
    } catch (err) {
      console.error(`[AirtableMCPClient] Update error: ${err.message}`);
      throw err;
    }
  }

  /**
   * レコード一覧を取得（レートリミット対応・リトライあり）
   * @param {Object} options - 取得オプション
   * @param {number} options.maxRecords - 最大レコード数（デフォルト: 100）
   * @param {string} options.filterByFormula - Airtableフィルタ式
   * @param {number} options.timeout - タイムアウト時間（ミリ秒、デフォルト: 30000）
   * @param {number} options.maxRetries - 最大リトライ回数（デフォルト: 3）
   * @returns {Promise<Object>} - レコード一覧
   */
  async listRecords(options = {}) {
    const timeout = options.timeout || 30000; // デフォルト30秒
    const maxRetries = options.maxRetries || 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._fetchRecords(options, timeout);
        return result;
      } catch (err) {
        const isRateLimit = err.statusCode === 429 || err.message.includes('rate limit');
        const isLastAttempt = attempt === maxRetries;

        if (isRateLimit && !isLastAttempt) {
          // レートリミットエラーの場合、エクスポネンシャルバックオフでリトライ
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000); // 最大10秒
          console.log(`[AirtableMCPClient] Rate limit hit, retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          // レートリミット以外、または最後の試行ならエラーをスロー
          console.error(`[AirtableMCPClient] List error: ${err.message}`);
          throw err;
        }
      }
    }
  }

  /**
   * レコードを取得する内部メソッド
   * @private
   */
  async _fetchRecords(options, timeout) {
    const fetchPromise = (async () => {
      // HybridClient.list() 呼び出し（eachPageパターンから変換）
      const records = await this.client.list(this.baseId, this.tableName, {
        limit: options.maxRecords || 100,
        where: options.filterByFormula || undefined
      });

      // HybridClientは { id, fields, createdTime } 形式を返すため、
      // 既存APIと同じ形式に変換
      return {
        records: records.map(r => ({ id: r.id, fields: r.fields }))
      };
    })();

    // タイムアウト処理（MCP層で継続実装）
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`HybridClient timeout after ${timeout}ms`));
      }, timeout);
    });

    return Promise.race([fetchPromise, timeoutPromise]);
  }

  /**
   * テキスト検索
   * @param {string} searchTerm - 検索語
   * @param {Object} options - 検索オプション
   * @returns {Promise<Object>} - 検索結果
   */
  async searchRecords(searchTerm, options = {}) {
    // Airtableフィルタ形式をNocoDBのwhere句に変換
    // TODO: NocoDBの検索構文に最適化が必要な場合は修正
    const filterByFormula = `SEARCH("${searchTerm}", {task_id})`;
    return this.listRecords({ ...options, filterByFormula });
  }

  /**
   * メトリクス取得（HybridClientから）
   * @returns {Object} - 使用状況メトリクス
   */
  getMetrics() {
    return this.client.getMetrics();
  }
}

module.exports = { AirtableMCPClient, buildAirtableRecordUrl };
