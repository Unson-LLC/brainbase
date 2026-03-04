import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineItemModal } from '../../../public/modules/ui/modals/timeline-item-modal.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

describe('TimelineItemModal', () => {
    let modal;
    let mockTimelineService;
    let modalElement;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = `
            <div id="timeline-item-modal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="timeline-modal-title">タイムライン項目</h3>
                        <button class="close-modal-btn"><i data-lucide="x"></i></button>
                    </div>
                    <div class="modal-body">
                        <input type="hidden" id="timeline-item-id">
                        <div class="form-group">
                            <label>タイトル</label>
                            <input type="text" id="timeline-item-title" class="form-input" maxlength="200">
                        </div>
                        <div class="form-group">
                            <label>タイプ</label>
                            <select id="timeline-item-type" class="form-input">
                                <option value="manual">手動</option>
                                <option value="session">セッション</option>
                                <option value="task">タスク</option>
                                <option value="command">コマンド</option>
                                <option value="system">システム</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>内容（任意）</label>
                            <textarea id="timeline-item-content" class="form-input" rows="3" maxlength="5000"></textarea>
                        </div>
                        <div class="form-group">
                            <label>日時</label>
                            <input type="datetime-local" id="timeline-item-timestamp" class="form-input">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary close-modal-btn">キャンセル</button>
                        <button id="save-timeline-item-btn" class="btn-primary">保存</button>
                    </div>
                </div>
            </div>
        `;

        modalElement = document.getElementById('timeline-item-modal');
        mockTimelineService = {
            createItem: vi.fn().mockResolvedValue({ success: true, item: {} }),
            updateItem: vi.fn().mockResolvedValue({ success: true, item: {} })
        };
        modal = new TimelineItemModal({
            timelineService: mockTimelineService,
            eventBus: eventBus
        });

        vi.clearAllMocks();
    });

    describe('initialization', () => {
        it('mount呼び出し時_モーダル要素が設定される', () => {
            modal.mount();
            expect(modal.modalElement).toBe(modalElement);
        });

        it('mount呼び出し時_モーダルは非表示', () => {
            modal.mount();
            expect(modalElement.classList.contains('active')).toBe(false);
        });
    });

    describe('openForCreate', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('openForCreate呼び出し時_作成モードでモーダルが開く', () => {
            modal.openForCreate();

            expect(modalElement.classList.contains('active')).toBe(true);
            expect(modal.isEditMode).toBe(false);
        });

        it('openForCreate呼び出し時_タイトルが新規追加になる', () => {
            modal.openForCreate();

            const title = document.getElementById('timeline-modal-title');
            expect(title.textContent).toBe('タイムライン項目を追加');
        });

        it('openForCreate呼び出し時_フォームがクリアされる', () => {
            // 事前に値を設定
            document.getElementById('timeline-item-title').value = 'old value';
            document.getElementById('timeline-item-content').value = 'old content';

            modal.openForCreate();

            expect(document.getElementById('timeline-item-title').value).toBe('');
            expect(document.getElementById('timeline-item-content').value).toBe('');
        });

        it('openForCreate呼び出し時_タイプがmanualにデフォルト設定', () => {
            modal.openForCreate();

            expect(document.getElementById('timeline-item-type').value).toBe('manual');
        });

        it('openForCreate呼び出し時_現在日時が設定される', () => {
            modal.openForCreate();

            const timestampInput = document.getElementById('timeline-item-timestamp');
            expect(timestampInput.value).not.toBe('');
        });
    });

    describe('openForEdit', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('openForEdit呼び出し時_編集モードでモーダルが開く', () => {
            const item = {
                id: 'tl_1',
                type: 'session',
                title: 'Test Session',
                content: 'Test content',
                timestamp: '2025-01-11T10:00:00.000Z'
            };

            modal.openForEdit(item);

            expect(modalElement.classList.contains('active')).toBe(true);
            expect(modal.isEditMode).toBe(true);
        });

        it('openForEdit呼び出し時_タイトルが編集になる', () => {
            modal.openForEdit({ id: 'tl_1', title: 'Test' });

            const title = document.getElementById('timeline-modal-title');
            expect(title.textContent).toBe('タイムライン項目を編集');
        });

        it('openForEdit呼び出し時_フォームに値が設定される', () => {
            const item = {
                id: 'tl_1',
                type: 'session',
                title: 'Test Session',
                content: 'Test content',
                timestamp: '2025-01-11T10:00:00.000Z'
            };

            modal.openForEdit(item);

            expect(document.getElementById('timeline-item-id').value).toBe('tl_1');
            expect(document.getElementById('timeline-item-title').value).toBe('Test Session');
            expect(document.getElementById('timeline-item-type').value).toBe('session');
            expect(document.getElementById('timeline-item-content').value).toBe('Test content');
        });
    });

    describe('close', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('close呼び出し時_モーダルが閉じる', () => {
            modal.openForCreate();
            expect(modalElement.classList.contains('active')).toBe(true);

            modal.close();
            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('閉じるボタンクリック時_モーダルが閉じる', () => {
            modal.openForCreate();

            const closeBtn = modalElement.querySelector('.close-modal-btn');
            closeBtn.click();

            expect(modalElement.classList.contains('active')).toBe(false);
        });

        it('バックドロップクリック時_モーダルが閉じる', () => {
            modal.openForCreate();

            const event = new MouseEvent('click', { bubbles: true });
            Object.defineProperty(event, 'target', { value: modalElement });
            modalElement.dispatchEvent(event);

            expect(modalElement.classList.contains('active')).toBe(false);
        });
    });

    describe('save - create mode', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('保存ボタンクリック時_作成モード_createItemが呼ばれる', async () => {
            modal.openForCreate();

            document.getElementById('timeline-item-title').value = 'New Item';
            document.getElementById('timeline-item-type').value = 'manual';
            document.getElementById('timeline-item-content').value = 'New content';

            const saveBtn = document.getElementById('save-timeline-item-btn');
            saveBtn.click();

            await vi.waitFor(() => {
                expect(mockTimelineService.createItem).toHaveBeenCalled();
                const call = mockTimelineService.createItem.mock.calls[0][0];
                expect(call.title).toBe('New Item');
                expect(call.type).toBe('manual');
                expect(call.content).toBe('New content');
            });
        });

        it('保存成功後_モーダルが閉じる', async () => {
            modal.openForCreate();

            document.getElementById('timeline-item-title').value = 'New Item';

            const saveBtn = document.getElementById('save-timeline-item-btn');
            saveBtn.click();

            await vi.waitFor(() => {
                expect(modalElement.classList.contains('active')).toBe(false);
            });
        });
    });

    describe('save - edit mode', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('保存ボタンクリック時_編集モード_updateItemが呼ばれる', async () => {
            modal.openForEdit({
                id: 'tl_1',
                type: 'session',
                title: 'Old Title',
                content: ''
            });

            document.getElementById('timeline-item-title').value = 'Updated Title';

            const saveBtn = document.getElementById('save-timeline-item-btn');
            saveBtn.click();

            await vi.waitFor(() => {
                expect(mockTimelineService.updateItem).toHaveBeenCalledWith('tl_1', expect.objectContaining({
                    title: 'Updated Title'
                }));
            });
        });
    });

    describe('validation', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('タイトル空欄時_保存されない', async () => {
            modal.openForCreate();

            document.getElementById('timeline-item-title').value = '';

            const saveBtn = document.getElementById('save-timeline-item-btn');
            saveBtn.click();

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockTimelineService.createItem).not.toHaveBeenCalled();
        });

        it('タイトル空欄時_エラーメッセージが表示される', () => {
            modal.openForCreate();

            document.getElementById('timeline-item-title').value = '';

            const saveBtn = document.getElementById('save-timeline-item-btn');
            saveBtn.click();

            const titleInput = document.getElementById('timeline-item-title');
            expect(titleInput.classList.contains('error')).toBe(true);
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            modal.mount();
        });

        it('TIMELINE_ADD_ITEM発火時_openForCreateが呼ばれる', async () => {
            const spy = vi.spyOn(modal, 'openForCreate');

            await eventBus.emit(EVENTS.TIMELINE_ADD_ITEM, {});

            expect(spy).toHaveBeenCalled();
        });

        it('TIMELINE_EDIT_ITEM発火時_openForEditが呼ばれる', async () => {
            const spy = vi.spyOn(modal, 'openForEdit');
            const item = { id: 'tl_1', title: 'Test' };

            await eventBus.emit(EVENTS.TIMELINE_EDIT_ITEM, { item });

            expect(spy).toHaveBeenCalledWith(item);
        });
    });

    describe('unmount', () => {
        it('unmount呼び出し時_イベントリスナーが解除される', async () => {
            modal.mount();
            const spy = vi.spyOn(modal, 'openForCreate');

            modal.unmount();
            await eventBus.emit(EVENTS.TIMELINE_ADD_ITEM, {});

            expect(spy).not.toHaveBeenCalled();
        });
    });
});
