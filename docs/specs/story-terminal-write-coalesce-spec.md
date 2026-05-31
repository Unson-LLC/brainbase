---
story_id: story-terminal-write-coalesce
title: Spec — coalesce the serialized terminal write queue
status: active
---

## Invariants

- **INV-1 (byte-identical)**: Coalescing must not change the bytes written to the terminal or
  their order. Concatenating a run of queued ops produces exactly the same stream as writing
  them one-by-one.
- **INV-2 (reset boundary)**: A `resetTerminal` op may only START a batch; ops enqueued before
  it are never merged across the `reset()`.
- **INV-3 (side-effects once-per-batch)**: viewport restore and render refresh run once per
  batched write (using the head op's viewport state; `'all'` refresh if any op requested it).
  Every op's `afterWrite` callback still fires.
- **INV-4 (generation)**: only same-generation ops coalesce; stale-generation ops
  (`_cancelTerminalWriteQueue`) are dropped, not written.

## Constraints

- **CON-1**: The drain stays serialized at the batch level (`_terminalWriteActive` guards
  re-entry); only the per-message granularity changes to per-batch.
- **CON-2**: A burst arriving while a write is in flight accumulates and coalesces on the next
  drain — that is the intended mechanism, not a race.

## Scenarios

- **S-1 (paste burst)**: N output messages arrive in a burst -> few terminal.write calls, full
  content in order.
- **S-2 (reset mid-stream)**: ops, then a reset op, then more ops -> reset() once, before/after
  not merged.
- **S-3 (afterWrite)**: multiple ops carry afterWrite -> all called after the batch.

## Anti-patterns

- **AP-1**: One terminal.write (+ viewport capture/restore + render refresh) per WS message in a
  high-frequency stream.
- **AP-2**: Merging ops across a `reset()` boundary (would drop pre-reset content or corrupt the
  screen).

## Verification

`tests/unit/terminal-write-coalesce.test.js` covers S-1 (500 -> <=3 writes, identical content),
S-2 (reset once, order preserved), S-3 (all afterWrite). `tests/e2e/story-terminal-write-coalesce-xterm.spec.js`
covers S-1 and S-2 against real xterm in a browser.
