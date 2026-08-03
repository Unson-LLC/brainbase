---
story_id: story-brainbase-local-ssot-atomic-commit
status: accepted
date: 2026-08-03
owners:
  - brainbase-maintainers
supersedes: []
---

# ADR: Local SSOT writes use a recoverable aggregate commit

## Context

Brainbase OSS stores the local Personal OS in four canonical files:
`graph.json`, `relationships.json`, `personal-kg.jsonl`, and
`decisions.jsonl`. Existing CLI write flows validate a proposed aggregate but
then publish those files independently. Two processes can therefore derive
changes from the same stale snapshot, overwrite one another, or expose a mixed
aggregate after an interruption.

Changing the canonical file layout would break the portable OSS contract. The
commit protocol must therefore strengthen consistency without changing file
names or serialized shapes.

## Decision

All supported Brainbase reads and writes will share a data-directory lock.
Writers will replace the four independent save calls with one aggregate
mutation boundary that owns this sequence:

1. acquire the process-shared lock;
2. recover any incomplete transaction;
3. reload the current aggregate;
4. compute and validate the next aggregate;
5. build complete `previous` and `next` snapshots in an unregistered staging
   directory, then atomically rename the directory into the recoverable
   transaction namespace;
6. copy each retained `next` file through a canonical-directory temporary
   file, publish it by rename, and mark the transaction committed;
7. release only the lock owned by the current process.

If a normal mutation fails before the commit marker, the writer restores the
`previous` snapshot. On the next supported access, an uncommitted normal
mutation is rolled back and a committed transaction is retained and cleaned
up. A registered initialization instead rolls forward its retained complete
`next` snapshot because no previous aggregate exists.

Initial creation of the four canonical files uses the same lock and protocol.
Because no previous aggregate exists, an interrupted registered initialization
rolls forward its already complete `next` snapshot. An incomplete unregistered
staging directory has not touched canonical files and can be discarded.
Publication does not move or consume the registered `next` snapshot before the
commit marker, so initialization recovery always retains a complete source.

The aggregate mutation boundary performs Ontology validation itself. Individual
file serializers are private transaction internals rather than exported write
APIs, so supported callers cannot bypass validation or multi-file recovery.

The lock owner records a unique token, PID, and hostname. A process may recover
only a same-host lock whose PID is no longer alive. It must not guess that a
foreign-host or live-owner lock is stale.

## Consequences

- Concurrent supported writers serialize the entire read-modify-validate-publish
  critical section, preventing lost updates.
- Supported Brainbase readers do not observe a mixed four-file state because
  they use the same lock and recovery boundary.
- The four canonical file names and JSON/JSONL formats remain compatible.
- Initialization and all three public canonical mutation flows share the same
  lock and recovery semantics.
- Lock and transaction directories are runtime recovery metadata, not SSOT
  facts.
- A raw filesystem reader that ignores the Brainbase lock is outside this
  consistency guarantee.
- Multi-file atomicity is implemented as recoverable application-level
  atomicity; the operating system still performs one atomic rename per file.

## Rejected alternatives

- A single new database or aggregate file: stronger primitive atomicity, but it
  breaks the existing portable-file contract.
- Locking only publication: still permits two writers to mutate stale
  snapshots and lose one update.
- Deleting old locks by age: can destroy a valid long-running writer and is not
  safe across hosts.
- Keeping the four existing save helpers as the CLI write boundary: preserves
  the current partial-publication failure mode.
