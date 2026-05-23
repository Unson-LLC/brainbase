import { expect, test } from '@playwright/test';

declare global {
    interface Window {
        __liveFeedStoryStatusFixture?: Record<string, unknown>;
        __liveFeedStorySessionsFixture?: unknown[];
        brainbaseApp?: {
            container?: unknown;
            mobileTabController?: {
                switchTab: (tab: string) => void;
                init?: () => void;
            };
        };
    }
}

test.describe('story-live-feed-activity-timeline', () => {
    test('Live Feed keeps stable row order while rendering current activity state', async ({ page }) => {
        const runtimeIssues: string[] = [];
        let statusFixture = {};
        let stateFixture = { sessions: [], currentSessionId: null, preferences: {}, testMode: false };
        page.on('console', (message) => {
            if (message.type() === 'error') {
                runtimeIssues.push(`console:${message.text()}`);
            }
        });
        page.on('pageerror', (error) => {
            runtimeIssues.push(`pageerror:${error.message}`);
        });
        page.on('requestfailed', (request) => {
            runtimeIssues.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
        });
        page.on('response', (response) => {
            const status = response.status();
            if (status >= 400) {
                runtimeIssues.push(`response:${status} ${response.url()}`);
            }
        });
        await page.route('**/api/auth/verify', async (route) => {
            if (route.request().method() !== 'GET') {
                runtimeIssues.push(`unexpected-method:${route.request().method()} ${route.request().url()}`);
                await route.fulfill({ status: 405 });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ authenticated: true })
            });
        });
        await page.route('**/api/sessions/status', async (route) => {
            if (route.request().method() !== 'GET') {
                runtimeIssues.push(`unexpected-method:${route.request().method()} ${route.request().url()}`);
                await route.fulfill({ status: 405 });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(statusFixture)
            });
        });
        await page.route('**/api/state', async (route) => {
            if (route.request().method() !== 'GET') {
                runtimeIssues.push(`unexpected-method:${route.request().method()} ${route.request().url()}`);
                await route.fulfill({ status: 405 });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(stateFixture)
            });
        });

        // story-live-feed-activity-timeline ac:1
        // story-live-feed-activity-timeline ac:2
        // story-live-feed-activity-timeline ac:3
        // story-live-feed-activity-timeline ac:4
        // story-live-feed-activity-timeline ac:5
        // story-live-feed-activity-timeline ac:6
        // story-live-feed-activity-timeline ac:7
        // story-live-feed-activity-timeline ac:8
        // story-live-feed-activity-timeline ac:9
        // story-live-feed-activity-timeline ac:10
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
            const [
                { appStore },
                sessionUiState
            ] = await Promise.all([
                import('/modules/core/store.js'),
                import('/modules/session-ui-state.js')
            ]);
            const {
                mergeSessionUiEntry,
                recordRecentFileOpen,
                replaceSessionHookStatuses,
                setSessionSummaryMap
            } = sessionUiState;

            appStore.setState({
                sessions: [
                    {
                        id: 'session-alpha',
                        name: 'Alpha',
                        intendedState: 'active',
                        runtimeStatus: { ttydRunning: true }
                    },
                    {
                        id: 'session-beta',
                        name: 'Beta',
                        intendedState: 'active',
                        taskBrief: 'Wikiの表示順を確認する',
                        taskBriefUpdatedAt: new Date(now - 120000).toISOString(),
                        runtimeStatus: { ttydRunning: true }
                    },
                    {
                        id: 'session-gamma',
                        name: 'Gamma',
                        intendedState: 'active',
                        runtimeStatus: { ttydRunning: false }
                    },
                    {
                        id: 'session-archived',
                        name: 'Archived',
                        intendedState: 'archived',
                        runtimeStatus: { ttydRunning: false }
                    }
                ],
                currentSessionId: null,
                sessionUi: { byId: {} }
            });

            replaceSessionHookStatuses({
                'session-alpha': {
                    isWorking: true,
                    isDone: false,
                    lastWorkingAt: now - 60000,
                    lastActivityAt: now - 60000,
                    lastDoneAt: 0,
                    activeTurnCount: 1,
                    liveActivity: {
                        activityKind: 'running_command',
                        assistantSnippet: 'Live Feedの安定表示を検証しています',
                        assistantSnippetUpdatedAt: now - 60000,
                        updatedAt: now - 60000,
                        statusTone: 'working'
                    }
                },
                'session-beta': {
                    isWorking: false,
                    isDone: false,
                    lastWorkingAt: 0,
                    lastActivityAt: now - 120000,
                    lastDoneAt: 0,
                    activeTurnCount: 0,
                    liveActivity: {
                        activityKind: 'waiting_input',
                        assistantSnippet: null,
                        assistantSnippetUpdatedAt: 0,
                        currentStep: '入力待ち',
                        latestEvidence: '',
                        updatedAt: now - 120000,
                        statusTone: 'waiting'
                    }
                },
                'session-gamma': {
                    isWorking: true,
                    isDone: false,
                    lastWorkingAt: now - 240000,
                    lastActivityAt: now - 240000,
                    lastDoneAt: 0,
                    activeTurnCount: 1,
                    liveActivity: {
                        activityKind: 'running_command',
                        assistantSnippet: '古い作業状態です',
                        assistantSnippetUpdatedAt: now - 240000,
                        updatedAt: now - 240000,
                        statusTone: 'working'
                    }
                }
            });
            window.__liveFeedStoryStatusFixture = appStore.getState().sessionUi.byId;
            window.__liveFeedStorySessionsFixture = appStore.getState().sessions;
            setSessionSummaryMap({
                'session-alpha': { repo: 'brainbase', baseBranch: 'develop' },
                'session-beta': { repo: 'brainbase', baseBranch: 'develop' },
                'session-gamma': { repo: 'brainbase', baseBranch: 'develop' }
            });

            document.querySelector<HTMLButtonElement>('.info-drawer-tab[data-tab="live-feed"]')?.click();
            const host = document.getElementById('live-feed-panel');
            if (!host) {
                throw new Error('production live-feed-panel not found');
            }

            const labels = () => Array.from(host.querySelectorAll('.feed-item-label')).map((node) => node.textContent || '');
            const tones = () => Array.from(host.querySelectorAll('.feed-item')).map((node) => node.getAttribute('data-tone') || '');
            const initialLabels = labels();
            const initialTones = tones();
            const hasLiveChrome = Boolean(
                host.querySelector('.live-feed-status.active')
                    && host.querySelector('.live-feed-filter-group')
                    && host.querySelector('.feed-item-actions')
                    && host.querySelector('.live-feed-footer')
            );
            const archivedVisible = host.textContent?.includes('Archived') || false;

            const betaBefore = appStore.getState().sessionUi.byId['session-beta']?.hookStatus;
            replaceSessionHookStatuses({
                'session-alpha': appStore.getState().sessionUi.byId['session-alpha']?.hookStatus,
                'session-beta': {
                    ...betaBefore,
                    lastActivityAt: now,
                    liveActivity: {
                        ...betaBefore?.liveActivity,
                        assistantSnippet: '入力待ちの補足だけが更新されました',
                        assistantSnippetUpdatedAt: now,
                        updatedAt: now
                    }
                },
                'session-gamma': appStore.getState().sessionUi.byId['session-gamma']?.hookStatus
            });
            recordRecentFileOpen('session-beta', 'docs/live-feed.md');
            const labelsAfterContentOnlyUpdate = labels();
            const betaTextUpdated = host.textContent?.includes('入力待ちの補足だけが更新されました') || false;

            mergeSessionUiEntry('session-beta', { attention: 'needs-input' });
            replaceSessionHookStatuses({
                'session-alpha': appStore.getState().sessionUi.byId['session-alpha']?.hookStatus,
                'session-beta': {
                    isWorking: true,
                    isDone: false,
                    lastWorkingAt: now + 1000,
                    lastActivityAt: now + 1000,
                    lastDoneAt: 0,
                    activeTurnCount: 1,
                    liveActivity: {
                        activityKind: 'editing_file',
                        assistantSnippet: '意味のある作業遷移として先頭に移動します',
                        assistantSnippetUpdatedAt: now + 1000,
                        updatedAt: now + 1000,
                        statusTone: 'working'
                    }
                },
                'session-gamma': appStore.getState().sessionUi.byId['session-gamma']?.hookStatus
            });
            const labelsAfterMeaningfulTransition = labels();

            const counts = Array.from(host.querySelectorAll('.feed-filter-count')).map((node) => node.textContent || '');
            const actionsDisabled = Array.from(host.querySelectorAll<HTMLButtonElement>('.feed-item-action'))
                .every((button) => button.disabled && button.getAttribute('aria-disabled') === 'true');
            const controlsDisabled = Array.from(host.querySelectorAll<HTMLButtonElement>('.feed-control-btn'))
                .every((button) => button.disabled && button.getAttribute('aria-disabled') === 'true');
            host.querySelector<HTMLButtonElement>('.feed-filter-btn[data-filter="system"]')?.click();
            const systemLabels = labels();
            const footerText = host.querySelector('.live-feed-footer')?.textContent || '';
            host.querySelector<HTMLButtonElement>('.feed-filter-btn[data-filter="all"]')?.click();

            return {
                initialLabels,
                initialTones,
                hasLiveChrome,
                archivedVisible,
                labelsAfterContentOnlyUpdate,
                betaTextUpdated,
                labelsAfterMeaningfulTransition,
                counts,
                actionsDisabled,
                controlsDisabled,
                systemLabels,
                footerText,
                actionCount: host.querySelectorAll('.feed-item-action').length,
                drawerOpen: document.getElementById('info-drawer')?.classList.contains('open') || false,
                liveFeedTabActive: document.querySelector('.info-drawer-tab[data-tab="live-feed"]')?.classList.contains('active') || false
            };
        });
        statusFixture = await page.evaluate(() => {
            const state = window.__liveFeedStoryStatusFixture || {};
            return Object.fromEntries(
                Object.entries(state).map(([sessionId, entry]) => [sessionId, entry?.hookStatus || {}])
            );
        });
        stateFixture = await page.evaluate(() => ({
            sessions: window.__liveFeedStorySessionsFixture || [],
            currentSessionId: null,
            preferences: {},
            testMode: false
        }));

        expect(result.hasLiveChrome).toBe(true);
        expect(result.drawerOpen).toBe(true);
        expect(result.liveFeedTabActive).toBe(true);
        expect(result.archivedVisible).toBe(false);
        expect(result.initialLabels).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(result.initialTones).toEqual(['working', 'waiting', 'blocked']);
        expect(result.labelsAfterContentOnlyUpdate).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(result.betaTextUpdated).toBe(true);
        expect(result.labelsAfterMeaningfulTransition).toEqual(['Beta', 'Alpha', 'Gamma']);
        expect(result.counts.length).toBe(5);
        expect(result.actionsDisabled).toBe(true);
        expect(result.controlsDisabled).toBe(true);
        expect(result.systemLabels).toEqual(['Gamma']);
        expect(result.footerText).toContain('表示: システム');
        expect(result.actionCount).toBeGreaterThan(0);
        const desktopFooterClear = await page.evaluate(() => {
            const footerDisplay = document.querySelector('#live-feed-panel .live-feed-footer span:last-child')?.getBoundingClientRect();
            const widget = document.querySelector('.mana-chat-widget')?.getBoundingClientRect();
            if (!footerDisplay || !widget) return true;
            return footerDisplay.right <= widget.left || footerDisplay.bottom <= widget.top || footerDisplay.top >= widget.bottom;
        });
        expect(desktopFooterClear).toBe(true);
        await page.waitForTimeout(500);
        await expect(page.locator('#live-feed-panel .feed-item-label')).toHaveCount(3);
        await expect(page.locator('#live-feed-panel')).toContainText('Alpha');
        await expect(page.locator('#live-feed-panel')).toContainText('Beta');
        await expect(page.locator('#live-feed-panel')).toContainText('Gamma');
        await page.locator('#live-feed-panel').screenshot({
            path: 'var/test-results/story-live-feed-activity-timeline-live-feed.png'
        });

        const systemSurface = await page.evaluate(() => {
            const host = document.getElementById('live-feed-panel');
            host?.querySelector<HTMLButtonElement>('.feed-filter-btn[data-filter="system"]')?.click();
            return {
                labels: Array.from(host?.querySelectorAll('.feed-item-label') || []).map((node) => node.textContent || ''),
                footerText: host?.querySelector('.live-feed-footer')?.textContent || ''
            };
        });
        expect(systemSurface.labels.length).toBeGreaterThan(0);
        expect(systemSurface.footerText).toContain('表示: システム');
        await page.locator('#live-feed-panel').screenshot({
            path: 'var/test-results/story-live-feed-activity-timeline-system-filter.png'
        });
        await page.locator('#live-feed-panel .feed-filter-btn[data-filter="all"]').click();
        await expect(page.locator('#live-feed-panel .feed-item-label')).toHaveCount(3);
        const desktopLabelsBeforeMobile = await page.locator('#live-feed-panel .feed-item-label').allTextContents();

        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(async () => {
            if (!window.brainbaseApp?.mobileTabController && window.brainbaseApp?.container) {
                const { MobileTabController } = await import('/modules/ui/mobile-tab-controller.js');
                window.brainbaseApp.mobileTabController = new MobileTabController({
                    container: window.brainbaseApp.container
                });
                window.brainbaseApp.mobileTabController.init?.();
            }
            window.brainbaseApp?.mobileTabController?.switchTab('feed');
        });
        await page.locator('#mobile-tab-content-feed .live-feed-container').waitFor({ state: 'visible' });
        const mobileSurface = await page.evaluate(() => {
            const host = document.getElementById('mobile-tab-content-feed');
            const actions = Array.from(host?.querySelectorAll<HTMLElement>('.feed-item-actions') || []);
            const visibleActions = actions.filter((node) => {
                const style = window.getComputedStyle(node);
                return style.display !== 'none' && style.visibility !== 'hidden';
            });
            return {
                mounted: Boolean(host?.querySelector('.live-feed-container')),
                labels: Array.from(host?.querySelectorAll('.feed-item-label') || []).map((node) => node.textContent || ''),
                visibleActionCount: visibleActions.length,
                footerText: host?.querySelector('.live-feed-footer')?.textContent || '',
                footerBottom: host?.querySelector('.live-feed-footer')?.getBoundingClientRect().bottom || 0
            };
        });
        expect(mobileSurface.mounted).toBe(true);
        expect(mobileSurface.labels).toEqual(desktopLabelsBeforeMobile);
        expect(mobileSurface.visibleActionCount).toBe(0);
        expect(mobileSurface.footerText).toContain('表示: すべて');
        expect(mobileSurface.footerBottom).toBeLessThan(800);
        await page.locator('#mobile-tab-content-feed').screenshot({
            path: 'var/test-results/story-live-feed-activity-timeline-mobile.png'
        });
        expect(runtimeIssues).toEqual([]);
    });
});
