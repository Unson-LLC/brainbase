/**
 * NocoDB REST API Client (Airtable-compatible interface)
 * Airtable APIと同じインターフェースを提供し、既存コードの移行を簡易化
 */

const axios = require('axios');

class NocoDBClient {
  constructor(baseUrl = process.env.NOCODB_URL, apiToken = process.env.NOCODB_TOKEN) {
    if (!baseUrl || !apiToken) {
      throw new Error('NOCODB_URL and NOCODB_TOKEN environment variables are required');
    }

    this.baseUrl = baseUrl.replace(/\/$/, ''); // 末尾スラッシュ削除
    this.apiToken = apiToken;
    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'xc-token': apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
  }

  /**
   * レコード一覧取得（Airtable互換）
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - テーブル名（元のAirtableテーブル名）
   * @param {Object} options - クエリオプション
   * @returns {Promise<Array>} - レコードリスト
   */
  async list(baseId, tableName, options = {}) {
    const { where, limit = 100, offset = 0, sort, fields } = options;

    const params = { limit, offset };
    if (where) params.where = where;
    if (sort) params.sort = sort;
    if (fields) params.fields = fields.join(',');

    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      const response = await this.axios.get(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}`,
        { params }
      );

      // Airtable形式に変換（{ id, fields, createdTime } 形式）
      return response.data.list.map(record => ({
        id: record.Id || record.id,
        fields: this._extractFields(record),
        createdTime: record.CreatedAt || record.created_at || new Date().toISOString()
      }));
    } catch (error) {
      // 404エラーの場合、より詳細なエラーメッセージを提供
      if (error.response && error.response.status === 404) {
        const projectId = await this.resolveProjectId(baseId);
        const nocodbTableName = this.resolveTableName(baseId, tableName);
        throw new Error(
          `NocoDB table not found: ${nocodbTableName} (project: ${projectId}, base: ${baseId}, table: ${tableName}). ` +
          `Please verify the table exists in NocoDB.`
        );
      }
      throw new Error(`NocoDB list error: ${error.message}`);
    }
  }

  /**
   * レコード作成（Airtable互換）
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - テーブル名（元のAirtableテーブル名）
   * @param {Object} fields - フィールドデータ
   * @returns {Promise<Object>} - 作成されたレコード
   */
  async create(baseId, tableName, fields) {
    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      const response = await this.axios.post(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}`,
        fields
      );

      return {
        id: response.data.Id || response.data.id,
        fields: this._extractFields(response.data),
        createdTime: response.data.CreatedAt || new Date().toISOString()
      };
    } catch (error) {
      // 404エラーの場合、より詳細なエラーメッセージを提供
      if (error.response && error.response.status === 404) {
        const projectId = await this.resolveProjectId(baseId);
        const nocodbTableName = this.resolveTableName(baseId, tableName);
        throw new Error(
          `NocoDB table not found: ${nocodbTableName} (project: ${projectId}, base: ${baseId}, table: ${tableName}). ` +
          `Please verify the table exists in NocoDB.`
        );
      }
      throw new Error(`NocoDB create error: ${error.message}`);
    }
  }

  /**
   * レコード更新（Airtable互換）
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - テーブル名（元のAirtableテーブル名）
   * @param {string} recordId - レコードID
   * @param {Object} fields - 更新フィールド
   * @returns {Promise<Object>} - 更新されたレコード
   */
  async update(baseId, tableName, recordId, fields) {
    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      const response = await this.axios.patch(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}/${recordId}`,
        fields
      );

      return {
        id: response.data.Id || response.data.id,
        fields: this._extractFields(response.data),
        createdTime: response.data.CreatedAt || new Date().toISOString()
      };
    } catch (error) {
      // 404エラーの場合、より詳細なエラーメッセージを提供
      if (error.response && error.response.status === 404) {
        const projectId = await this.resolveProjectId(baseId);
        const nocodbTableName = this.resolveTableName(baseId, tableName);
        throw new Error(
          `NocoDB table or record not found: ${nocodbTableName}/${recordId} (project: ${projectId}, base: ${baseId}, table: ${tableName}). ` +
          `Please verify the table and record exist in NocoDB.`
        );
      }
      throw new Error(`NocoDB update error: ${error.message}`);
    }
  }

  /**
   * レコード削除（Airtable互換）
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - テーブル名（元のAirtableテーブル名）
   * @param {string} recordId - レコードID
   * @returns {Promise<void>}
   */
  async delete(baseId, tableName, recordId) {
    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      await this.axios.delete(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}/${recordId}`
      );
    } catch (error) {
      // 404エラーの場合、より詳細なエラーメッセージを提供
      if (error.response && error.response.status === 404) {
        const projectId = await this.resolveProjectId(baseId);
        const nocodbTableName = this.resolveTableName(baseId, tableName);
        throw new Error(
          `NocoDB table or record not found: ${nocodbTableName}/${recordId} (project: ${projectId}, base: ${baseId}, table: ${tableName}). ` +
          `Please verify the table and record exist in NocoDB.`
        );
      }
      throw new Error(`NocoDB delete error: ${error.message}`);
    }
  }

  /**
   * プロジェクト一覧取得
   * @returns {Promise<Array>} - プロジェクトリスト
   */
  async listProjects() {
    try {
      const response = await this.axios.get('/api/v1/db/meta/projects');
      return response.data.list || [];
    } catch (error) {
      throw new Error(`NocoDB list projects error: ${error.message}`);
    }
  }

  /**
   * テーブル一覧取得
   * @param {string} projectId - NocoDBプロジェクトID
   * @returns {Promise<Array>} - テーブルリスト
   */
  async listTables(projectId) {
    try {
      const response = await this.axios.get(`/api/v1/db/meta/projects/${projectId}/tables`);
      return response.data.list || [];
    } catch (error) {
      throw new Error(`NocoDB list tables error: ${error.message}`);
    }
  }

  /**
   * レコードからフィールドデータを抽出（内部ヘルパー）
   * @param {Object} record - NocoDBレコード
   * @returns {Object} - フィールドデータ
   */
  _extractFields(record) {
    // NocoDBのシステムフィールド（Id, CreatedAt等）を除外
    const systemFields = ['Id', 'id', 'CreatedAt', 'created_at', 'UpdatedAt', 'updated_at'];
    const fields = {};

    for (const [key, value] of Object.entries(record)) {
      if (!systemFields.includes(key)) {
        fields[key] = value;
      }
    }

    return fields;
  }

  /**
   * プロジェクトIDをbase_idから解決（config.yml連携）
   * @param {string} baseId - Airtable base ID（config.ymlで定義）
   * @returns {Promise<string>} - NocoDBプロジェクトID
   */
  async resolveProjectId(baseId) {
    // config.ymlのmapping情報からNocoDB project IDを取得
    // 実装: _codex/common/ops/nocodb-project-mapping.json を参照
    try {
      const fs = require('fs');
      const path = require('path');
      const mappingPath = path.join(__dirname, '../../_codex/common/ops/nocodb-project-mapping.json');

      if (fs.existsSync(mappingPath)) {
        const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
        return mapping[baseId];
      }

      throw new Error(`NocoDB project mapping not found for base_id: ${baseId}`);
    } catch (error) {
      throw new Error(`Failed to resolve project ID: ${error.message}`);
    }
  }

  /**
   * base_idからbase_nameを解決
   * @param {string} baseId - Airtable base ID
   * @returns {string} - base_name (例: "SalesTailor")
   */
  resolveBaseName(baseId) {
    try {
      const fs = require('fs');
      const path = require('path');
      const mappingPath = path.join(__dirname, '../../_codex/common/ops/nocodb-basename-mapping.json');

      if (fs.existsSync(mappingPath)) {
        const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
        const baseName = mapping[baseId];

        if (!baseName) {
          throw new Error(`Base name not found in mapping for base_id: ${baseId}`);
        }

        return baseName;
      }

      throw new Error(`NocoDB basename mapping file not found: ${mappingPath}`);
    } catch (error) {
      throw new Error(`Failed to resolve base name: ${error.message}`);
    }
  }

  /**
   * NocoDBテーブル名を構築（{BaseName}_{TableName}形式）
   * @param {string} baseId - Airtable base ID
   * @param {string} tableName - 元のテーブル名（日本語対応）
   * @returns {string} - NocoDBテーブル名
   */
  resolveTableName(baseId, tableName) {
    const baseName = this.resolveBaseName(baseId);

    // 日本語テーブル名の正規化（UTF-8エンコーディング確認）
    // NocoDBでは日本語テーブル名がそのまま使用されるため、追加の変換は不要
    const normalizedTableName = tableName.trim();

    // テーブル名が空でないことを確認
    if (!normalizedTableName) {
      throw new Error(`Table name cannot be empty for base_id: ${baseId}`);
    }

    const fullTableName = `${baseName}_${normalizedTableName}`;

    // デバッグログ（UTF-8エンコーディング確認用）
    console.log(`[NocoDBClient] Resolved table name: ${fullTableName} (base: ${baseName}, table: ${normalizedTableName})`);

    return fullTableName;
  }
}

module.exports = NocoDBClient;
