import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InboxView } from '../../../public/modules/ui/views/inbox-view.js';
import { InboxService } from '../../../public/modules/domain/inbox/inbox-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

// InboxServiceをモック化
vi.mock('../../../public/modules/domain/inbox/inbox-service.js', () => {
    return {
        InboxService: class MockInboxService {
            constructor() {
                this.loadInbox = vi.fn();
                this.markAsDone = vi.fn();
                this.markAllAsDone = vi.fn();
                this.getInboxCount = vi.fn(() => 0);
            }
        }
    };
});

describe('InboxView', () => {
    let inboxView;
    let mockInboxService;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = `
            <div id="inbox-trigger-btn"></div>
            <div id="inbox-dropdown">
                <div id="inbox-list"></div>
                <button id="mark-all-done-btn">すべて確認済みにする</button>
            </div>
            <span id="inbox-badge"></span>
        `;

        // モックサービス
        mockInboxService = new InboxService();
        inboxView = new InboxView({ inboxService: mockInboxService });

        // ストア初期化
        appStore.setState({ inbox: [] });

        vi.clearAllMocks();
    });

    describe('mount', () => {
        it('mount呼び出し時_DOM要素が取得される', () => {
            inboxView.mount();

            expect(inboxView.inboxTriggerBtn).toBeTruthy();
            expect(inboxView.inboxDropdown).toBeTruthy();
            expect(inboxView.inboxListEl).toBeTruthy();
            expect(inboxView.inboxBadge).toBeTruthy();
            expect(inboxView.markAllDoneBtn).toBeTruthy();
        });

        it('mount呼び出し時_loadInboxが呼ばれる', () => {
            inboxView.mount();

            expect(mockInboxService.loadInbox).toHaveBeenCalled();
        });

        it('mount呼び出し時_EventBusリスナーが設定される', () => {
            const renderSpy = vi.spyOn(inboxView, 'render');
            inboxView.mount();

            eventBus.emit(EVENTS.INBOX_LOADED, { items: [] });

            expect(renderSpy).toHaveBeenCalled();
        });
    });

    describe('render', () => {
        beforeEach(() => {
            inboxView.mount();
        });

        it('render呼び出し時_inbox空_通知なしメッセージが表示される', () => {
            appStore.setState({ inbox: [] });

            inboxView.render();

            const inboxList = document.getElementById('inbox-list');
            expect(inboxList.innerHTML).toContain('通知はありません');
        });

        it('render呼び出し時_inbox空_バッジが非表示になる', () => {
            appStore.setState({ inbox: [] });

            inboxView.render();

            const badge = document.getElementById('inbox-badge');
            expect(badge.style.display).toBe('none');
        });

        it('render呼び出し時_inbox項目あり_バッジが表示される', () => {
            appStore.setState({
                inbox: [{ id: '1', message: 'Test', sender: 'User', channel: 'general' }]
            });

            inboxView.render();

            const badge = document.getElementById('inbox-badge');
            expect(badge.style.display).toBe('inline-flex');
            expect(badge.textContent).toBe('1');
        });

        it('render呼び出し時_inbox項目あり_項目が表示される', () => {
            const items = [
                { id: '1', message: 'Test Message 1', sender: 'Alice', channel: 'general' },
                { id: '2', message: 'Test Message 2', sender: 'Bob', channel: 'random' }
            ];
            appStore.setState({ inbox: items });

            inboxView.render();

            const inboxList = document.getElementById('inbox-list');
            expect(inboxList.innerHTML).toContain('Test Message 1');
            expect(inboxList.innerHTML).toContain('Alice');
            expect(inboxList.innerHTML).toContain('#general');
            expect(inboxList.innerHTML).toContain('Test Message 2');
            expect(inboxList.innerHTML).toContain('Bob');
            expect(inboxList.innerHTML).toContain('#random');
        });

        it('render呼び出し時_HTMLエスケープが適用される', () => {
            const items = [
                { id: '1', message: '<script>alert("XSS")</script>', sender: 'Hacker', channel: 'test' }
            ];
            appStore.setState({ inbox: items });

            inboxView.render();

            const inboxList = document.getElementById('inbox-list');
            expect(inboxList.innerHTML).not.toContain('<script>');
            expect(inboxList.innerHTML).toContain('&lt;script&gt;');
        });

        it('render呼び出し時_slackUrlがある場合_リンクが表示される', () => {
            const items = [
                { id: '1', message: 'Test', sender: 'User', channel: 'general', slackUrl: 'https://slack.com/archives/C123' }
            ];
            appStore.setState({ inbox: items });

            inboxView.render();

            const inboxList = document.getElementById('inbox-list');
            expect(inboxList.innerHTML).toContain('Slackで開く');
            expect(inboxList.innerHTML).toContain('https://slack.com/archives/C123');
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            inboxView.mount();

            const items = [
                { id: '1', message: 'Test', sender: 'User', channel: 'general' }
            ];
            appStore.setState({ inbox: items }); // mount後にstateを設定（Store購読でrender()が呼ばれる）
        });

        it('inbox trigger buttonクリック時_ドロップダウンが開く', () => {
            const triggerBtn = document.getElementById('inbox-trigger-btn');
            triggerBtn.click();

            const dropdown = document.getElementById('inbox-dropdown');
            expect(dropdown.classList.contains('open')).toBe(true);
        });

        it('inbox trigger buttonクリック時_ドロップダウンが閉じる（toggle）', () => {
            const triggerBtn = document.getElementById('inbox-trigger-btn');

            // Open
            triggerBtn.click();
            expect(inboxView.inboxOpen).toBe(true);

            // Close
            triggerBtn.click();
            expect(inboxView.inboxOpen).toBe(false);
        });

        it('外側クリック時_ドロップダウンが閉じる', () => {
            const triggerBtn = document.getElementById('inbox-trigger-btn');
            triggerBtn.click();
            expect(inboxView.inboxOpen).toBe(true);

            // Click outside
            document.body.click();

            const dropdown = document.getElementById('inbox-dropdown');
            expect(dropdown.classList.contains('open')).toBe(false);
            expect(inboxView.inboxOpen).toBe(false);
        });

        it('mark as doneボタンクリック時_markAsDoneが呼ばれる', async () => {
            mockInboxService.markAsDone.mockResolvedValue();

            const doneBtn = document.querySelector('.inbox-done-btn');
            doneBtn.click();

            await vi.waitFor(() => {
                expect(mockInboxService.markAsDone).toHaveBeenCalledWith('1');
            });
        });

        it('mark all doneボタンクリック時_markAllAsDoneが呼ばれる', async () => {
            mockInboxService.markAllAsDone.mockResolvedValue();

            const markAllBtn = document.getElementById('mark-all-done-btn');
            markAllBtn.click();

            await vi.waitFor(() => {
                expect(mockInboxService.markAllAsDone).toHaveBeenCalled();
            });
        });
    });

    describe('event subscriptions', () => {
        beforeEach(() => {
            inboxView.mount();
        });

        it('INBOX_LOADEDイベント発火時_再レンダリングされる', () => {
            const renderSpy = vi.spyOn(inboxView, 'render');

            eventBus.emit(EVENTS.INBOX_LOADED, { items: [] });

            expect(renderSpy).toHaveBeenCalled();
        });
    });

    describe('store subscriptions', () => {
        beforeEach(() => {
            inboxView.mount();
        });

        it('inbox state変更時_再レンダリングされる', () => {
            const renderSpy = vi.spyOn(inboxView, 'render');

            appStore.setState({
                inbox: [{ id: '1', message: 'New notification', sender: 'System', channel: 'alerts' }]
            });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('inbox以外のstate変更時_再レンダリングされない', () => {
            const renderSpy = vi.spyOn(inboxView, 'render');
            renderSpy.mockClear(); // Clear initial render call

            appStore.setState({ tasks: [] }); // inbox以外の変更

            expect(renderSpy).not.toHaveBeenCalled();
        });
    });
});
