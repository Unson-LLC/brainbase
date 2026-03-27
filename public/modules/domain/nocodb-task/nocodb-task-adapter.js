const FIELD_KEYS = {
    title: 'タイトル',
    status: 'ステータス',
    priority: '優先度',
    due: '期限',
    description: '説明',
    assignee: '担当者',
    context: '背景',
    meetingDate: '会議日',
    meetingTitle: '会議タイトル'
};

const DEFAULT_TITLE = 'Untitled';
const DEFAULT_STATUS = 'pending';
const DEFAULT_PRIORITY = 'medium';

const STATUS_TO_NOCO = {
    pending: '未着手',
    in_progress: '進行中',
    completed: '完了'
};

const PRIORITY_TO_NOCO = {
    high: '高',
    medium: '中',
    low: '低'
};

const STATUS_FROM_NOCO = invertMap(STATUS_TO_NOCO);
const PRIORITY_FROM_NOCO = invertMap(PRIORITY_TO_NOCO);

/**
 * NocoDBTaskAdapter
 * NocoDB形式 ⇔ 内部タスク形式の変換
 */
export class NocoDBTaskAdapter {
    /**
     * NocoDBレコード → 内部タスク形式
     * @param {Object} record - NocoDBレコード
     * @returns {Object} 内部タスク形式
     */
    toInternalTask(record) {
        const fields = record.fields || {};
        const title = getFieldValue(fields, FIELD_KEYS.title, DEFAULT_TITLE);
        const due = getFieldValue(fields, FIELD_KEYS.due, null);
        const description = getFieldValue(fields, FIELD_KEYS.description, '');
        const assignee = getFieldValue(fields, FIELD_KEYS.assignee, '');

        return {
            id: `nocodb:${record.project}:${record.id}`,
            source: 'nocodb',
            project: record.project,
            projectName: record.projectName || record.project,
            title,
            name: title,
            status: this._mapStatus(fields[FIELD_KEYS.status]),
            priority: this._mapPriority(fields[FIELD_KEYS.priority]),
            deadline: due,
            due,
            description,
            assignee,
            // コンテキスト情報（manaから議事録ベースで登録されたタスク）
            context: getFieldValue(fields, FIELD_KEYS.context, ''),
            meetingDate: getFieldValue(fields, FIELD_KEYS.meetingDate, null),
            meetingTitle: getFieldValue(fields, FIELD_KEYS.meetingTitle, ''),
            nocodbRecordId: record.id,
            nocodbBaseId: record.baseId,
            nocodbTableId: record.tableId,
            createdTime: record.createdTime
        };
    }

    /**
     * 内部ステータス → NocoDBステータス
     * @param {string} status - 内部ステータス
     * @returns {string} NocoDBステータス
     */
    toNocoDBStatus(status) {
        return STATUS_TO_NOCO[status] || status;
    }

    /**
     * NocoDBステータス → 内部ステータス
     */
    _mapStatus(nocoStatus) {
        return STATUS_FROM_NOCO[nocoStatus] || DEFAULT_STATUS;
    }

    /**
     * NocoDB優先度 → 内部優先度
     */
    _mapPriority(nocoPriority) {
        return PRIORITY_FROM_NOCO[nocoPriority] || DEFAULT_PRIORITY;
    }

    /**
     * 内部優先度 → NocoDB優先度
     */
    toNocoDBPriority(priority) {
        return PRIORITY_TO_NOCO[priority] || priority;
    }

    /**
     * 内部フィールド → NocoDBフィールド形式
     * @param {Object} updates - 更新データ { name, priority, due, description, status }
     * @returns {Object} NocoDBフィールド形式
     */
    toNocoDBFields(updates) {
        const fields = {};
        if (updates.name) fields[FIELD_KEYS.title] = updates.name;
        if (updates.priority) fields[FIELD_KEYS.priority] = this.toNocoDBPriority(updates.priority);
        if (updates.due !== undefined) fields[FIELD_KEYS.due] = updates.due || null;
        if (updates.description !== undefined) fields[FIELD_KEYS.description] = updates.description;
        if (updates.status) fields[FIELD_KEYS.status] = this.toNocoDBStatus(updates.status);
        if (updates.assignee !== undefined) fields[FIELD_KEYS.assignee] = updates.assignee;
        return fields;
    }
}

function invertMap(map) {
    return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]));
}

function getFieldValue(fields, key, fallback) {
    return fields[key] ?? fallback;
}
