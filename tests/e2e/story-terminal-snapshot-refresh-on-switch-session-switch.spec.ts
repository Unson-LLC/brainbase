import { test, expect } from '@playwright/test';

test.describe('story-terminal-snapshot-refresh-on-switch', () => {
    test('session switch replaces cached terminal snapshot with fresh capture', async ({ page }) => {
        // story-terminal-snapshot-refresh-on-switch ac:1
        // story-terminal-snapshot-refresh-on-switch ac:2
        // story-terminal-snapshot-refresh-on-switch ac:3
        // story-terminal-snapshot-refresh-on-switch ac:4
        await page.addInitScript(() => {
            window.__BRAINBASE_TEST__ = true;
        });
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');
        await page.waitForSelector('#terminal-snapshot-panel', { state: 'attached', timeout: 15000 });

        const result = await page.evaluate(async () => {
            const [{ createApp }, { appStore }, { httpClient }] = await Promise.all([
                import('/app.js'),
                import('/modules/core/store.js'),
                import('/modules/core/http-client.js')
            ]);
            const app = createApp();
            app.reconnectManager = { setCurrentSession() {} };
            app._shouldUseXtermTransport = () => true;
            app.terminalXtermHost = document.getElementById('terminal-xterm-host');
            app.terminalFrame = document.getElementById('terminal-frame');
            app.terminalTransportClient = {
                show() {},
                disconnect() {},
                hide() {},
                destroy() {},
                isActiveForSession() { return false; }
            };
            app._connectXtermTransport = async () => ({ ok: true });
            app.focusTerminal = () => {};

            const snapshotUrls = [];
            httpClient.get = async (url) => {
                if (url.includes('/terminal/snapshot')) {
                    snapshotUrls.push(url);
                    return {
                        text: 'fresh snapshot from e2e',
                        colorText: null,
                        capturedAt: '2026-05-19T00:00:03.000Z',
                        mode: 'fast'
                    };
                }
                if (url.includes('/runtime')) {
                    return {
                        runtimeStatus: { ttydRunning: false, proxyPath: null },
                        terminalAccess: {
                            state: 'owner',
                            ownerViewerLabel: 'Local / Mac',
                            ownerLastSeenAt: null,
                            canTakeover: false
                        }
                    };
                }
                return {};
            };
            httpClient.patch = async () => ({ ok: true });

            appStore.setState({
                currentSessionId: 'session-previous',
                sessions: [
                    {
                        id: 'session-previous',
                        name: 'Previous Session',
                        path: '/tmp/session-previous',
                        engine: 'codex',
                        intendedState: 'active'
                    },
                    {
                        id: 'session-1',
                        name: 'Session 1',
                        path: '/tmp/session-1',
                        engine: 'codex',
                        intendedState: 'active'
                    }
                ]
            });
            app._terminalSnapshotCache.set('session-1', {
                text: 'old cached snapshot',
                colorText: null,
                capturedAt: '2026-05-19T00:00:00.000Z',
                mode: 'fast'
            });
            document.getElementById('console-area')?.classList.add('using-xterm');
            document.getElementById('terminal-xterm-host')?.classList.remove('hidden');

            await app.switchSession('session-1');
            await new Promise((resolve) => setTimeout(resolve, 0));

            return {
                snapshotUrls,
                cachedSnapshot: app._terminalSnapshotCache.get('session-1')
            };
        });

        expect(result.snapshotUrls.length).toBeGreaterThan(0);
        expect(result.snapshotUrls[0]).toContain('/api/sessions/session-1/terminal/snapshot');
        expect(result.snapshotUrls[0]).toContain('mode=fast');
        expect(result.cachedSnapshot).toMatchObject({
            text: 'fresh snapshot from e2e',
            mode: 'fast'
        });
    });
});
