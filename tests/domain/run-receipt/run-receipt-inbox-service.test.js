import { describe, expect, it, vi } from 'vitest';

import { EventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { Store } from '../../../public/modules/core/store.js';
import { RunReceiptInboxClient } from '../../../public/modules/domain/run-receipt/run-receipt-inbox-client.js';
import { RunReceiptInboxService } from '../../../public/modules/domain/run-receipt/run-receipt-inbox-service.js';

function initialInbox(overrides = {}) {
    return {
        status: 'idle',
        items: [],
        count: 0,
        has_more: false,
        omitted_count: 0,
        error: null,
        filters: {},
        ...overrides
    };
}

function makeService({ client, inbox = initialInbox() }) {
    const store = new Store({ runReceiptInbox: inbox });
    const bus = new EventBus();
    return {
        store,
        bus,
        service: new RunReceiptInboxService({ client, appStore: store, eventBus: bus })
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('RunReceiptInboxService', () => {
    it('load呼び出し時_loading中も直前のitemsとcountを保持する', async () => {
        let resolveList;
        const pending = new Promise((resolve) => { resolveList = resolve; });
        const { service, store } = makeService({
            client: { list: vi.fn().mockReturnValue(pending) },
            inbox: initialInbox({ items: [{ id: 'old-run' }], count: 1 })
        });

        const loading = service.load();

        expect(store.getState().runReceiptInbox).toMatchObject({
            status: 'loading', items: [{ id: 'old-run' }], count: 1, error: null
        });
        resolveList({ items: [], count: 0, has_more: false, omitted_count: 0 });
        await loading;
    });

    it('load成功時_専用Storeを更新しloaded eventを発火する', async () => {
        const result = {
            items: [{ id: 'run-1' }], count: 3, has_more: true, omitted_count: 2
        };
        const client = { list: vi.fn().mockResolvedValue(result) };
        const { service, store, bus } = makeService({ client });
        const loaded = vi.fn();
        bus.on(EVENTS.RUN_RECEIPT_INBOX_LOADED, loaded);

        await expect(service.load({ source_type: 'mana' })).resolves.toEqual(result);

        expect(client.list).toHaveBeenCalledWith({ source_type: 'mana' });
        expect(store.getState().runReceiptInbox).toEqual({
            status: 'ready',
            ...result,
            error: null,
            filters: { source_type: 'mana' }
        });
        expect(loaded).toHaveBeenCalledTimes(1);
        expect(loaded.mock.calls[0][0].detail).toMatchObject(result);
    });

    it('load失敗時_既存itemsを0件にせずunavailableとfailed eventを残す', async () => {
        const error = new Error('source unavailable');
        const { service, store, bus } = makeService({
            client: { list: vi.fn().mockRejectedValue(error) },
            inbox: initialInbox({ items: [{ id: 'last-confirmed' }], count: 1 })
        });
        const failed = vi.fn();
        bus.on(EVENTS.RUN_RECEIPT_INBOX_FAILED, failed);

        await expect(service.load({ source_type: 'salestailor' })).rejects.toThrow('source unavailable');

        expect(store.getState().runReceiptInbox).toEqual({
            status: 'unavailable',
            items: [{ id: 'last-confirmed' }],
            count: 1,
            has_more: false,
            omitted_count: 0,
            error: 'source unavailable',
            filters: {}
        });
        expect(failed).toHaveBeenCalledTimes(1);
        expect(failed.mock.calls[0][0].detail).toMatchObject({ message: 'source unavailable' });
    });

    it('filter変更のload失敗時_確認済みsnapshotのfiltersを保持する', async () => {
        const error = new Error('source unavailable');
        const { service, store } = makeService({
            client: { list: vi.fn().mockRejectedValue(error) },
            inbox: initialInbox({
                items: [{ id: 'mana-confirmed' }],
                count: 1,
                filters: { project_id: 'brainbase', source_type: 'mana' }
            })
        });

        await expect(service.setFilters({ source_type: 'github_actions' }))
            .rejects.toThrow('source unavailable');

        expect(store.getState().runReceiptInbox).toMatchObject({
            status: 'unavailable',
            items: [{ id: 'mana-confirmed' }],
            count: 1,
            filters: { project_id: 'brainbase', source_type: 'mana' }
        });
    });

    it('応答しないrequestのtimeout時_確認済みsnapshotを保持してunavailableへ遷移する', async () => {
        vi.useFakeTimers();
        try {
            const apiFetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            }));
            const client = new RunReceiptInboxClient({ apiFetch, requestTimeoutMs: 25 });
            const { service, store, bus } = makeService({
                client,
                inbox: initialInbox({
                    items: [{ id: 'last-confirmed' }],
                    count: 1,
                    filters: { source_type: 'mana' }
                })
            });
            const failed = vi.fn();
            bus.on(EVENTS.RUN_RECEIPT_INBOX_FAILED, failed);

            const pending = service.setFilters({ source_type: 'github_actions' });
            const rejection = expect(pending).rejects
                .toThrow('Run Receipt Inbox request timed out after 25ms');
            await vi.advanceTimersByTimeAsync(25);

            await rejection;
            expect(store.getState().runReceiptInbox).toMatchObject({
                status: 'unavailable',
                items: [{ id: 'last-confirmed' }],
                count: 1,
                filters: { source_type: 'mana' }
            });
            expect(failed).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('setFilters呼び出し時_既存filterへmergeして再取得する', async () => {
        const client = {
            list: vi.fn().mockResolvedValue({ items: [], count: 0, has_more: false, omitted_count: 0 })
        };
        const { service } = makeService({
            client,
            inbox: initialInbox({ filters: { project_id: 'brainbase', source_type: 'mana' } })
        });

        await service.setFilters({ source_type: 'github_actions', evidence_state: 'no_data' });

        expect(client.list).toHaveBeenCalledWith({
            project_id: 'brainbase', source_type: 'github_actions', evidence_state: 'no_data'
        });
    });

    it('後発request成功後に先発requestが成功してもStoreとeventを巻き戻さない', async () => {
        const first = deferred();
        const second = deferred();
        const client = { list: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
        const { service, store, bus } = makeService({ client });
        const loaded = vi.fn();
        bus.on(EVENTS.RUN_RECEIPT_INBOX_LOADED, loaded);

        const firstLoad = service.load({ source_type: 'github_actions' });
        const secondLoad = service.load({ source_type: 'salestailor' });
        second.resolve({ items: [{ id: 'latest' }], count: 1, has_more: false, omitted_count: 0 });
        await secondLoad;
        first.resolve({ items: [{ id: 'stale' }], count: 1, has_more: false, omitted_count: 0 });
        await firstLoad;

        expect(store.getState().runReceiptInbox).toMatchObject({
            status: 'ready', items: [{ id: 'latest' }], filters: { source_type: 'salestailor' }
        });
        expect(loaded).toHaveBeenCalledTimes(1);
        expect(loaded.mock.calls[0][0].detail.items).toEqual([{ id: 'latest' }]);
    });

    it('後発request成功後に先発requestが失敗してもStoreとfailed eventを巻き戻さない', async () => {
        const first = deferred();
        const second = deferred();
        const client = { list: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
        const { service, store, bus } = makeService({ client });
        const failed = vi.fn();
        bus.on(EVENTS.RUN_RECEIPT_INBOX_FAILED, failed);

        const firstLoad = service.load({ source_type: 'github_actions' });
        const firstRejection = expect(firstLoad).rejects.toThrow('stale failure');
        const secondLoad = service.load({ source_type: 'salestailor' });
        second.resolve({ items: [{ id: 'latest' }], count: 1, has_more: false, omitted_count: 0 });
        await secondLoad;
        first.reject(new Error('stale failure'));
        await firstRejection;

        expect(store.getState().runReceiptInbox).toMatchObject({
            status: 'ready', items: [{ id: 'latest' }], filters: { source_type: 'salestailor' }
        });
        expect(failed).not.toHaveBeenCalled();
    });

    it('重複loadの最新request失敗時_最後の確認済みsnapshotを復元する', async () => {
        const first = deferred();
        const second = deferred();
        const client = { list: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
        const { service, store, bus } = makeService({
            client,
            inbox: initialInbox({
                status: 'ready', items: [{ id: 'confirmed' }], count: 1,
                filters: { source_type: 'mana' }
            })
        });
        const loaded = vi.fn();
        const failed = vi.fn();
        bus.on(EVENTS.RUN_RECEIPT_INBOX_LOADED, loaded);
        bus.on(EVENTS.RUN_RECEIPT_INBOX_FAILED, failed);

        const firstLoad = service.load({ source_type: 'github_actions' });
        const secondLoad = service.load({ source_type: 'salestailor' });
        second.reject(new Error('latest failure'));
        await expect(secondLoad).rejects.toThrow('latest failure');
        first.resolve({ items: [{ id: 'stale' }], count: 1, has_more: false, omitted_count: 0 });
        await firstLoad;

        expect(store.getState().runReceiptInbox).toMatchObject({
            status: 'unavailable', items: [{ id: 'confirmed' }], count: 1,
            filters: { source_type: 'mana' }, error: 'latest failure'
        });
        expect(loaded).not.toHaveBeenCalled();
        expect(failed).toHaveBeenCalledTimes(1);
    });
});
