import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

async function setStartupPrompt(page, text) {
    await page.evaluate((value) => {
        const input = document.getElementById('session-startup-prompt-input');
        if (!input) throw new Error('startup prompt input not found');
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await expect(page.locator('#session-startup-prompt-input')).toHaveValue(text);
}

test.describe('story-session-shell-first-startup-ux', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.route(/\/api\/state\/sessions\/[^/]+$/, async (route) => {
            if (route.request().method() !== 'PATCH') {
                await route.fallback();
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true })
            });
        });
        await page.evaluate(() => {
            document.getElementById('app-loading-splash')?.remove();
            if (window.brainbaseApp) {
                window.brainbaseApp._shouldUseXtermTransport = () => false;
            }
        });
    });

    test('AC: real create-session UI shows promptable pending shell and flushes queued prompt after startup', async ({ page, request }) => {
        // story-session-shell-first-startup-ux ac:1
        // story-session-shell-first-startup-ux ac:2
        // story-session-shell-first-startup-ux ac:3
        // story-session-shell-first-startup-ux ac:4
        // story-session-shell-first-startup-ux ac:5
        // story-session-shell-first-startup-ux ac:7
        test.setTimeout(60000);
        const sessionName = `Startup UX E2E ${Date.now()}`;
        const sentInputs = [];
        let createPayload = null;
        let readyStateSession = null;
        let releaseWorktreeStartup;

        await page.route('**/api/sessions/*/progress?**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    phase: 'worktree',
                    percent: 35,
                    message: 'ワークスペースを準備中...',
                    timestamp: Date.now()
                })
            });
        });

        await page.route('**/api/sessions/create-with-worktree', async (route) => {
            createPayload = route.request().postDataJSON();
            await new Promise((resolve) => {
                releaseWorktreeStartup = resolve;
            });

            const now = new Date().toISOString();
            const worktreePath = `/tmp/brainbase-e2e/${createPayload.sessionId}`;
            readyStateSession = {
                id: createPayload.sessionId,
                name: createPayload.name,
                project: createPayload.project,
                path: worktreePath,
                worktree: {
                    path: worktreePath,
                    repoPath: createPayload.repoPath,
                    branch: createPayload.sessionId
                },
                engine: createPayload.engine,
                initialCommand: '',
                intendedState: 'active',
                startupStatus: 'ready',
                startupPhase: 'done',
                startupMessage: '',
                updatedAt: now
            };
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    sessionId: createPayload.sessionId,
                    proxyPath: `/console/${createPayload.sessionId}`
                })
            });
        });

        await page.route(/\/api\/sessions\/[^/]+\/input$/, async (route) => {
            sentInputs.push({
                url: route.request().url(),
                body: route.request().postDataJSON()
            });
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true })
            });
        });

        const row = page.locator('.session-child-row').filter({
            has: page.locator('.session-name', { hasText: sessionName })
        }).first();

        try {
            await expect(page.locator('#session-list')).toBeVisible();
            await page.locator('#add-session-btn').click();
            await expect(page.locator('#create-session-modal')).toHaveClass(/active/);
            await page.locator('#session-name-input').fill(sessionName);
            await page.locator('#session-project-select').selectOption('brainbase');
            const useWorktreeCheckbox = page.locator('#use-worktree-checkbox');
            if (!(await useWorktreeCheckbox.isChecked())) {
                await useWorktreeCheckbox.check();
            }
            await page.locator('input[name="session-engine"][value="codex"]').check();
            await page.locator('#create-session-btn').click();

            await expect(page.locator('#create-session-modal')).not.toHaveClass(/active/);
            await expect(row).toBeVisible({ timeout: 15000 });
            await expect(row).toHaveClass(/active/);
            await expect(page.locator('#terminal-loading-overlay')).not.toHaveClass(/hidden/);
            await expect(page.locator('#session-startup-composer')).not.toHaveClass(/hidden/);

            await expect.poll(async () => createPayload?.sessionId || null).not.toBeNull();
            await expect.poll(async () => {
                return await page.evaluate(async (sessionId) => {
                    const { appStore } = await import('/modules/core/store.js');
                    const session = (appStore.getState().sessions || []).find((entry) => entry.id === sessionId);
                    return session?.startupStatus || null;
                }, createPayload.sessionId);
            }).toBe('pending');

            await setStartupPrompt(page, 'queued first prompt');
            await page.waitForTimeout(250);
            // Typing while startup is pending should queue automatically before startup is released.
            await expect.poll(async () => (
                await page.evaluate((sessionId) => (
                    window.brainbaseApp?._sessionStartupPromptQueue?.get(sessionId) || null
                ), createPayload.sessionId)
            ), { timeout: 5000 }).toBe('queued first prompt');
            expect(sentInputs).toEqual([]);
            await page.route('**/api/state', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        sessions: readyStateSession ? [readyStateSession] : [],
                        testMode: false,
                        preferences: {}
                    })
                });
            });

            await page.screenshot({
                path: 'var/test-results/story-session-shell-first-startup-ux-pending-shell.png',
                fullPage: false
            });

            releaseWorktreeStartup();
            await expect.poll(() => sentInputs.length, { timeout: 10000 }).toBe(1);
            expect(sentInputs[0].url).toContain(`/api/sessions/${createPayload.sessionId}/input`);
            expect(sentInputs[0].body).toEqual({
                input: 'queued first prompt\n',
                type: 'text'
            });
        } finally {
            if (createPayload?.sessionId) {
                await request.delete(`${BASE_URL}/api/state/sessions/${encodeURIComponent(createPayload.sessionId)}`).catch(() => {});
            }
        }

    });

    test('AC: real create-session UI keeps failed startup prompt retryable', async ({ page, request }) => {
        // story-session-shell-first-startup-ux ac:5
        test.setTimeout(60000);
        const sessionName = `Failed Startup E2E ${Date.now()}`;
        const createAttempts = [];
        const sentInputs = [];
        let readyStateSession = null;
        let releaseRetryStartup;

        await page.route('**/api/sessions/*/progress?**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    phase: createAttempts.length > 1 ? 'worktree' : 'error',
                    percent: createAttempts.length > 1 ? 45 : 0,
                    message: createAttempts.length > 1 ? 'ワークスペースを再準備中...' : 'セッション作成に失敗',
                    timestamp: Date.now()
                })
            });
        });

        await page.route('**/api/sessions/create-with-worktree', async (route) => {
            const payload = route.request().postDataJSON();
            createAttempts.push(payload);

            if (createAttempts.length === 1) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'startup failed' })
                });
                return;
            }

            await new Promise((resolve) => {
                releaseRetryStartup = resolve;
            });
            const now = new Date().toISOString();
            const worktreePath = `/tmp/brainbase-e2e/${payload.sessionId}`;
            readyStateSession = {
                id: payload.sessionId,
                name: payload.name,
                project: payload.project,
                path: worktreePath,
                worktree: {
                    path: worktreePath,
                    repoPath: payload.repoPath,
                    branch: payload.sessionId
                },
                engine: payload.engine,
                initialCommand: '',
                intendedState: 'active',
                startupStatus: 'ready',
                startupPhase: 'done',
                startupMessage: '',
                updatedAt: now
            };
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    sessionId: payload.sessionId,
                    proxyPath: `/console/${payload.sessionId}`
                })
            });
        });

        await page.route(/\/api\/sessions\/[^/]+\/input$/, async (route) => {
            sentInputs.push({
                url: route.request().url(),
                body: route.request().postDataJSON()
            });
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true })
            });
        });

        const row = page.locator('.session-child-row').filter({
            has: page.locator('.session-name', { hasText: sessionName })
        }).first();

        try {
            await expect(page.locator('#session-list')).toBeVisible();
            await page.locator('#add-session-btn').click();
            await expect(page.locator('#create-session-modal')).toHaveClass(/active/);
            await page.locator('#session-name-input').fill(sessionName);
            await page.locator('#session-project-select').selectOption('brainbase');
            await page.locator('#session-command-input').fill('retry prompt');
            const useWorktreeCheckbox = page.locator('#use-worktree-checkbox');
            if (!(await useWorktreeCheckbox.isChecked())) {
                await useWorktreeCheckbox.check();
            }
            await page.locator('input[name="session-engine"][value="codex"]').check();
            await page.locator('#create-session-btn').click();

            await expect(row).toBeVisible({ timeout: 15000 });
            await expect.poll(() => createAttempts.length).toBe(1);
            const sessionId = createAttempts[0].sessionId;
            await expect(page.locator('#terminal-loading-overlay')).not.toHaveClass(/hidden/);
            await expect(page.locator('#session-startup-composer')).not.toHaveClass(/hidden/);
            await expect(page.locator('#session-startup-prompt-input')).toHaveValue('retry prompt');
            await expect(page.locator('#session-startup-prompt-send')).toBeEnabled();
            await expect.poll(async () => {
                return await page.evaluate(async (sessionId) => {
                    const { appStore } = await import('/modules/core/store.js');
                    const session = (appStore.getState().sessions || []).find((entry) => entry.id === sessionId);
                    if (session?.startupStatus === 'failed') return 'failed';
                    return window.brainbaseApp?._sessionStartupFailed?.has(sessionId) ? 'failed' : (session?.startupStatus || null);
                }, sessionId);
            }).toBe('failed');

            await setStartupPrompt(page, 'updated retry prompt');
            await page.route('**/api/state', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        sessions: readyStateSession ? [readyStateSession] : [],
                        testMode: false,
                        preferences: {}
                    })
                });
            });
            await page.locator('#session-startup-prompt-send').click();
            await expect.poll(() => createAttempts.length, { timeout: 10000 }).toBe(2);
            expect(sentInputs).toEqual([]);

            releaseRetryStartup();
            await expect.poll(() => sentInputs.length, { timeout: 10000 }).toBe(1);
            expect(sentInputs[0].url).toContain(`/api/sessions/${sessionId}/input`);
            expect(sentInputs[0].body).toEqual({
                input: 'updated retry prompt\n',
                type: 'text'
            });
        } finally {
            const sessionId = createAttempts[0]?.sessionId;
            if (sessionId) {
                await request.delete(`${BASE_URL}/api/state/sessions/${encodeURIComponent(sessionId)}`).catch(() => {});
            }
        }
    });

    test('AC: pending shell switch does not resolve runtime from canonical path', async ({ page }) => {
        // story-session-shell-first-startup-ux ac:6
        // story-session-shell-first-startup-ux ac:7
        const result = await page.evaluate(async () => {
            const { appStore } = await import('/modules/core/store.js');

            const fetchUrls = [];
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                fetchUrls.push(String(url));
                if (String(url).includes('/api/sessions/create-with-worktree')) {
                    return new Promise(() => {});
                }
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            };

            appStore.setState({
                currentSessionId: null,
                sessions: [{
                    id: 'session-pending-e2e',
                    name: 'Pending E2E',
                    project: 'brainbase',
                    path: '/Users/ksato/workspace/code/brainbase',
                    engine: 'codex',
                    intendedState: 'active',
                    startupStatus: 'pending',
                    startupMessage: 'ワークスペースを準備中...'
                }]
            });

            const app = window.brainbaseApp;
            let xtermConnectAttempts = 0;
            const originalShouldUseXterm = app._shouldUseXtermTransport;
            const originalConnectXterm = app._connectXtermTransport;
            app._shouldUseXtermTransport = () => true;
            app._connectXtermTransport = async (...args) => {
                xtermConnectAttempts += 1;
                return originalConnectXterm.apply(app, args);
            };
            const terminalFrame = document.getElementById('terminal-frame');
            if (terminalFrame) {
                terminalFrame.src = 'about:blank';
            }
            const switchResult = await app.switchSession('session-pending-e2e');
            await new Promise((resolve) => setTimeout(resolve, 50));
            app._shouldUseXtermTransport = originalShouldUseXterm;
            app._connectXtermTransport = originalConnectXterm;
            window.fetch = originalFetch;
            return {
                switchResult,
                fetchUrls,
                xtermConnectAttempts,
                terminalFrameSrc: document.getElementById('terminal-frame')?.getAttribute('src') || '',
                overlayVisible: !document.getElementById('terminal-loading-overlay')?.classList.contains('hidden'),
                composerVisible: !document.getElementById('session-startup-composer')?.classList.contains('hidden')
            };
        });

        expect(result.switchResult).toEqual({ ok: true, mode: 'startup_pending' });
        expect(result.fetchUrls.some((url) => url.includes('/runtime') || url.includes('/terminal/ensure') || url.includes('/content'))).toBe(false);
        expect(result.xtermConnectAttempts).toBe(0);
        expect(result.terminalFrameSrc).not.toContain('session-pending-e2e');
        expect(result.overlayVisible).toBe(true);
        expect(result.composerVisible).toBe(true);
    });

    test('AC: reload-resumed pending shell flushes restored queued prompt after startup becomes ready', async ({ page }) => {
        // story-session-shell-first-startup-ux ac:4
        // story-session-shell-first-startup-ux ac:5
        test.setTimeout(30000);
        const sessionId = 'session-resume-e2e';
        const sentInputs = [];
        const now = new Date().toISOString();
        const readySession = {
            id: sessionId,
            name: 'Resume E2E',
            project: 'brainbase',
            path: `/tmp/brainbase-e2e/${sessionId}`,
            engine: 'codex',
            intendedState: 'active',
            startupStatus: 'ready',
            startupPhase: 'done',
            startupMessage: '',
            updatedAt: now,
            worktree: {
                path: `/tmp/brainbase-e2e/${sessionId}`,
                repoPath: '/Users/ksato/workspace/code/brainbase',
                branch: sessionId
            }
        };

        await page.route('**/api/sessions/*/progress?**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    phase: 'done',
                    percent: 100,
                    message: 'セッション作成完了！',
                    timestamp: Date.now()
                })
            });
        });

        await page.route('**/api/state', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    sessions: [readySession],
                    testMode: false,
                    preferences: {}
                })
            });
        });

        await page.route(new RegExp(`/api/state/sessions/${sessionId}$`), async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, sessionId })
            });
        });

        await page.route(new RegExp(`/api/sessions/${sessionId}/input$`), async (route) => {
            sentInputs.push(route.request().postDataJSON());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true })
            });
        });

        const switchResult = await page.evaluate(async ({ sessionId }) => {
            const { appStore } = await import('/modules/core/store.js');
            window.localStorage.setItem(`brainbase:session-startup-prompt:${sessionId}`, JSON.stringify({
                draft: 'restored after reload',
                prompt: 'restored after reload',
                queued: true
            }));
            appStore.setState({
                currentSessionId: null,
                sessions: [{
                    id: sessionId,
                    name: 'Resume E2E',
                    project: 'brainbase',
                    path: '/Users/ksato/workspace/code/brainbase',
                    engine: 'codex',
                    intendedState: 'active',
                    startupStatus: 'pending',
                    startupMessage: 'ワークスペースを準備中...'
                }]
            });
            return await window.brainbaseApp.switchSession(sessionId);
        }, { sessionId });

        expect(switchResult).toEqual({ ok: true, mode: 'startup_pending' });
        await expect.poll(() => sentInputs.length, { timeout: 10000 }).toBe(1);
        expect(sentInputs[0]).toEqual({
            input: 'restored after reload\n',
            type: 'text'
        });
        await expect.poll(async () => (
            await page.evaluate((sessionId) => window.localStorage.getItem(`brainbase:session-startup-prompt:${sessionId}`), sessionId)
        )).toBeNull();
    });
});
