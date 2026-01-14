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
     * 全プロジェクトから担当者フィルタ付きのタスクを取得
     */
    list = async (req, res) => {
        try {
            const assignee = req.query.assignee || null;

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

            // 同じbase_idを持つプロジェクトをグループ化（重複取得を防止）
            const baseIdToMappings = new Map();
            for (const mapping of mappings) {
                const baseId = mapping.base_id;
                if (!baseIdToMappings.has(baseId)) {
                    baseIdToMappings.set(baseId, []);
                }
                baseIdToMappings.get(baseId).push(mapping);
            }

            // 各ベースからタスクを取得（重複なし）
            const allTasks = [];
            const projectInfo = [];

            for (const [baseId, baseMappings] of baseIdToMappings) {
                // 最初のマッピングを使用してタスクを取得
                const primaryMapping = baseMappings[0];

                try {
                    const tasks = await this._fetchProjectTasks(primaryMapping, assignee);

                    // 同じベースを参照する全プロジェクトの情報を記録
                    for (const mapping of baseMappings) {
                        projectInfo.push({
                            id: mapping.project_id,
                            name: mapping.base_name || mapping.project_id,
                            baseId: mapping.base_id
                        });
                    }

                    // タスクには最初のマッピングのプロジェクト情報を付与
                    // （UIでは base_name を表示するため、実際のプロジェクト名になる）
                    tasks.forEach(task => {
                        task.project = primaryMapping.project_id;
                        task.projectName = primaryMapping.base_name || primaryMapping.project_id;
                    });

                    allTasks.push(...tasks);

                    // 同じベースを参照する複数プロジェクトがある場合は警告
                    if (baseMappings.length > 1) {
                        logger.info('Multiple projects share same NocoDB base', {
                            baseId,
                            projects: baseMappings.map(m => m.project_id),
                            usingPrimary: primaryMapping.project_id
                        });
                    }
                } catch (projectError) {
                    // 個別ベースのエラーはログして続行
                    logger.warn('Failed to fetch tasks from base', {
                        baseId,
                        projects: baseMappings.map(m => m.project_id),
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

            // Fetch table details to get columns (tables list doesn't include columns)
            const tableDetailResponse = await fetch(
                `${this.nocodbUrl}/api/v2/meta/tables/${taskTable.id}`,
                {
                    headers: {
                        'xc-token': this.nocodbToken
                    }
                }
            );

            let hasIdColumn = false;
            if (tableDetailResponse.ok) {
                const tableDetail = await tableDetailResponse.json();
                // Check if table has an actual ID column (pk or ID type)
                hasIdColumn = tableDetail.columns?.some(col =>
                    col.pk === true || col.uidt === 'ID' || col.title === 'ID'
                );
            }

            // Tables with ID column use 'ID' (uppercase), tables without use 'Id' (row index)
            const idFieldName = hasIdColumn ? 'ID' : 'Id';

            logger.info('NocoDB update: ID column detection', {
                tableId: taskTable.id,
                hasIdColumn,
                idFieldName,
                recordId: id
            });

            const recordIdValue = this._normalizeRecordId(id);

            // NocoDB APIでタスク更新
            const response = await fetch(
                `${this.nocodbUrl}/api/v2/tables/${taskTable.id}/records`,
                {
                    method: 'PATCH',
                    headers: {
                        'xc-token': this.nocodbToken,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        [idFieldName]: recordIdValue,
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

            // Fetch table details to get columns (tables list doesn't include columns)
            const tableDetailResponse = await fetch(
                `${this.nocodbUrl}/api/v2/meta/tables/${taskTable.id}`,
                {
                    headers: {
                        'xc-token': this.nocodbToken
                    }
                }
            );

            let hasIdColumn = false;
            if (tableDetailResponse.ok) {
                const tableDetail = await tableDetailResponse.json();
                // Check if table has an actual ID column (pk or ID type)
                hasIdColumn = tableDetail.columns?.some(col =>
                    col.pk === true || col.uidt === 'ID' || col.title === 'ID'
                );
            }

            // Tables with ID column use 'ID' (uppercase), tables without use 'Id' (row index)
            const idFieldName = hasIdColumn ? 'ID' : 'Id';

            logger.info('NocoDB delete: ID column detection', {
                tableId: taskTable.id,
                hasIdColumn,
                idFieldName,
                recordId: id
            });

            const recordIdValue = this._normalizeRecordId(id);

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
                        [idFieldName]: recordIdValue
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
    async _fetchProjectTasks(mapping, assignee = null) {
        const tableName = encodeURIComponent('タスク');
        const where = assignee ? encodeURIComponent(`(担当者,like,%${assignee}%)`) : null;

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
            `${this.nocodbUrl}/api/v2/tables/${taskTable.id}/records?limit=100${where ? `&where=${where}` : ''}`,
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
            // Note: Using nullish coalescing (??) to handle 0 as valid ID
            // Priority: ID (BAAO style) > RecordId (manually added) > other variants
            const recordId = record.ID ?? record.Id ?? record.id ??
                             record.RecordId ?? record.recordId ??
                             record.nc_id ?? record._nc_id ??
                             record.row_id ?? record.RowId ??
                             // Fallback: use row index (1-based)
                             (index + 1);
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

    /**
     * レコードIDをNocoDB用に正規化
     * @param {string} id - レコードID
     * @returns {number|string}
     */
    _normalizeRecordId(id) {
        const numericId = Number(id);
        return Number.isNaN(numericId) ? id : numericId;
    }
}
