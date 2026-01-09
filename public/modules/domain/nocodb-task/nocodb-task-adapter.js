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

        return {
            id: `nocodb:${record.project}:${record.id}`,
            source: 'nocodb',
            project: record.project,
            projectName: record.projectName || record.project,
            title: fields['タイトル'] || 'Untitled',
            name: fields['タイトル'] || 'Untitled',
            status: this._mapStatus(fields['ステータス']),
            priority: this._mapPriority(fields['優先度']),
            deadline: fields['期限'] || null,
            due: fields['期限'] || null,
            description: fields['説明'] || '',
            assignee: fields['担当者'] || '',
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
     * NocoDB優先度 → 内部優先度
     */
    _mapPriority(nocoPriority) {
        const map = {
            '高': 'high',
            '中': 'medium',
            '低': 'low'
        };
        return map[nocoPriority] || 'medium';
    }

    /**
     * 内部優先度 → NocoDB優先度
     */
    toNocoDBPriority(priority) {
        const map = {
            'high': '高',
            'medium': '中',
            'low': '低'
        };
        return map[priority] || priority;
    }

    /**
     * 内部フィールド → NocoDBフィールド形式
     * @param {Object} updates - 更新データ { name, priority, due, description, status }
     * @returns {Object} NocoDBフィールド形式
     */
    toNocoDBFields(updates) {
        const fields = {};
        if (updates.name) fields['タイトル'] = updates.name;
        if (updates.priority) fields['優先度'] = this.toNocoDBPriority(updates.priority);
        if (updates.due !== undefined) fields['期限'] = updates.due || null;
        if (updates.description !== undefined) fields['説明'] = updates.description;
        if (updates.status) fields['ステータス'] = this.toNocoDBStatus(updates.status);
        return fields;
    }
}
