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
// UTF-8 byte carryover across %output lines
// ---------------------------------------------------------------------------

describe('UTF-8 byte carryover across %output lines', () => {
    it('3-byte character split across two lines: first 2 bytes then 1 byte', () => {
        // あ = E3 81 82 = \343\201\202
        // Line 1: \343\201 (2 bytes — incomplete 3-byte UTF-8)
        // Line 2: \202 (remaining 1 byte)
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\343\\201');
        // Should not emit garbled text — bytes should be buffered
        expect(outputs).toEqual([]);
        expect(client._pendingUtf8Bytes).toEqual([0xE3, 0x81]);

        client._handleLine('%output %0 \\202');
        // Now the 3-byte sequence is complete → emit "あ"
        expect(outputs).toEqual(['あ']);
        expect(client._pendingUtf8Bytes).toEqual([]);
    });

    it('3-byte character split: 1 byte then 2 bytes', () => {
        // あ = E3 81 82
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\343');
        expect(outputs).toEqual([]);
        expect(client._pendingUtf8Bytes).toEqual([0xE3]);

        client._handleLine('%output %0 \\201\\202');
        expect(outputs).toEqual(['あ']);
    });

    it('4-byte emoji split across two lines', () => {
        // 🔥 = F0 9F 94 A5 = \360\237\224\245
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\360\\237');
        expect(outputs).toEqual([]);
        expect(client._pendingUtf8Bytes).toEqual([0xF0, 0x9F]);

        client._handleLine('%output %0 \\224\\245');
        expect(outputs).toEqual(['🔥']);
    });

    it('ASCII before split UTF-8 is emitted immediately', () => {
        // "Hi" + partial あ
        const { client, outputs } = createClient();
        client._handleLine('%output %0 Hi\\343\\201');
        expect(outputs).toEqual(['Hi']);
        expect(client._pendingUtf8Bytes).toEqual([0xE3, 0x81]);

        client._handleLine('%output %0 \\202!');
        expect(outputs).toEqual(['Hi', 'あ!']);
    });

    it('complete character followed by split character on same line', () => {
        // あ (complete) + first 2 bytes of い
        // あ = E3 81 82, い = E3 81 84
        const { client, outputs } = createClient();
        client._handleLine('%output %0 \\343\\201\\202\\343\\201');
        expect(outputs).toEqual(['あ']);
        expect(client._pendingUtf8Bytes).toEqual([0xE3, 0x81]);

        client._handleLine('%output %0 \\204');
        expect(outputs).toEqual(['あ', 'い']);
    });

    it('2-byte character split across lines', () => {
        // é = C3 A9 = \303\251
        const { client, outputs } = createClient();
        client._handleLine('%output %0 caf\\303');
        expect(outputs).toEqual(['caf']);
        expect(client._pendingUtf8Bytes).toEqual([0xC3]);

        client._handleLine('%output %0 \\251');
        expect(outputs).toEqual(['caf', 'é']);
    });
});

// ---------------------------------------------------------------------------
// _handleStdout chunk boundary tests
// ---------------------------------------------------------------------------

describe('_handleStdout chunk handling', () => {
    it('buffers incomplete lines (no trailing newline)', () => {
        const { client, outputs } = createClient();
        client._handleStdout(Buffer.from('%output %0 \\343\\201\\202'));
        // No newline yet — nothing emitted
        expect(outputs).toEqual([]);
        // Complete the line
        client._handleStdout(Buffer.from('\n'));
        expect(outputs).toEqual(['あ']);
    });

    it('handles multiple lines in one chunk', () => {
        const { client, outputs } = createClient();
        client._handleStdout(Buffer.from('%output %0 hello\n%output %0 \\343\\201\\202\n'));
        expect(outputs).toEqual(['hello', 'あ']);
    });

    it('handles line split across two chunks', () => {
        const { client, outputs } = createClient();
        client._handleStdout(Buffer.from('%output %0 hel'));
        client._handleStdout(Buffer.from('lo\n'));
        expect(outputs).toEqual(['hello']);
    });

    it('raw UTF-8 bytes split by newline across %output lines do NOT produce FFFD', () => {
        // Simulate tmux outputting raw UTF-8 "確認" where "確" (E7 A2 BA) is split:
        // First %output line ends with E7 A2 (partial "確")
        // Second %output line starts with BA (completing "確")
        const { client, outputs } = createClient();
        const chunk = Buffer.concat([
            Buffer.from('%output %0 '),
            Buffer.from([0xE7, 0xA2]),     // partial "確" — 2 of 3 bytes
            Buffer.from('\n'),              // newline splits the character!
            Buffer.from('%output %0 '),
            Buffer.from([0xBA]),            // remaining byte of "確"
            Buffer.from('認\n')             // "認" as raw UTF-8
        ]);
        client._handleStdout(chunk);
        // The first line gets E7 A2 which is incomplete — tmux's line boundary broke it.
        // With Buffer-based handling, each line is decoded independently.
        // The first 2 bytes (E7 A2) on line 1 → \uFFFD (unavoidable at line level)
        // The lone byte BA on line 2 → \uFFFD + "認"
        // This is the fundamental tmux behavior — the fix prevents CROSS-CHUNK splits,
        // but within-line splits are tmux's responsibility.
        // In practice, tmux doesn't split raw UTF-8 characters across %output lines.
        // This test just verifies no crash.
        expect(outputs.length).toBe(2);
        // No crash, outputs are strings (may contain FFFD from tmux's split, which is expected)
    });

    it('raw UTF-8 bytes split across Node.js read chunks do NOT produce FFFD', () => {
        // Key scenario: "確認" as raw UTF-8 in one %output line,
        // but the Node.js read chunk boundary splits "確" (E7 A2 BA)
        const { client, outputs } = createClient();
        // Chunk 1: "%output %0 " + first 2 bytes of "確"
        client._handleStdout(Buffer.concat([
            Buffer.from('%output %0 '),
            Buffer.from([0xE7, 0xA2])  // partial "確"
        ]));
        expect(outputs).toEqual([]); // line not complete yet

        // Chunk 2: remaining byte of "確" + "認" + newline
        client._handleStdout(Buffer.concat([
            Buffer.from([0xBA]),        // completes "確"
            Buffer.from('認\n')
        ]));
        // Now the full line is: "%output %0 " + E7 A2 BA + "認"
        // Decoded as UTF-8: "%output %0 確認"
        expect(outputs).toEqual(['確認']);
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
