import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import { TimelineStorage } from '../../lib/timeline-storage.js';

// Mock fs module
vi.mock('fs/promises', () => ({
    default: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn()
    }
}));

import fs from 'fs/promises';

describe('TimelineStorage', () => {
    let storage;
    const mockDir = '/tmp/test-timeline';

    beforeEach(() => {
        storage = new TimelineStorage(mockDir);
        vi.clearAllMocks();
    });

    describe('loadTimeline', () => {
        it('loadTimeline呼び出し時_ファイル存在_項目が返される', async () => {
            const mockData = {
                date: '2025-01-11',
                items: [
                    { id: 'tl_1', type: 'session', title: 'Test' }
                ],
                version: '1.0.0'
            };
            fs.readFile.mockResolvedValue(JSON.stringify(mockData));

            const result = await storage.loadTimeline('2025-01-11');

            expect(result.items).toHaveLength(1);
            expect(result.items[0].id).toBe('tl_1');
        });

        it('loadTimeline呼び出し時_ファイル不存在_空配列が返される', async () => {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            fs.readFile.mockRejectedValue(error);

            const result = await storage.loadTimeline('2025-01-11');

            expect(result.items).toEqual([]);
            expect(result.date).toBe('2025-01-11');
        });

        it('loadTimeline呼び出し時_その他エラー_例外がスローされる', async () => {
            fs.readFile.mockRejectedValue(new Error('Permission denied'));

            await expect(storage.loadTimeline('2025-01-11')).rejects.toThrow('Permission denied');
        });
    });

    describe('saveTimeline', () => {
        it('saveTimeline呼び出し時_ファイルに保存される', async () => {
            fs.mkdir.mockResolvedValue(undefined);
            fs.writeFile.mockResolvedValue(undefined);

            const items = [{ id: 'tl_1', type: 'session', title: 'Test' }];
            await storage.saveTimeline('2025-01-11', items);

            expect(fs.mkdir).toHaveBeenCalledWith(mockDir, { recursive: true });
            expect(fs.writeFile).toHaveBeenCalled();
            const writeCall = fs.writeFile.mock.calls[0];
            expect(writeCall[0]).toBe(path.join(mockDir, '2025-01-11.json'));
            const savedData = JSON.parse(writeCall[1]);
            expect(savedData.items).toHaveLength(1);
        });
    });

    describe('addItem', () => {
        it('addItem呼び出し時_新規項目_追加される', async () => {
            const error = new Error('ENOENT');
            error.code = 'ENOENT';
            fs.readFile.mockRejectedValue(error);
            fs.mkdir.mockResolvedValue(undefined);
            fs.writeFile.mockResolvedValue(undefined);

            const item = {
                id: 'tl_1736571600000_abc',
                timestamp: '2025-01-11T09:00:00.000Z',
                type: 'session',
                title: 'New session'
            };

            const result = await storage.addItem(item);

            expect(result.success).toBe(true);
            expect(result.item).toEqual(item);
        });

        it('addItem呼び出し時_重複項目_スキップされる', async () => {
            const existingData = {
                date: '2025-01-11',
                items: [{
                    id: 'tl_1736571600000_xyz',
                    timestamp: '2025-01-11T09:00:00.000Z',
                    type: 'session',
                    title: 'Existing session'
                }]
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));

            const item = {
                id: 'tl_1736571602000_abc', // 2秒後
                timestamp: '2025-01-11T09:00:02.000Z',
                type: 'session', // 同じtype
                title: 'Duplicate session'
            };

            const result = await storage.addItem(item, 5000);

            expect(result.success).toBe(false);
            expect(result.reason).toBe('duplicate');
        });

        it('addItem呼び出し時_同タイプ異時刻_追加される', async () => {
            const existingData = {
                date: '2025-01-11',
                items: [{
                    id: 'tl_1736571600000_xyz',
                    timestamp: '2025-01-11T09:00:00.000Z',
                    type: 'session',
                    title: 'Existing session'
                }]
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));
            fs.mkdir.mockResolvedValue(undefined);
            fs.writeFile.mockResolvedValue(undefined);

            const item = {
                id: 'tl_1736571610000_abc', // 10秒後
                timestamp: '2025-01-11T09:00:10.000Z',
                type: 'session',
                title: 'New session'
            };

            const result = await storage.addItem(item, 5000);

            expect(result.success).toBe(true);
        });
    });

    describe('updateItem', () => {
        it('updateItem呼び出し時_存在する項目_更新される', async () => {
            const existingData = {
                date: '2025-01-11',
                items: [{
                    id: 'tl_1736571600000_abc',
                    timestamp: '2025-01-11T09:00:00.000Z',
                    type: 'session',
                    title: 'Original title'
                }]
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));
            fs.mkdir.mockResolvedValue(undefined);
            fs.writeFile.mockResolvedValue(undefined);

            const result = await storage.updateItem('tl_1736571600000_abc', {
                title: 'Updated title'
            });

            expect(result.success).toBe(true);
            expect(result.item.title).toBe('Updated title');
            expect(result.item.updatedAt).toBeDefined();
        });

        it('updateItem呼び出し時_存在しない項目_エラー返却', async () => {
            const existingData = {
                date: '2025-01-11',
                items: []
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));

            const result = await storage.updateItem('tl_1736571600000_abc', {
                title: 'Updated title'
            });

            expect(result.success).toBe(false);
            expect(result.reason).toBe('not_found');
        });

        it('updateItem呼び出し時_不正なID_エラー返却', async () => {
            const result = await storage.updateItem('invalid_id', {
                title: 'Updated title'
            });

            expect(result.success).toBe(false);
            expect(result.reason).toBe('invalid_id');
        });
    });

    describe('deleteItem', () => {
        it('deleteItem呼び出し時_存在する項目_削除される', async () => {
            const existingData = {
                date: '2025-01-11',
                items: [{
                    id: 'tl_1736571600000_abc',
                    timestamp: '2025-01-11T09:00:00.000Z',
                    type: 'session',
                    title: 'To be deleted'
                }]
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));
            fs.mkdir.mockResolvedValue(undefined);
            fs.writeFile.mockResolvedValue(undefined);

            const result = await storage.deleteItem('tl_1736571600000_abc');

            expect(result.success).toBe(true);
            const writeCall = fs.writeFile.mock.calls[0];
            const savedData = JSON.parse(writeCall[1]);
            expect(savedData.items).toHaveLength(0);
        });

        it('deleteItem呼び出し時_存在しない項目_エラー返却', async () => {
            const existingData = {
                date: '2025-01-11',
                items: []
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));

            const result = await storage.deleteItem('tl_1736571600000_abc');

            expect(result.success).toBe(false);
            expect(result.reason).toBe('not_found');
        });
    });

    describe('getItem', () => {
        it('getItem呼び出し時_存在する項目_項目が返される', async () => {
            const existingData = {
                date: '2025-01-11',
                items: [{
                    id: 'tl_1736571600000_abc',
                    timestamp: '2025-01-11T09:00:00.000Z',
                    type: 'session',
                    title: 'Test item'
                }]
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));

            const result = await storage.getItem('tl_1736571600000_abc');

            expect(result).not.toBeNull();
            expect(result.title).toBe('Test item');
        });

        it('getItem呼び出し時_存在しない項目_nullが返される', async () => {
            const existingData = {
                date: '2025-01-11',
                items: []
            };
            fs.readFile.mockResolvedValue(JSON.stringify(existingData));

            const result = await storage.getItem('tl_1736571600000_abc');

            expect(result).toBeNull();
        });
    });
});
