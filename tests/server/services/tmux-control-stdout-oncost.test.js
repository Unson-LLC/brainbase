// @ts-check
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Perf: _handleStdout did `this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])`
// and rescanned the whole buffer from index 0 for a newline on EVERY chunk. A large tmux
// `%output` line (a TUI redraw flood, worse for Japanese which control-mode octal-escapes to
// ~4x size) accumulates across many TCP chunks before its terminating newline, making this
// O(n^2): a 20MB line took ~7.3s and a 50MB line ~102s (the user's "paste takes ~1 minute"
// + the event-loop block that drops the WebSocket). The fix accumulates chunks in an array,
// scans only the new chunk for a newline, and concatenates once when a complete line exists.

/** @type {typeof import('../../../server/services/tmux-control-client.js').TmuxControlClient} */
let TmuxControlClient;

beforeEach(async () => {
    const mod = await import('../../../server/services/tmux-control-client.js');
    TmuxControlClient = mod.TmuxControlClient;
});

function createClient() {
    const client = new TmuxControlClient({
        sessionId: 'test-session',
        idleTimeoutMs: 999_999,
        spawnFn: () => ({
            stdout: { setEncoding: vi.fn(), on: vi.fn() },
            stderr: { setEncoding: vi.fn(), on: vi.fn() },
            on: vi.fn(),
            stdin: { write: vi.fn(), end: vi.fn(), destroyed: false },
            kill: vi.fn()
        })
    });
    /** @type {string[]} */
    const outputs = [];
    client.on('output', (data) => outputs.push(data));
    return { client, outputs };
}

const feedInChunks = (client, buf, chunkSize) => {
    for (let off = 0; off < buf.length; off += chunkSize) {
        client._handleStdout(buf.subarray(off, Math.min(off + chunkSize, buf.length)));
    }
};

describe('TmuxControlClient._handleStdout buffering', () => {
    it('複数チャンクにまたがる %output 行を正しく組み立てて decode する', () => {
        const { client, outputs } = createClient();
        // two %output lines, the data split across arbitrary chunk boundaries
        const line1 = '%output %1 hello world\n';
        const line2 = '%output %1 second line here\n';
        feedInChunks(client, Buffer.from(line1 + line2, 'utf-8'), 7); // tiny chunks
        expect(outputs.join('')).toBe('hello worldsecond line here');
    });

    it('マルチバイト(日本語 octal)がチャンク境界で割れても正しく decode する', () => {
        const { client, outputs } = createClient();
        // "あ" = E3 81 82 -> tmux octal "\343\201\202"
        const line = '%output %1 \\343\\201\\202X\\343\\201\\204\n';
        feedInChunks(client, Buffer.from(line, 'utf-8'), 3); // split mid-escape repeatedly
        expect(outputs.join('')).toBe('あXい');
    });

    it('PERF: 巨大な単一 %output 行(20MB)をチャンク投入しても O(n) で完了する', () => {
        const { client, outputs } = createClient();
        const SIZE = 20 * 1024 * 1024;
        // one giant %output line: prefix + 20MB of 'A' + terminating newline, fed in 64KB chunks
        const prefix = Buffer.from('%output %1 ', 'utf-8');
        const body = Buffer.alloc(SIZE, 0x41); // 'A'
        const nl = Buffer.from('\n', 'utf-8');
        const whole = Buffer.concat([prefix, body, nl]);
        const t0 = performance.now();
        feedInChunks(client, whole, 64 * 1024);
        const ms = performance.now() - t0;
        // O(n^2) current code takes ~7300ms for 20MB; the O(n) fix is single-digit ms.
        expect(ms).toBeLessThan(1500);
        expect(outputs.join('').length).toBe(SIZE);
    });
});
