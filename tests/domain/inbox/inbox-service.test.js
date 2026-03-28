import { describe, it, expect, beforeEach, vi } from 'vitest';
import { listenForEvent } from '../../helpers/event-test-utils.js';
import { InboxService } from '../../../public/modules/domain/inbox/inbox-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// モジュールをモック化
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn(),
        post: vi.fn()
    }
}));

describe('InboxService', () => {
    let inboxService;
    let mockInboxItems;

    beforeEach(() => {
        // テストデータ準備
        mockInboxItems = [
            {
                id: 'inbox-1',
                kind: 'notification',
                sender: 'テストユーザー',
                channel: 'general',
                message: 'テストメッセージ1',
                slackUrl: 'https://slack.com/archives/C123/p123'
            },
            {
                id: 'inbox-2',
                kind: 'notification',
                sender: '田中',
                channel: 'dev',
                message: 'テストメッセージ2',
                slackUrl: 'https://slack.com/archives/C456/p456'
            }
        ];

        // ストア初期化
        appStore.setState({
            inbox: []
        });

        // サービスインスタンス作成
        inboxService = new InboxService();

        // モックリセット
        vi.clearAllMocks();
    });

    describe('loadInbox', () => {
        it('loadInbox呼び出し時_API経由でInboxアイテムを取得してStoreを更新する', async () => {
            httpClient.get
                .mockResolvedValueOnce(mockInboxItems)
                .mockResolvedValueOnce([]);

            const result = await inboxService.loadInbox();

            expect(httpClient.get).toHaveBeenCalledWith('/api/inbox/pending');
            expect(httpClient.get).toHaveBeenCalledWith('/api/learning/promotions?status=evaluated&apply_mode=manual');
            expect(appStore.getState().inbox).toEqual(mockInboxItems);
            expect(result).toEqual(mockInboxItems);
        });

        it('loadInbox呼び出し時_INBOX_LOADEDイベントが発火される', async () => {
            httpClient.get
                .mockResolvedValueOnce(mockInboxItems)
                .mockResolvedValueOnce([]);
            const listener = vi.fn();
            eventBus.on(EVENTS.INBOX_LOADED, listener);

            await inboxService.loadInbox();

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.items).toEqual(mockInboxItems);
        });
    });

    describe('markAsDone', () => {
        it('markAsDone呼び出し時_API経由でアイテムを完了済みにしてInboxを再読み込みする', async () => {
            httpClient.post.mockResolvedValue({});
            httpClient.get
                .mockResolvedValueOnce([mockInboxItems[1]])
                .mockResolvedValueOnce([]);

            await inboxService.markAsDone('inbox-1');

            expect(httpClient.post).toHaveBeenCalledWith('/api/inbox/inbox-1/done');
            expect(httpClient.get).toHaveBeenCalledWith('/api/inbox/pending');
        });

        it('markAsDone呼び出し時_INBOX_ITEM_COMPLETEDイベントが発火される', async () => {
            httpClient.post.mockResolvedValue({});
            httpClient.get
                .mockResolvedValueOnce([mockInboxItems[1]])
                .mockResolvedValueOnce([]);
            const listener = vi.fn();
            eventBus.on(EVENTS.INBOX_ITEM_COMPLETED, listener);

            await inboxService.markAsDone('inbox-1');

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail.itemId).toBe('inbox-1');
        });
    });

    describe('markAllAsDone', () => {
        it('markAllAsDone呼び出し時_API経由で全アイテムを完了済みにしてInboxを再読み込みする', async () => {
            httpClient.post.mockResolvedValue({});
            httpClient.get
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            await inboxService.markAllAsDone();

            expect(httpClient.post).toHaveBeenCalledWith('/api/inbox/mark-all-done');
            expect(httpClient.get).toHaveBeenCalledWith('/api/inbox/pending');
        });

        it('markAllAsDone呼び出し時_Storeが空配列になる', async () => {
            // 最初にアイテムがある状態
            appStore.setState({ inbox: mockInboxItems });

            httpClient.post.mockResolvedValue({});
            httpClient.get
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            await inboxService.markAllAsDone();

            expect(appStore.getState().inbox).toEqual([]);
        });
    });

    describe('getInboxCount', () => {
        it('getInboxCount呼び出し時_現在のInboxアイテム数を返す', () => {
            appStore.setState({ inbox: mockInboxItems });

            const count = inboxService.getInboxCount();

            expect(count).toBe(2);
        });

        it('getInboxCount呼び出し時_Inboxが空の場合は0を返す', () => {
            appStore.setState({ inbox: [] });

            const count = inboxService.getInboxCount();

            expect(count).toBe(0);
        });

        it('loadInbox呼び出し時_learning candidate を先頭にマージする', async () => {
            httpClient.get
                .mockResolvedValueOnce(mockInboxItems)
                .mockResolvedValueOnce([
                    {
                        id: 'prm_1',
                        pillar: 'skill',
                        target_ref: '.claude/skills/recovery/SKILL.md',
                        title: 'recovery',
                        source_preview: 'UI learning candidate smoke test',
                        source_type: 'explicit_learn',
                        outcome: 'success',
                        risk_level: 'low',
                        evaluation_summary: {},
                        proposed_content: '# recovery'
                    }
                ]);

            const result = await inboxService.loadInbox();

            expect(result[0].kind).toBe('learning');
            expect(result[1].kind).toBe('notification');
        });
    });
});
