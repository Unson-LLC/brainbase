/**
 * Hybrid Client (NocoDB + Airtable Fallback)
 * NocoDB優先、エラー時にAirtableにフォールバック
 * ゼロダウンタイム移行を実現
 */

const NocoDBClient = require('./nocodb-client');
const Airtable = require('airtable');

class HybridClient {
  constructor() {
    // NocoDBクライアント
    this.useNocoDB = process.env.USE_NOCODB === 'true';
    this.fallbackEnabled = process.env.FALLBACK_TO_AIRTABLE === 'true';

    if (this.useNocoDB) {
      this.nocodbClient = new NocoDBClient();
    }

    // Airtableクライアント（フォールバック用）
    if (this.fallbackEnabled && process.env.AIRTABLE_TOKEN) {
      this.airtableClient = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN });
    }

    // メトリクス
    this.metrics = {
      nocodbRequests: 0,
      airtableRequests: 0,
      nocodbErrors: 0,
      fallbackActivations: 0
    };
  }

  /**
   * レコード一覧取得
   * @param {string} baseId - Airtable base ID（config.ymlで定義）
   * @param {string} tableName - テーブル名
   * @param {Object} options - クエリオプション
   * @returns {Promise<Array>} - レコードリスト
   */
  async list(baseId, tableName, options = {}) {
    if (this.useNocoDB) {
      try {
        this.metrics.nocodbRequests++;

        // NocoDBから取得（baseIdとtableNameを直接渡す）
        const records = await this.nocodbClient.list(baseId, tableName, options);

        console.log(`[HybridClient] NocoDB success: ${tableName} (${records.length} records)`);
        return records;

      } catch (error) {
        this.metrics.nocodbErrors++;
        console.warn(`[HybridClient] NocoDB error: ${error.message}`);

        // フォールバックが有効な場合のみAirtableにフォールバック
        if (this.fallbackEnabled) {
          this.metrics.fallbackActivations++;
          console.warn(`[HybridClient] Falling back to Airtable for ${tableName}`);
          return this._airtableList(baseId, tableName, options);
        }

        // フォールバック無効の場合はエラーを投げる
        throw error;
      }
    }

    // NocoDBが無効の場合、直接Airtableを使用
    this.metrics.airtableRequests++;
    return this._airtableList(baseId, tableName, options);
  }

  /**
   * レコード作成
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - テーブル名
   * @param {Object} fields - フィールドデータ
   * @returns {Promise<Object>} - 作成されたレコード
   */
  async create(baseId, tableName, fields) {
    if (this.useNocoDB) {
      try {
        this.metrics.nocodbRequests++;

        const record = await this.nocodbClient.create(baseId, tableName, fields);

        console.log(`[HybridClient] NocoDB create success: ${tableName}`);
        return record;

      } catch (error) {
        this.metrics.nocodbErrors++;
        console.warn(`[HybridClient] NocoDB create error: ${error.message}`);

        if (this.fallbackEnabled) {
          this.metrics.fallbackActivations++;
          console.warn(`[HybridClient] Falling back to Airtable create for ${tableName}`);
          return this._airtableCreate(baseId, tableName, fields);
        }

        throw error;
      }
    }

    this.metrics.airtableRequests++;
    return this._airtableCreate(baseId, tableName, fields);
  }

  /**
   * レコード更新
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - テーブル名
   * @param {string} recordId - レコードID
   * @param {Object} fields - 更新フィールド
   * @returns {Promise<Object>} - 更新されたレコード
   */
  async update(baseId, tableName, recordId, fields) {
    if (this.useNocoDB) {
      try {
        this.metrics.nocodbRequests++;

        const record = await this.nocodbClient.update(baseId, tableName, recordId, fields);

        console.log(`[HybridClient] NocoDB update success: ${tableName}/${recordId}`);
        return record;

      } catch (error) {
        this.metrics.nocodbErrors++;
        console.warn(`[HybridClient] NocoDB update error: ${error.message}`);

        if (this.fallbackEnabled) {
          this.metrics.fallbackActivations++;
          console.warn(`[HybridClient] Falling back to Airtable update for ${tableName}/${recordId}`);
          return this._airtableUpdate(baseId, tableName, recordId, fields);
        }

        throw error;
      }
    }

    this.metrics.airtableRequests++;
    return this._airtableUpdate(baseId, tableName, recordId, fields);
  }

  /**
   * レコード削除
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - テーブル名
   * @param {string} recordId - レコードID
   * @returns {Promise<void>}
   */
  async delete(baseId, tableName, recordId) {
    if (this.useNocoDB) {
      try {
        this.metrics.nocodbRequests++;

        await this.nocodbClient.delete(baseId, tableName, recordId);

        console.log(`[HybridClient] NocoDB delete success: ${tableName}/${recordId}`);
        return;

      } catch (error) {
        this.metrics.nocodbErrors++;
        console.warn(`[HybridClient] NocoDB delete error: ${error.message}`);

        if (this.fallbackEnabled) {
          this.metrics.fallbackActivations++;
          console.warn(`[HybridClient] Falling back to Airtable delete for ${tableName}/${recordId}`);
          return this._airtableDelete(baseId, tableName, recordId);
        }

        throw error;
      }
    }

    this.metrics.airtableRequests++;
    return this._airtableDelete(baseId, tableName, recordId);
  }

  /**
   * メトリクス取得
   * @returns {Object} - 使用状況メトリクス
   */
  getMetrics() {
    return {
      ...this.metrics,
      nocodbSuccessRate: this.metrics.nocodbRequests > 0
        ? ((this.metrics.nocodbRequests - this.metrics.nocodbErrors) / this.metrics.nocodbRequests * 100).toFixed(2) + '%'
        : 'N/A',
      fallbackRate: this.metrics.nocodbRequests > 0
        ? (this.metrics.fallbackActivations / this.metrics.nocodbRequests * 100).toFixed(2) + '%'
        : 'N/A'
    };
  }

  // === Airtable フォールバック実装 ===

  async _airtableList(baseId, tableName, options = {}) {
    const base = this.airtableClient.base(baseId);
    const table = base(tableName);

    const records = [];
    await table.select(options).eachPage((pageRecords, fetchNextPage) => {
      pageRecords.forEach(record => {
        records.push({
          id: record.id,
          fields: record.fields,
          createdTime: record._rawJson.createdTime
        });
      });
      fetchNextPage();
    });

    return records;
  }

  async _airtableCreate(baseId, tableName, fields) {
    const base = this.airtableClient.base(baseId);
    const table = base(tableName);

    const record = await table.create(fields);

    return {
      id: record.id,
      fields: record.fields,
      createdTime: record._rawJson.createdTime
    };
  }

  async _airtableUpdate(baseId, tableName, recordId, fields) {
    const base = this.airtableClient.base(baseId);
    const table = base(tableName);

    const record = await table.update(recordId, fields);

    return {
      id: record.id,
      fields: record.fields,
      createdTime: record._rawJson.createdTime
    };
  }

  async _airtableDelete(baseId, tableName, recordId) {
    const base = this.airtableClient.base(baseId);
    const table = base(tableName);

    await table.destroy(recordId);
  }
}

module.exports = HybridClient;
