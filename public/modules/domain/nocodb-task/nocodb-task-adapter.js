// @ts-check
/**
 * NocoDBTaskAdapter
 * NocoDB形式 ⇔ 内部タスク形式の変換
 */
import { PRIORITY_LABELS, getPriorityLabel } from '../../utils/task-filters.js';

// 逆引きマップ（日本語→英語）をPRIORITY_LABELSから生成
const PRIORITY_REVERSE = Object.fromEntries(
    Object.entries(PRIORITY_LABELS).map(([k, v]) => [v, k])
);

export class NocoDBTaskAdapter {
    /**
     * NocoDBレコード → 内部タスク形式
     * @param {Object} record - NocoDBレコード
     * @returns {Object} 内部タスク形式
     */
    toInternalTask(record) {
        const fields = record.fields || {};

        return {
            id: `nocodb:${record.project}:${record.id}`,
            source: 'nocodb',
            project: record.project,
            projectName: record.projectName || record.project,
            title: fields['タイトル'] || 'Untitled',
            name: fields['タイトル'] || 'Untitled',
            status: this._mapStatus(fields['ステータス']),
            priority: PRIORITY_REVERSE[fields['優先度']] || 'medium',
            deadline: fields['期限'] || null,
            due: fields['期限'] || null,
            description: fields['説明'] || '',
            assignee: fields['担当者'] || '',
            context: fields['背景'] || '',
            meetingDate: fields['会議日'] || null,
            meetingTitle: fields['会議タイトル'] || '',
            nocodbRecordId: record.id,
            nocodbBaseId: record.baseId,
            nocodbTableId: record.tableId,
            createdTime: record.createdTime
        };
    }

    /**
     * 内部ステータス → NocoDBステータス
     */
    toNocoDBStatus(status) {
        const map = {
            'pending': '未着手',
            'in_progress': '進行中',
            'completed': '完了'
        };
        return map[status] || status;
    }

    /**
     * NocoDBステータス → 内部ステータス
     */
    _mapStatus(nocoStatus) {
        const map = {
            '未着手': 'pending',
            '進行中': 'in_progress',
            '完了': 'completed'
        };
        return map[nocoStatus] || 'pending';
    }

    /**
     * 内部フィールド → NocoDBフィールド形式
     * @param {Object} updates - 更新データ { name, priority, due, description, status }
     * @returns {Object} NocoDBフィールド形式
     */
    toNocoDBFields(updates) {
        const fields = {};
        if (updates.name) fields['タイトル'] = updates.name;
        if (updates.priority) fields['優先度'] = getPriorityLabel(updates.priority);
        if (updates.due !== undefined) fields['期限'] = updates.due || null;
        if (updates.description !== undefined) fields['説明'] = updates.description;
        if (updates.status) fields['ステータス'] = this.toNocoDBStatus(updates.status);
        if (updates.assignee !== undefined) fields['担当者'] = updates.assignee;
        return fields;
    }
}
