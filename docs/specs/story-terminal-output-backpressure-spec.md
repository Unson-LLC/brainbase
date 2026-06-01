---
story_id: story-terminal-output-backpressure
title: Spec — streaming terminal output backpressure
status: active
---

## Invariants

- **INV-1 (verbatim normal path)**: While the client keeps up (`ws.bufferedAmount` below the high
  water mark), every output chunk is forwarded unchanged. No per-flush full-string scan.
- **INV-2 (bounded memory / non-blocking)**: When `ws.bufferedAmount` exceeds the high water mark,
  the transport stops appending to / sending the output stream. The in-flight buffer and the
  `outputBatch` string do not grow unbounded; the event loop is not blocked by the flood.
- **INV-3 (resync correctness)**: After dropping the backed-up stream, the client is resynced with
  a fresh `capture-pane` snapshot once the socket has drained AND the flood has paused. The terminal
  shows the correct CURRENT screen — no corruption from the dropped intermediate bytes.
- **INV-4 (single-batch bound)**: A single output chunk at or above `OUTPUT_BATCH_MAX_CHARS` is
  flushed immediately rather than buffered into one giant batch string.

## Constraints

- **CON-1**: Terminal output is an ordered byte stream; bytes cannot be partially dropped without
  corrupting terminal state. The only safe "shed" is drop-everything-then-resync via snapshot.
- **CON-2**: The tmux control client is shared across viewers (refcounted registry), so backpressure
  must be applied per-connection at the WS layer, not by pausing the shared source.
- **CON-3**: Resync must wait for both drain (`bufferedAmount <= low water`) and flood idle
  (`now - lastOutputAt >= RESYNC_IDLE_MS`) to avoid snapshotting mid-burst and immediately falling
  behind again.

## Scenarios

- **S-1 (normal)**: output below high water -> forwarded verbatim.
- **S-2 (flood)**: a send leaves the socket backlogged -> enter behind mode -> subsequent flood
  output dropped -> on drain + idle, one snapshot resyncs the client.
- **S-3 (giant chunk)**: a single >= OUTPUT_BATCH_MAX_CHARS chunk -> immediate flush.

## Anti-patterns

- **AP-1**: `ws.send` without consulting `ws.bufferedAmount` under a sustained flood (unbounded
  in-flight buffer -> event-loop block -> WS drop -> OOM/restart).
- **AP-2**: Scanning the entire flushed string every flush (debug FFFD check) on a high-throughput
  stream.
- **AP-3**: Dropping arbitrary output bytes without a snapshot resync (corrupts terminal state).

## Verification

`tests/server/services/terminal-transport-backpressure.test.js` covers S-1 (verbatim incl. FFFD),
S-2 (behind -> flood dropped -> snapshot resync, captureCache invalidated), S-3 (giant chunk
immediate flush). Existing transport-service suite (42) stays green.
