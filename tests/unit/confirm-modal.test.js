import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('confirm-modal', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="confirm-modal" class="modal">
                <div class="modal-content">
                    <button class="close-modal-btn">x</button>
                    <h3 id="confirm-modal-title"></h3>
                    <p id="confirm-modal-message"></p>
                    <div id="confirm-manual-copy" class="confirm-manual-copy hidden">
                        <textarea id="confirm-manual-copy-text" readonly></textarea>
                    </div>
                    <div class="modal-footer">
                        <button id="confirm-cancel-btn"></button>
                        <button id="confirm-action-btn" style="display:none"></button>
                        <button id="confirm-ai-btn" style="display:none"></button>
                        <button id="confirm-ok-btn"></button>
                    </div>
                </div>
            </div>
        `;
        vi.resetModules();
    });

    it('showConfirmWithAction呼び出し時_AIボタンクリック中にclipboardへ書き込む', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true
        });

        const { showConfirmWithAction } = await import('../../public/modules/confirm-modal.js');

        const promise = showConfirmWithAction('message', {
            title: '確認',
            okText: 'OK',
            cancelText: 'Cancel',
            actionText: 'Action',
            aiActionText: 'AI',
            aiClipboardText: 'prompt text'
        });

        document.getElementById('confirm-ai-btn').click();

        await expect(promise).resolves.toEqual({
            action: 'ai',
            delivery: { mode: 'clipboard' }
        });
        expect(writeText).toHaveBeenCalledWith('prompt text');
    });

    it('showConfirmWithAction呼び出し時_clipboard失敗なら手動コピー欄を表示する', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: vi.fn().mockRejectedValue(new Error('denied'))
            },
            configurable: true
        });
        document.execCommand = vi.fn().mockReturnValue(false);

        const { showConfirmWithAction } = await import('../../public/modules/confirm-modal.js');

        void showConfirmWithAction('message', {
            title: '確認',
            okText: 'OK',
            cancelText: 'Cancel',
            actionText: 'Action',
            aiActionText: 'AI',
            aiClipboardText: 'prompt text'
        });

        document.getElementById('confirm-ai-btn').click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(document.getElementById('confirm-modal').classList.contains('active')).toBe(true);
        expect(document.getElementById('confirm-manual-copy').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('confirm-manual-copy-text').value).toBe('prompt text');
    });
});
