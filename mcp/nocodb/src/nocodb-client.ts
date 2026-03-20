/**
 * NocoDB REST API Client (Airtable-compatible interface)
 * Airtable APIと同じインターフェースを提供し、既存コードの移行を簡易化
 */

import axios, { AxiosInstance } from 'axios';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ListOptions {
  where?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  fields?: string[];
}

export interface ColumnOption {
  title: string;
  color?: string;
}

export interface ColumnUpdateOptions {
  colOptions?: {
    options: ColumnOption[];
  };
}

export interface TableMeta {
  id: string;
  title: string;
  columns: ColumnMeta[];
}

export interface ColumnMeta {
  id: string;
  title: string;
  uidt: string;
  dtxp?: string;
  colOptions?: {
    options: Array<{
      id: string;
      title: string;
      color?: string;
    }>;
  };
}

export interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
}

export class NocoDBClient {
  private baseUrl: string;
  private apiToken: string;
  private axios: AxiosInstance;

  constructor(
    baseUrl: string = process.env.NOCODB_URL || '',
    apiToken: string = process.env.NOCODB_TOKEN || ''
  ) {
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
   */
  async list(baseId: string, tableName: string, options: ListOptions = {}): Promise<AirtableRecord[]> {
    const { where, limit = 100, offset = 0, sort, fields } = options;

    const params: any = { limit, offset };
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

      // Airtable形式に変換
      return response.data.list.map((record: any) => ({
        id: String(record.ID || record.Id || record.id),
        fields: this._extractFields(record),
        createdTime: record.CreatedAt || record.created_at || new Date().toISOString()
      }));
    } catch (error: any) {
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
   * 単一レコード取得
   */
  async get(baseId: string, tableName: string, recordId: string): Promise<AirtableRecord> {
    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      const response = await this.axios.get(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}/${recordId}`
      );

      return {
        id: String(response.data.ID || response.data.Id || response.data.id),
        fields: this._extractFields(response.data),
        createdTime: response.data.CreatedAt || response.data.created_at || new Date().toISOString()
      };
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        const projectId = await this.resolveProjectId(baseId);
        const nocodbTableName = this.resolveTableName(baseId, tableName);
        throw new Error(
          `NocoDB record not found: ${nocodbTableName}/${recordId} (project: ${projectId}, base: ${baseId}, table: ${tableName})`
        );
      }
      throw new Error(`NocoDB get error: ${error.message}`);
    }
  }

  /**
   * レコード作成
   */
  async create(baseId: string, tableName: string, fields: Record<string, any>): Promise<AirtableRecord> {
    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      const response = await this.axios.post(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}`,
        fields
      );

      return {
        id: String(response.data.ID || response.data.Id || response.data.id),
        fields: this._extractFields(response.data),
        createdTime: response.data.CreatedAt || new Date().toISOString()
      };
    } catch (error: any) {
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new Error(`NocoDB create error: ${detail}`);
    }
  }

  /**
   * レコード更新
   */
  async update(baseId: string, tableName: string, recordId: string, fields: Record<string, any>): Promise<AirtableRecord> {
    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      const response = await this.axios.patch(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}/${recordId}`,
        fields
      );

      return {
        id: String(response.data.ID || response.data.Id || response.data.id),
        fields: this._extractFields(response.data),
        createdTime: response.data.CreatedAt || new Date().toISOString()
      };
    } catch (error: any) {
      throw new Error(`NocoDB update error: ${error.message}`);
    }
  }

  /**
   * レコード削除
   */
  async delete(baseId: string, tableName: string, recordId: string): Promise<void> {
    try {
      const projectId = await this.resolveProjectId(baseId);
      const nocodbTableName = this.resolveTableName(baseId, tableName);

      await this.axios.delete(
        `/api/v1/db/data/noco/${projectId}/${nocodbTableName}/${recordId}`
      );
    } catch (error: any) {
      throw new Error(`NocoDB delete error: ${error.message}`);
    }
  }

  // ============================================
  // Meta API (v2) - テーブル・列定義の操作
  // ============================================

  /**
   * テーブルメタデータ取得（列定義含む）
   * @param tableId NocoDB テーブルID（例: mxsy93mwfdvhug1）
   */
  async getTableMeta(tableId: string): Promise<TableMeta> {
    try {
      const response = await this.axios.get(`/api/v2/meta/tables/${tableId}`);

      return {
        id: response.data.id,
        title: response.data.title,
        columns: response.data.columns.map((col: any) => ({
          id: col.id,
          title: col.title,
          uidt: col.uidt,
          dtxp: col.dtxp,
          colOptions: col.colOptions
        }))
      };
    } catch (error: any) {
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new Error(`NocoDB getTableMeta error: ${detail}`);
    }
  }

  /**
   * 列オプション更新（SingleSelect/MultiSelect用）
   * @param columnId 列ID（例: ctqf64uyeb7frf9）
   * @param options 更新オプション
   */
  async updateColumn(columnId: string, options: ColumnUpdateOptions): Promise<any> {
    try {
      const response = await this.axios.patch(
        `/api/v2/meta/columns/${columnId}`,
        options
      );
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      throw new Error(`NocoDB updateColumn error: ${detail}`);
    }
  }

  /**
   * レコードからフィールドデータを抽出
   */
  private _extractFields(record: any): Record<string, any> {
    const systemFields = ['ID', 'Id', 'id', 'CreatedAt', 'created_at', 'UpdatedAt', 'updated_at'];
    const fields: Record<string, any> = {};

    for (const [key, value] of Object.entries(record)) {
      if (!systemFields.includes(key)) {
        fields[key] = value;
      }
    }

    return fields;
  }

  /**
   * プロジェクトIDをbase_idから解決
   */
  async resolveProjectId(baseId: string): Promise<string> {
    try {
      const mappingPath = join(__dirname, '../nocodb-project-mapping.json');

      if (existsSync(mappingPath)) {
        const mapping = JSON.parse(readFileSync(mappingPath, 'utf-8'));
        return mapping[baseId];
      }

      throw new Error(`NocoDB project mapping not found for base_id: ${baseId}`);
    } catch (error: any) {
      throw new Error(`Failed to resolve project ID: ${error.message}`);
    }
  }

  /**
   * base_idからbase_nameを解決
   */
  resolveBaseName(baseId: string): string {
    try {
      const mappingPath = join(__dirname, '../nocodb-basename-mapping.json');

      if (existsSync(mappingPath)) {
        const mapping = JSON.parse(readFileSync(mappingPath, 'utf-8'));

        if (!mapping.hasOwnProperty(baseId)) {
          throw new Error(`Base name not found in mapping for base_id: ${baseId}`);
        }

        return mapping[baseId];
      }

      throw new Error(`NocoDB basename mapping file not found: ${mappingPath}`);
    } catch (error: any) {
      throw new Error(`Failed to resolve base name: ${error.message}`);
    }
  }

  /**
   * NocoDBテーブル名を構築
   */
  resolveTableName(baseId: string, tableName: string): string {
    const baseName = this.resolveBaseName(baseId);
    const normalizedTableName = tableName.trim();

    if (!normalizedTableName) {
      throw new Error(`Table name cannot be empty for base_id: ${baseId}`);
    }

    if (!baseName || baseName === '') {
      return normalizedTableName;
    }

    return `${baseName}_${normalizedTableName}`;
  }
}
