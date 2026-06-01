import { test, expect } from '@playwright/test';
import { TmuxControlClient } from '../../server/services/tmux-control-client.js';

// End-to-end of the real TmuxControlClient stdout pipeline (no browser needed): feed raw tmux
// control-mode bytes through _handleStdout exactly as the child process would, and assert the
// emitted `output` events. Proves the O(n^2) paste-freeze is gone and decoding is unchanged.

function createClient() {
    const client: any = new TmuxControlClient({
        sessionId: 'e2e-session',
        idleTimeoutMs: 999_999,
        // @ts-ignore — stub spawn; we drive _handleStdout directly
        spawnFn: () => ({
            stdout: { setEncoding() {}, on() {} },
            stderr: { setEncoding() {}, on() {} },
            on() {},
            stdin: { write() {}, end() {}, destroyed: false },
            kill() {}
        })
    });
    const outputs: string[] = [];
    client.on('output', (d: string) => outputs.push(d));
    return { client, outputs };
}

function feedInChunks(client: any, buf: Buffer, chunkSize: number) {
    for (let off = 0; off < buf.length; off += chunkSize) {
        client._handleStdout(buf.subarray(off, Math.min(off + chunkSize, buf.length)));
    }
}

test.describe('story-control-mode-stdout-oncost', () => {
    test('AC: a giant single %output line fed across many chunks decodes in linear time', () => {
        // story-control-mode-stdout-oncost ac:1
        const { client, outputs } = createClient();
        const SIZE = 30 * 1024 * 1024; // 30MB single line
        const CHUNK = 64 * 1024;
        const whole = Buffer.concat([Buffer.from('%output %1 '), Buffer.alloc(SIZE, 0x41), Buffer.from('\n')]);
        const chunks = Math.ceil(whole.length / CHUNK); // ~480 chunks

        // Deterministic O(n) proof (instrumentation-independent): the old O(n^2) code did
        // Buffer.concat([wholeBuffer, chunk]) per chunk (~480 calls); the O(n) fix concatenates the
        // pending chunks once when the line completes.
        const origConcat = Buffer.concat;
        let concatCalls = 0;
        (Buffer as any).concat = (...args: any[]) => { concatCalls++; return (origConcat as any).apply(Buffer, args); };
        try {
            feedInChunks(client, whole, CHUNK);
        } finally {
            Buffer.concat = origConcat;
        }
        // A large single output line fed across many chunks is assembled and decoded in linear time so a paste-driven redraw flood no longer blocks the event loop for tens of seconds.
        expect(concatCalls, 'A large single output line fed across many chunks is assembled and decoded in linear time so a paste-driven redraw flood no longer blocks the event loop for tens of seconds.').toBeLessThanOrEqual(2);
        expect(chunks).toBeGreaterThan(100);
        expect(outputs.join('').length).toBe(SIZE);
    });

    test('AC: lines split across chunk boundaries decode byte-identically', () => {
        // story-control-mode-stdout-oncost ac:2
        const whole = createClient();
        // "あ"=E3 81 82 octal \343\201\202, "い"=E3 81 84 octal \343\201\204
        const stream = '%output %1 head \\343\\201\\202mid\\343\\201\\204\n%output %1 tail line\n';
        feedInChunks(whole.client, Buffer.from(stream, 'utf-8'), 3); // split mid-escape + mid-multibyte
        const wholeResult = whole.outputs.join('');

        // reference: feed the identical stream in one shot
        const ref = createClient();
        ref.client._handleStdout(Buffer.from(stream, 'utf-8'));
        const refResult = ref.outputs.join('');

        // Output lines split across chunk boundaries including mid multibyte and mid escape decode to the same bytes as before with no correctness regression.
        expect(wholeResult, 'Output lines split across chunk boundaries including mid multibyte and mid escape decode to the same bytes as before with no correctness regression.').toBe(refResult);
        expect(wholeResult).toBe('head あmidいtail line');
    });
});
