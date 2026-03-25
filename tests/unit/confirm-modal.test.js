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

    it('showConfirmWithAction呼び出し時_AIボタンクリックでaiアクションを返す', async () => {
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
            action: 'ai'
        });
    });

    it('showConfirmWithAction呼び出し時_AIボタンクリックでもモーダルは通常どおり閉じる', async () => {
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
        await expect(promise).resolves.toEqual({ action: 'ai' });
        expect(document.getElementById('confirm-modal').classList.contains('active')).toBe(false);
    });
});
