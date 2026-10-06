import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMeetingMinutesLineageStore,
  initializeMeetingMinutesLineageStore,
  MeetingMinutesLineageError,
  type AdoptionReference,
  type ExecutionReceiptPort,
  type JudgmentAdoptionResult,
  type JudgmentLineagePort,
  type MinutesLineageAccess,
  type MinutesLineageActor,
  type MinutesLineageCandidate,
  type MinutesLineageTargetReference,
  type MinutesVersionPort,
  type MinutesVersionReference,
  type ResultPort,
  type TaskAdoptionResult,
  type TaskLineagePort,
} from '../src/meeting-minutes-lineage.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const access: MinutesLineageAccess = { principal: 'person-1', scope: 'company-1' };
const actor: MinutesLineageActor = { type: 'person', id: 'person-1' };

const minutesV1: MinutesVersionReference = {
  meetingId: 'meeting-1',
  minutesId: 'minutes-1',
  versionId: 'v1',
  contentDigest: 'sha256:minutes-v1',
  locator: { section: 'decisions', item: 2 },
  provenance: { providerKind: 'google_drive', providerId: 'doc-1', revision: 'v1', digest: 'sha256:source-v1' },
};

const minutesV2: MinutesVersionReference = {
  ...minutesV1,
  versionId: 'v2',
  contentDigest: 'sha256:minutes-v2',
  provenance: { ...minutesV1.provenance, revision: 'v2', digest: 'sha256:source-v2' },
};

async function makeDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-lineage-'));
  dataDirs.push(directory);
  await initializeMeetingMinutesLineageStore(directory);
  return directory;
}

function targetFor(kind: 'judgment' | 'task', candidate: MinutesLineageCandidate): MinutesLineageTargetReference {
  if (kind === 'judgment') {
    return {
      kind,
      id: `judgment-${candidate.id}`,
      revision: '2',
      digest: `sha256:judgment-${candidate.id}`,
    };
  }
  return { kind, id: `task-${candidate.id}`, version: 1, digest: `sha256:task-${candidate.id}` };
}

function adoptionFor(kind: 'judgment' | 'task', candidate: MinutesLineageCandidate): AdoptionReference {
  return {
    kind: kind === 'judgment' ? 'judgment_adoption' : 'task_adoption',
    id: `adoption-${candidate.id}`,
    revision: '1',
    digest: `sha256:adoption-${candidate.id}`,
  };
}

function createProviderFixtures() {
  const current = new Map<string, MinutesVersionReference>([
    [minutesV1.versionId, minutesV1],
    [minutesV2.versionId, minutesV2],
  ]);
  let denyMinutes = false;
  const minutesReads: MinutesVersionReference[] = [];
  const minutes: MinutesVersionPort = {
    readExact: vi.fn(async (reference) => {
      minutesReads.push(reference);
      if (denyMinutes) throw new MeetingMinutesLineageError('authorization_denied', 'minutes ACL denied');
      const stored = current.get(reference.versionId);
      return stored ? { reference: stored } : null;
    }),
  };

  const judgmentTargets = new Map<string, MinutesLineageTargetReference>();
  const taskTargets = new Map<string, MinutesLineageTargetReference>();
  const judgmentAdopt = vi.fn(async ({ candidate }: { candidate: MinutesLineageCandidate }): Promise<JudgmentAdoptionResult> => {
    const target = targetFor('judgment', candidate);
    judgmentTargets.set(target.id, target);
    return { target: target as Extract<MinutesLineageTargetReference, { kind: 'judgment' }>, adoption: adoptionFor('judgment', candidate) };
  });
  const taskCreate = vi.fn(async ({ candidate }: { candidate: MinutesLineageCandidate }): Promise<TaskAdoptionResult> => {
    const target = targetFor('task', candidate);
    taskTargets.set(target.id, target);
    return { target: target as Extract<MinutesLineageTargetReference, { kind: 'task' }>, adoption: adoptionFor('task', candidate) };
  });
  const judgment: JudgmentLineagePort = {
    adopt: judgmentAdopt,
    readExact: vi.fn(async (target) => judgmentTargets.has(target.id) ? { id: target.id } : null),
  };
  const task: TaskLineagePort = {
    create: taskCreate,
    readExact: vi.fn(async (target) => taskTargets.has(target.id) ? { id: target.id } : null),
  };

  let receiptTarget: MinutesLineageTargetReference | undefined;
  const receiptReads: string[] = [];
  const receipt: ExecutionReceiptPort = {
    read: vi.fn(async (reference) => {
      receiptReads.push(reference.id);
      return receiptTarget ? { reference, runId: 'run-1', target: receiptTarget } : null;
    }),
  };
  let resultTarget: MinutesLineageTargetReference | undefined;
  const result: ResultPort = {
    read: vi.fn(async (reference) => resultTarget ? { reference, target: resultTarget } : null),
  };

  return {
    current,
    minutes,
    minutesReads,
    setDenyMinutes(value: boolean) { denyMinutes = value; },
    judgment,
    task,
    judgmentAdopt,
    taskCreate,
    judgmentTargets,
    taskTargets,
    receipt,
    receiptReads,
    setReceiptTarget(target: MinutesLineageTargetReference) { receiptTarget = target; },
    result,
    setResultTarget(target: MinutesLineageTargetReference) { resultTarget = target; },
  };
}

async function createCandidate(
  store: ReturnType<typeof createMeetingMinutesLineageStore>,
  id: string,
  kind: 'judgment' | 'task',
  proposal: unknown = { title: id },
) {
  return store.createCandidate({
    id,
    idempotencyKey: `candidate-key-${id}`,
    actor,
    evidence: minutesV1,
    kind,
    proposal,
    epistemicStatus: 'inferred',
    access,
  });
}

async function confirmCandidate(store: ReturnType<typeof createMeetingMinutesLineageStore>, candidate: MinutesLineageCandidate, suffix = candidate.id) {
  return store.confirmCandidate({
    id: `confirmation-${suffix}`,
    idempotencyKey: `confirmation-key-${suffix}`,
    candidateId: candidate.id,
    actor,
    evidenceDigest: candidate.evidenceDigest,
    access,
  });
}

describe('meeting minutes judgment/task lineage', () => {
  it('keeps confirmation, adoption, execution, and result as separate explicit states', async () => {
    const dataDir = await makeDataDir();
    const fixtures = createProviderFixtures();
    const store = createMeetingMinutesLineageStore({ dataDir, ...fixtures });

    const candidate = await createCandidate(store, 'candidate-j1', 'judgment', { judgment: 'Prioritize the onboarding fix' });
    const beforeConfirmation = await store.readByMinutesVersion(minutesV1, access);
    expect(beforeConfirmation.candidates[0]).toMatchObject({
      confirmationStatus: 'unconfirmed',
      adoptionStatus: 'not_adopted',
      executionStatus: 'unrecorded',
      resultStatus: 'unrecorded',
    });
    await expect(store.adoptJudgment({
      id: 'adoption-j1',
      idempotencyKey: 'adoption-key-j1',
      candidateId: candidate.id,
      actor,
      access,
    })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fixtures.judgmentAdopt).not.toHaveBeenCalled();

    await confirmCandidate(store, candidate);
    const adoption = await store.adoptJudgment({
      id: 'adoption-j1',
      idempotencyKey: 'adoption-key-j1',
      candidateId: candidate.id,
      actor,
      access,
    });
    expect(adoption.target.kind).toBe('judgment');

    const replayWithNewTransportKey = await store.adoptJudgment({
      id: 'adoption-j1-retry',
      idempotencyKey: 'adoption-key-j1-retry',
      candidateId: candidate.id,
      actor,
      access,
    });
    expect(replayWithNewTransportKey.id).toBe(adoption.id);
    expect(fixtures.judgmentAdopt).toHaveBeenCalledTimes(1);

    fixtures.setReceiptTarget(adoption.target);
    const execution = await store.recordExecution({
      id: 'execution-j1',
      idempotencyKey: 'execution-key-j1',
      candidateId: candidate.id,
      receiptRef: { id: 'receipt-j1', digest: 'sha256:receipt-j1' },
      actor,
      access,
    });
    expect(execution).toMatchObject({ target: adoption.target, runId: 'run-1' });

    fixtures.setResultTarget(adoption.target);
    const result = await store.acceptResult({
      id: 'result-j1',
      idempotencyKey: 'result-key-j1',
      executionId: execution.id,
      resultRef: { id: 'result-j1', digest: 'sha256:result-j1' },
      actor,
      access,
    });
    expect(result.target).toEqual(adoption.target);

    const byTarget = await store.readByTarget(adoption.target, access);
    expect(byTarget.adoptions).toHaveLength(1);
    expect(byTarget.candidates[0]).toMatchObject({
      confirmationStatus: 'confirmed',
      adoptionStatus: 'adopted',
      executionStatus: 'actual',
      resultStatus: 'accepted',
      reviewStatus: 'clear',
    });
    expect(fixtures.receiptReads).toContain('receipt-j1');
  });

  it('allows multiple candidate payloads from one exact minutes version and separates judgment from Task targets', async () => {
    const dataDir = await makeDataDir();
    const fixtures = createProviderFixtures();
    const store = createMeetingMinutesLineageStore({ dataDir, ...fixtures });

    const judgment1 = await createCandidate(store, 'candidate-j1', 'judgment', { judgment: 'A' });
    const judgment2 = await createCandidate(store, 'candidate-j2', 'judgment', { judgment: 'B' });
    const task = await createCandidate(store, 'candidate-t1', 'task', { title: 'Follow up' });
    await Promise.all([confirmCandidate(store, judgment1), confirmCandidate(store, judgment2), confirmCandidate(store, task)]);

    const [adoption1, adoption2, taskAdoption] = await Promise.all([
      store.adoptJudgment({ id: 'adoption-j1', idempotencyKey: 'adoption-key-j1', candidateId: judgment1.id, actor, access }),
      store.adoptJudgment({ id: 'adoption-j2', idempotencyKey: 'adoption-key-j2', candidateId: judgment2.id, actor, access }),
      store.adoptTask({ id: 'adoption-t1', idempotencyKey: 'adoption-key-t1', candidateId: task.id, actor, access }),
    ]);

    expect(adoption1.target.id).toBe('judgment-candidate-j1');
    expect(adoption2.target.id).toBe('judgment-candidate-j2');
    expect(taskAdoption.target.id).toBe('task-candidate-t1');
    expect(fixtures.judgmentAdopt).toHaveBeenCalledTimes(2);
    expect(fixtures.taskCreate).toHaveBeenCalledTimes(1);
    const view = await store.readByMinutesVersion(minutesV1, access);
    expect(view.candidates).toHaveLength(3);
    expect(view.candidates.filter((item) => item.adoptionStatus === 'adopted')).toHaveLength(3);
  });

  it('records correction as review-required and never invokes task cancellation or execution', async () => {
    const dataDir = await makeDataDir();
    const fixtures = createProviderFixtures();
    const store = createMeetingMinutesLineageStore({ dataDir, ...fixtures });
    const task = await createCandidate(store, 'candidate-t1', 'task');
    await confirmCandidate(store, task);
    const adoption = await store.adoptTask({ id: 'adoption-t1', idempotencyKey: 'adoption-key-t1', candidateId: task.id, actor, access });

    const correction = await store.markCorrection({
      id: 'correction-1',
      idempotencyKey: 'correction-key-1',
      previousVersion: minutesV1,
      replacementVersion: minutesV2,
      actor,
      reason: 'The decision paragraph was corrected by the meeting owner.',
      access,
    });
    expect(correction.affectedCandidateIds).toEqual([task.id]);

    const oldView = await store.readByMinutesVersion(minutesV1, access);
    expect(oldView.candidates[0]).toMatchObject({ reviewStatus: 'review_required', adoptionStatus: 'adopted' });
    const replacementView = await store.readByMinutesVersion(minutesV2, access);
    expect(replacementView.candidates).toHaveLength(0);
    expect(replacementView.corrections[0].id).toBe(correction.id);
    expect(fixtures.taskCreate).toHaveBeenCalledTimes(1);
    expect(adoption.target.kind).toBe('task');
  });

  it('rechecks the current minutes ACL and fails closed when the source becomes unavailable', async () => {
    const dataDir = await makeDataDir();
    const fixtures = createProviderFixtures();
    const store = createMeetingMinutesLineageStore({ dataDir, ...fixtures });
    const candidate = await createCandidate(store, 'candidate-j1', 'judgment');
    fixtures.setDenyMinutes(true);

    await expect(store.readByMinutesVersion(minutesV1, access)).rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(store.readCandidate(candidate.id, access)).rejects.toMatchObject({ code: 'authorization_denied' });
    fixtures.setDenyMinutes(false);
    expect((await store.readCandidate(candidate.id, access))?.id).toBe(candidate.id);
  });

  it('persists an append-only sidecar with separate collections', async () => {
    const dataDir = await makeDataDir();
    const fixtures = createProviderFixtures();
    const store = createMeetingMinutesLineageStore({ dataDir, ...fixtures });
    await createCandidate(store, 'candidate-j1', 'judgment');

    const sidecar = JSON.parse(await readFile(join(dataDir, 'evidence', 'meeting-minutes-lineage.json'), 'utf8')) as Record<string, unknown>;
    expect(sidecar.version).toBe(1);
    expect(sidecar.candidates).toHaveLength(1);
    expect(sidecar.confirmations).toEqual([]);
    expect(sidecar.adoptions).toEqual([]);
    expect(sidecar.executions).toEqual([]);
    expect(sidecar.results).toEqual([]);
    expect(sidecar.corrections).toEqual([]);
  });
});
