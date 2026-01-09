import { logger } from '../utils/logger.js';

/**
 * NocoDBController
 * NocoDB連携タスクのHTTPリクエスト処理
 */
export class NocoDBController {
    constructor(configParser) {
        this.configParser = configParser;
        // Support both naming conventions
        this.nocodbUrl = process.env.NOCODB_BASE_URL || process.env.NOCODB_URL;
        this.nocodbToken = process.env.NOCODB_API_TOKEN || process.env.NOCODB_TOKEN;
    }

    /**
     * GET /api/nocodb/tasks
     * 全プロジェクトから担当者="佐藤"のタスクを取得
     */
    list = async (req, res) => {
        try {
            // 環境変数チェック
            if (!this.nocodbUrl || !this.nocodbToken) {
                return res.status(500).json({
                    error: 'NocoDB configuration missing',
                    details: 'NOCODB_URL or NOCODB_TOKEN environment variable is not set'
                });
            }

            // NocoDBマッピングを取得
            const mappings = await this.configParser.getNocoDBMappings();
            if (!mappings || mappings.length === 0) {
                return res.json({ records: [], projects: [] });
            }

            // 各プロジェクトからタスクを取得
            const allTasks = [];
            const projectInfo = [];

            for (const mapping of mappings) {
                try {
                    const tasks = await this._fetchProjectTasks(mapping);

                    // プロジェクト情報を付与
                    tasks.forEach(task => {
                        task.project = mapping.project_id;
                        task.projectName = mapping.base_name || mapping.project_id;
                    });

                    allTasks.push(...tasks);
                    projectInfo.push({
                        id: mapping.project_id,
                        name: mapping.base_name || mapping.project_id,
                        baseId: mapping.base_id
                    });
                } catch (projectError) {
                    // 個別プロジェクトのエラーはログして続行
                    logger.warn('Failed to fetch tasks from project', {
                        project: mapping.project_id,
                        error: projectError.message
                    });
                }
            }

            res.json({
                records: allTasks,
                projects: projectInfo
            });
        } catch (error) {
            logger.error('Failed to fetch NocoDB tasks', { error });
            res.status(500).json({ error: 'Failed to fetch NocoDB tasks' });
        }
    };

    /**
     * PUT /api/nocodb/tasks/:id
     * タスクステータスを更新
     */
    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { baseId, fields } = req.body;

            // 入力検証
            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: 'Invalid task ID' });
            }
            if (!baseId || !fields) {
                return res.status(400).json({ error: 'Missing baseId or fields' });
            }

            // 環境変数チェック
            if (!this.nocodbUrl || !this.nocodbToken) {
                return res.status(500).json({
                    error: 'NocoDB configuration missing'
                });
            }

            // NocoDBマッピングからprojectIdを取得
            const mappings = await this.configParser.getNocoDBMappings();
            const mapping = mappings.find(m => m.base_id === baseId);
            if (!mapping) {
                return res.status(404).json({ error: 'Unknown base_id' });
            }

            // NocoDB APIでタスク更新
            const response = await fetch(
                `${this.nocodbUrl}/api/v2/tables/${mapping.base_id}/records`,
                {
                    method: 'PATCH',
                    headers: {
                        'xc-token': this.nocodbToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        Id: parseInt(id, 10),
                        ...fields
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                logger.error('NocoDB update failed', {
                    status: response.status,
                    error: errorText
                });
                return res.status(response.status).json({
                    error: 'NocoDB update failed',
                    details: errorText
                });
            }

            const result = await response.json();
            res.json({ success: true, record: result });
        } catch (error) {
            logger.error('Failed to update NocoDB task', { error, taskId: req.params.id });
            res.status(500).json({ error: 'Failed to update task' });
        }
    };

    /**
     * DELETE /api/nocodb/tasks/:id
     * タスクを削除
     */
    delete = async (req, res) => {
        try {
            const { id } = req.params;
            const { baseId } = req.body;

            // 入力検証
            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: 'Invalid task ID' });
            }
            if (!baseId) {
                return res.status(400).json({ error: 'Missing baseId' });
            }

            // 環境変数チェック
            if (!this.nocodbUrl || !this.nocodbToken) {
                return res.status(500).json({
                    error: 'NocoDB configuration missing'
                });
            }

            // NocoDBマッピングからtableIdを取得
            const mappings = await this.configParser.getNocoDBMappings();
            const mapping = mappings.find(m => m.base_id === baseId);
            if (!mapping) {
                return res.status(404).json({ error: 'Unknown base_id' });
            }

            // テーブル一覧を取得してタスクテーブルIDを特定
            const tablesResponse = await fetch(
                `${this.nocodbUrl}/api/v2/meta/bases/${mapping.base_id}/tables`,
                {
                    headers: {
                        'xc-token': this.nocodbToken
                    }
                }
            );

            if (!tablesResponse.ok) {
                throw new Error(`Failed to fetch tables: ${tablesResponse.status}`);
            }

            const tablesData = await tablesResponse.json();
            const taskTable = tablesData.list?.find(t => t.title === 'タスク');

            if (!taskTable) {
                return res.status(404).json({ error: 'Task table not found' });
            }

            // NocoDB APIでタスク削除
            const response = await fetch(
                `${this.nocodbUrl}/api/v2/tables/${taskTable.id}/records`,
                {
                    method: 'DELETE',
                    headers: {
                        'xc-token': this.nocodbToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        Id: parseInt(id, 10)
                    })
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                logger.error('NocoDB delete failed', {
                    status: response.status,
                    error: errorText
                });
                return res.status(response.status).json({
                    error: 'NocoDB delete failed',
                    details: errorText
                });
            }

            res.json({ success: true, deletedId: id });
        } catch (error) {
            logger.error('Failed to delete NocoDB task', { error, taskId: req.params.id });
            res.status(500).json({ error: 'Failed to delete task' });
        }
    };

    /**
     * プロジェクトからタスクを取得（内部メソッド）
     */
    async _fetchProjectTasks(mapping) {
        const tableName = encodeURIComponent('タスク');
        const where = encodeURIComponent('(担当者,like,%佐藤%)');

        // NocoDB v2 API: /api/v2/tables/{tableId}/records
        // tableIdはbase_idから取得する必要がある場合がある
        // まずはテーブル一覧を取得してタスクテーブルのIDを特定
        const tablesResponse = await fetch(
            `${this.nocodbUrl}/api/v2/meta/bases/${mapping.base_id}/tables`,
            {
                headers: {
                    'xc-token': this.nocodbToken
                }
            }
        );

        if (!tablesResponse.ok) {
            throw new Error(`Failed to fetch tables: ${tablesResponse.status}`);
        }

        const tablesData = await tablesResponse.json();
        const taskTable = tablesData.list?.find(t => t.title === 'タスク');

        if (!taskTable) {
            // タスクテーブルがない場合は空配列を返す
            return [];
        }

        // タスクレコードを取得
        const recordsResponse = await fetch(
            `${this.nocodbUrl}/api/v2/tables/${taskTable.id}/records?where=${where}&limit=100`,
            {
                headers: {
                    'xc-token': this.nocodbToken
                }
            }
        );

        if (!recordsResponse.ok) {
            throw new Error(`Failed to fetch records: ${recordsResponse.status}`);
        }

        const recordsData = await recordsResponse.json();

        // Airtable互換形式に変換
        // NocoDB v2 APIはデフォルトでIDを返さない場合がある
        // インデックスベースのIDを生成（更新には別途テーブルスキーマが必要）
        return (recordsData.list || []).map((record, index) => {
            // Try various ID field names that NocoDB might use
            const recordId = record.Id || record.id || record.ID ||
                             record.nc_id || record._nc_id ||
                             record.row_id || record.RowId ||
                             // Fallback: create a hash from unique fields
                             `${mapping.base_id}_${index}`;
            return {
                id: String(recordId),
                fields: this._extractFields(record),
                createdTime: record.CreatedAt || record.created_at || new Date().toISOString(),
                baseId: mapping.base_id,
                tableId: taskTable.id
            };
        });
    }

    /**
     * レコードからフィールドを抽出（システムフィールドを除外）
     */
    _extractFields(record) {
        const systemFields = [
            'Id', 'id', 'ID',
            'CreatedAt', 'created_at',
            'UpdatedAt', 'updated_at',
            'nc_'  // NocoDB内部フィールドプレフィックス
        ];

        const fields = {};
        for (const [key, value] of Object.entries(record)) {
            // システムフィールドをスキップ
            if (systemFields.some(sf => key === sf || key.startsWith(sf))) {
                continue;
            }
            fields[key] = value;
        }
        return fields;
    }
}
