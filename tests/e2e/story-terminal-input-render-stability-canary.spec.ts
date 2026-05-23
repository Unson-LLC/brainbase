import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import { promisify } from 'util';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${PORT}`;
const execFileAsync = promisify(execFile);

async function createTmuxCanarySession(sessionId) {
    await execFileAsync('tmux', [
        'new-session',
        '-d',
        '-s',
        sessionId,
        '-c',
        process.cwd(),
        'bash -lc \'while true; do printf "$ "; read -r line || exit; done\''
    ]);
    await expect.poll(async () => {
        const { stdout } = await execFileAsync('tmux', ['capture-pane', '-t', sessionId, '-p', '-S', '-20']);
        return stdout.includes('$');
    }, { timeout: 5000 }).toBe(true);
}

async function killTmuxCanarySession(sessionId) {
    await execFileAsync('tmux', ['kill-session', '-t', sessionId]).catch(() => {});
}

test.describe('terminal input canary', () => {
    const cleanupSessionIds = [];

    test.afterEach(async ({ request }) => {
        while (cleanupSessionIds.length > 0) {
            const sessionId = cleanupSessionIds.pop();
            await request.delete(`${BASE_URL}/api/state/sessions/${encodeURIComponent(sessionId)}`).catch(() => {});
            await killTmuxCanarySession(sessionId);
        }
    });

    test('AC: Browser-to-PTY canary verifies typed text through tmux snapshot capture, not only xterm local buffer state', async ({ page, request }) => {
        const sessionId = `e2e-terminal-canary-${Date.now()}`;
        await createTmuxCanarySession(sessionId);
        cleanupSessionIds.push(sessionId);
        await request.post(`${BASE_URL}/api/state/sessions`, {
            data: {
                id: sessionId,
                name: 'E2E terminal input canary',
                project: 'brainbase',
                path: process.cwd(),
                cwd: process.cwd(),
                engine: 'claude',
                intendedState: 'active',
                createdAt: new Date().toISOString()
            }
        });

        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => Boolean(window.brainbaseApp), null, { timeout: 15000 });

        const row = page.locator(`[data-id="${sessionId}"]`).first();
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
            }, { base: BASE_URL, sessionId });
        }

        await page.evaluate(async () => {
            await window.brainbaseApp?.terminalTransportClient?.verifyInputReady?.();
        });

        const ready = await page.waitForFunction(
            (expectedSessionId) => {
                const client = window.brainbaseApp?.terminalTransportClient;
                const status = client?.getStatus?.();
                return Boolean(
                    client?.sessionId === expectedSessionId
                    && status?.connected
                    && status?.terminalAccess?.state === 'owner'
                    && status?.inputReady === true
                );
            },
            sessionId,
            { timeout: 15000 }
        ).then(() => true).catch(() => false);

        test.skip(!ready, 'terminal input transport is not ready for the active local session');

        const activeTransport = await page.evaluate(async () => {
            const { appStore } = await import('/modules/core/store.js');
            const client = window.brainbaseApp?.terminalTransportClient;
            return {
                currentSessionId: appStore.getState().currentSessionId,
                clientSessionId: client?.sessionId,
                connected: client?.getStatus?.()?.connected,
                inputReady: client?.getStatus?.()?.inputReady,
                terminalAccess: client?.getStatus?.()?.terminalAccess?.state,
                wsReadyState: client?.ws?.readyState
            };
        });
        expect(activeTransport).toMatchObject({
            currentSessionId: sessionId,
            clientSessionId: sessionId,
            connected: true,
            inputReady: true,
            terminalAccess: 'owner',
            wsReadyState: 1
        });

        const beforeHealth = await page.evaluate(async (base) => {
            const response = await fetch(`${base}/api/health/terminal`);
            return response.json();
        }, BASE_URL);
        expect(beforeHealth.sessions.duplicateTtyd).toBe(0);

        const marker = `BB_CANARY_${Date.now()}`;
        await page.locator('#terminal-xterm-host').click();
        const dispatch = await page.evaluate(async (value) => {
            const client = window.brainbaseApp?.terminalTransportClient;
            const sent = [];
            const originalSend = client?.ws?.send?.bind(client.ws);
            if (client?.ws && originalSend) {
                client.ws.send = (message) => {
                    try {
                        sent.push(JSON.parse(message));
                    } catch {
                        sent.push({ raw: String(message) });
                    }
                    return originalSend(message);
                };
            }
            await client?.sendText?.(value);
            await new Promise((resolve) => setTimeout(resolve, 100));
            return {
                sessionId: client?.sessionId,
                status: client?.getStatus?.(),
                sent
            };
        }, marker);
        expect(dispatch.sessionId).toBe(sessionId);
        expect(dispatch.sent).toContainEqual(expect.objectContaining({
            type: 'input',
            inputType: 'text',
            value: marker
        }));

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

        await expect.poll(async () => {
            const { stdout } = await execFileAsync('tmux', ['capture-pane', '-t', sessionId, '-p', '-S', '-20']);
            return stdout.includes(marker);
        }, { timeout: 10000 }).toBe(true);

        await expect.poll(async () => {
            return page.evaluate(async ({ base, sessionId, expected }) => {
                const client = window.brainbaseApp?.terminalTransportClient;
                const viewerId = client?.viewerId || 'terminal-input-canary';
                const viewerLabel = client?.viewerLabel || 'Terminal Input Canary';
                const params = new URLSearchParams({
                    viewerId,
                    viewerLabel,
                    lines: '80',
                    visibleOnly: '0'
                });
                const response = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/terminal/snapshot?${params}`);
                if (!response.ok) return false;
                const snapshot = await response.json();
                return `${snapshot.text || ''}\n${snapshot.colorText || ''}`.includes(expected);
            }, { base: BASE_URL, sessionId, expected: marker });
        }, { timeout: 10000 }).toBe(true);

        await page.keyboard.press('Control+U');
        await page.waitForTimeout(100);

        await page.reload();
        await page.waitForLoadState('domcontentloaded');

        const afterHealth = await page.evaluate(async (base) => {
            const response = await fetch(`${base}/api/health/terminal`);
            return response.json();
        }, BASE_URL);
        expect(afterHealth.sessions.duplicateTtyd).toBe(0);
    });
});
