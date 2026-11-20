import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConnectedOnboardingRuntime,
  ONBOARDING_WORKFLOW_STATES,
  type ConnectedOnboardingRun,
  type SourceInventoryInput
} from '../src/connected-onboarding.js';
import { ONBOARDING_WORKFLOW_STATES as RUNTIME_WORKFLOW_STATES } from '../src/onboarding-runtime.js';
import { initializePersonalOs } from '../src/ssot.js';

const TEST_TMP_ROOT = process.env.BRAINBASE_TEST_FIXTURE_ROOT ?? tmpdir();
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const drive: SourceInventoryInput = {
  id: 'drive-project-a',
  mode: 'drive',
  status: 'ready',
  evidencePointer: 'drive://folder/project-a',
  permissionScope: ['folder:project-a']
};

function receipt(hash: string) {
  return {
    sourceId: drive.id,
    evidencePointer: drive.evidencePointer!,
    contentHash: `sha256:${hash.repeat(64)}`,
    permissionSnapshot: { scopes: ['folder:project-a'] },
    collectionStatus: 'collected' as const
  };
}

function project(name: string, evidenceId: string) {
  return { kind: 'project', payload: { name }, observationClass: 'observed' as const, evidenceId };
}

/** Runs every operation, including retries and late calls, and records each state change. */
async function observedSteps(): Promise<string[]> {
  const dataDir = await mkdtemp(join(TEST_TMP_ROOT, 'brainbase-onboarding-transitions-'));
  dirs.push(dataDir);
  await initializePersonalOs(dataDir);
  const runtime = new ConnectedOnboardingRuntime(dataDir);
  const seen = new Set<string>();
  const states = new Map<string, string>();
  const step = async (operation: string, call: () => Promise<ConnectedOnboardingRun>): Promise<ConnectedOnboardingRun | undefined> => {
    let run: ConnectedOnboardingRun;
    try {
      run = await call();
    } catch {
      return undefined;
    }
    const before = states.get(run.id) ?? '-';
    if (before !== run.state) seen.add(`${operation}:${before}:${run.state}`);
    states.set(run.id, run.state);
    return run;
  };

  // A blocked run stays initialized: ingest is refused.
  const blocked = await step('start', () => runtime.start({ valueTarget: '案件を知る', sources: [{ id: 'gmail', mode: 'gmail', status: 'error', detail: 'timeout' }] }));
  await step('ingest', () => runtime.ingest(blocked!.id, { source: receipt('a'), candidates: [project('Alpha', 'e-1')] }));

  // A fallback run starts source_ready like a warm one.
  await step('start', () => runtime.start({
    valueTarget: '案件を知る',
    sources: [{ id: 'doc', mode: 'single_document', status: 'ready', evidencePointer: 'file:///tmp/a.md', permissionScope: ['document:a.md'] }]
  }));

  // A run whose only review rejects its candidate.
  const rejecting = await step('start', () => runtime.start({ valueTarget: '案件を知る', sources: [drive] }));
  const rejectingIngest = await step('ingest', () => runtime.ingest(rejecting!.id, { source: receipt('b'), candidates: [project('Beta', 'e-b')] }));
  await step('review', () => runtime.review(rejecting!.id, [{ candidateId: rejectingIngest!.candidates[0].id, decision: 'reject', reason: '対象外' }]));

  // The full path, with retries and later calls at every stage.
  const run = await step('start', () => runtime.start({ valueTarget: '案件を知る', sources: [drive] }));
  const id = run!.id;
  await step('ingest', () => runtime.ingest(id, { source: receipt('c'), candidates: [] }));
  const ingested = await step('ingest', () => runtime.ingest(id, { source: receipt('c'), candidates: [project('Gamma', 'e-1')] }));
  await step('ingest', () => runtime.ingest(id, { source: receipt('c'), candidates: [project('Gamma', 'e-1')] }));
  const approve = ingested!.candidates.map((candidate) => ({ candidateId: candidate.id, decision: 'approve' as const, reason: '確認済み' }));
  const reviewed = await step('review', () => runtime.review(id, approve));
  await step('review', () => runtime.review(id, approve));
  await step('ingest', () => runtime.ingest(id, { source: receipt('c'), candidates: [project('Delta', 'e-2')] }));
  const record = { action: 'record' as const, answerHash: `sha256:${'e'.repeat(64)}`, usedCanonicalIds: reviewed!.promotedCanonicalIds.slice(0, 1) };
  await step('firstValue', () => runtime.firstValue(id, record));
  await step('firstValue', () => runtime.firstValue(id, record));
  await step('firstValue', () => runtime.firstValue(id, { action: 'review', verdict: 'useful', missingContext: [] }));
  await step('firstValue', () => runtime.firstValue(id, { action: 'review', verdict: 'useful', missingContext: [] }));
  await step('ingest', () => runtime.ingest(id, { source: receipt('c'), candidates: [project('Epsilon', 'e-3')] }));
  return [...seen];
}

/** Expands the `operation: from -> to` lines of the spec's state diagram. */
async function diagramSteps(): Promise<string[]> {
  const spec = await readFile(new URL('../docs/specs/story-brainbase-portable-connected-world-onboarding.md', import.meta.url), 'utf8');
  const block = /## 状態と操作[\s\S]*?```text\n([\s\S]*?)```/u.exec(spec);
  if (block === null) throw new Error('state diagram not found in story-brainbase-portable-connected-world-onboarding');
  return block[1].split('\n').filter((line) => line.trim() !== '').flatMap((line) => {
    const match = /^(\w+):\s+(\S+)\s+->\s+([\w|\s]+?)(?:\s+\(.*\))?\s*$/u.exec(line);
    if (match === null) throw new Error(`unreadable state diagram line: ${line}`);
    const sources = match[2] === '(new)' ? ['-'] : match[2].split('/');
    const targets = match[3].split('|').map((target) => target.trim());
    return sources.flatMap((source) => targets.map((target) => `${match[1]}:${source}:${target}`));
  });
}

describe('connected onboarding state diagram', () => {
  it('has one list of states, shared by both public entry points', () => {
    expect(RUNTIME_WORKFLOW_STATES).toBe(ONBOARDING_WORKFLOW_STATES);
    expect([...ONBOARDING_WORKFLOW_STATES]).toEqual([
      'initialized', 'source_ready', 'candidates_ready', 'promotion_reviewed', 'first_value_ready', 'first_value_answer_reviewed'
    ]);
  });

  it('is exactly the set of state changes the runtime makes', { timeout: 60_000 }, async () => {
    const observed = await observedSteps();
    expect(observed.sort()).toEqual((await diagramSteps()).sort());
    // Every change moves forward in the shared order.
    for (const step of observed) {
      const [, from, to] = step.split(':');
      if (from !== '-') {
        expect(ONBOARDING_WORKFLOW_STATES.indexOf(to as never)).toBeGreaterThan(ONBOARDING_WORKFLOW_STATES.indexOf(from as never));
      }
    }
  });
});
