# Judgment lifecycle core v1

This package export is the Stage 3a portability boundary for the judgment
Host. It extracts deterministic lifecycle logic while leaving the existing
Host as the owner of authority, storage, and external effects.

## Core responsibilities

`judgment-lifecycle-core` provides pure projections and a small port-driven
state machine for:

- normalizing a request from Host-provided conversation context;
- validating the context digest and receipt/request binding;
- creating the adoption and episode records;
- rendering the owner audit line from a request and receipt;
- creating deterministic tool events and final receipts;
- adopting an existing episode, replaying an identical event, and rejecting
  conflicts;
- blocking finalization until the Host reports a complete audit; and
- enqueueing a finalized projection after the journal write.

The core is deterministic for the same input values. Callers provide timestamps
and external response values explicitly, so the core does not read files,
environment variables, Graph data, credentials, or the network.

## Ports and ownership

The `JudgmentLifecyclePorts` contract has three boundaries:

- `journal` owns locking, validation, canonical journal writes, and readback;
- `resolver` supplies the approved `JudgmentReceipt` for a canonical request;
- `transport` is optional and receives a finalized projection after the journal
  has accepted it.

Task/Graph authorization, tenant binding, value-proof persistence,
continuation, and remote MCP transport remain Host responsibilities. A Host
must complete those checks at its existing boundaries and must not treat this
core export as a claim that those systems have moved to OSS.

The existing `judgment-host` orchestration remains compatible with this
contract. The Stage 3a consumer adapter can bind its current journal and
resolver implementations to these ports without moving the Unson canonical
write path.

## Completion contract

`finalize` returns a `block` result when the Host has not completed the audit.
On success it writes a `brainbase-judgment-final-v1` receipt with the event set
digest and owner audit line count, then calls the optional transport port. A
repeated finalization with the same answer is replay-safe; a different answer,
event set, or episode binding is rejected as a conflict.

This v1 boundary intentionally does not move transcript discovery, journal
locking, Task/Graph auth or persistence, credential transport, or Stop-hook
finalization. Those remain in the Host until a separately reviewed consumer
adapter proves equivalent behavior.
