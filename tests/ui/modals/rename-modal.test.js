/**
 * RenameModal Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

// eventBusをモック化
vi.mock('../../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn()
    },
    EVENTS: {
        SESSION_UPDATED: 'session:updated'
    }
}));

describe('RenameModal', () => {
    let dom;
    let document;
    let window;

    beforeEach(() => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="rename-session-modal" class="modal">
                        <button class="close-modal-btn">×</button>
                        <input type="text" id="rename-session-input" />
                        <button id="save-rename-btn">Rename</button>
                    </div>
                </body>
            </html>
        `, { runScripts: 'dangerously' });
        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;
        global.alert = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('DOM elements', () => {
        it('should have rename modal element', () => {
            const modal = document.getElementById('rename-session-modal');
            expect(modal).not.toBeNull();
        });

        it('should have session name input', () => {
            const input = document.getElementById('rename-session-input');
            expect(input).not.toBeNull();
        });

        it('should have rename button', () => {
            const button = document.getElementById('save-rename-btn');
            expect(button).not.toBeNull();
        });
    });

    describe('RenameModal class', () => {
        let RenameModal;
        let mockSessionService;

        beforeEach(async () => {
            mockSessionService = {
                updateSession: vi.fn().mockResolvedValue({})
            };

            const module = await import('../../../public/modules/ui/modals/rename-modal.js');
            RenameModal = module.RenameModal;
        });

        it('mount呼び出し時_モーダル要素が取得される', () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            expect(modal.modalElement).not.toBeNull();
            expect(modal.modalElement.id).toBe('rename-session-modal');
        });

        it('open呼び出し時_inputにセッション名が設定される', async () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Test Session' };
            modal.open(session);

            const input = document.getElementById('rename-session-input');
            expect(input.value).toBe('Test Session');
        });

        it('open呼び出し時_currentSessionIdが設定される', () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-123', name: 'Test' };
            modal.open(session);

            expect(modal.currentSessionId).toBe('session-123');
        });

        it('open呼び出し時_モーダルにactiveクラスが追加される', () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Test' };
            modal.open(session);

            expect(modal.modalElement.classList.contains('active')).toBe(true);
        });

        it('close呼び出し時_モーダルからactiveクラスが削除される', () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Test' };
            modal.open(session);
            modal.close();

            expect(modal.modalElement.classList.contains('active')).toBe(false);
        });

        it('close呼び出し時_currentSessionIdがnullになる', () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Test' };
            modal.open(session);
            modal.close();

            expect(modal.currentSessionId).toBeNull();
        });

        it('save呼び出し時_sessionServiceのupdateSessionが呼ばれる', async () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Old Name' };
            modal.open(session);

            const input = document.getElementById('rename-session-input');
            input.value = 'New Name';

            await modal.save();

            expect(mockSessionService.updateSession).toHaveBeenCalledWith('session-1', { name: 'New Name' });
        });

        it('save呼び出し時_空の入力_alertが表示される', async () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Test' };
            modal.open(session);

            const input = document.getElementById('rename-session-input');
            input.value = '';

            await modal.save();

            expect(global.alert).toHaveBeenCalledWith('セッション名を入力してください');
            expect(mockSessionService.updateSession).not.toHaveBeenCalled();
        });

        it('save成功時_モーダルが閉じる', async () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Test' };
            modal.open(session);

            const input = document.getElementById('rename-session-input');
            input.value = 'New Name';

            await modal.save();

            expect(modal.modalElement.classList.contains('active')).toBe(false);
        });

        it('Enterキー押下時_saveが呼ばれる', async () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();

            const session = { id: 'session-1', name: 'Test' };
            modal.open(session);

            const input = document.getElementById('rename-session-input');
            input.value = 'New Name';

            const saveSpy = vi.spyOn(modal, 'save');

            const event = new window.KeyboardEvent('keydown', { key: 'Enter' });
            input.dispatchEvent(event);

            expect(saveSpy).toHaveBeenCalled();
        });

        it('unmount呼び出し時_modalElementがnullになる', () => {
            const modal = new RenameModal({ sessionService: mockSessionService });
            modal.mount();
            modal.unmount();

            expect(modal.modalElement).toBeNull();
            expect(modal.currentSessionId).toBeNull();
        });
    });
});
