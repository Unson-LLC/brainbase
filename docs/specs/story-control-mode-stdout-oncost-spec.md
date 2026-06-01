---
story_id: story-control-mode-stdout-oncost
title: Spec — O(n) control-mode stdout buffering
status: active
---

## Invariants

- **INV-1 (byte-identical decode)**: For any chunking of the same stdout byte stream, the sequence
  and content of emitted `output` events is identical to the previous implementation. Chunk
  boundaries (including inside a multibyte UTF-8 char or inside an octal `\NNN` escape) never change
  the decoded result.
- **INV-2 (linear time)**: Assembling a single large `%output` line that spans K chunks is O(total
  bytes), not O(total bytes^2). No per-chunk full-buffer recopy or full rescan.
- **INV-3 (bounded memory)**: A single line that never terminates is flushed once it exceeds
  `MAX_PENDING_LINE_BYTES`, so pending memory is bounded.

## Constraints

- **CON-1**: Cross-line carryover state (`_pendingLineBytes`, `_pendingUtf8Bytes`) is unchanged; the
  buffering change is purely how raw bytes are accumulated and split on `0x0A`.
- **CON-2**: `decodeTmuxEscapes` still decodes named escapes (`\n \r \t`), `\\`, and 3-digit octal
  runs into UTF-8 exactly as before; only non-escape runs are copied in bulk instead of per char.

## Scenarios

- **S-1 (giant line)**: one `%output` line of N MB arrives in 64KB chunks -> assembled + decoded in
  O(N), well under a one-second bound for tens of MB.
- **S-2 (split boundaries)**: a `%output` line split across chunk boundaries mid-multibyte and
  mid-escape decodes identically to feeding it whole.
- **S-3 (many small lines)**: ordinary per-redraw `%output` lines still emit one `output` per line in
  order.

## Anti-patterns

- **AP-1**: `Buffer.concat([wholeBuffer, chunk])` + rescan-from-0 on every chunk (O(n^2)).
- **AP-2**: char-by-char `result += value[i]` over a large non-escape run.

## Verification

`tests/server/services/tmux-control-stdout-oncost.test.js` covers S-1 (20MB PERF guard), S-2
(multi-chunk + mid-multibyte split correctness), and S-3 (multi-line reassembly). The existing
control-client decode suite (34 tests) guards INV-1/CON-2.
