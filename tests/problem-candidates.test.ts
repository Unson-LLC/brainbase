import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FoundationScope, ObjectiveDefinition } from '../src/ontology-foundation.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { initializePersonalOs, loadPersonalOs } from '../src/ssot.js';
import {
  createProblemCandidateStore,
  normalizeProblemCandidate,
  PROBLEM_CANDIDATES_SIDECAR,
  ProblemCandidateStoreError,
  type ProblemCandidateInput,
  type ProblemCandidateEvidenceAccessProvider,
  type ProblemCandidateStoreContext
} from '../src/problem-candidates.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const scope: FoundationScope = {
  subjectIds: ['hotel-1'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z'
};

const objective: ObjectiveDefinition = {
  id: 'objective-reduce-front-load',
  type: 'objective',
  revision: '1',
  meaning: 'Reduce total front-desk response load while maintaining service quality.',
  epistemicState: 'supported',
  adoptionState: 'approved',
  authorizedUses: ['draft', 'judgment', 'evaluation'],
  acl: { ownerId: 'org-1', visibility: 'organization', readerIds: ['person-1', 'person-2'], writerIds: ['org-1'] },
  storage: 'ontology',
  provenance: [{ sourceId: 'decision-objective-1', sourceKind: 'decision', evidenceIds: ['private-objective-evidence'] }],
  scope,
  beneficiaryIds: ['org-1'],
  desiredState: 'Front-desk total response load is lower without lower service quality.',
  criteria: [{
    variableRef: { id: 'front-total-load', type: 'variable', revision: '1' },
    operator: 'at_most',
    target: 120
  }],
  evaluationPeriod: {
    from: '2026-01-01T00:00:00.000Z',
    until: '2026-12-31T23:59:59.000Z'
  },
  accountableId: 'person-1'
};

async function createCanonicalStore(): Promise<{
  dataDir: string;
  context: ProblemCandidateStoreContext;
  objectiveRef: { id: string; type: 'objective'; revision: string; digest: string };
  store: ReturnType<typeof createProblemCandidateStore>;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-problem-candidates-'));
  dataDirs.push(dataDir);
  await initializePersonalOs(dataDir);
  const foundationStore = createFoundationRevisionStore({ dataDir });
  const objectiveRef = await foundationStore.create(objective, { principal: 'org-1' });
  const evidenceAccessProvider: ProblemCandidateEvidenceAccessProvider = {
    authorize: ({ context, source }) => source.id !== 'private-evidence-1'
      || context.principal === 'org-1'
      || context.principal === 'person-1'
  };
  return {
    dataDir,
    context: { principal: 'org-1' },
    objectiveRef: { ...objectiveRef, type: 'objective' },
    store: createProblemCandidateStore({ dataDir, foundationStore, evidenceAccessProvider })
  };
}

function candidate(
  objectiveRef: { id: string; type: 'objective'; revision: string; digest: string },
  overrides: Partial<ProblemCandidateInput> = {}
): ProblemCandidateInput {
  return {
    id: 'candidate-front-load-gap-1',
    kind: 'gap',
    statement: 'Repeated handoffs are a possible source of avoidable front-desk load.',
    objectiveRefs: [objectiveRef],
    event: {
      id: 'event-front-load-1',
      occurredAt: '2026-06-10T01:00:00.000Z',
      recordedAt: '2026-06-11T01:00:00.000Z',
      sourceRefs: [
        { id: 'observation-front-load-1', kind: 'observation', digest: 'sha256:' + '1'.repeat(64) },
        { id: 'private-evidence-1', kind: 'evidence', digest: 'sha256:' + '2'.repeat(64) }
      ]
    },
    observedGap: { status: 'known', value: 'Handoffs add response work after automated answers.' },
    opportunity: { status: 'unknown', reason: 'No validated intervention is known yet.' },
    threat: { status: 'unknown', reason: 'Impact on service quality has not been measured.' },
    uncertainty: { status: 'known', value: 'The handoff rate is not yet measured for every hotel.' },
    deadline: { status: 'unknown', reason: 'No review deadline was agreed.' },
    expectedEffect: { status: 'known', value: 'A focused review may identify a lower-load workflow.' },
    requiredResources: { status: 'unknown', reason: 'Required staffing and integration effort are not estimated.' },
    responsibleId: { status: 'known', value: 'person-1' },
    ownerScope: scope,
    acl: { ownerId: 'org-1', visibility: 'organization', readerIds: ['person-1'], writerIds: ['org-1'] },
    ...overrides
  };
}

describe('problem candidate contract', () => {
  it('keeps unknown fields explicit and rejects selection or approval states', () => {
    const input = candidate({ id: 'objective-1', type: 'objective', revision: '1', digest: 'sha256:' + 'a'.repeat(64) });
    const normalized = normalizeProblemCandidate(input);
    expect(normalized.opportunity).toEqual({ status: 'unknown', reason: 'No validated intervention is known yet.' });
    expect(normalized.requiredResources.status).toBe('unknown');
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(() => normalizeProblemCandidate({ ...input, status: 'approved' as never })).toThrow(/candidate, merged, or dismissed/);
    expect(() => normalizeProblemCandidate({
      ...input,
      event: {
        ...input.event,
        sourceRefs: [{ id: 'evidence-1', kind: 'evidence', summary: 'restricted body' } as never]
      }
    })).toThrow(/unsupported field/);
    expect(() => normalizeProblemCandidate({
      ...input,
      event: { ...input.event, recordedAt: '2026-06-09T01:00:00.000Z' }
    })).toThrow(/recordedAt/);
  });
});

describe('problem candidate sidecar store', () => {
  it('persists only candidate evidence in the sidecar and reads the exact Objective revision', async () => {
    const { dataDir, context, objectiveRef, store } = await createCanonicalStore();
    const saved = await store.saveCandidate(candidate(objectiveRef), context);
    const retried = await store.saveCandidate(candidate(objectiveRef), context);

    expect(retried).toEqual(saved);
    await expect(store.readCandidate(saved.id, { principal: 'person-1' })).resolves.toEqual(saved);

    const aggregate = await loadPersonalOs(dataDir);
    expect(aggregate.graph.version).toBe(2);
    expect(JSON.stringify(aggregate.graph)).not.toContain(saved.id);
    const sidecarText = await readFile(join(dataDir, PROBLEM_CANDIDATES_SIDECAR), 'utf8');
    const sidecar = JSON.parse(sidecarText) as { candidates: readonly Record<string, unknown>[]; events: readonly Record<string, unknown>[] };
    expect(sidecar.candidates).toHaveLength(1);
    expect(sidecar.events).toHaveLength(1);
    expect(sidecarText).not.toContain('private-evidence-body');
    expect(sidecarText).not.toContain('private-objective-evidence-body');
    expect(sidecar.candidates[0]?.event).toBeDefined();
    expect(sidecar.candidates[0]?.summary).toBeUndefined();
  });

  it('rejects a conflicting retry and preserves roots when candidates are merged', async () => {
    const { context, objectiveRef, store } = await createCanonicalStore();
    const original = await store.saveCandidate(candidate(objectiveRef), context);
    await expect(store.saveCandidate(candidate(objectiveRef, {
      statement: 'The same event was rewritten with a different statement.'
    }), context)).rejects.toMatchObject({ code: 'event_conflict' } satisfies Partial<ProblemCandidateStoreError>);

    const merged = await store.mergeCandidates({
      ...candidate(objectiveRef, {
        id: 'candidate-front-load-merged-1',
        acl: { ownerId: 'org-1', visibility: 'public', readerIds: [], writerIds: ['org-1'] },
        event: {
          id: 'event-front-load-merge-1',
          occurredAt: '2026-06-12T01:00:00.000Z',
          recordedAt: '2026-06-12T02:00:00.000Z',
          sourceRefs: [{ id: 'review-event-1', kind: 'event' }]
        }
      }),
      sourceCandidateIds: [original.id]
    }, context);

    expect(merged.mergedFrom).toEqual([original.id]);
    expect(merged.provenance.candidateIds).toEqual([original.id]);
    expect(merged.provenance.eventIds).toEqual(['event-front-load-merge-1']);
    await expect(store.readCandidate(original.id, context)).resolves.toMatchObject({
      id: original.id,
      status: 'merged',
      statement: original.statement,
      provenance: { eventIds: ['event-front-load-1'] }
    });
    await expect(store.readCandidate(merged.id, { principal: 'person-2' }))
      .rejects.toMatchObject({ code: 'authorization_denied' } satisfies Partial<ProblemCandidateStoreError>);
  });

  it('filters by scope and protects candidate and Objective ACLs', async () => {
    const { context, objectiveRef, store } = await createCanonicalStore();
    const saved = await store.saveCandidate(candidate(objectiveRef), context);

    await expect(store.readCandidate(saved.id, { principal: 'person-2' })).rejects.toMatchObject({ code: 'authorization_denied' } satisfies Partial<ProblemCandidateStoreError>);
    await expect(store.readCandidate(saved.id, { principal: 'person-1', scope: {
      subjectIds: ['hotel-2'],
      validFrom: scope.validFrom,
      validUntil: scope.validUntil
    } })).rejects.toMatchObject({ code: 'scope_violation' } satisfies Partial<ProblemCandidateStoreError>);
    await expect(store.listCandidates({ ownerScope: scope, responsibleId: 'person-1', status: 'candidate' }, { principal: 'person-1' })).resolves.toHaveLength(1);
    await expect(store.listCandidates(undefined, { principal: 'person-1', scope: {
      subjectIds: ['hotel-2'],
      validFrom: scope.validFrom,
      validUntil: scope.validUntil
    } })).resolves.toEqual([]);
  });
});
