import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createJudgmentDAGEvaluationEventSet,
  createJudgmentDAGOutcomeAttachment,
  evaluateJudgmentDAGVersions,
  executeJudgmentDAG,
  loadJudgmentDAGRunArtifact,
  replayJudgmentDAGRun,
  saveJudgmentDAGRunArtifact,
  type JudgmentDAG,
  type JudgmentDAGRunRecord
} from '../src/judgment-dag.js';
import * as replayEvaluation from '../src/judgment-dag-replay-evaluation.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'brainbase-r1-replay-'));
  roots.push(root);
  return root;
}

function dag(version: string, includeCandidateOnly = false): JudgmentDAG {
  return {
    id: 'r1-evaluation-test',
    version,
    nodes: [
      {
        id: 'context',
        node_type: 'observation',
        layer: 'context',
        scope: { type: 'project', id: 'r1-evaluation-test' },
        version: '1.0.0',
        description: 'recorded context',
        depends_on: [],
        input_contract: 'r1.input.v1',
        output_contract: 'r1.context.v1',
        runner_type: 'deterministic'
      },
      {
        id: 'judgment',
        node_type: 'judgment',
        layer: 'judgment',
        scope: { type: 'project', id: 'r1-evaluation-test' },
        version,
        description: 'versioned judgment',
        depends_on: ['context'],
        input_contract: 'r1.input.v1',
        output_contract: 'r1.judgment.v1',
        runner_type: 'deterministic'
      },
      ...(includeCandidateOnly ? [{
        id: 'candidate-only',
        node_type: 'evaluation' as const,
        layer: 'evaluation' as const,
        scope: { type: 'project' as const, id: 'r1-evaluation-test' },
        version,
        description: 'candidate-only calibration node',
        depends_on: ['judgment'],
        input_contract: 'r1.input.v1',
        output_contract: 'r1.evaluation.v1',
        runner_type: 'deterministic' as const
      }] : [])
    ],
    edges: [
      { from: 'context', to: 'judgment', relation: 'depends_on' },
      ...(includeCandidateOnly
        ? [{ from: 'judgment', to: 'candidate-only', relation: 'depends_on' as const }]
        : [])
    ]
  };
}

async function runRecord(
  runId: string,
  version: string,
  input: { prompt: string },
  includeCandidateOnly = false
): Promise<JudgmentDAGRunRecord> {
  return executeJudgmentDAG({
    run_id: runId,
    dag: dag(version, includeCandidateOnly),
    input,
    runners: {
      deterministic: {
        version: `runner-${version}`,
        run: ({ node, input: recordedInput }) => ({ node_id: node.id, input: recordedInput, version })
      }
    }
  });
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) expectDeeplyFrozen(child);
}

describe('R1 replay and evaluation primitives', () => {
  it('replays a fresh-loaded historical record with its exact context and runner version', async () => {
    const root = await temporaryRoot();
    const historical = await runRecord('run-baseline', 'v1', { prompt: 'recorded context' });
    const saved = await saveJudgmentDAGRunArtifact({ root, record: historical });
    const loaded = await loadJudgmentDAGRunArtifact({ root, artifact_id: saved.artifact_id });
    const runner = vi.fn(({ node, input }) => ({ node_id: node.id, input, version: 'v1' }));

    const replay = await replayJudgmentDAGRun({
      source: { artifact_id: saved.artifact_id, record: loaded },
      replay_run_id: 'run-historical-replay',
      mode: 'historical',
      runners: { deterministic: { version: 'runner-v1', run: runner } }
    });

    expect(replay.source_artifact_id).toBe(saved.artifact_id);
    expect(replay.source_run_id).toBe('run-baseline');
    expect(replay.record.run_id).toBe('run-historical-replay');
    expect(replay.record.dag).toEqual(loaded.dag);
    expect(replay.record.input).toEqual({ prompt: 'recorded context' });
    expect(runner).toHaveBeenCalledTimes(2);
    expectDeeplyFrozen(replay);

    const mismatched = vi.fn(() => ({ ok: true }));
    await expect(replayJudgmentDAGRun({
      source: { artifact_id: saved.artifact_id, record: loaded },
      replay_run_id: 'run-mismatch',
      mode: 'historical',
      runners: { deterministic: { version: 'runner-v2', run: mismatched } }
    })).rejects.toMatchObject({ code: 'runner_version_mismatch' });
    expect(mismatched).not.toHaveBeenCalled();
  });

  it('creates separate immutable outcomes and compares versions on one immutable event set', async () => {
    const root = await temporaryRoot();
    const input = { prompt: 'same historical context' };
    const baseline = await runRecord('run-baseline', 'v1', input);
    const baselineSaved = await saveJudgmentDAGRunArtifact({ root, record: baseline });
    const candidateReplay = await replayJudgmentDAGRun({
      source: { artifact_id: baselineSaved.artifact_id, record: baseline },
      replay_run_id: 'run-candidate',
      mode: 'candidate',
      candidate_dag: dag('v2', true),
      runners: {
        deterministic: {
          version: 'runner-v2',
          run: ({ node, input: recordedInput }) => ({ node_id: node.id, input: recordedInput, version: 'v2' })
        }
      }
    });
    const candidateSaved = await saveJudgmentDAGRunArtifact({ root, record: candidateReplay.record });
    expect(candidateReplay.record.input).toEqual(input);

    const baselineOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: baselineSaved.artifact_id,
      record: baseline,
      observations: [
        { metric_id: 'quality', scope: 'run', value: 60 },
        { metric_id: 'quality', scope: 'node', node_id: 'judgment', value: 0.6 }
      ]
    });
    const candidateOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: candidateSaved.artifact_id,
      record: candidateReplay.record,
      observations: [
        { metric_id: 'quality', scope: 'run', value: 80 },
        { metric_id: 'quality', scope: 'node', node_id: 'judgment', value: 0.8 },
        { metric_id: 'quality', scope: 'node', node_id: 'candidate-only', value: 0.9 }
      ]
    });
    expect(baselineOutcome.run_id).toBe('run-baseline');
    expect(baselineOutcome.attachment_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expectDeeplyFrozen(baselineOutcome);

    const mutableEvents = [{
      event_id: 'event-1',
      baseline: { artifact_id: baselineSaved.artifact_id, record: baseline, outcome: baselineOutcome },
      candidate: { artifact_id: candidateSaved.artifact_id, record: candidateReplay.record, outcome: candidateOutcome }
    }];
    const eventSet = createJudgmentDAGEvaluationEventSet({ events: mutableEvents });
    mutableEvents[0]!.event_id = 'caller-mutation';
    expect(eventSet.event_ids).toEqual(['event-1']);
    expect(eventSet.event_set_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expectDeeplyFrozen(eventSet);

    const comparison = evaluateJudgmentDAGVersions({
      event_set: eventSet,
      criterion: {
        criterion_id: 'quality-score',
        goal: 'increase judgment quality',
        metric_id: 'quality',
        scoring: { kind: 'numeric', direction: 'higher_is_better' }
      }
    });

    expect(comparison.event_set_id).toBe(eventSet.event_set_id);
    expect(comparison.overall).toEqual({ baseline: 60, candidate: 80, delta: 20, event_count: 1 });
    expect(comparison.node_calibration).toMatchObject([
      { node_id: 'candidate-only', status: 'candidate_only', baseline: null, candidate: null, delta: null, event_count: 0 },
      { node_id: 'context', status: 'no_observation', baseline: null, candidate: null, delta: null, event_count: 0 },
      { node_id: 'judgment', status: 'comparable', baseline: 0.6, candidate: 0.8, event_count: 1 }
    ]);
    expect(comparison.node_calibration[2]!.delta).toBeCloseTo(0.2);
    expectDeeplyFrozen(comparison);

    expect(await loadJudgmentDAGRunArtifact({ root, artifact_id: baselineSaved.artifact_id })).toEqual(baseline);
    expect(await loadJudgmentDAGRunArtifact({ root, artifact_id: candidateSaved.artifact_id }))
      .toEqual(candidateReplay.record);
    expect('outcome' in baseline).toBe(false);
  });

  it('uses a data-only pass/fail criterion without callbacks', async () => {
    const root = await temporaryRoot();
    const input = { prompt: 'pass/fail context' };
    const baseline = await runRecord('run-pass-baseline', 'v1', input);
    const candidate = await runRecord('run-pass-candidate', 'v2', input);
    const artifactA = (await saveJudgmentDAGRunArtifact({ root, record: baseline })).artifact_id;
    const artifactB = (await saveJudgmentDAGRunArtifact({ root, record: candidate })).artifact_id;
    const baselineOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: artifactA,
      record: baseline,
      observations: [{ metric_id: 'accepted', scope: 'run', value: false }]
    });
    const candidateOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: artifactB,
      record: candidate,
      observations: [{ metric_id: 'accepted', scope: 'run', value: true }]
    });
    const eventSet = createJudgmentDAGEvaluationEventSet({
      events: [{
        event_id: 'pass-fail-event',
        baseline: { artifact_id: artifactA, record: baseline, outcome: baselineOutcome },
        candidate: { artifact_id: artifactB, record: candidate, outcome: candidateOutcome }
      }]
    });

    const comparison = evaluateJudgmentDAGVersions({
      event_set: eventSet,
      criterion: {
        criterion_id: 'accepted-criterion',
        goal: 'accept the recorded judgment',
        metric_id: 'accepted',
        scoring: { kind: 'pass_fail', operator: 'eq', target: true }
      }
    });

    expect(comparison.overall).toEqual({ baseline: 0, candidate: 1, delta: 1, event_count: 1 });
  });

  it('fails closed for context/outcome mismatch, duplicate events, and invalid observations', async () => {
    const root = await temporaryRoot();
    const baseline = await runRecord('run-a', 'v1', { prompt: 'A' });
    const candidate = await runRecord('run-b', 'v2', { prompt: 'B' });
    const artifactA = (await saveJudgmentDAGRunArtifact({ root, record: baseline })).artifact_id;
    const artifactB = (await saveJudgmentDAGRunArtifact({ root, record: candidate })).artifact_id;
    const outcomeA = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: artifactA,
      record: baseline,
      observations: [{ metric_id: 'pass', scope: 'run', value: true }]
    });
    const outcomeB = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: artifactB,
      record: candidate,
      observations: [{ metric_id: 'pass', scope: 'run', value: true }]
    });

    await expect(Promise.resolve().then(() => createJudgmentDAGEvaluationEventSet({
      events: [{
        event_id: 'different-context',
        baseline: { artifact_id: artifactA, record: baseline, outcome: outcomeA },
        candidate: { artifact_id: artifactB, record: candidate, outcome: outcomeB }
      }]
    }))).rejects.toMatchObject({ code: 'context_mismatch' });

    const sameContextCandidate = await runRecord('run-c', 'v2', { prompt: 'A' });
    const sameContextArtifact = (await saveJudgmentDAGRunArtifact({
      root,
      record: sameContextCandidate
    })).artifact_id;
    const sameContextOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: sameContextArtifact,
      record: sameContextCandidate,
      observations: [{ metric_id: 'pass', scope: 'run', value: true }]
    });
    const repeatedEvent = {
      event_id: 'duplicate',
      baseline: { artifact_id: artifactA, record: baseline, outcome: outcomeA },
      candidate: {
        artifact_id: sameContextArtifact,
        record: sameContextCandidate,
        outcome: sameContextOutcome
      }
    };
    expect(() => createJudgmentDAGEvaluationEventSet({
      events: [repeatedEvent, repeatedEvent]
    })).toThrow(expect.objectContaining({ code: 'invalid_request' }));

    const tamperedOutcome = { ...sameContextOutcome, attachment_id: `sha256:${'e'.repeat(64)}` };
    expect(() => createJudgmentDAGEvaluationEventSet({
      events: [{ ...repeatedEvent, event_id: 'tampered-outcome', candidate: {
        ...repeatedEvent.candidate,
        outcome: tamperedOutcome
      } }]
    })).toThrow(expect.objectContaining({ code: 'outcome_mismatch' }));

    expect(() => createJudgmentDAGOutcomeAttachment({
      run_artifact_id: artifactA,
      record: baseline,
      observations: [{ metric_id: 'quality', scope: 'run', value: Number.NaN }]
    })).toThrow(expect.objectContaining({ code: 'invalid_request' }));

    expect(() => createJudgmentDAGOutcomeAttachment({
      run_artifact_id: artifactA,
      record: baseline,
      observations: [{ metric_id: 'quality', scope: 'node', node_id: 'missing', value: 1 }]
    })).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('rejects an artifact id that does not address the supplied record', async () => {
    const root = await temporaryRoot();
    const baseline = await runRecord('run-artifact-binding', 'v1', { prompt: 'bound content' });
    const saved = await saveJudgmentDAGRunArtifact({ root, record: baseline });
    const fakeArtifactId = `sha256:${'f'.repeat(64)}`;

    expect(() => createJudgmentDAGOutcomeAttachment({
      run_artifact_id: fakeArtifactId,
      record: baseline,
      observations: [{ metric_id: 'quality', scope: 'run', value: 1 }]
    })).toThrow(expect.objectContaining({ code: 'artifact_mismatch' }));

    const runner = vi.fn(() => ({ ok: true }));
    await expect(replayJudgmentDAGRun({
      source: { artifact_id: fakeArtifactId, record: baseline },
      replay_run_id: 'run-fake-artifact-replay',
      mode: 'historical',
      runners: { deterministic: { version: 'runner-v1', run: runner } }
    })).rejects.toMatchObject({ code: 'artifact_mismatch' });
    expect(runner).not.toHaveBeenCalled();

    const outcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: saved.artifact_id,
      record: baseline,
      observations: [{ metric_id: 'quality', scope: 'run', value: 1 }]
    });
    expect(() => createJudgmentDAGEvaluationEventSet({
      events: [{
        event_id: 'fake-artifact-event',
        baseline: { artifact_id: fakeArtifactId, record: baseline, outcome },
        candidate: { artifact_id: saved.artifact_id, record: baseline, outcome }
      }]
    })).toThrow(expect.objectContaining({ code: 'artifact_mismatch' }));
  });

  it('captures runner registrations once and rejects accessor-based substitutions', async () => {
    const root = await temporaryRoot();
    const historical = await runRecord('run-runner-capture', 'v1', { prompt: 'stable runner' });
    const saved = await saveJudgmentDAGRunArtifact({ root, record: historical });
    const runner = vi.fn(() => ({ ok: true }));
    let getterReads = 0;
    const runners = {} as Record<string, { version: string; run: typeof runner }>;
    Object.defineProperty(runners, 'deterministic', {
      enumerable: true,
      configurable: true,
      get() {
        getterReads += 1;
        return { version: getterReads === 1 ? 'runner-v1' : 'runner-v2', run: runner };
      }
    });

    await expect(replayJudgmentDAGRun({
      source: { artifact_id: saved.artifact_id, record: historical },
      replay_run_id: 'run-runner-substitution',
      mode: 'historical',
      runners
    })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(getterReads).toBe(0);
    expect(runner).not.toHaveBeenCalled();
  });

  it('exports the R1 implementation from the public judgment-dag subpath', () => {
    expect(replayJudgmentDAGRun).toBe(replayEvaluation.replayJudgmentDAGRun);
    expect(createJudgmentDAGOutcomeAttachment).toBe(replayEvaluation.createJudgmentDAGOutcomeAttachment);
    expect(createJudgmentDAGEvaluationEventSet).toBe(replayEvaluation.createJudgmentDAGEvaluationEventSet);
    expect(evaluateJudgmentDAGVersions).toBe(replayEvaluation.evaluateJudgmentDAGVersions);
  });
});
