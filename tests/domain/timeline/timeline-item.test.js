import { describe, it, expect, beforeEach } from 'vitest';
import {
    TimelineItem,
    validateTimelineItem,
    generateTimelineId,
    TIMELINE_TYPES
} from '../../../public/modules/domain/timeline/timeline-item.js';

describe('TimelineItem', () => {
    describe('TIMELINE_TYPES', () => {
        it('定義されたタイプ一覧が存在する', () => {
            expect(TIMELINE_TYPES).toBeDefined();
            expect(TIMELINE_TYPES.COMMAND).toBe('command');
            expect(TIMELINE_TYPES.SESSION).toBe('session');
            expect(TIMELINE_TYPES.MANUAL).toBe('manual');
            expect(TIMELINE_TYPES.TASK).toBe('task');
            expect(TIMELINE_TYPES.SYSTEM).toBe('system');
        });
    });

    describe('generateTimelineId', () => {
        it('generateTimelineId呼び出し時_tl_プレフィックスのIDが生成される', () => {
            const id = generateTimelineId();

            expect(id).toMatch(/^tl_\d+_[a-z0-9]+$/);
        });

        it('generateTimelineId連続呼び出し時_異なるIDが生成される', () => {
            const id1 = generateTimelineId();
            const id2 = generateTimelineId();

            expect(id1).not.toBe(id2);
        });
    });

    describe('validateTimelineItem', () => {
        let validItem;

        beforeEach(() => {
            validItem = {
                id: 'tl_1704931200000_abc123',
                timestamp: '2025-01-11T09:00:00.000Z',
                type: 'session',
                title: 'Started session: Bug fix #123'
            };
        });

        it('validate呼び出し時_有効な項目_エラーなし', () => {
            const errors = validateTimelineItem(validItem);

            expect(errors).toEqual([]);
        });

        it('validate呼び出し時_id欠損_エラーが返される', () => {
            delete validItem.id;

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('id is required');
        });

        it('validate呼び出し時_timestamp欠損_エラーが返される', () => {
            delete validItem.timestamp;

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('timestamp is required');
        });

        it('validate呼び出し時_type欠損_エラーが返される', () => {
            delete validItem.type;

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('type is required');
        });

        it('validate呼び出し時_title欠損_エラーが返される', () => {
            delete validItem.title;

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('title is required');
        });

        it('validate呼び出し時_不正なtype_エラーが返される', () => {
            validItem.type = 'invalid_type';

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('type must be one of: command, session, manual, task, system');
        });

        it('validate呼び出し時_title長すぎ_エラーが返される', () => {
            validItem.title = 'a'.repeat(201);

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('title must be 200 characters or less');
        });

        it('validate呼び出し時_content長すぎ_エラーが返される', () => {
            validItem.content = 'a'.repeat(5001);

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('content must be 5000 characters or less');
        });

        it('validate呼び出し時_不正なtimestamp形式_エラーが返される', () => {
            validItem.timestamp = 'not-a-date';

            const errors = validateTimelineItem(validItem);

            expect(errors).toContain('timestamp must be valid ISO8601 format');
        });
    });

    describe('TimelineItem class', () => {
        it('コンストラクタ呼び出し時_必須フィールドで初期化される', () => {
            const item = new TimelineItem({
                type: 'session',
                title: 'Started session'
            });

            expect(item.id).toMatch(/^tl_/);
            expect(item.timestamp).toBeDefined();
            expect(item.type).toBe('session');
            expect(item.title).toBe('Started session');
            expect(item.createdAt).toBeDefined();
            expect(item.updatedAt).toBeDefined();
        });

        it('コンストラクタ呼び出し時_オプションフィールドが設定される', () => {
            const item = new TimelineItem({
                type: 'task',
                title: 'Task completed',
                content: 'Detailed description',
                linkedTaskId: 'task-123',
                sessionId: 'session-456',
                metadata: { project: 'brainbase', source: 'auto' }
            });

            expect(item.content).toBe('Detailed description');
            expect(item.linkedTaskId).toBe('task-123');
            expect(item.sessionId).toBe('session-456');
            expect(item.metadata.project).toBe('brainbase');
            expect(item.metadata.source).toBe('auto');
        });

        it('toJSON呼び出し時_シリアライズ可能なオブジェクトが返される', () => {
            const item = new TimelineItem({
                type: 'manual',
                title: 'Manual entry'
            });

            const json = item.toJSON();

            expect(typeof json).toBe('object');
            expect(json.id).toBe(item.id);
            expect(json.type).toBe('manual');
            expect(json.title).toBe('Manual entry');
        });

        it('fromJSON呼び出し時_JSONからインスタンスが復元される', () => {
            const data = {
                id: 'tl_1704931200000_abc123',
                timestamp: '2025-01-11T09:00:00.000Z',
                type: 'command',
                title: 'Executed: npm run test',
                content: 'Test output...',
                metadata: { command: 'npm run test', exitCode: 0 },
                createdAt: '2025-01-11T09:00:00.000Z',
                updatedAt: '2025-01-11T09:00:00.000Z'
            };

            const item = TimelineItem.fromJSON(data);

            expect(item).toBeInstanceOf(TimelineItem);
            expect(item.id).toBe(data.id);
            expect(item.type).toBe('command');
            expect(item.metadata.command).toBe('npm run test');
        });

        it('validate呼び出し時_不正データ_例外がスローされる', () => {
            const item = new TimelineItem({
                type: 'invalid',
                title: 'Test'
            });

            expect(() => item.validate()).toThrow();
        });

        it('validate呼び出し時_有効データ_例外なし', () => {
            const item = new TimelineItem({
                type: 'session',
                title: 'Valid entry'
            });

            expect(() => item.validate()).not.toThrow();
        });
    });
});
