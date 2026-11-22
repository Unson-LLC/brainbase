import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  cancelKnowledgeLookup,
  createKnowledgeLookup,
  prepareKnowledgeAction,
  recordKnowledgeResult,
  stopKnowledgeLookup,
  type KnowledgeLookupState
} from '../src/knowledge-continuation.js';

// The continuation has no transition table in code: status is a summary of
// pending, attempts and budgets. This test drives the public functions
// breadth-first and compares every status change it sees with the spec's
// state diagram, in both directions.

const FIELD = 'environments.production.endpoint';
const refA = { id: 'app_a', entity_type: 'app', evidence_fields: [FIELD] };
const refB = { id: 'app_b', entity_type: 'app', evidence_fields: [FIELD] };
const REPLAN = { assessment: 'insufficient', why_different: 'a different angle' };
const LIMITS = { attempts: 3, replans: 2, milliseconds: 1000 };
const ON_TIME = 1;
const LATE = 5000;
// Every status change is reached within this depth; a depth of 9 finds the same set.
const DEPTH = 6;

function plan(state: KnowledgeLookupState, nextAction: object, extra: object = {}): object {
  return {
    question: 'Example endpoint?',
    target_hint: 'Example',
    lookup_id: state.lookup_id,
    revision: state.revision,
    required_fields: [FIELD],
    next_action: nextAction,
    ...extra
  };
}

function plans(state: KnowledgeLookupState): Array<[string, unknown]> {
  const replan = state.attempts.length > 0 ? REPLAN : {};
  const lastRead = [...state.attempts].reverse().find((attempt) => attempt.references.length > 0);
  const evidence = [{ field: FIELD, reference_id: refA.id, attempt_id: lastRead?.attempt_id ?? 'none' }];
  return [
    ['search', plan(state, { kind: 'search', query: 'Example' }, replan)],
    ['readA', plan(state, { kind: 'read', entity_id: refA.id, entity_type: 'app' }, replan)],
    ['readB', plan(state, { kind: 'read', entity_id: refB.id, entity_type: 'app' }, replan)],
    ['invalid', { not: 'a plan' }],
    ['satisfied', plan(state, { kind: 'finish', status: 'satisfied', assessment: 'sufficient', reference_ids: [refA.id], field_evidence: evidence, unresolved_items: [], termination_reason: 'done' })],
    ['unresolved', plan(state, { kind: 'finish', status: 'unresolved', assessment: 'insufficient', reference_ids: [], field_evidence: [], unresolved_items: [FIELD], termination_reason: 'not found' })],
    ['user', plan(state, { kind: 'finish', status: 'needs_user_input', assessment: 'insufficient', reference_ids: [], field_evidence: [], unresolved_items: [FIELD], termination_reason: 'target_ambiguous' })]
  ];
}

const RESULTS: readonly unknown[] = [
  { status: 'ok', data: { outcome: 'retrieved', references: [refA], missing_fields: [] } },
  { status: 'ok', data: { outcome: 'retrieved', references: [refA, refB], missing_fields: [] } },
  { status: 'ok', data: { outcome: 'empty', references: [], missing_fields: [FIELD] } },
  { status: 'ok', data: { outcome: 'transport_error', references: [] } },
  { status: 'ok', data: { outcome: 'forbidden', references: [] } },
  { status: 'ok' },
  { status: 'error' }
];

interface Node {
  readonly state: KnowledgeLookupState;
  readonly inputs: ReadonlyMap<string, unknown>;
}

function observedSteps(): string[] {
  const start = createKnowledgeLookup({ lookupId: 'lookup-1', question: 'q', now: 0, limits: LIMITS });
  const seen = new Set<string>([`createKnowledgeLookup:-:${start.status}`]);
  const visited = new Set<string>([JSON.stringify(start)]);
  let frontier: Node[] = [{ state: start, inputs: new Map() }];
  for (let depth = 0; depth < DEPTH && frontier.length > 0; depth += 1) {
    const next: Node[] = [];
    for (const { state, inputs } of frontier) {
      const calls: Array<[string, () => KnowledgeLookupState, ReadonlyMap<string, unknown>]> = [];
      for (const now of [ON_TIME, LATE]) {
        for (const [name, input] of plans(state)) {
          const id = `call-${state.revision}-${name}`;
          calls.push(['prepareKnowledgeAction', () => prepareKnowledgeAction(state, input, id, now).state, new Map([...inputs, [id, input]])]);
        }
        const pending = state.pending;
        if (pending !== null) {
          for (const result of RESULTS) {
            calls.push(['recordKnowledgeResult', () => recordKnowledgeResult(state, inputs.get(pending.tool_use_id), result, pending.tool_use_id, now), inputs]);
          }
        }
        calls.push(['stopKnowledgeLookup', () => stopKnowledgeLookup(state, now).state, inputs]);
      }
      calls.push(['cancelKnowledgeLookup', () => cancelKnowledgeLookup(state), inputs]);
      for (const [operation, call, nextInputs] of calls) {
        const out = call();
        if (out.status !== state.status) seen.add(`${operation}:${state.status}:${out.status}`);
        const key = JSON.stringify(out);
        if (!visited.has(key)) {
          visited.add(key);
          next.push({ state: out, inputs: nextInputs });
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** Expands the `operation: from -> to` lines of the spec's state diagram. */
async function diagramSteps(): Promise<string[]> {
  const spec = await readFile(new URL('../docs/specs/story-knowledge-retrieval-continuation-spec.md', import.meta.url), 'utf8');
  const block = /## 状態と操作[\s\S]*?```text\n([\s\S]*?)```/u.exec(spec);
  if (block === null) throw new Error('state diagram not found in story-knowledge-retrieval-continuation-spec');
  return block[1].split('\n').filter((line) => line.trim() !== '').flatMap((line) => {
    const match = /^(\w+):\s+(\S+)\s+->\s+([\w|\s]+?)(?:\s+\(.*\))?\s*$/u.exec(line);
    if (match === null) throw new Error(`unreadable state diagram line: ${line}`);
    const sources = match[2] === '(new)' ? ['-'] : match[2].split('/');
    const targets = match[3].split('|').map((target) => target.trim());
    return sources.flatMap((source) => targets.map((target) => `${match[1]}:${source}:${target}`));
  });
}

describe('knowledge continuation state diagram', () => {
  it('is exactly the set of status changes the public functions make', { timeout: 60_000 }, async () => {
    expect(observedSteps().sort()).toEqual((await diagramSteps()).sort());
  });

  it('never rewrites a finished lookup when it is cancelled', () => {
    const cancelled = cancelKnowledgeLookup(createKnowledgeLookup({ lookupId: 'lookup-1', question: 'q', now: 0 }));
    expect(cancelled).toMatchObject({ status: 'cancelled', termination_reason: 'user_cancelled' });
    expect(cancelKnowledgeLookup(cancelled)).toEqual(cancelled);

    const finished = { ...cancelled, status: 'satisfied', termination_reason: 'model_assessed_with_retrieval' } as KnowledgeLookupState;
    const again = cancelKnowledgeLookup(finished);
    expect(again).toEqual(finished);
    expect(again).not.toBe(finished);
  });
});
