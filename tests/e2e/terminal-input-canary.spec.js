import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${PORT}`;

test.describe('terminal input canary', () => {
    test('xterm transport reports verified input readiness before browser typing', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => Boolean(window.brainbaseApp), null, { timeout: 15000 });

        const activeSession = await page.evaluate(async (base) => {
            const response = await fetch(`${base}/api/state`);
            const state = await response.json();
            return (state.sessions || []).find((session) => session.intendedState === 'active') || null;
        }, BASE_URL);

        if (!activeSession?.id) {
            test.skip('active session is not available for terminal input canary');
            return;
        }

        const row = page.locator(`[data-id="${activeSession.id}"]`).first();
        await expect(row).toBeVisible({ timeout: 15000 });

        await row.click();

        await page.waitForFunction(
            () => Boolean(window.brainbaseApp?.terminalTransportClient?.getStatus?.()),
            null,
            { timeout: 5000 }
        ).catch(() => null);

        const blocked = await page.evaluate(() => {
            const status = window.brainbaseApp?.terminalTransportClient?.getStatus?.();
            return status?.terminalAccess?.state === 'blocked';
        });
        if (blocked) {
            await page.evaluate(async ({ base, sessionId }) => {
                const client = window.brainbaseApp?.terminalTransportClient;
                await fetch(`${base}/api/sessions/${sessionId}/terminal/takeover`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ viewerId: client?.viewerId })
                });
                await client?.reconnect?.({ force: true });
            }, { base: BASE_URL, sessionId: activeSession.id });
        }

        await page.evaluate(async () => {
            await window.brainbaseApp?.terminalTransportClient?.verifyInputReady?.();
        });

        const ready = await page.waitForFunction(
            () => {
                const client = window.brainbaseApp?.terminalTransportClient;
                const status = client?.getStatus?.();
                return Boolean(status?.connected && status?.terminalAccess?.state === 'owner' && status?.inputReady === true);
            },
            null,
            { timeout: 15000 }
        ).then(() => true).catch(() => false);

        test.skip(!ready, 'terminal input transport is not ready for the active local session');

        const beforeHealth = await page.evaluate(async (base) => {
            const response = await fetch(`${base}/api/health/terminal`);
            return response.json();
        }, BASE_URL);
        expect(beforeHealth.sessions.duplicateTtyd).toBe(0);

        const marker = `BB_CANARY_${Date.now()}`;
        await page.locator('#terminal-xterm-host').click();
        await page.keyboard.type(marker);

        await expect.poll(async () => {
            return page.evaluate((expected) => {
                const terminal = window.brainbaseApp?.terminalTransportClient?.terminal;
                const buffer = terminal?.buffer?.active;
                if (!buffer) return false;
                const rows = [];
                for (let i = 0; i < buffer.length; i += 1) {
                    const line = buffer.getLine(i);
                    if (line) rows.push(line.translateToString(true));
                }
                return rows.join('\n').includes(expected);
            }, marker);
        }, { timeout: 5000 }).toBe(true);

        await page.reload();
        await page.waitForLoadState('domcontentloaded');

        const afterHealth = await page.evaluate(async (base) => {
            const response = await fetch(`${base}/api/health/terminal`);
            return response.json();
        }, BASE_URL);
        expect(afterHealth.sessions.duplicateTtyd).toBe(0);
    });
});
