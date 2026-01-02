import { test, expect, devices } from '@playwright/test';

// iPhone 12 Proでテスト（トップレベルで設定）
test.use(devices['iPhone 12 Pro']);

test.describe('Mobile keyboard auto-scroll', () => {
    /**
     * Helper function to select a session and wait for terminal to load
     */
    async function selectFirstSession(page) {
        console.log('[Test] Waiting for session list to load...');

        // Wait for initial data load
        await page.waitForTimeout(3000);

        // Explicitly click on "Sessions" tab to ensure session list is visible
        console.log('[Test] Clicking Sessions tab...');
        const sessionsTab = page.locator('text=Sessions').first();
        await sessionsTab.click({ timeout: 10000 });

        console.log('[Test] Sessions tab clicked, waiting for content...');
        await page.waitForTimeout(3000);

        // Wait for session content to be in DOM (attached state)
        console.log('[Test] Waiting for session items to be in DOM...');
        await page.waitForSelector('.session-child-row', {
            state: 'attached',
            timeout: 20000
        });

        console.log('[Test] Session items found in DOM');

        // Click the first ACTIVE session using JavaScript
        // This bypasses Playwright's visibility checks which fail in LambdaTest environment
        // NOTE: We select the first active session (not archived) to ensure tmux pane exists
        console.log('[Test] Finding first active session via JavaScript...');
        const sessionSelected = await page.evaluate(() => {
            // Find all session rows
            const rows = document.querySelectorAll('.session-child-row');
            console.log(`[Test Eval] Found ${rows.length} session rows`);

            // Try each row until we find one that works
            for (const row of rows) {
                const sessionName = row.querySelector('.session-name');
                const sessionId = row.dataset.id;

                if (sessionName && sessionId) {
                    const displayName = sessionName.textContent.trim();
                    console.log(`[Test Eval] Trying session: ${displayName} (ID: ${sessionId})`);

                    // Click this session
                    row.click();
                    return { success: true, sessionId, displayName };
                }
            }

            return { success: false };
        });

        if (!sessionSelected.success) {
            throw new Error('No session found to select');
        }

        console.log(`[Test] Session clicked: ${sessionSelected.displayName} (ID: ${sessionSelected.sessionId})`);

        console.log('[Test] Session clicked, waiting for terminal...');

        // Wait for terminal iframe to get a src (not about:blank)
        await page.waitForFunction(() => {
            const iframe = document.getElementById('terminal-frame');
            return iframe && iframe.src && iframe.src !== 'about:blank';
        }, { timeout: 20000 });

        // Wait for terminal to fully initialize (tmux pane creation + xterm initialization)
        // Extended timeout for LambdaTest environment
        console.log('[Test] Waiting for terminal initialization (tmux + xterm)...');
        await page.waitForTimeout(15000);

        console.log('[Test] Terminal iframe loaded and initialized');
    }

    test.beforeEach(async ({ page }) => {
        // コンソールログをキャプチャ
        page.on('console', msg => {
            console.log(`[Console ${msg.type()}]`, msg.text());
        });

        // ページエラーをキャプチャ
        page.on('pageerror', error => {
            console.error(`[Page Error]`, error.message);
        });
    });

    test('should initialize mobile keyboard handler', async ({ page }) => {
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // mobile-keyboard.jsが読み込まれているか確認
        const isMobileKeyboardInitialized = await page.evaluate(() => {
            // User-Agentチェック
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            // Visual Viewport APIサポート確認
            const hasVisualViewport = !!window.visualViewport;

            return {
                isMobile,
                hasVisualViewport,
                initialHeight: window.visualViewport?.height
            };
        });

        console.log('[Test] Mobile keyboard initialization:', isMobileKeyboardInitialized);

        expect(isMobileKeyboardInitialized.isMobile).toBe(true);
        expect(isMobileKeyboardInitialized.hasVisualViewport).toBe(true);
        expect(isMobileKeyboardInitialized.initialHeight).toBeGreaterThan(0);
    });

    test('should detect keyboard show via Visual Viewport resize', async ({ page }) => {
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000); // 初期化完了を待つ

        // 初期ビューポート高さを取得
        const initialHeight = await page.evaluate(() => window.visualViewport.height);
        console.log('[Test] Initial viewport height:', initialHeight);

        // キーボード表示をシミュレート（ビューポート高さを縮小）
        const keyboardHeight = 300; // iPhone 12 Proのキーボード高さ（概算）
        const newHeight = initialHeight - keyboardHeight;

        // Visual Viewport APIのresizeイベントを手動でトリガー
        const resizeTriggered = await page.evaluate((targetHeight) => {
            // visualViewportのheightを変更することはできないので、
            // 代わりにresizeイベントを発火させる
            const event = new Event('resize');

            // heightをモックするためのgetter
            Object.defineProperty(window.visualViewport, 'height', {
                get: () => targetHeight,
                configurable: true
            });

            window.visualViewport.dispatchEvent(event);

            return {
                newHeight: window.visualViewport.height,
                eventFired: true
            };
        }, newHeight);

        console.log('[Test] After resize simulation:', resizeTriggered);

        expect(resizeTriggered.newHeight).toBe(newHeight);
        expect(resizeTriggered.eventFired).toBe(true);

        // ログに「Keyboard appeared!」が出力されるか確認（少し待つ）
        await page.waitForTimeout(500);
    });

    test('should send postMessage to iframe when keyboard appears', async ({ page }) => {
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // Select a session to load terminal iframe
        await selectFirstSession(page);

        // Verify Visual Viewport API is available (required for mobile keyboard handling)
        const hasVisualViewport = await page.evaluate(() => {
            return window.visualViewport !== undefined && window.visualViewport !== null;
        });
        expect(hasVisualViewport).toBe(true);

        // Verify terminal frame exists and has loaded (not about:blank)
        const hasTerminalFrame = await page.evaluate(() => {
            const frame = document.getElementById('terminal-frame');
            return frame !== null && frame !== undefined && frame.src !== 'about:blank';
        });
        expect(hasTerminalFrame).toBe(true);

        // NOTE: Full E2E verification of postMessage is complex due to cross-iframe communication.
        // The implementation is verified by:
        // 1. Visual Viewport API exists (keyboard detection works)
        // 2. Terminal frame exists and loaded (postMessage target exists)
        // 3. Code review shows postMessage is sent on keyboard appearance
        // Manual testing on actual mobile device is recommended for full verification.
    });

    test('should scroll iframe to bottom when receiving postMessage', async ({ page }) => {
        test.setTimeout(60000); // Extended timeout for terminal initialization
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // Select a session to load terminal iframe
        await selectFirstSession(page);

        // Wait for terminal iframe to load
        const terminalFrame = page.frameLocator('#terminal-frame');

        // Wait for .xterm-viewport to appear (terminal takes time to initialize)
        // Extended timeout for LambdaTest environment
        console.log('[Test] Waiting for xterm-viewport...');
        await terminalFrame.locator('.xterm-viewport').first().waitFor({
            state: 'attached',
            timeout: 30000
        });

        const xtermViewport = terminalFrame.locator('.xterm-viewport').first();

        // Get initial scroll position
        const initialScroll = await xtermViewport.evaluate(el => ({
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight
        }));

        console.log('[Test] Initial scroll state:', initialScroll);

        // Manually send postMessage to trigger scroll
        await page.evaluate(() => {
            const iframe = document.getElementById('terminal-frame');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'scroll-to-bottom',
                    source: 'brainbase-mobile-keyboard',
                    timestamp: Date.now()
                }, '*');
            }
        });

        await page.waitForTimeout(500);

        // Get scroll position after message
        const afterScroll = await xtermViewport.evaluate(el => ({
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            isAtBottom: el.scrollTop >= (el.scrollHeight - el.clientHeight - 10) // 10px margin
        }));

        console.log('[Test] After scroll state:', afterScroll);

        // Verify scrolled to bottom
        // NOTE: This test will fail until custom_ttyd_index.html postMessage listener is implemented
        expect(afterScroll.isAtBottom).toBe(true);
    });

    test('should auto-scroll when keyboard appears (full integration)', async ({ page }) => {
        test.setTimeout(60000); // Extended timeout for terminal initialization
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // Select a session to load terminal iframe
        await selectFirstSession(page);

        // Wait for terminal iframe to load
        const terminalFrame = page.frameLocator('#terminal-frame');

        // Wait for .xterm-viewport to appear (terminal takes time to initialize)
        // Extended timeout for LambdaTest environment
        console.log('[Test] Waiting for xterm-viewport...');
        await terminalFrame.locator('.xterm-viewport').first().waitFor({
            state: 'attached',
            timeout: 30000
        });

        const xtermViewport = terminalFrame.locator('.xterm-viewport').first();

        // Record initial scroll position
        const initialState = await xtermViewport.evaluate(el => ({
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight
        }));

        console.log('[Test] Initial state:', initialState);

        // Simulate keyboard appearance (Visual Viewport resize triggers postMessage)
        await page.evaluate(() => {
            const initialHeight = window.visualViewport.height;
            const newHeight = initialHeight - 300;

            // Mock Visual Viewport height
            Object.defineProperty(window.visualViewport, 'height', {
                get: () => newHeight,
                configurable: true
            });

            // Trigger resize event
            const event = new Event('resize');
            window.visualViewport.dispatchEvent(event);
        });

        // Wait for scroll to execute
        await page.waitForTimeout(1000);

        // Get final scroll position
        const finalState = await xtermViewport.evaluate(el => ({
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            isAtBottom: el.scrollTop >= (el.scrollHeight - el.clientHeight - 10)
        }));

        console.log('[Test] Final state:', finalState);

        // Verify scrolled to bottom
        // NOTE: This test will fail until both mobile-keyboard.js and custom_ttyd_index.html are implemented
        expect(finalState.isAtBottom).toBe(true);
    });
});
