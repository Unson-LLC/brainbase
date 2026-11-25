# Task semantic preparation gate (UNS-8, draft)

A Host configured with `JudgmentHostOptions.taskProgress` binds one task,
criterion and contract revision into the immutable episode at UserPromptSubmit.
At Stop, before autonomy continuation or finalization, it obtains a semantic
observation from the configured adapter. The adapter is trusted Host code; no
classification or scope is accepted from the Stop payload or answer text.

Two preparation-only observations for that scope require a change of approach,
even when the retrieved documents, event digests, sessions or turns differ.
The Host returns `block_kind=semantic_replan` before writing a final receipt.
Replaying the same episode/event-set cannot consume another observation or
invoke the assessor again. Replaying a blocked snapshot fails closed instead
of issuing an endless series of identical continuation prompts.

The append-only task ledger shares one scope lock across sessions and links
its entries by digest. Evidence IDs must identify successful events in the
current immutable episode. Waiting does not count as preparation and does not
reset the history. A new negative result or criterion advancement resets it
only after the adapter's independent `verifyOutcome` check succeeds; repeating
a prior immutable verification reference is rejected. Verification failure and
malformed observations leave the ledger unchanged.

## Adapter obligations and limits

- Resolve task, criterion and revision from the authorized canonical task before
  opening the episode. Do not let a model rename a scope to evade the gate.
- `assess` supplies semantics, including whether work is preparation, waiting,
  or an actual new outcome. The Host does not infer this from keywords or count
  tool calls, elapsed time, tokens, or money.
- `verifyOutcome` must read/check the actual task-bound result independently.
  Returning true on the model's declaration alone does not satisfy this contract.
- `verification_ref` identifies an immutable checked result, not a mutable URL.
- Do not invoke a paid model by default. No model provider is built into the gate.
- This ledger is execution control, never task completion or human acceptance.

## Validation and rollout boundary

`tests/judgment-host-task-progress.test.ts` exercises UserPromptSubmit,
PostToolUse and Stop through the portable Host, including different preparation
results across sessions, task binding changes, concurrent Stops, independent
negative-result verification, malformed evidence, corruption and replay.
The semantic assessor and independent verifier are test adapters: these tests
prove enforcement of their decisions, not the truth of semantic classification.

This change is opt-in and has no installed production adapter. The existing
Unson Host still uses its existing evidence-digest continuation policy. Adoption
requires a pinned OSS package, a canonical-task-bound semantic assessment and
independent readback adapter, then fresh ordinary Codex/Claude Code Host evidence.
Neither these tests nor opening the draft PR satisfies UNS-8's three completion
conditions. Same-task formal submission, owner acceptance and owner quality/load
evaluation remain separate required evidence. No runtime rollout is performed.
