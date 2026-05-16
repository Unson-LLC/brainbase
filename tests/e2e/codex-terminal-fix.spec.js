/**
 * E2E test: codex セッションのターミナル初期化ハング修正の検証
 *
 * 現行方針: custom_ttyd_index.html では _reportFocus() override を使わない。
 * codex 起動時のブロックする端末クエリは scripts/codex-pty-shim.py で処理し、
 * ttyd HTML 側は通常の focus reporting を維持する。
 */

import { existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${PORT}`;

function getSessionWorkspacePath(session) {
    return session?.worktree?.path || session?.path || session?.cwd || null;
}

test.describe('codex terminal startup compatibility', () => {

    test('custom_ttyd_index.html documents that browser-side _reportFocus override is disabled', async ({ page }) => {
        const res = await page.goto(`${BASE_URL}/ttyd/custom_ttyd_index.html`);
        expect(res.status()).toBe(200);

        const html = await page.content();
        expect(html).toContain('focus reporting disable was a workaround');
        expect(html).toContain('codex-pty-shim.py handles');
        expect(html).not.toContain('disableFocusReporting');
    });

    test('ttyd HTML does not install a browser-side focus override hook', async ({ page }) => {
        // ttyd HTML を直接開く（standalone モード）
        const res = await page.goto(`${BASE_URL}/ttyd/custom_ttyd_index.html`);
        expect(res.status()).toBe(200);

        // xterm.js Terminal オブジェクトが初期化されるのを待つ
        // (ttyd standalone は WebSocket 接続なしでも Terminal を初期化する)
        await page.waitForFunction(
            () => typeof window.term !== 'undefined',
            { timeout: 5000 }
        ).catch(() => null); // standalone では term が未定義の場合もある

        const overrideHookLoaded = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('script')).some((script) =>
                script.textContent.includes('disableFocusReporting')
                    || script.textContent.includes('_testDisableFocus')
            );
        });
        expect(overrideHookLoaded).toBe(false);

        const termExists = await page.evaluate(() => typeof window.term !== 'undefined');
        if (termExists) {
            const focusReporterIsNotNoOp = await page.evaluate(() => {
                const term = window.term;
                if (!term) return false;
                const target = term._core || term;
                if (typeof target._reportFocus !== 'function') return false;
                const src = target._reportFocus.toString().replace(/\s/g, '');
                return src !== 'function(){}';
            });
            expect(focusReporterIsNotNoOp).toBe(true);
        }
    });

    test('codex セッションを開くと terminal-frame が ttyd URL を指す', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        // セッションリスト DOM から codex セッションを直接探す（data-engine="codex"）
        const codexSessionEl = page.locator('[data-engine="codex"]').first();
        const codexVisible = await codexSessionEl.isVisible().catch(() => false);

        if (!codexVisible) {
            test.skip('UIにcodexセッションが表示されていない');
            return;
        }

        const sessionId = await codexSessionEl.getAttribute('data-id');
        console.log(`Testing with codex session: ${sessionId}`);

        await codexSessionEl.click();

        // terminal-frame の src が ttyd URL (/console/...) になるのを待つ
        await page.waitForFunction(
            (sid) => {
                const frame = document.getElementById('terminal-frame');
                return frame && frame.src && frame.src.includes(`/console/${sid}`);
            },
            sessionId,
            { timeout: 10000 }
        );

        const frameSrc = await page.evaluate(() => {
            const frame = document.getElementById('terminal-frame');
            return frame ? frame.src : null;
        });

        console.log(`terminal-frame src: ${frameSrc}`);
        expect(frameSrc).toContain(`/console/${sessionId}`);
    });

    test('codex TUI が実際にブラウザで描画される（ハングしない）', async ({ page, context }) => {
        // active な codex セッションを取得（IDの降順＝最近作成順で試す）
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const allSessions = await page.evaluate(async (base) => {
            const r = await fetch(`${base}/api/state`);
            const d = await r.json();
            const codexSessions = (d.sessions || []).filter(s => s.engine === 'codex' && s.intendedState === 'active');
            // IDが大きい（＝最近作成）順にソート
            return codexSessions.sort((a, b) => b.id.localeCompare(a.id));
        }, BASE_URL);
        const sessions = allSessions.filter((session) => {
            const workspacePath = getSessionWorkspacePath(session);
            return workspacePath && existsSync(workspacePath);
        });

        if (!sessions.length) {
            test.skip('実在するworkspaceを持つアクティブな codex セッションが存在しない');
            return;
        }

        // 全セッションを試し、いずれかでTUI描画が確認できればOK
        let tuiRendered = false;
        let terminalContent = '';
        let testedSessionId = '';
        let runnableSessionFound = false;

        for (const session of sessions) {
            const sessionId = session.id;
            console.log(`Trying codex session: ${sessionId}`);

            // terminal/ensure API で ttyd を起動
            const ensureData = await page.evaluate(async (args) => {
                const r = await fetch(`${args.base}/api/sessions/${args.id}/terminal/ensure`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ forceTtyd: true })
                });
                return r.json();
            }, { base: BASE_URL, id: sessionId });

            if (!ensureData?.runtimeStatus?.ttydRunning) {
                console.log(`Session ${sessionId}: ttyd not running, skipping`);
                continue;
            }
            runnableSessionFound = true;

            const ttydPort = ensureData.runtimeStatus.port;
            const ttydUrl = `http://127.0.0.1:${ttydPort}/console/${sessionId}/`;
            console.log(`Direct ttyd URL: ${ttydUrl}`);

            // ttyd ページを新しいタブで開く
            const ttydPage = await context.newPage();
            await ttydPage.goto(ttydUrl);
            await ttydPage.waitForLoadState('domcontentloaded');

            // xterm.js が初期化されるのを待つ（最大8秒）
            await ttydPage.waitForFunction(
                () => typeof window.term !== 'undefined',
                { timeout: 8000 }
            ).catch(() => null);

            // codex TUI の描画を確認（最大15秒待機）
            for (let attempt = 0; attempt < 30; attempt++) {
                await ttydPage.waitForTimeout(500);

                const state = await ttydPage.evaluate(() => {
                    const t = window.term;
                    if (!t) return { termExists: false, rows: [] };

                    try {
                        const buffer = t.buffer.active;
                        const rows = [];
                        // スクロールバックも含めて全行を確認
                        const totalRows = buffer.length;
                        const startRow = Math.max(0, totalRows - t.rows);
                        for (let i = startRow; i < totalRows; i++) {
                            const line = buffer.getLine(i);
                            if (line) rows.push(line.translateToString(true));
                        }
                        return { termExists: true, rows };
                    } catch (e) {
                        return { termExists: true, rows: [], error: e.message };
                    }
                });

                if (!state.termExists) continue;

                const allText = state.rows.join('\n');
                // codex TUIの特徴的なテキストを確認
                if (allText.includes('OpenAI Codex') || allText.includes('>_ ') ||
                    allText.includes('Update available') || allText.includes('context left') ||
                    allText.includes('codex') || allText.includes('Codex')) {
                    tuiRendered = true;
                    testedSessionId = sessionId;
                    terminalContent = allText.substring(0, 200);
                    break;
                }
            }

            await ttydPage.close();

            if (tuiRendered) break;
        }

        console.log(`TUI rendered: ${tuiRendered}, session: ${testedSessionId}`);
        if (terminalContent) {
            console.log(`Terminal content preview: ${terminalContent.replace(/\n/g, '|').substring(0, 200)}`);
        }

        if (!runnableSessionFound) {
            test.skip('実行可能な codex ttyd runtime が存在しない');
            return;
        }

        expect(tuiRendered, 'codex TUIがブラウザで描画されているべき（ハングしていない）').toBe(true);
    });

    test('codex セッションの ttyd URL に直接アクセスしても browser-side focus override は入らない', async ({ page, context }) => {
        // terminal/ensure API から ttyd URL を取得（UIクリック不要）
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const allSessions = await page.evaluate(async (base) => {
            const r = await fetch(`${base}/api/state`);
            const d = await r.json();
            return (d.sessions || []).filter(s => s.engine === 'codex' && s.intendedState === 'active');
        }, BASE_URL);
        const sessions = allSessions.filter((session) => {
            const workspacePath = getSessionWorkspacePath(session);
            return workspacePath && existsSync(workspacePath);
        });

        if (!sessions.length) {
            test.skip('実在するworkspaceを持つアクティブな codex セッションが存在しない');
            return;
        }

        const sessionId = sessions[0].id;
        console.log(`Testing codex session via direct ttyd URL: ${sessionId}`);

        // terminal/ensure API で ttyd を起動してプロキシURL取得
        const ensureData = await page.evaluate(async (args) => {
            const r = await fetch(`${args.base}/api/sessions/${args.id}/terminal/ensure`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }
            });
            return r.json();
        }, { base: BASE_URL, id: sessionId });

        console.log('Ensure result:', JSON.stringify(ensureData?.runtimeStatus));

        if (!ensureData?.runtimeStatus?.ttydRunning) {
            test.skip(`セッション ${sessionId} の ttyd が未起動`);
            return;
        }

        // ttyd の実際のポートへ直接ナビゲート（cross-origin 回避）
        const ttydPort = ensureData.runtimeStatus.port;
        const ttydUrl = `http://127.0.0.1:${ttydPort}/console/${sessionId}/`;
        console.log(`Direct ttyd URL: ${ttydUrl}`);

        // 新しいページで ttyd HTML を直接開く
        const ttydPage = await context.newPage();
        await ttydPage.goto(ttydUrl);
        await ttydPage.waitForLoadState('domcontentloaded');
        await ttydPage.waitForTimeout(3000); // xterm.js 初期化待ち

        const overrideHookLoaded = await ttydPage.evaluate(() =>
            Array.from(document.querySelectorAll('script')).some((script) =>
                script.textContent.includes('disableFocusReporting')
                    || script.textContent.includes('_testDisableFocus')
            )
        );
        expect(overrideHookLoaded).toBe(false);

        // window.term._core._reportFocus is not forcibly no-op at the browser layer.
        const termState = await ttydPage.evaluate(() => {
            const t = window.term;
            if (!t) return { termExists: false };
            const target = t._core || t;
            const fn = target._reportFocus;
            if (typeof fn !== 'function') return { termExists: true, hasFn: false };
            return {
                termExists: true,
                hasFn: true,
                isNoOp: fn.toString().replace(/\s/g, '') === 'function(){}'
            };
        });
        console.log('Term state:', JSON.stringify(termState));

        if (termState.termExists && termState.hasFn) {
            expect(termState.isNoOp).toBe(false);
        } else {
            // window.term が存在しない場合はscript確認のみ（WebSocket未接続時）
            expect(overrideHookLoaded).toBe(false);
        }

        await ttydPage.close();
    });

    test('ttyd HTML does not expose the old _testDisableFocus hook', async ({ page }) => {
        await page.goto(`${BASE_URL}/ttyd/custom_ttyd_index.html`);

        const hookState = await page.evaluate(() => {
            let called = false;
            window.term = { _reportFocus: function() { called = true; } };
            if (typeof window._testDisableFocus === 'function') {
                window._testDisableFocus(window.term);
            }
            window.term._reportFocus();
            return {
                hasTestHook: typeof window._testDisableFocus === 'function',
                focusEventFired: called
            };
        });

        expect(hookState.hasTestHook).toBe(false);
        expect(hookState.focusEventFired).toBe(true);
    });

});
