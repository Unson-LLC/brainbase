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

    it('O(n): 巨大な単一 %output 行をチャンク投入しても Buffer.concat は行ごと1回だけ（O(n²)再コピーしない）', () => {
        const { client, outputs } = createClient();
        const SIZE = 20 * 1024 * 1024;
        const CHUNK = 64 * 1024;
        // one giant %output line: prefix + 20MB of 'A' + terminating newline, fed in 64KB chunks
        const whole = Buffer.concat([Buffer.from('%output %1 ', 'utf-8'), Buffer.alloc(SIZE, 0x41), Buffer.from('\n', 'utf-8')]);
        const chunks = Math.ceil(whole.length / CHUNK); // ~320 chunks

        // Deterministic, instrumentation-independent O(n) proof: count Buffer.concat calls made
        // WHILE feeding. The old O(n^2) code did Buffer.concat([wholeBuffer, chunk]) per chunk
        // (~320 calls); the O(n) fix concatenates the pending chunks once, when the line completes.
        const concatSpy = vi.spyOn(Buffer, 'concat');
        const before = concatSpy.mock.calls.length;
        feedInChunks(client, whole, CHUNK);
        const concatCalls = concatSpy.mock.calls.length - before;
        concatSpy.mockRestore();

        expect(concatCalls).toBeLessThanOrEqual(2);   // O(n); O(n^2) would be ~one per chunk (~320)
        expect(chunks).toBeGreaterThan(100);          // sanity: the line really spans many chunks
        expect(outputs.join('').length).toBe(SIZE);   // and the full line is emitted intact
    });
});
