// @ts-check
/**
 * NocoDBIssueAdapter
 * NocoDB形式 ⇔ 内部課題形式の変換
 */
export class NocoDBIssueAdapter {
    /**
     * NocoDBレコード → 内部課題形式
     */
    toInternalIssue(record) {
        const fields = record.fields || {};
        return {
            id: `nocodb-issue:${record.project}:${record.id}`,
            source: 'nocodb',
            project: record.project,
            projectName: record.projectName || record.project,
            title: fields['タイトル'] || 'Untitled',
            type: fields['種別'] || '',
            status: fields['ステータス'] || 'open',
            impact: fields['影響度'] || 'medium',
            reporter: fields['起票者'] || '',
            assignee: fields['担当者'] || '',
            decisionLog: fields['判断ログ'] || '',
            description: fields['説明'] || '',
            storyUrl: fields['関連ストーリー'] || '',
            nocodbRecordId: record.id,
            nocodbBaseId: record.baseId,
            nocodbTableId: record.tableId,
            createdTime: record.createdTime
        };
    }

    /**
     * 内部フィールド → NocoDBフィールド形式
     */
    toNocoDBFields(updates) {
        const fields = {};
        if (updates.title) fields['タイトル'] = updates.title;
        if (updates.type) fields['種別'] = updates.type;
        if (updates.status) fields['ステータス'] = updates.status;
        if (updates.impact) fields['影響度'] = updates.impact;
        if (updates.reporter) fields['起票者'] = updates.reporter;
        if (updates.assignee !== undefined) fields['担当者'] = updates.assignee;
        if (updates.decisionLog !== undefined) fields['判断ログ'] = updates.decisionLog;
        if (updates.description !== undefined) fields['説明'] = updates.description;
        if (updates.storyUrl !== undefined) fields['関連ストーリー'] = updates.storyUrl;
        return fields;
    }
}
