import { expect, test } from '@playwright/test';

declare global {
    interface Window {
        brainbaseApp?: {
            container?: unknown;
        };
    }
}

test.describe('story-live-feed-agent-activity-history', () => {
    test('Live Feed shows low-cost prompt and agent activity history with session focus', async ({ page }) => {
        const runtimeIssues: string[] = [];
        const now = Date.now();
        const sessions = [
            {
                id: 'session-alpha-history',
                name: 'Alpha History',
                intendedState: 'active',
                runtimeStatus: { ttydRunning: true },
                activityHistory: [
                    {
                        id: 'alpha-startup',
                        actor: 'user',
                        kind: 'startup_prompt',
                        text: 'Live Feedでこのセッションに何を頼んだか一覧で見たい',
                        textSource: 'raw_prompt',
                        evidenceSource: 'session_initial_command',
                        occurredAt: new Date(now - 240000).toISOString(),
                        dedupeKey: 'alpha-startup'
                    },
                    {
                        id: 'alpha-prompt',
                        actor: 'user',
                        kind: 'user_prompt',
                        text: 'LLMを常時使わずに活動履歴を作って',
                        textSource: 'raw_prompt',
                        evidenceSource: 'terminal_input',
                        occurredAt: new Date(now - 120000).toISOString(),
                        dedupeKey: 'alpha-prompt'
                    }
                ]
            },
            {
                id: 'session-beta-history',
                name: 'Beta History',
                intendedState: 'active',
                runtimeStatus: { ttydRunning: true },
                activityHistory: [
                    {
                        id: 'beta-prompt',
                        actor: 'user',
                        kind: 'user_prompt',
                        text: '全体のエージェント作業順序も見たい',
                        textSource: 'raw_prompt',
                        evidenceSource: 'terminal_input',
                        occurredAt: new Date(now - 90000).toISOString(),
                        dedupeKey: 'beta-prompt'
                    }
                ]
            }
        ];
        page.on('console', (message) => {
            if (message.type() === 'error') runtimeIssues.push(`console:${message.text()}`);
        });
        page.on('pageerror', (error) => runtimeIssues.push(`pageerror:${error.message}`));
        page.on('requestfailed', (request) => {
            runtimeIssues.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
        });
        page.on('response', (response) => {
            if (response.status() >= 400) runtimeIssues.push(`response:${response.status()} ${response.url()}`);
        });

        await page.route('**/api/auth/verify', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ authenticated: true })
            });
        });
        await page.route('**/api/sessions/status', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({})
            });
        });
        await page.route('**/api/sessions/*/runtime**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ port: 31991, proxyPath: '/console/mock-session/' })
            });
        });
        await page.route('**/api/sessions/*/context**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ context: null })
            });
        });
        await page.route('**/api/sessions/*/terminal/snapshot**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ text: '', lines: [], cursor: null })
            });
        });
        await page.route('**/api/sessions/*/terminal/ensure**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, proxyPath: '/console/mock-session/' })
            });
        });
        await page.route('**/api/state/sessions/*', async (route) => {
            if (route.request().method() === 'PATCH') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(sessions.find((session) => route.request().url().includes(session.id)) || sessions[0])
                });
                return;
            }
            await route.fallback();
        });
        await page.route('**/api/state', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ sessions, currentSessionId: null, preferences: {}, testMode: false })
            });
        });
        await page.route('**/console/mock-session/**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><html><body><div id="terminal">mock terminal</div></body></html>'
            });
        });

        // story-live-feed-agent-activity-history ac:1
        // story-live-feed-agent-activity-history ac:2
        // story-live-feed-agent-activity-history ac:3
        // story-live-feed-agent-activity-history ac:4
        // story-live-feed-agent-activity-history ac:5
        // story-live-feed-agent-activity-history ac:6
        // story-live-feed-agent-activity-history ac:7
        // story-live-feed-agent-activity-history ac:8
        // story-live-feed-agent-activity-history ac:9
        // story-live-feed-agent-activity-history ac:10
        // story-live-feed-agent-activity-history ac:11
        // story-live-feed-agent-activity-history ac:12
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => window.brainbaseApp !== undefined);
        await page.waitForFunction(() => {
            const splash = document.getElementById('app-loading-splash');
            if (!splash) return true;
            const style = window.getComputedStyle(splash);
            return splash.classList.contains('hidden') || style.pointerEvents === 'none';
        });

        const result = await page.evaluate(async () => {
            const now = Date.now();
            const [{ appStore }, sessionUiState] = await Promise.all([
                import('/modules/core/store.js'),
                import('/modules/session-ui-state.js')
            ]);
            const { replaceSessionHookStatuses } = sessionUiState;

            appStore.setState({
                sessions: [
                    {
                        id: 'session-alpha-history',
                        name: 'Alpha History',
                        intendedState: 'active',
                        runtimeStatus: { ttydRunning: true },
                        activityHistory: [
                            {
                                id: 'alpha-startup',
                                actor: 'user',
                                kind: 'startup_prompt',
                                text: 'Live Feedでこのセッションに何を頼んだか一覧で見たい',
                                textSource: 'raw_prompt',
                                evidenceSource: 'session_initial_command',
                                occurredAt: new Date(now - 240000).toISOString(),
                                dedupeKey: 'alpha-startup'
                            },
                            {
                                id: 'alpha-prompt',
                                actor: 'user',
                                kind: 'user_prompt',
                                text: 'LLMを常時使わずに活動履歴を作って',
                                textSource: 'raw_prompt',
                                evidenceSource: 'terminal_input',
                                occurredAt: new Date(now - 120000).toISOString(),
                                dedupeKey: 'alpha-prompt'
                            }
                        ]
                    },
                    {
                        id: 'session-beta-history',
                        name: 'Beta History',
                        intendedState: 'active',
                        runtimeStatus: { ttydRunning: true },
                        activityHistory: [
                            {
                                id: 'beta-prompt',
                                actor: 'user',
                                kind: 'user_prompt',
                                text: '全体のエージェント作業順序も見たい',
                                textSource: 'raw_prompt',
                                evidenceSource: 'terminal_input',
                                occurredAt: new Date(now - 90000).toISOString(),
                                dedupeKey: 'beta-prompt'
                            }
                        ]
                    }
                ],
                currentSessionId: null,
                sessionUi: { byId: {} }
            });

            replaceSessionHookStatuses({
                'session-alpha-history': {
                    isWorking: true,
                    isDone: false,
                    lastWorkingAt: now - 60000,
                    lastActivityAt: now - 60000,
                    lastDoneAt: 0,
                    activeTurnCount: 1,
                    liveActivity: {
                        activityKind: 'editing_file',
                        currentStep: 'ActivityHistoryRepositoryを実装中',
                        latestEvidence: 'public/modules/domain/live-feed/live-feed-service.js',
                        updatedAt: now - 60000,
                        statusTone: 'working'
                    }
                },
                'session-beta-history': {
                    isWorking: false,
                    isDone: false,
                    lastWorkingAt: 0,
                    lastActivityAt: now - 30000,
                    lastDoneAt: 0,
                    activeTurnCount: 0,
                    liveActivity: {
                        activityKind: 'waiting_input',
                        currentStep: '入力待ち',
                        updatedAt: now - 30000,
                        statusTone: 'waiting'
                    }
                }
            });

            document.querySelector<HTMLButtonElement>('.info-drawer-tab[data-tab="live-feed"]')?.click();
            const host = document.getElementById('live-feed-panel');
            if (!host) throw new Error('live-feed-panel not found');

            const text = host.textContent || '';
            const historyTexts = Array.from(host.querySelectorAll('.feed-item-history-text')).map((node) => node.textContent || '');
            const sources = Array.from(host.querySelectorAll('.feed-item-source')).map((node) => node.textContent || '');
            const labels = Array.from(host.querySelectorAll('.feed-item-label')).map((node) => node.textContent || '');
            const modelSummaryVisible = text.includes('generated summary') || text.includes('生成要約');
            const sessionChips = Array.from(host.querySelectorAll('.feed-session-chip')).map((node) => node.textContent || '');
            const defaultGroupIds = Array.from(host.querySelectorAll('.feed-session-section')).map((node) => node.getAttribute('data-session-id') || '');

            replaceSessionHookStatuses({
                'session-alpha-history': {
                    isWorking: true,
                    isDone: false,
                    lastWorkingAt: now - 60000,
                    lastActivityAt: now - 60000,
                    lastDoneAt: 0,
                    activeTurnCount: 1,
                    liveActivity: {
                        activityKind: 'editing_file',
                        currentStep: 'ActivityHistoryRepositoryを実装中',
                        latestEvidence: 'public/modules/domain/live-feed/live-feed-service.js',
                        updatedAt: now - 60000,
                        statusTone: 'working'
                    }
                },
                'session-beta-history': {
                    isWorking: false,
                    isDone: false,
                    lastWorkingAt: 0,
                    lastActivityAt: now + 30000,
                    lastDoneAt: 0,
                    activeTurnCount: 0,
                    liveActivity: {
                        activityKind: 'waiting_input',
                        currentStep: '入力待ち',
                        updatedAt: now + 30000,
                        statusTone: 'waiting'
                    }
                }
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            const afterHeartbeatGroupIds = Array.from(host.querySelectorAll('.feed-session-section')).map((node) => node.getAttribute('data-session-id') || '');

            host.querySelector<HTMLButtonElement>('.feed-view-mode-btn[data-feed-mode="log"]')?.click();
            const logModeLabels = Array.from(host.querySelectorAll('.feed-item-label')).map((node) => node.textContent || '');
            const logModeHasGroups = host.querySelectorAll('.feed-session-section').length > 0;

            host.querySelector<HTMLButtonElement>('.feed-session-chip[data-session-scope="session-alpha-history"]')?.click();
            const focusedText = host.textContent || '';
            const focusedLabels = Array.from(host.querySelectorAll('.feed-item-label')).map((node) => node.textContent || '');
            const focusedFooter = host.querySelector('.live-feed-footer')?.textContent || '';

            return {
                text,
                historyTexts,
                sources,
                labels,
                modelSummaryVisible,
                sessionChips,
                defaultGroupIds,
                afterHeartbeatGroupIds,
                logModeLabels,
                logModeHasGroups,
                focusedText,
                focusedLabels,
                focusedFooter,
                itemCount: host.querySelectorAll('.feed-item').length,
                sourceCount: host.querySelectorAll('.feed-item-source').length,
                drawerOpen: document.getElementById('info-drawer')?.classList.contains('open') || false
            };
        });

        expect(result.drawerOpen).toBe(true);
        expect(result.labels).toContain('Alpha History');
        expect(result.labels).toContain('Beta History');
        expect(result.historyTexts).toEqual(expect.arrayContaining([
            'Live Feedでこのセッションに何を頼んだか一覧で見たい',
            'LLMを常時使わずに活動履歴を作って',
            '全体のエージェント作業順序も見たい',
            'ActivityHistoryRepositoryを実装中',
            '入力待ち'
        ]));
        expect(result.sources).toContain('raw prompt');
        expect(result.sources).toContain('structured activity');
        expect(result.modelSummaryVisible).toBe(false);
        expect(result.sessionChips).toEqual(expect.arrayContaining(['全体', 'Alpha History', 'Beta History']));
        expect(result.defaultGroupIds).toEqual(['session-alpha-history', 'session-beta-history']);
        expect(result.afterHeartbeatGroupIds).toEqual(['session-alpha-history', 'session-beta-history']);
        expect(result.logModeHasGroups).toBe(false);
        expect(result.logModeLabels[0]).toBe('Beta History');
        expect(result.focusedLabels.every((label) => label === 'Alpha History')).toBe(true);
        expect(result.focusedText).toContain('LLMを常時使わずに活動履歴を作って');
        expect(result.focusedText).not.toContain('全体のエージェント作業順序も見たい');
        expect(result.focusedFooter).toContain('表示: セッション履歴');
        expect(result.itemCount).toBeGreaterThanOrEqual(3);
        expect(result.sourceCount).toBeGreaterThanOrEqual(3);
        expect(runtimeIssues).toEqual([]);

        await expect(page.locator('#live-feed-panel .feed-item-history-text', {
            hasText: 'LLMを常時使わずに活動履歴を作って'
        })).toBeVisible();
        await expect(page.locator('#live-feed-panel .feed-item-source', {
            hasText: 'raw prompt'
        }).first()).toBeVisible();
        await expect(page.locator('#live-feed-panel .live-feed-footer')).toContainText('表示: セッション履歴');

        await page.locator('#live-feed-panel').screenshot({
            path: 'var/test-results/story-live-feed-agent-activity-history.png'
        });
    });
});
