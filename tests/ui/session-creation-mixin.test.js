import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn()
    }
}));

import { httpClient } from '../../public/modules/core/http-client.js';
import { applySessionCreationMixin } from '../../public/modules/app/session-creation-mixin.js';

describe('applySessionCreationMixin', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <span id="app-version"></span>
            <span id="mobile-app-version"></span>
        `;
        vi.clearAllMocks();
    });

    it('updateAppVersionDisplay呼び出し時_表示は短いversionだけにして詳細はtitleへ退避する', async () => {
        httpClient.get.mockResolvedValue({
            version: 'v0.3.18',
            runtime: {
                git: { sha: 'bc8e3c37', branch: 'develop' },
                cwd: '/workspace/brainbase',
                pid: 13610
            }
        });
        class App {}
        applySessionCreationMixin(App);

        await new App().updateAppVersionDisplay();

        const desktop = document.getElementById('app-version');
        const mobile = document.getElementById('mobile-app-version');
        expect(desktop.textContent).toBe('v0.3.18');
        expect(mobile.textContent).toBe('v0.3.18');
        expect(desktop.textContent).not.toContain('bc8e3c37');
        expect(desktop.dataset.gitSha).toBe('bc8e3c37');
        expect(desktop.title).toContain('commit: bc8e3c37');
        expect(desktop.title).toContain('branch: develop');
    });
});
