import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_E2E_PORT || process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

// Real captured xterm-transport handoff (interactive Claude Code TUI session). W[1] is the
// snapshot frame written by _applySnapshot (text starts with \x1b[2J\x1b[3J\x1b[H); W[3] is
// the first live output (a relative-cursor redraw).
const W = JSON.parse(readFileSync(path.resolve(process.cwd(), 'tests/fixtures/terminal-handoff-184205.json'), 'utf8'));
const CLEAR = '\x1b[2J\x1b[3J\x1b[H';
const snapshotBody = W[1].text.startsWith(CLEAR) ? W[1].text.slice(CLEAR.length) : W[1].text;
const liveOutput = W[3].text;

test.describe('story-terminal-snapshot-handoff', () => {
    test('AC: real browser xterm one-shot clears scrollback only (preserves the frame for the live redraw)', async ({ page }) => {
        // story-terminal-snapshot-handoff ac:1
        // Acceptance criterion (verbatim, for E2E coverage matching):
        // A session-switch snapshot->live handoff preserves the visible frame for the live app's relative-cursor first redraw: the one-shot writes `\x1b[3J` (scrollback only) and NOT `\x1b[2J\x1b[3J\x1b[H` or `terminal.reset()`.
        // the post-snapshot session-switch one-shot, run
        // through the REAL terminal-transport message handler against a REAL xterm, must write
        // \x1b[3J (scrollback only) and NOT \x1b[2J\x1b[3J\x1b[H / terminal.reset(), so the
        // interactive TUI's relative-cursor first redraw keeps the visible frame (no blank/garble).
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');

        const result = await page.evaluate(async ({ snapshotBody, liveOutput }) => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?handoff=${Date.now()}`);
            const originalWebSocket = window.WebSocket;
            const wsInstances = [];
            class FakeWebSocket extends EventTarget {
                static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
                constructor(url) { super(); this.url = String(url); this.readyState = 1; this.sent = []; wsInstances.push(this); setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
                send(d) { this.sent.push(d); }
                close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test' })); }
                emit(m) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) })); }
            }
            window.WebSocket = FakeWebSocket;

            const host = document.createElement('div');
            host.style.cssText = 'width:720px;height:420px;position:fixed;left:0;top:0;background:#000;z-index:2147483647';
            document.body.appendChild(host);

            const client = new TerminalTransportClient({ viewerId: 'story-handoff-e2e', viewerLabel: 'Handoff E2E' });
            await client.init(host);

            // Spy on the REAL serialized write path so we can see exactly what the one-shot emits.
            const writeCalls = [];
            let resetCount = 0;
            const origWrite = client.terminal.write.bind(client.terminal);
            const origReset = client.terminal.reset?.bind(client.terminal);
            client.terminal.write = (text, cb) => { writeCalls.push(text); return origWrite(text, cb); };
            if (origReset) client.terminal.reset = () => { resetCount += 1; return origReset(); };

            const waitForWs = async (i) => { for (let a = 0; a < 50; a++) { if (wsInstances[i]) return wsInstances[i]; await new Promise(r => setTimeout(r, 20)); } throw new Error('no ws'); };
            const idle = async () => { for (let a = 0; a < 60; a++) { if (!client._terminalWriteActive && client._terminalWriteQueue.length === 0) return; await new Promise(r => setTimeout(r, 20)); } };

            const connectPromise = client.connect('session-handoff', { skipInitialResize: true });
            const ws = await waitForWs(0);
            client._resetTerminalOnNextSnapshot = true;            // simulate the session-switch reset
            ws.emit({ type: 'snapshot', text: snapshotBody, capturedAt: new Date().toISOString() });
            ws.emit({ type: 'ready', runtimeState: 'interactive_ready', inputReady: true, terminalAccess: { state: 'owner' } });
            await connectPromise;
            await idle();
            const armed = client._liveResetPendingAfterSnapshot === true;
            const snapshotResetCount = resetCount;                 // reset() used to draw the snapshot frame
            const writesBeforeOutput = writeCalls.length;
            // First LIVE output (relative redraw) -> runs the real `case 'output':` one-shot.
            ws.emit({ type: 'output', data: liveOutput });
            await idle();

            // the one-shot write is the first write after the snapshot, before the live output
            const oneShotWrite = writeCalls[writesBeforeOutput];
            window.WebSocket = originalWebSocket;
            host.remove();
            return {
                armed,
                disarmedAfter: client._liveResetPendingAfterSnapshot === false,
                oneShotWrite,
                resetAfterOutput: resetCount - snapshotResetCount,
                sawLiveOutput: writeCalls.includes(liveOutput),
                allWrites: writeCalls.map(w => JSON.stringify(w).slice(0,30)),
                hasBareScrollbackClear: writeCalls.includes('\x1b[3J'),
                hasBareFullClear: writeCalls.includes('\x1b[2J\x1b[3J\x1b[H'),
            };
        }, { snapshotBody, liveOutput });

        // The reset snapshot armed the one-shot, which fired exactly \x1b[3J (scrollback only):
        expect(result.armed, "A session-switch snapshot->live handoff preserves the visible frame for the live app's relative-cursor first redraw: the one-shot writes \\x1b[3J (scrollback only) and NOT \\x1b[2J\\x1b[3J\\x1b[H or terminal.reset().").toBe(true);
        expect(result.disarmedAfter).toBe(true);
        expect(result.oneShotWrite).toBe('\x1b[3J'); // the FIX
        expect(result.oneShotWrite).not.toBe('\x1b[2J\x1b[3J\x1b[H'); // not the bug
        expect(result.resetAfterOutput).toBe(0);                     // not #911's terminal.reset()
        expect(result.sawLiveOutput).toBe(true);
        await page.screenshot({ path: 'var/test-results/story-terminal-snapshot-handoff-xterm.png', fullPage: false });
    });

    test('AC: a full-repaint live output is not ghosted by the scrollback-only one-shot', async ({ page }) => {
        // story-terminal-snapshot-handoff ac:2
        // Acceptance criterion (verbatim, for E2E coverage matching):
        // A full-repaint app (which emits its own clear) is not ghosted by the scrollback-only one-shot.
        // a full-repaint app emits its own clear, so the
        // \x1b[3J one-shot must not leave ghost rows from the snapshot frame.
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const result = await page.evaluate(async ({ snapshotBody }) => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?fullrepaint=${Date.now()}`);
            const orig = window.WebSocket; const wsi = [];
            class FW extends EventTarget { static OPEN=1; constructor(u){super();this.url=String(u);this.readyState=1;this.sent=[];wsi.push(this);setTimeout(()=>this.dispatchEvent(new Event('open')),0);} send(d){this.sent.push(d);} close(){this.readyState=3;this.dispatchEvent(new CloseEvent('close',{code:1000}));} emit(m){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(m)}));} }
            window.WebSocket = FW;
            const host=document.createElement('div'); host.style.cssText='width:720px;height:420px;position:fixed;left:0;top:0;background:#000;z-index:2147483647'; document.body.appendChild(host);
            const c=new TerminalTransportClient({viewerId:'fr-e2e',viewerLabel:'FR'}); await c.init(host);
            const waitWs=async(i)=>{for(let a=0;a<50;a++){if(wsi[i])return wsi[i];await new Promise(r=>setTimeout(r,20));}throw new Error('no ws');};
            const idle=async()=>{for(let a=0;a<60;a++){if(!c._terminalWriteActive&&c._terminalWriteQueue.length===0)return;await new Promise(r=>setTimeout(r,20));}};
            const cp=c.connect('s-fr',{skipInitialResize:true}); const ws=await waitWs(0);
            c._resetTerminalOnNextSnapshot=true;
            ws.emit({type:'snapshot',text:snapshotBody,capturedAt:new Date().toISOString()});
            ws.emit({type:'ready',runtimeState:'interactive_ready',inputReady:true,terminalAccess:{state:'owner'}});
            await cp; await idle();
            ws.emit({type:'output',data:'\x1b[2J\x1b[H' + 'REPAINT-A\r\nREPAINT-B\r\nREPAINT-C'}); // full repaint
            await idle();
            const b=c.terminal.buffer.active; const rows=[]; for(let y=0;y<c.terminal.rows;y++){const l=b.getLine(b.baseY+y); if(l) rows.push(l.translateToString(true));}
            const joined=rows.join('\n'); window.WebSocket=orig; host.remove();
            return { nonEmpty: rows.filter(l=>l.trim()).length, hasRepaint: joined.includes('REPAINT-A'), hasGhost: joined.includes('Session') || joined.includes('Volumes') };
        }, { snapshotBody });
        expect(result.hasRepaint).toBe(true);
        expect(result.hasGhost, 'A full-repaint app (which emits its own clear) is not ghosted by the scrollback-only one-shot.').toBe(false); // no ghost rows from the snapshot frame
        expect(result.nonEmpty).toBeLessThanOrEqual(4); // only the repaint lines
    });

    test('AC: an empty first output disarms the one-shot and the frame survives the later redraw', async ({ page }) => {
        // story-terminal-snapshot-handoff ac:3
        // Acceptance criterion (verbatim, for E2E coverage matching):
        // An empty first output disarms the one-shot and the frame still survives the later live redraw.
        // an empty first output must disarm the one-shot
        // (scrollback-only is benign on empty) so it cannot defer onto a later unrelated output.
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        const result = await page.evaluate(async ({ snapshotBody, liveOutput }) => {
            const { TerminalTransportClient } = await import(`/modules/core/terminal-transport-client.js?empty=${Date.now()}`);
            const orig = window.WebSocket; const wsi = [];
            class FW extends EventTarget { static OPEN=1; constructor(u){super();this.url=String(u);this.readyState=1;this.sent=[];wsi.push(this);setTimeout(()=>this.dispatchEvent(new Event('open')),0);} send(d){this.sent.push(d);} close(){this.readyState=3;this.dispatchEvent(new CloseEvent('close',{code:1000}));} emit(m){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(m)}));} }
            window.WebSocket = FW;
            const host=document.createElement('div'); host.style.cssText='width:720px;height:420px;position:fixed;left:0;top:0;background:#000;z-index:2147483647'; document.body.appendChild(host);
            const c=new TerminalTransportClient({viewerId:'em-e2e',viewerLabel:'EM'}); await c.init(host);
            const wt=[]; const oWT=c._writeToTerminal.bind(c); c._writeToTerminal=(t,v,o)=>{wt.push(t);return oWT(t,v,o);};
            const waitWs=async(i)=>{for(let a=0;a<50;a++){if(wsi[i])return wsi[i];await new Promise(r=>setTimeout(r,20));}throw new Error('no ws');};
            const idle=async()=>{for(let a=0;a<60;a++){if(!c._terminalWriteActive&&c._terminalWriteQueue.length===0)return;await new Promise(r=>setTimeout(r,20));}};
            const cp=c.connect('s-em',{skipInitialResize:true}); const ws=await waitWs(0);
            c._resetTerminalOnNextSnapshot=true;
            ws.emit({type:'snapshot',text:snapshotBody,capturedAt:new Date().toISOString()});
            ws.emit({type:'ready',runtimeState:'interactive_ready',inputReady:true,terminalAccess:{state:'owner'}});
            await cp; await idle();
            const armed = c._liveResetPendingAfterSnapshot === true;
            const wtBefore = wt.length;
            ws.emit({type:'output',data:''});             // EMPTY first output
            const disarmed = c._liveResetPendingAfterSnapshot === false;
            const oneShotOnEmpty = wt.slice(wtBefore).includes('\x1b[3J'); // one-shot fired \x1b[3J on the empty output
            ws.emit({type:'output',data:liveOutput});     // real relative redraw afterwards
            await idle();
            const reDisarmed = c._liveResetPendingAfterSnapshot === false; // not re-armed / not deferred
            window.WebSocket=orig; host.remove();
            return { armed, disarmed, oneShotOnEmpty, reDisarmed };
        }, { snapshotBody, liveOutput });
        expect(result.armed).toBe(true);
        expect(result.disarmed, 'An empty first output disarms the one-shot and the frame still survives the later live redraw.').toBe(true); // empty output disarmed the one-shot
        expect(result.oneShotOnEmpty).toBe(true);     // and it fired \x1b[3J (scrollback only), not deferred
        expect(result.reDisarmed).toBe(true);         // stays disarmed for the later real output
    });

});
