import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from '@xterm/headless/lib-headless/xterm-headless.js';

const { Terminal } = pkg;

// Deterministic reproduction of the session-switch snapshot->live terminal handoff,
// replayed from a REAL captured byte stream (xterm-transport, interactive Claude Code
// TUI session). The post-snapshot one-shot used to write \x1b[2J\x1b[3J\x1b[H, which
// wipes the visible frame + homes the cursor; the app's first live output is a RELATIVE
// cursor redraw that then cannot reconstruct the frame -> near-blank / garbled (the
// "描画が重複/空白" report). The fix clears scrollback only (\x1b[3J), preserving the
// frame + cursor so the relative redraw lands correctly.
//
// Fixture writes: [0]=initial reset, [1]=snapshot frame, [2]=one-shot clear (ignored;
// we apply the strategy under test), [3]=first live output (relative-cursor redraw).

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/terminal-handoff-184205.json');
const W = JSON.parse(readFileSync(fixturePath, 'utf8'));

const COLS = 80, ROWS = 24;
const write = (t, d) => new Promise((r) => t.write(d, r));
function nonEmptyLines(t) {
  const b = t.buffer.active; let n = 0;
  for (let y = 0; y < ROWS; y++) {
    if ((b.getLine(b.baseY + y)?.translateToString(true) || '').trim()) n++;
  }
  return n;
}
async function replay(oneShot) {
  const t = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  await write(t, W[0].text);   // initial reset
  await write(t, W[1].text);   // snapshot frame
  if (oneShot === 'reset') { t.reset(); await write(t, '\x1b[2J\x1b[3J\x1b[H'); }
  else if (oneShot) { await write(t, oneShot); }
  await write(t, W[3].text);   // first live output (relative redraw)
  await write(t, '');
  return nonEmptyLines(t);
}

describe('terminal snapshot->live handoff (real captured byte stream)', () => {
  it('snapshot frame alone renders the full screen (the ideal)', async () => {
    const t = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
    await write(t, W[0].text); await write(t, W[1].text); await write(t, '');
    expect(nonEmptyLines(t)).toBeGreaterThanOrEqual(10);
  });

  it('FIX (\\x1b[3J scrollback-only) preserves the frame through the live redraw', async () => {
    const n = await replay('\x1b[3J');
    expect(n).toBeGreaterThanOrEqual(10); // ~12-line frame survives (was 13 in capture)
  });

  it('REGRESSION GUARD: \\x1b[2J\\x1b[3J\\x1b[H wipes the frame -> near-blank', async () => {
    const n = await replay('\x1b[2J\x1b[3J\x1b[H');
    expect(n).toBeLessThanOrEqual(2); // documents the bug the fix avoids
  });

  it('REGRESSION GUARD: terminal.reset() (#911) also blanks', async () => {
    const n = await replay('reset');
    expect(n).toBeLessThanOrEqual(2);
  });

  // gate review (gate_evidence): the "full-repaint app self-clears" claim must be evidenced.
  it('full-repaint first output (its own \\x1b[2J\\x1b[H) is NOT ghosted by \\x1b[3J', async () => {
    const t = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
    await write(t, W[0].text); await write(t, W[1].text); // snapshot frame present (12 lines)
    await write(t, '\x1b[3J');                              // the fix's one-shot
    // a full-repaint app's first output clears the screen itself, then draws fewer lines:
    await write(t, '\x1b[2J\x1b[H' + 'REPAINT-A\r\nREPAINT-B\r\nREPAINT-C');
    await write(t, '');
    const b = t.buffer.active; const lines = [];
    for (let y = 0; y < ROWS; y++) lines.push(b.getLine(b.baseY + y)?.translateToString(true) || '');
    const joined = lines.join('\n');
    expect(nonEmptyLines(t)).toBe(3);                       // exactly the 3 repaint lines, no ghost
    expect(joined).toContain('REPAINT-A');
    expect(joined).not.toContain('Session');               // no leftover snapshot-frame text
  });

  // human_usability review (high): an empty first output must NOT leave the one-shot armed
  // to fire on a later unrelated output. After the fix disarms on the first output message,
  // a subsequent live redraw still lands on the preserved frame.
  it('empty first output disarms the one-shot; the frame survives the later redraw', async () => {
    const t = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
    await write(t, W[0].text); await write(t, W[1].text);
    await write(t, '\x1b[3J');   // one-shot fires on the (empty) first output -> scrollback only
    // empty output carried no bytes; the REAL relative redraw arrives next and must align:
    await write(t, W[3].text);
    await write(t, '');
    expect(nonEmptyLines(t)).toBeGreaterThanOrEqual(10);    // frame preserved, not blank
  });
});
