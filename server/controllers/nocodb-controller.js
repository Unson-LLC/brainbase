// @ts-check
import { logger } from '../utils/logger.js';
import { formatDateYMD, getDefaultDueDate, getPriorityLabel } from '../lib/validation.js';

/** @typedef {any} Request */
/** @typedef {any} Response */

/** @param {unknown} error */
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error || '');
}

/**
 * NocoDBController
 * NocoDB連携タスクのHTTPリクエスト処理
 */
export class NocoDBController {
    /** @param {any} configParser */
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
    /** @param {Request} req @param {Response} res */
    list = async (req, res) => {
        try {
            const assignee = req.query.assignee || null;

            this._ensureConfigured();

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
                        error: getErrorMessage(projectError)
                    });
                }
            }

            res.json({
                records: allTasks,
                projects: projectInfo
            });
        } catch (error) {
            logger.error('Failed to fetch NocoDB tasks', { error });
            res.status((/** @type {any} */ (error)).statusCode || 500).json({ error: getErrorMessage(error) || 'Failed to fetch NocoDB tasks' });
        }
    };

    /**
     * POST /api/nocodb/tasks
     * タスクを作成
     */
    /** @param {Request} req @param {Response} res */
    create = async (req, res) => {
        try {
            const { projectId, baseId, title, assignee, priority, due, description } = req.body;

            // 入力検証: title は必須
            if (!title || typeof title !== 'string' || title.trim() === '') {
                return res.status(400).json({ error: 'Title is required' });
            }

            this._ensureConfigured();

            // NocoDBマッピングからprojectId/baseIdを解決
            const mappings = await this.configParser.getNocoDBMappings();
            let mapping = null;
            if (projectId) {
                mapping = mappings.find(m => m.project_id === projectId);
            }
            if (!mapping && baseId) {
                mapping = mappings.find(m => m.base_id === baseId);
            }
            if (!mapping) {
                return res.status(404).json({ error: 'Unknown project or baseId' });
            }

            const taskTable = await this._findTaskTable(mapping.base_id);
            if (!taskTable) {
                return res.status(404).json({ error: 'Task table not found' });
            }

            // デフォルト値の適用
            const normalizedAssignee = typeof assignee === 'string' && assignee.trim()
                ? assignee.trim()
                : '自分';
            const rawPriority = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
            const allowedPriorities = ['low', 'medium', 'high'];
            if (rawPriority && !allowedPriorities.includes(rawPriority)) {
                return res.status(400).json({ error: 'Invalid priority value' });
            }
            const normalizedPriority = rawPriority || 'medium';
            const normalizedDue = typeof due === 'string' && due.trim()
                ? due.trim()
                : getDefaultDueDate();

            const fields = {
                'タイトル': title.trim(),
                '担当者': normalizedAssignee,
                '優先度': getPriorityLabel(normalizedPriority),
                '期限': normalizedDue,
                '説明': typeof description === 'string' ? description : '',
                'ステータス': '未着手'
            };

            const response = await this._createRecord(taskTable.id, fields);
            if (!response.ok) {
                const errorText = await response.text();
                logger.error('NocoDB create failed', {
                    status: response.status,
                    error: errorText
                });
                return res.status(response.status).json({
                    error: 'NocoDB create failed',
                    details: errorText
                });
            }

            const result = await response.json();
            res.status(201).json({ success: true, record: result });
        } catch (error) {
            logger.error('Failed to create NocoDB task', { error });
            res.status((/** @type {any} */ (error)).statusCode || 500).json({ error: getErrorMessage(error) || 'Failed to create task' });
        }
    };

    /**
     * PUT /api/nocodb/tasks/:id
     * タスクステータスを更新
     */
    /** @param {Request} req @param {Response} res */
    update = async (req, res) => {
        try {
            const { id } = req.params;
            const { baseId, fields } = req.body;

            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: 'Invalid task ID' });
            }
            if (!baseId || !fields) {
                return res.status(400).json({ error: 'Missing baseId or fields' });
            }

            this._ensureConfigured();
            const { taskTable, idFieldName } = await this._resolveTable(baseId);

            const recordIdValue = this._normalizeRecordId(id);
            const fallbackIdFields = this._getFallbackIdFields(idFieldName, recordIdValue);

            logger.info('NocoDB update: ID column detection', {
                tableId: taskTable.id,
                idFieldName,
                recordId: id,
                recordIdValue,
                fallbackIdFields
            });

            // NocoDB APIでタスク更新
            let response = await this._patchRecord(taskTable.id, idFieldName, recordIdValue, fields);
            for (const fallbackField of fallbackIdFields) {
                if (response.ok || response.status !== 404) {
                    break;
                }
                logger.warn('NocoDB update retry with fallback id field', {
                    tableId: taskTable.id,
                    fallbackField,
                    recordIdValue
                });
                response = await this._patchRecord(taskTable.id, fallbackField, recordIdValue, fields);
            }

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
            res.status((/** @type {any} */ (error)).statusCode || 500).json({ error: getErrorMessage(error) || 'Failed to update task' });
        }
    };

    /**
     * DELETE /api/nocodb/tasks/:id
     * タスクを削除
     */
    /** @param {Request} req @param {Response} res */
    delete = async (req, res) => {
        try {
            const { id } = req.params;
            const { baseId } = req.body;

            if (!id || typeof id !== 'string') {
                return res.status(400).json({ error: 'Invalid task ID' });
            }
            if (!baseId) {
                return res.status(400).json({ error: 'Missing baseId' });
            }

            this._ensureConfigured();
            const { taskTable, idFieldName } = await this._resolveTable(baseId);

            const recordIdValue = this._normalizeRecordId(id);
            const fallbackIdFields = this._getFallbackIdFields(idFieldName, recordIdValue);

            logger.info('NocoDB delete: ID column detection', {
                tableId: taskTable.id,
                idFieldName,
                recordId: id,
                recordIdValue,
                fallbackIdFields
            });

            // NocoDB APIでタスク削除
            let response = await this._deleteRecord(taskTable.id, idFieldName, recordIdValue);
            for (const fallbackField of fallbackIdFields) {
                if (response.ok || response.status !== 404) {
                    break;
                }
                logger.warn('NocoDB delete retry with fallback id field', {
                    tableId: taskTable.id,
                    fallbackField,
                    recordIdValue
                });
                response = await this._deleteRecord(taskTable.id, fallbackField, recordIdValue);
            }

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
            res.status(error.statusCode || 500).json({ error: error.message || 'Failed to delete task' });
        }
    };

    // ==================== 課題 (Issues) ====================

    /**
     * GET /api/nocodb/issues
     * 全プロジェクトから課題を取得
     */
    /** @param {Request} req @param {Response} res */
    listIssues = async (req, res) => {
        try {
            this._ensureConfigured();

            const mappings = await this.configParser.getNocoDBMappings();
            if (!mappings || mappings.length === 0) {
                return res.json({ records: [], projects: [] });
            }

            const baseIdToMappings = new Map();
            for (const mapping of mappings) {
                const baseId = mapping.base_id;
                if (!baseIdToMappings.has(baseId)) {
                    baseIdToMappings.set(baseId, []);
                }
                baseIdToMappings.get(baseId).push(mapping);
            }

            const allIssues = [];
            const projectInfo = [];

            for (const [baseId, baseMappings] of baseIdToMappings) {
                const primaryMapping = baseMappings[0];
                try {
                    const issueTable = await this._findTable(primaryMapping.base_id, '課題');
                    if (!issueTable) continue;

                    const idFieldName = await this._resolveTableIdField(issueTable.id);
                    const recordsResponse = await fetch(
                        `${this.nocodbUrl}/api/v2/tables/${issueTable.id}/records?limit=100`,
                        { headers: this._headers }
                    );
                    if (!recordsResponse.ok) continue;

                    const recordsData = await recordsResponse.json();
                    const issues = (recordsData.list || []).map((record, index) => {
                        const recordId = this._selectRecordId(record, index, idFieldName);
                        return {
                            id: String(recordId),
                            fields: this._extractFields(record),
                            createdTime: record.CreatedAt || record.created_at || new Date().toISOString(),
                            baseId: primaryMapping.base_id,
                            tableId: issueTable.id
                        };
                    });

                    issues.forEach(issue => {
                        issue.project = primaryMapping.project_id;
                        issue.projectName = primaryMapping.base_name || primaryMapping.project_id;
                    });

                    allIssues.push(...issues);

                    for (const mapping of baseMappings) {
                        projectInfo.push({
                            id: mapping.project_id,
                            name: mapping.base_name || mapping.project_id,
                            baseId: mapping.base_id
                        });
                    }
                } catch (projectError) {
                    logger.warn('Failed to fetch issues from base', {
                        baseId,
                        error: getErrorMessage(projectError)
                    });
                }
            }

            res.json({ records: allIssues, projects: projectInfo });
        } catch (error) {
            logger.error('Failed to fetch NocoDB issues', { error });
            res.status((/** @type {any} */ (error)).statusCode || 500).json({ error: getErrorMessage(error) || 'Failed to fetch issues' });
        }
    };

    /**
     * POST /api/nocodb/issues
     * 課題を作成
     */
    /** @param {Request} req @param {Response} res */
    createIssue = async (req, res) => {
        try {
            const { projectId, baseId, title, type, impact, reporter, assignee, description } = req.body;

            if (!title || typeof title !== 'string' || title.trim() === '') {
                return res.status(400).json({ error: 'Title is required' });
            }

            this._ensureConfigured();

            const mappings = await this.configParser.getNocoDBMappings();
            let mapping = null;
            if (projectId) mapping = mappings.find(m => m.project_id === projectId);
            if (!mapping && baseId) mapping = mappings.find(m => m.base_id === baseId);
            if (!mapping) return res.status(404).json({ error: 'Unknown project or baseId' });

            const issueTable = await this._findTable(mapping.base_id, '課題');
            if (!issueTable) return res.status(404).json({ error: 'Issues table not found' });

            const fields = {
                'タイトル': title.trim(),
                '種別': type || '運用的',
                'ステータス': assignee ? 'assigned' : 'open',
                '影響度': impact || 'medium',
                '起票者': reporter || '',
                '担当者': assignee || '',
                '説明': typeof description === 'string' ? description : ''
            };

            const response = await this._createRecord(issueTable.id, fields);
            if (!response.ok) {
                const errorText = await response.text();
                logger.error('NocoDB issue create failed', { status: response.status, error: errorText });
                return res.status(response.status).json({ error: 'NocoDB issue create failed', details: errorText });
            }

            const result = await response.json();
            res.status(201).json({ success: true, record: result });
        } catch (error) {
            logger.error('Failed to create NocoDB issue', { error });
            res.status((/** @type {any} */ (error)).statusCode || 500).json({ error: getErrorMessage(error) || 'Failed to create issue' });
        }
    };

    /**
     * PUT /api/nocodb/issues/:id
     * 課題を更新
     */
    /** @param {Request} req @param {Response} res */
    updateIssue = async (req, res) => {
        try {
            const { id } = req.params;
            const { baseId, fields } = req.body;

            if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Invalid issue ID' });
            if (!baseId || !fields) return res.status(400).json({ error: 'Missing baseId or fields' });

            this._ensureConfigured();
            const { taskTable: issueTable, idFieldName } = await this._resolveTable(baseId, '課題');

            const recordIdValue = this._normalizeRecordId(id);
            let response = await this._patchRecord(issueTable.id, idFieldName, recordIdValue, fields);

            const fallbackIdFields = this._getFallbackIdFields(idFieldName, recordIdValue);
            for (const fallbackField of fallbackIdFields) {
                if (response.ok || response.status !== 404) break;
                response = await this._patchRecord(issueTable.id, fallbackField, recordIdValue, fields);
            }

            if (!response.ok) {
                const errorText = await response.text();
                return res.status(response.status).json({ error: 'NocoDB issue update failed', details: errorText });
            }

            const result = await response.json();
            res.json({ success: true, record: result });
        } catch (error) {
            logger.error('Failed to update NocoDB issue', { error, issueId: req.params.id });
            res.status((/** @type {any} */ (error)).statusCode || 500).json({ error: getErrorMessage(error) || 'Failed to update issue' });
        }
    };

    /**
     * 環境変数チェック。未設定ならAppErrorを投げる
     */
    _ensureConfigured() {
        if (!this.nocodbUrl || !this.nocodbToken) {
            const error = new Error('NocoDB configuration missing: NOCODB_URL or NOCODB_TOKEN not set');
            error.statusCode = 500;
            throw error;
        }
    }

    /**
     * マッピングからテーブルとIDフィールドを解決する共通処理
     * @param {string} baseId
     * @param {string} [tableName='タスク'] - テーブル名
     * @returns {Promise<{taskTable: Object, idFieldName: string, mapping: Object}>}
     */
    async _resolveTable(baseId, tableName = 'タスク') {
        const mappings = await this.configParser.getNocoDBMappings();
        const mapping = mappings.find(m => m.base_id === baseId);
        if (!mapping) {
            const error = new Error('Unknown base_id');
            error.statusCode = 404;
            throw error;
        }
        const taskTable = await this._findTable(mapping.base_id, tableName);
        if (!taskTable) {
            const error = new Error(`${tableName} table not found`);
            error.statusCode = 404;
            throw error;
        }
        const idFieldName = await this._resolveTableIdField(taskTable.id);
        return { taskTable, idFieldName, mapping };
    }

    /**
     * NocoDB API共通ヘッダー
     */
    get _headers() {
        return { 'xc-token': this.nocodbToken };
    }

    /**
     * 指定テーブルを検索（テーブル一覧から該当タイトルのテーブルを返す）
     * @param {string} baseId - NocoDB base ID
     * @param {string} tableName - テーブル名（例: 'タスク', '課題'）
     * @returns {Promise<Object|null>} テーブルオブジェクトまたはnull
     */
    async _findTable(baseId, tableName) {
        const resp = await fetch(
            `${this.nocodbUrl}/api/v2/meta/bases/${baseId}/tables`,
            { headers: this._headers }
        );
        if (!resp.ok) throw new Error(`Failed to fetch tables: ${resp.status}`);
        const data = await resp.json();
        return data.list?.find(t => t.title === tableName) || null;
    }

    /**
     * タスクテーブルを検索（後方互換）
     * @param {string} baseId - NocoDB base ID
     * @returns {Promise<Object|null>}
     */
    async _findTaskTable(baseId) {
        return this._findTable(baseId, 'タスク');
    }

    /**
     * タスクテーブルのIDフィールド名を解決する
     * @param {string} tableId - テーブルID
     * @returns {Promise<string>} IDフィールド名
     */
    async _resolveTableIdField(tableId) {
        const resp = await fetch(
            `${this.nocodbUrl}/api/v2/meta/tables/${tableId}`,
            { headers: this._headers }
        );
        const detail = resp.ok ? await resp.json() : null;
        return this._resolveIdFieldName(detail);
    }

    /**
     * プロジェクトからタスクを取得（内部メソッド）
     */
    async _fetchProjectTasks(mapping, assignee = null) {
        const where = assignee ? encodeURIComponent(`(担当者,like,%${assignee}%)`) : null;

        const taskTable = await this._findTaskTable(mapping.base_id);
        if (!taskTable) return [];

        const idFieldName = await this._resolveTableIdField(taskTable.id);

        const recordsResponse = await fetch(
            `${this.nocodbUrl}/api/v2/tables/${taskTable.id}/records?limit=100${where ? `&where=${where}` : ''}`,
            { headers: this._headers }
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
            const recordId = this._selectRecordId(record, index, idFieldName);
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
     * レコードIDフィールド名を解決
     * @param {Object|null} tableDetail - テーブル詳細
     * @returns {string}
     */
    _resolveIdFieldName(tableDetail) {
        const pkColumn = tableDetail?.columns?.find(col => col.pk === true);
        if (pkColumn?.title) {
            return pkColumn.title;
        }
        const idColumn = tableDetail?.columns?.find(col => col.uidt === 'ID');
        if (idColumn?.title) {
            return idColumn.title;
        }
        return 'Id';
    }

    /**
     * 代替IDフィールド候補を取得
     * @param {string} idFieldName - 現在のIDフィールド名
     * @param {number|string} recordIdValue - レコードID
     * @returns {string[]}
     */
    _getFallbackIdFields(idFieldName, recordIdValue) {
        if (typeof recordIdValue !== 'number' || Number.isNaN(recordIdValue)) {
            return [];
        }
        return ['Id', 'ID'].filter(name => name !== idFieldName);
    }

    /**
     * レコードIDを選択
     * @param {Object} record - NocoDBレコード
     * @param {number} index - レコードインデックス
     * @returns {number|string}
     */
    _selectRecordId(record, index, idFieldName = null) {
        if (idFieldName && record[idFieldName] !== undefined) {
            return record[idFieldName];
        }
        const rowId = record.Id ?? record.id;
        if (rowId !== undefined) {
            return rowId;
        }
        if (!idFieldName) {
            const recordId = record.ID ??
                             record.RecordId ?? record.recordId ??
                             record.nc_id ?? record._nc_id ??
                             record.row_id ?? record.RowId ??
                             // Fallback: use row index (1-based)
                             (index + 1);
            return recordId;
        }
        return index + 1;
    }

    /**
     * NocoDBレコード更新
     * @param {string} tableId - テーブルID
     * @param {string} idFieldName - IDフィールド名
     * @param {number|string} recordIdValue - レコードID
     * @param {Object} fields - 更新フィールド
     * @returns {Promise<Response>}
     */
    _patchRecord(tableId, idFieldName, recordIdValue, fields) {
        return fetch(
            `${this.nocodbUrl}/api/v2/tables/${tableId}/records`,
            {
                method: 'PATCH',
                headers: { ...this._headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    [idFieldName]: recordIdValue,
                    ...fields
                })
            }
        );
    }

    /**
     * NocoDBレコード作成
     * @param {string} tableId - テーブルID
     * @param {Object} fields - 作成フィールド
     * @returns {Promise<Response>}
     */
    async _createRecord(tableId, fields) {
        const url = `${this.nocodbUrl}/api/v2/tables/${tableId}/records`;
        const headers = { ...this._headers, 'Content-Type': 'application/json' };

        const payloads = [
            JSON.stringify(fields),
            JSON.stringify({ records: [fields] }),
            JSON.stringify({ records: [{ fields }] })
        ];

        let response = null;
        for (const body of payloads) {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body
            });
            if (response.ok) {
                return response;
            }
        }

        return response;
    }

    /**
     * NocoDBレコード削除
     * @param {string} tableId - テーブルID
     * @param {string} idFieldName - IDフィールド名
     * @param {number|string} recordIdValue - レコードID
     * @returns {Promise<Response>}
     */
    _deleteRecord(tableId, idFieldName, recordIdValue) {
        return fetch(
            `${this.nocodbUrl}/api/v2/tables/${tableId}/records`,
            {
                method: 'DELETE',
                headers: { ...this._headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    [idFieldName]: recordIdValue
                })
            }
        );
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
