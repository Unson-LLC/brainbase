import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMeetingMinutesLineageCorrectionHook,
  type MeetingMinutesLineageVersionSavedEvent,
} from '../src/meeting-minutes-lineage-lifecycle.js';
import {
  nativeMeetingMinutesVersionReference,
  type NativeMeetingMinutesVersionRecord,
} from '../src/meeting-minutes-lineage-adapters.js';
import {
  createMeetingMinutesLineageStore,
  initializeMeetingMinutesLineageStore,
  MeetingMinutesLineageError,
  type MinutesLineageAccess,
  type MinutesLineageActor,
  type MinutesLineageCandidate,
  type MinutesVersionPort,
  type MinutesVersionReference,
  type TaskLineagePort,
} from '../src/meeting-minutes-lineage.js';

const directories: string[] = [];
const access: MinutesLineageAccess = { principal: 'person-1', scope: 'company-1' };
const actor: MinutesLineageActor = { type: 'person', id: 'person-1' };

const nativeV1: NativeMeetingMinutesVersionRecord = {
  version_id: 'v1',
  minutes_id: 'minutes-1',
  meeting_id: 'meeting-1',
  body_digest: 'sha256:minutes-v1',
};

const nativeV2: NativeMeetingMinutesVersionRecord = {
  version_id: 'v2',
  minutes_id: 'minutes-1',
  meeting_id: 'meeting-1',
  predecessor_version_id: 'v1',
  body_digest: 'sha256:minutes-v2',
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeStore(): Promise<{
  dataDir: string;
  store: ReturnType<typeof createMeetingMinutesLineageStore>;
  v1: MinutesVersionReference;
  v2: MinutesVersionReference;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-lifecycle-'));
  directories.push(dataDir);
  await initializeMeetingMinutesLineageStore(dataDir);
  const v1 = nativeMeetingMinutesVersionReference(nativeV1);
  const v2 = nativeMeetingMinutesVersionReference(nativeV2);
  const byVersion = new Map([[v1.versionId, v1], [v2.versionId, v2]]);
  const minutes: MinutesVersionPort = {
    readExact: vi.fn(async (reference) => {
      const stored = byVersion.get(reference.versionId);
      return stored && JSON.stringify(stored) === JSON.stringify(reference) ? { reference: stored } : null;
    }),
  };
  const task: TaskLineagePort = {
    create: vi.fn(async ({ candidate }) => ({
      target: { kind: 'task' as const, id: `task-${candidate.id}`, version: 1, digest: `sha256:task-${candidate.id}` },
      adoption: { kind: 'task_adoption' as const, id: `task-adoption-${candidate.id}`, revision: '1', digest: `sha256:task-adoption-${candidate.id}` },
    })),
    readExact: vi.fn(async () => ({ id: 'task-readable' })),
  };
  return { dataDir, store: createMeetingMinutesLineageStore({ dataDir, minutes, task }), v1, v2 };
}

async function createTaskCandidate(
  store: ReturnType<typeof createMeetingMinutesLineageStore>,
  evidence: MinutesVersionReference,
): Promise<MinutesLineageCandidate> {
  return store.createCandidate({
    id: 'candidate-task-1',
    idempotencyKey: 'candidate-task-1-key',
    actor,
    evidence,
    kind: 'task',
    proposal: { title: 'Follow up on corrected decision' },
    epistemicStatus: 'inferred',
    access,
  });
}

function savedEvent(
  previousVersion: NativeMeetingMinutesVersionRecord = nativeV1,
  replacementVersion: NativeMeetingMinutesVersionRecord = nativeV2,
): MeetingMinutesLineageVersionSavedEvent {
  return {
    previousVersion,
    replacementVersion,
    access,
    actor,
    reason: 'The meeting owner corrected the decision paragraph.',
  };
}

describe('meeting minutes lineage lifecycle hook', () => {
  it('records a correction after a native save and marks the adopted candidate review-required', async () => {
    const { store, v1, v2 } = await makeStore();
    const candidate = await createTaskCandidate(store, v1);
    await store.confirmCandidate({
      id: 'confirmation-task-1',
      idempotencyKey: 'confirmation-task-1-key',
      candidateId: candidate.id,
      actor,
      evidenceDigest: candidate.evidenceDigest,
      access,
    });
    await store.adoptTask({
      id: 'adoption-task-1',
      idempotencyKey: 'adoption-task-1-key',
      candidateId: candidate.id,
      actor,
      access,
    });

    const hook = createMeetingMinutesLineageCorrectionHook({ store });
    const result = await hook.onVersionSaved(savedEvent());

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.correction).toMatchObject({
      previousVersion: v1,
      replacementVersion: v2,
      affectedCandidateIds: [candidate.id],
    });
    expect(result.retry.previousVersion).toEqual(v1);
    expect(result.retry.replacementVersion).toEqual(v2);
    const view = await store.readByMinutesVersion(v1, access);
    expect(view.candidates[0]).toMatchObject({ reviewStatus: 'review_required', adoptionStatus: 'adopted' });
  });

  it('returns a stable retry after lineage failure and leaves execution-owned providers untouched', async () => {
    const markCorrection = vi.fn(async () => {
      throw new MeetingMinutesLineageError('source_unavailable', 'The lineage sidecar is temporarily unavailable');
    });
    const hook = createMeetingMinutesLineageCorrectionHook({ store: { markCorrection } });

    const first = await hook.onVersionSaved(savedEvent());
    const second = await hook.onVersionSaved(savedEvent());

    expect(first.status).toBe('failed');
    expect(second.status).toBe('failed');
    if (first.status !== 'failed' || second.status !== 'failed') return;
    expect(first.error).toEqual({ code: 'source_unavailable', message: 'The lineage sidecar is temporarily unavailable' });
    expect(second.retry.idempotencyKey).toBe(first.retry.idempotencyKey);
    expect(second.retry.previousVersion).toEqual(first.retry.previousVersion);
    expect(second.retry.replacementVersion).toEqual(first.retry.replacementVersion);
    expect(markCorrection).toHaveBeenCalledTimes(2);
    expect(markCorrection.mock.calls[0][0]).toMatchObject({
      id: first.retry.id,
      idempotencyKey: first.retry.idempotencyKey,
      previousVersion: first.retry.previousVersion,
      replacementVersion: first.retry.replacementVersion,
    });
  });

  it('rejects an unrelated version pair before writing lineage', async () => {
    const markCorrection = vi.fn();
    const hook = createMeetingMinutesLineageCorrectionHook({ store: { markCorrection } });
    const unrelated = { ...nativeV2, meeting_id: 'meeting-2', predecessor_version_id: 'v1' };

    const result = await hook.onVersionSaved(savedEvent(nativeV1, unrelated));

    expect(result.status).toBe('failed');
    expect(result).toMatchObject({ error: { code: 'invalid_input' } });
    expect(markCorrection).not.toHaveBeenCalled();
  });
});
