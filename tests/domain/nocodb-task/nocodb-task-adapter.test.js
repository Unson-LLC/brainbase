import { describe, expect, it } from 'vitest';

import { NocoDBTaskAdapter } from '../../../public/modules/domain/nocodb-task/nocodb-task-adapter.js';

describe('NocoDBTaskAdapter canonical projection', () => {
    const adapter = new NocoDBTaskAdapter();

    it('preserves waiting and urgent in both directions', () => {
        const task = adapter.toInternalTask({
            project: 'brainbase', id: 7, baseId: 'base-1', tableId: 'table-1',
            fields: { 'タイトル': '返答待ち', 'ステータス': '待ち', '優先度': '緊急' }
        });

        expect(task).toMatchObject({ status: 'waiting', priority: 'urgent' });
        expect(adapter.toNocoDBStatus('waiting')).toBe('待ち');
        expect(adapter.toNocoDBFields({ priority: 'urgent' })).toEqual({ '優先度': '緊急' });
    });

    it('keeps unknown legacy values visible instead of silently changing their meaning', () => {
        const task = adapter.toInternalTask({
            project: 'brainbase', id: 8,
            fields: { 'タイトル': '確認', 'ステータス': '保留中', '優先度': '最優先' }
        });

        expect(task).toMatchObject({ status: '保留中', priority: '最優先' });
    });

    it('projects opaque canonical ids and versions for browser mutations', () => {
        const task = adapter.toInternalCanonicalTask({
            id: 'ct1.payload.signature', version: 4, title: '正本タスク',
            status: 'waiting', priority: 'urgent', assignee_person_id: 'sato_keigo',
            assignee_display_name: '佐藤圭吾', due_at: null, description: '本文',
            source_refs: [{ type: 'mana_capture', project: 'brainbase' }]
        });

        expect(task).toMatchObject({
            id: 'canonical:ct1.payload.signature', canonicalTaskId: 'ct1.payload.signature',
            canonicalVersion: 4, source: 'canonical_task', status: 'waiting', priority: 'urgent',
            project: 'brainbase', assigneePersonId: 'sato_keigo'
        });
    });
});
