// @ts-check
import { describe, it, expect, vi, beforeEach } from 'vitest';

// decodeTmuxEscapes is not exported, so we test it indirectly via _handleLine
// by constructing a TmuxControlClient with a mock spawn that never starts.

// We'll import the module and test through the class.
// Since decodeTmuxEscapes is module-scoped, we need to test it via _handleLine output.

/** @type {typeof import('../../server/services/tmux-control-client.js').TmuxControlClient} */
let TmuxControlClient;

beforeEach(async () => {
    const mod = await import('../../../server/services/tmux-control-client.js');
    TmuxControlClient = mod.TmuxControlClient;
});

/**
 * Helper: create a client that captures 'output' events.
 * The real spawn is stubbed out.
 */
function createClient() {
    const client = new TmuxControlClient({
        sessionId: 'test-session',
        idleTimeoutMs: 999_999,
        spawnFn: () => ({ // stub — never actually starts tmux
            stdout: { setEncoding: vi.fn(), on: vi.fn() },
            stderr: { setEncoding: vi.fn(), on: vi.fn() },
            on: vi.fn(),
            stdin: { write: vi.fn(), end: vi.fn(), destroyed: false },
            kill: vi.fn()
        })
    });
    // Manually trigger start to set up the process stub
    // Actually, we won't start it. We'll call _handleLine directly.
    /** @type {string[]} */
    const outputs = [];
    client.on('output', (data) => outputs.push(data));
    return { client, outputs };
}

// ---------------------------------------------------------------------------
// decodeTmuxEscapes tests (via _handleLine)
// ---------------------------------------------------------------------------

describe('decodeTmuxEscapes', () => {
    it('decodes Japanese hiragana "あ" (3-byte UTF-8)', () => {
        // あ = U+3042 = UTF-8 bytes E3 81 82 = octal \343\201\202
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\343\\201\\202');
        expect(outputs).toEqual(['あ']);
    });

    it('decodes multiple Japanese characters', () => {
        // あいう = \343\201\202\343\201\204\343\201\206
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\343\\201\\202\\343\\201\\204\\343\\201\\206');
        expect(outputs).toEqual(['あいう']);
    });

    it('decodes mixed ASCII and Japanese', () => {
        // Hello + あ + World
        const { client, outputs } = createClient();
        client._handleLine('%output %0 Hello\\343\\201\\202World');
        expect(outputs).toEqual(['HelloあWorld']);
    });

    it('handles named escapes \\n \\r \\t', () => {
        const { client, outputs } = createClient();
        client._handleLine('%output %0 line1\\nline2\\ttab\\rcr');
        expect(outputs).toEqual(['line1\nline2\ttab\rcr']);
    });

    it('decodes escaped backslash \\\\ without corrupting following digits', () => {
        // \\\\343 should become literal \343, NOT byte 0xE3
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\\\343');
        expect(outputs).toEqual(['\\343']);
    });

    it('preserves incomplete octal at end of string', () => {
        // \34 (only 2 octal digits, not 3) — incomplete octal sequence
        const { client, outputs } = createClient();
        client._handleLine('%output %0 text\\34');
        // The incomplete octal \34 should be buffered in _pendingOctal
        // Only "text" should be emitted
        expect(outputs).toEqual(['text']);
        // And the pending octal should be carried over
        expect(client._pendingOctal).toBe('\\34');
    });

    it('resolves incomplete octal from previous line', () => {
        const { client, outputs } = createClient();
        // First line: incomplete octal at end (\34 → only 2 digits)
        client._handleLine('%output %0 text\\34');
        expect(outputs).toEqual(['text']);
        expect(client._pendingOctal).toBe('\\34');

        // Second line: completes the octal with 3
        client._handleLine('%output %0 3rest');
        // \34 + 3 = \343 (byte 0xE3), then "rest" — emitted as one output
        // 0xE3 alone is incomplete UTF-8, so it becomes replacement char
        expect(outputs.length).toBe(2);
        expect(outputs[1]).toContain('rest');
        expect(client._pendingOctal).toBe('');
    });

    it('handles lone backslash at end of string — buffered as incomplete octal', () => {
        const { client, outputs } = createClient();
        client._handleLine('%output %0 end\\');
        // Lone backslash is treated as incomplete octal, buffered for next line
        expect(outputs).toEqual(['end']);
        expect(client._pendingOctal).toBe('\\');

        // Next line resolves it (backslash followed by non-octal)
        client._handleLine('%output %0 x');
        // \ + x = \x (unknown escape → preserved as \x)
        expect(outputs).toEqual(['end', '\\x']);
    });

    it('handles empty payload', () => {
        const { client, outputs } = createClient();
        client._handleLine('%output %0 ');
        // Empty after decode — nothing emitted
        expect(outputs).toEqual([]);
    });

    it('handles CJK characters with 3-byte UTF-8', () => {
        // 構 = U+69CB = UTF-8 E6 A7 8B = octal \346\247\213
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\346\\247\\213');
        expect(outputs).toEqual(['構']);
    });

    it('handles emoji with 4-byte UTF-8', () => {
        // 🔥 = U+1F525 = UTF-8 F0 9F 94 A5 = octal \360\237\224\245
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\360\\237\\224\\245');
        expect(outputs).toEqual(['🔥']);
    });

    it('handles unknown escape sequences gracefully', () => {
        // \x is not a known escape — should emit backslash + x
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\x');
        expect(outputs).toEqual(['\\x']);
    });

    it('passes through plain ASCII without modification', () => {
        const { client, outputs } = createClient();
        client._handleLine('%output %0 Hello, World! 12345');
        expect(outputs).toEqual(['Hello, World! 12345']);
    });
});

// ---------------------------------------------------------------------------
// _handleStdout chunk boundary tests
// ---------------------------------------------------------------------------

describe('_handleStdout chunk handling', () => {
    it('buffers incomplete lines (no trailing newline)', () => {
        const { client, outputs } = createClient();
        client._handleStdout('%output %0 \\343\\201\\202');
        // No newline yet — nothing emitted
        expect(outputs).toEqual([]);
        // Complete the line
        client._handleStdout('\n');
        expect(outputs).toEqual(['あ']);
    });

    it('handles multiple lines in one chunk', () => {
        const { client, outputs } = createClient();
        client._handleStdout('%output %0 hello\n%output %0 \\343\\201\\202\n');
        expect(outputs).toEqual(['hello', 'あ']);
    });

    it('handles line split across two chunks', () => {
        const { client, outputs } = createClient();
        client._handleStdout('%output %0 hel');
        client._handleStdout('lo\n');
        expect(outputs).toEqual(['hello']);
    });
});

// ---------------------------------------------------------------------------
// Non-output lines
// ---------------------------------------------------------------------------

describe('non-output lines', () => {
    it('emits exit event for %exit', () => {
        const { client } = createClient();
        const exitEvents = [];
        client.on('exit', (e) => exitEvents.push(e));
        client._handleLine('%exit');
        expect(exitEvents).toEqual([{ code: 0, signal: null }]);
    });

    it('emits error event for %error', () => {
        const { client } = createClient();
        const errors = [];
        client.on('error', (e) => errors.push(e));
        client._handleLine('%error some error');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toBe('%error some error');
    });

    it('ignores empty lines', () => {
        const { client, outputs } = createClient();
        client._handleLine('');
        client._handleLine('   ');
        // "   " doesn't start with %output, so no output emitted
        expect(outputs).toEqual([]);
    });
});
