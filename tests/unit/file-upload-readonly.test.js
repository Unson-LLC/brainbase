import { afterEach, describe, expect, it, vi } from 'vitest';
import { initFileUpload } from '../../public/modules/file-upload.js';
import { httpClient } from '../../public/modules/core/http-client.js';

describe('file upload terminal paste routing', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('clipboard text paste uses TerminalInteractionService and does not fall back to HTTP when read-only rejects', async () => {
        document.body.innerHTML = `
            <div class="console-area"></div>
            <div id="drop-overlay"></div>
            <div id="paste-confirm-modal" class="modal">
                <button class="close-modal-btn" type="button">close</button>
                <pre id="paste-preview-text"></pre>
                <button id="paste-confirm-btn" type="button">paste</button>
                <button id="paste-cancel-btn" type="button">cancel</button>
            </div>
        `;
        const readOnlyError = Object.assign(new Error('Terminal display is read-only'), {
            code: 'TERMINAL_READ_ONLY'
        });
        const terminalInteractionService = {
            sendPasteText: vi.fn(async () => {
                throw readOnlyError;
            }),
            sendText: vi.fn()
        };
        vi.spyOn(httpClient, 'post').mockResolvedValue({});
        const alertMock = vi.fn();
        vi.stubGlobal('alert', alertMock);

        initFileUpload(() => 'session-app-server', {
            getTerminalInteractionService: () => terminalInteractionService
        });

        const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(pasteEvent, 'clipboardData', {
            value: {
                items: [{
                    type: 'text/plain',
                    getAsString: (callback) => callback('pasted text')
                }]
            }
        });

        document.dispatchEvent(pasteEvent);
        document.getElementById('paste-confirm-btn').click();

        await vi.waitFor(() => {
            expect(terminalInteractionService.sendPasteText).toHaveBeenCalledWith(
                'session-app-server',
                'pasted text'
            );
        });
        expect(terminalInteractionService.sendText).not.toHaveBeenCalled();
        expect(httpClient.post).not.toHaveBeenCalledWith(
            '/api/sessions/session-app-server/input',
            expect.anything()
        );
        expect(alertMock).toHaveBeenCalledWith('テキストの貼り付けに失敗しました');
    });

    it('read-only sessions abort image picker uploads before creating upload side effects', async () => {
        document.body.innerHTML = `
            <div class="console-area"></div>
            <div id="drop-overlay"></div>
            <input id="image-file-input" type="file" />
            <button id="upload-image-btn" type="button">upload</button>
        `;
        const terminalInteractionService = {
            getAvailability: vi.fn(() => ({ canSend: false, reason: 'read-only' })),
            sendText: vi.fn()
        };
        vi.spyOn(httpClient, 'post').mockResolvedValue({ path: '/tmp/uploaded.png' });

        initFileUpload(() => 'session-app-server', {
            getTerminalInteractionService: () => terminalInteractionService
        });

        const input = document.getElementById('image-file-input');
        const file = new File(['image-bytes'], 'readonly.png', { type: 'image/png' });
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [file]
        });

        input.dispatchEvent(new Event('change', { bubbles: true }));

        await vi.waitFor(() => {
            expect(terminalInteractionService.getAvailability).toHaveBeenCalledWith('session-app-server');
        });
        expect(httpClient.post).not.toHaveBeenCalledWith('/api/upload', expect.anything());
        expect(terminalInteractionService.sendText).not.toHaveBeenCalled();
    });

    it('read-only sessions ignore trusted iframe terminal helper messages that mutate terminal state', async () => {
        document.body.innerHTML = `
            <div class="console-area"></div>
            <div id="drop-overlay"></div>
            <iframe id="terminal-frame"></iframe>
            <iframe id="mobile-live-terminal-frame"></iframe>
        `;
        const terminalInteractionService = {
            getAvailability: vi.fn(() => ({ canSend: false, reason: 'read-only' }))
        };
        vi.spyOn(httpClient, 'post').mockResolvedValue({});

        initFileUpload(() => 'session-app-server', {
            getTerminalInteractionService: () => terminalInteractionService
        });

        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: { type: 'TMUX_SELECT_PANE', direction: 'R' }
        }));
        window.dispatchEvent(new MessageEvent('message', {
            origin: window.location.origin,
            data: { type: 'TERMINAL_INTERACT' }
        }));

        await Promise.resolve();

        expect(terminalInteractionService.getAvailability).toHaveBeenCalledWith('session-app-server');
        expect(httpClient.post).not.toHaveBeenCalledWith(
            '/api/sessions/session-app-server/select_pane',
            expect.anything()
        );
        expect(httpClient.post).not.toHaveBeenCalledWith(
            '/api/sessions/session-app-server/exit_copy_mode',
            expect.anything()
        );
    });
});
