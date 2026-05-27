import { test, expect } from '@playwright/test';

// Story: terminal-same-viewer-multitab-orphan
// viewerId が localStorage 化され、同一ブラウザの複数タブが同じ viewerId を共有する。
// サーバ側で同一viewerの2つ目のタブは旧接続を close code 4002 (session_superseded_same_viewer)
// で明示クローズする。クライアントは 4002 を EXPECTED_CLOSE_CODES として扱い、
//   - 再接続しない（タブ間の引き継ぎ合戦=ピンポンを防止）
//   - mode を 'blocked'（別viewerに奪われた）にしない
// 別viewer takeover の 4001 は従来どおり blocked、異常切断 1006 は再接続する。
// これらをreal browserで実際に動作確認する（Visual QA sc-screenshot付き）。

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_E2E_PORT || process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

// real browser内で TerminalTransportClient を FakeWebSocket で駆動し、
// 指定 close code を受けたあとの「再接続が起きたか(=新WS生成)」「modeが何か」を返す。
async function probeCloseBehavior(page: any, closeCode: number, closeReason: string) {
    return await page.evaluate(async ({ closeCode, closeReason }: { closeCode: number; closeReason: string }) => {
        const mod = await import(`/modules/core/terminal-transport-client.js?multitab-supersede=${Date.now()}-${closeCode}`);
        const { TerminalTransportClient } = mod;

        const originalWebSocket = window.WebSocket;
        const wsInstances: any[] = [];
        class FakeWebSocket extends EventTarget {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;
            url: string;
            readyState: number;
            sent: string[] = [];
            constructor(url: string) {
                super();
                this.url = String(url);
                this.readyState = FakeWebSocket.OPEN;
                wsInstances.push(this);
                setTimeout(() => this.dispatchEvent(new Event('open')), 0);
            }
            send(data: string) { this.sent.push(data); }
            close() {
                if (this.readyState === FakeWebSocket.CLOSED) return;
                this.readyState = FakeWebSocket.CLOSED;
                this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'fake-close' }));
            }
            emit(message: unknown) {
                this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
            }
            emitClose(code: number, reason: string) {
                this.readyState = FakeWebSocket.CLOSED;
                this.dispatchEvent(new CloseEvent('close', { code, reason }));
            }
        }
        // @ts-expect-error test override
        window.WebSocket = FakeWebSocket;

        const host = document.createElement('div');
        host.id = 'multitab-supersede-host';
        host.style.width = '720px';
        host.style.height = '280px';
        host.style.position = 'fixed';
        host.style.left = '0';
        host.style.top = '0';
        host.style.background = '#000';
        document.body.appendChild(host);

        const client = new TerminalTransportClient({
            viewerId: 'multitab-supersede-e2e',
            viewerLabel: 'Multitab Supersede E2E'
        });
        await client.init(host);

        const waitForWs = async (index: number) => {
            for (let attempt = 0; attempt < 50; attempt += 1) {
                if (wsInstances[index]) return wsInstances[index];
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error(`WebSocket ${index} was not created`);
        };

        const connectPromise = client.connect('session-multitab', { skipInitialResize: true });
        const ws = await waitForWs(0);
        ws.emit({
            type: 'ready',
            runtimeState: 'interactive_ready',
            inputReady: true,
            terminalAccess: { state: 'owner' }
        });
        await connectPromise;

        // ページ全体(app.js)も自身の brainbase 端末WSを開くため、
        // 再接続検出は probe 自身のセッション(session-multitab)宛WSだけを数える。
        const myWsCount = () => wsInstances.filter((w) => w.url.includes('session-multitab')).length;
        const wsCountBeforeClose = myWsCount();
        // サーバが旧タブへ送る close を模擬する
        ws.emitClose(closeCode, closeReason);

        // BASE_RECONNECT_DELAY_MS=1000ms。再接続が起きるなら ~1000ms 後に新WSが生成される。
        await new Promise((resolve) => setTimeout(resolve, 1300));

        const wsCountAfterClose = myWsCount();
        const result = {
            wsCountBeforeClose,
            wsCountAfterClose,
            reconnected: wsCountAfterClose > wsCountBeforeClose,
            mode: client.status.mode,
            connected: client.status.connected
        };

        // @ts-expect-error restore
        window.WebSocket = originalWebSocket;
        // host は Visual QA スクショのため残す（呼び出し側で除去）
        return result;
    }, { closeCode, closeReason });
}

test.describe('story-terminal-same-viewer-multitab-orphan', () => {

    test('同一viewerの2タブ目に引き継がれた旧タブ(4002)は再接続せずblockedにもならない', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const superseded = await probeCloseBehavior(page, 4002, 'session_superseded_same_viewer');

        // 旧タブは再接続しない（タブ間ピンポン防止）。pre-fixでは4002がEXPECTED外で再接続していた。
        expect(superseded.reconnected).toBe(false);
        expect(superseded.wsCountAfterClose).toBe(superseded.wsCountBeforeClose);
        // 同一viewerが所有し続けるので blocked UI にはしない
        expect(superseded.mode).not.toBe('blocked');
        expect(superseded.connected).toBe(false);

        // Visual QA: 旧タブの端末表示（blockedオーバーレイではなく素のsnapshot/disconnected）
        await page.screenshot({ path: 'var/visual-qa/multitab-superseded-old-tab.png' });
    });

    test('別viewerに奪われた旧タブ(4001)は従来どおりblocked・再接続しない', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const blocked = await probeCloseBehavior(page, 4001, 'session_taken_over');

        expect(blocked.mode).toBe('blocked');
        expect(blocked.reconnected).toBe(false);
    });

    test('異常切断(1006)は再接続する（4002が特別にEXPECTED扱いである対照）', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const abnormal = await probeCloseBehavior(page, 1006, 'abnormal');

        // 1006 はEXPECTED外なので再接続が起きる。これにより 4002 の no-reconnect が
        // 「単に切れたから」ではなく「4002をEXPECTEDとして扱ったから」だと示せる。
        expect(abnormal.reconnected).toBe(true);
    });
});
