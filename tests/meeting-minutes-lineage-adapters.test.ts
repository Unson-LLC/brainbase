import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanonicalTaskServiceFixture } from './fixtures/canonical-task-service.js';
import {
  adaptNativeMeetingMinutesVersionPort,
  createCanonicalTaskLineagePort,
  createMeetingMinutesJudgmentLineagePort,
  nativeMeetingMinutesVersionReference,
  type NativeMeetingMinutesVersionRecord,
} from '../src/meeting-minutes-lineage-adapters.js';
import type { CompanyOsEvaluationRecord, LearningTargetPort, LearningTargetReference, LearningTargetVersion } from '../src/company-os-learning-adoption.js';
import { createCompanyOsLearningAdoptionStore, digestEvaluationRecord } from '../src/company-os-learning-adoption.js';
import type { FoundationAcl, FoundationScope } from '../src/ontology-foundation.js';
import { initializePersonalOs } from '../src/ssot.js';
import {
  createMeetingMinutesLineageStore,
  initializeMeetingMinutesLineageStore,
  type MinutesLineageAccess,
  type MinutesLineageActor,
  type MinutesLineageCandidate,
} from '../src/meeting-minutes-lineage.js';

const directories: string[] = [];
const access: MinutesLineageAccess = { principal: 'person-1', scope: 'company-1' };
const actor: MinutesLineageActor = { type: 'person', id: 'person-1' };
const nativeVersion: NativeMeetingMinutesVersionRecord = {
  version_id: 'v1',
  minutes_id: 'minutes-1',
  meeting_id: 'meeting-1',
  body_digest: 'sha256:minutes-v1',
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function taskCandidate(): MinutesLineageCandidate {
  const evidence = nativeMeetingMinutesVersionReference(nativeVersion);
  return {
    version: 1,
    id: 'candidate-task-actual',
    idempotencyKey: 'candidate-task-actual-key',
    requestDigest: 'sha256:request',
    actor,
    evidence,
    evidenceDigest: 'sha256:evidence',
    kind: 'task',
    proposal: { task: { title: 'Follow up from minutes' } },
    proposalDigest: 'sha256:proposal',
    epistemicStatus: 'confirmed',
    createdAt: '2026-10-06T00:00:00.000Z',
    digest: 'sha256:candidate',
  };
}

const learningScope: FoundationScope = {
  subjectIds: ['company-1'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z',
};

const learningAcl: FoundationAcl = {
  ownerId: 'person-1',
  visibility: 'private',
  readerIds: ['person-1'],
  writerIds: ['person-1'],
};

function learningEvaluation(): CompanyOsEvaluationRecord {
  return {
    version: 1,
    id: 'evaluation-minutes-1',
    snapshot: {
      snapshotId: 'snapshot-minutes-1',
      problemId: 'problem-minutes-1',
      revision: '1',
      digest: 'sha256:snapshot-minutes-1',
    },
    objectiveRef: { id: 'objective-minutes-1', revision: '1', digest: 'sha256:objective-minutes-1' },
    outcomeCaseRef: { id: 'outcome-minutes-1', revision: '1', digest: 'sha256:outcome-minutes-1' },
    predictions: [],
    actuals: [],
    criteria: [],
    predictionComparisons: [],
    achievement: 'indeterminate',
    judgmentAtTimeValidity: { status: 'valid', basis: 'Meeting minutes evidence was readable.' },
    evaluatedAt: '2026-10-06T00:00:00.000Z',
  };
}

function createJudgmentTargetFixture(): {
  target: LearningTargetPort;
  reference: LearningTargetReference;
  current: () => LearningTargetVersion;
} {
  const initialReference: LearningTargetReference = {
    kind: 'judgment_method',
    id: 'judgment-method-minutes-1',
    revision: '1',
    digest: `sha256:${'1'.repeat(64)}`,
  };
  const adoptedReference: LearningTargetReference = {
    ...initialReference,
    revision: '2',
    digest: `sha256:${'2'.repeat(64)}`,
  };
  const initial: LearningTargetVersion = {
    target: initialReference,
    reference: initialReference,
    definition: { acl: learningAcl, label: 'minutes judgment method v1' },
    acl: learningAcl,
    scope: learningScope,
  };
  const adopted: LearningTargetVersion = {
    ...initial,
    target: adoptedReference,
    reference: adoptedReference,
    definition: { acl: learningAcl, label: 'minutes judgment method v2' },
  };
  let currentVersion = initial;
  const exact = (reference: LearningTargetReference, candidate: LearningTargetVersion): boolean =>
    reference.kind === candidate.reference.kind
    && reference.id === candidate.reference.id
    && reference.revision === candidate.reference.revision
    && reference.digest === candidate.reference.digest;
  const target: LearningTargetPort = {
    async readCurrent(reference) {
      return exact(reference, currentVersion) ? currentVersion : null;
    },
    async read(reference) {
      return exact(reference, initial) ? initial : exact(reference, adopted) ? adopted : exact(reference, currentVersion) ? currentVersion : null;
    },
    prepareRevision({ current: expected }) {
      if (!exact(expected.reference, currentVersion)) throw new Error('target changed');
      return adopted;
    },
    commitRevision({ currentAggregate, expectedCurrent, prepared }) {
      if (!exact(expectedCurrent.reference, currentVersion)) throw new Error('target changed before commit');
      currentVersion = prepared;
      return { nextAggregate: currentAggregate, adopted: prepared };
    },
  };
  return { target, reference: initialReference, current: () => currentVersion };
}

describe('meeting minutes lineage provider adapters', () => {
  it('composes with the native core exact-version port without duplicating ACL logic', async () => {
    const reference = nativeMeetingMinutesVersionReference(nativeVersion);
    const corePort = {
      readExact: vi.fn(async (requested: typeof reference, currentAccess: { principal: string }) => {
        expect(currentAccess.principal).toBe('person-1');
        return { reference: requested };
      }),
    };
    const port = adaptNativeMeetingMinutesVersionPort(corePort);

    await expect(port.readExact(reference, access)).resolves.toEqual({ reference });
    expect(corePort.readExact).toHaveBeenCalledWith(reference, access);
  });

  it('uses CanonicalTaskService as the real provider and recovers one task on a repeated idempotent create', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const phases: string[] = [];
    const port = createCanonicalTaskLineagePort({
      service: fixture.service,
      contextFor: ({ phase }) => {
        phases.push(phase);
        return fixture.context();
      },
    });
    const candidate = taskCandidate();

    const first = await port.create({ candidate, idempotencyKey: 'stable-task-key', actor, access });
    const replay = await port.create({ candidate, idempotencyKey: 'stable-task-key', actor, access });

    expect(replay.target).toEqual(first.target);
    expect(fixture.tasks.size).toBe(1);
    expect(phases).toEqual(['create', 'create']);
    await expect(port.readExact(first.target, access)).resolves.toMatchObject({ id: first.target.id, version: 1 });
  });

  it('keeps the lineage stable key at the actual Task provider across transport retries', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-task-adapter-'));
    directories.push(dataDir);
    await initializeMeetingMinutesLineageStore(dataDir);
    const nativeReference = nativeMeetingMinutesVersionReference(nativeVersion);
    const minutes = {
      readExact: vi.fn(async (reference: typeof nativeReference) => ({ reference })),
    };
    const fixture = createCanonicalTaskServiceFixture();
    const task = createCanonicalTaskLineagePort({
      service: fixture.service,
      contextFor: () => fixture.context(),
    });
    const store = createMeetingMinutesLineageStore({ dataDir, minutes, task });
    const candidate = await store.createCandidate({
      id: 'candidate-task-provider',
      idempotencyKey: 'candidate-task-provider-key',
      actor,
      evidence: nativeReference,
      kind: 'task',
      proposal: { task: { title: 'Canonical task from minutes' } },
      epistemicStatus: 'inferred',
      access,
    });
    await store.confirmCandidate({
      id: 'confirmation-task-provider',
      idempotencyKey: 'confirmation-task-provider-key',
      candidateId: candidate.id,
      actor,
      evidenceDigest: candidate.evidenceDigest,
      access,
    });

    const first = await store.adoptTask({
      id: 'adoption-task-provider-1',
      idempotencyKey: 'transport-key-1',
      candidateId: candidate.id,
      actor,
      access,
    });
    const replay = await store.adoptTask({
      id: 'adoption-task-provider-2',
      idempotencyKey: 'transport-key-2',
      candidateId: candidate.id,
      actor,
      access,
    });

    expect(replay.id).toBe(first.id);
    expect(replay.target).toEqual(first.target);
    expect(fixture.tasks.size).toBe(1);
    expect([...fixture.tasks.values()][0]).toMatchObject({ title: 'Canonical task from minutes', version: 1 });
    await expect(store.readByTarget(first.target, access)).resolves.toMatchObject({
      adoptions: [{ target: first.target }],
      candidates: [{ adoptionStatus: 'adopted' }],
    });
  });

  it('keeps source locators in lineage and rejects copying them into canonical Task source_refs', async () => {
    const fixture = createCanonicalTaskServiceFixture();
    const port = createCanonicalTaskLineagePort({ service: fixture.service, contextFor: () => fixture.context() });
    const candidate = { ...taskCandidate(), proposal: { task: { title: 'Invalid source refs', source_refs: [{ id: 'private-locator' }] } } };

    await expect(port.create({ candidate, idempotencyKey: 'task-source-refs', actor, access }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(fixture.tasks.size).toBe(0);
  });

  it('maps a minutes judgment to the real Company OS candidate, validation, and adoption records', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-meeting-minutes-learning-adapter-'));
    directories.push(dataDir);
    await initializePersonalOs(dataDir);
    const evaluation = learningEvaluation();
    const targetFixture = createJudgmentTargetFixture();
    const learning = createCompanyOsLearningAdoptionStore({
      dataDir,
      evaluation: {
        async read(id) {
          return id === evaluation.id ? evaluation : null;
        },
      },
      target: targetFixture.target,
      now: () => '2026-10-06T01:00:00.000Z',
    });
    const port = createMeetingMinutesJudgmentLineagePort({
      store: learning,
      target: targetFixture.target,
      learningAccessFor: ({ access }) => ({ principal: access.principal, scope: learningScope }),
      resolveTarget: ({ target }) => target.id === targetFixture.reference.id ? targetFixture.current().reference : null,
    });
    const evidence = nativeMeetingMinutesVersionReference(nativeVersion);
    const candidate: MinutesLineageCandidate = {
      version: 1,
      id: 'candidate-judgment-provider',
      idempotencyKey: 'candidate-judgment-provider-key',
      requestDigest: 'sha256:request',
      actor,
      evidence,
      evidenceDigest: 'sha256:evidence',
      kind: 'judgment',
      proposal: {
        learningCandidate: {
          sourceEvaluationRef: { id: evaluation.id, digest: digestEvaluationRecord(evaluation) },
          target: targetFixture.reference,
          proposedChange: { label: 'minutes judgment method v2' },
          grounds: ['The reviewed minutes support a revised judgment method.'],
          counterexamples: [],
          uncertainty: ['The sample is limited to the reviewed meeting.'],
          applicability: learningScope,
        },
        learningValidation: {
          findings: [],
          conclusion: 'supported',
          modelDisposition: 'unchanged',
          basis: 'The minutes evidence was reviewed against the existing method.',
          validatedAt: '2026-10-06T01:00:00.000Z',
        },
      },
      proposalDigest: 'sha256:proposal',
      epistemicStatus: 'inferred',
      createdAt: '2026-10-06T00:00:00.000Z',
      digest: 'sha256:candidate',
    };

    const adopted = await port.adopt({ candidate, idempotencyKey: 'transport-judgment-key', actor, access });

    expect(adopted.target).toEqual({
      kind: 'judgment',
      id: targetFixture.reference.id,
      revision: '2',
      digest: `sha256:${'2'.repeat(64)}`,
    });
    expect(adopted.adoption.kind).toBe('judgment_adoption');
    await expect(port.readExact(adopted.target, access)).resolves.toMatchObject({
      reference: targetFixture.current().reference,
    });
  });
});
