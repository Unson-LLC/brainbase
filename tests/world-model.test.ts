import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DecisionRevision,
  FoundationRevision,
  ModelDefinition,
  VariableDefinition
} from '../src/ontology-foundation.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { initializePersonalOs, loadPersonalOs } from '../src/ssot.js';
import {
  createWorldModelStore,
  normalizeWorldModelObservation,
  retainCandidateModel,
  validateWorldModelModel,
  validateWorldModelObservation,
  type CandidateModelSnapshot,
  type WorldModelObservationInput,
  type WorldModelStoreContext,
  WORLD_MODEL_EVIDENCE_SIDECAR,
  WorldModelStoreError
} from '../src/world-model.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createCanonicalStore(): Promise<{
  dataDir: string;
  context: WorldModelStoreContext;
  foundationStore: ReturnType<typeof createFoundationRevisionStore>;
  store: ReturnType<typeof createWorldModelStore>;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-world-model-'));
  dataDirs.push(dataDir);
  await initializePersonalOs(dataDir);
  const foundationStore = createFoundationRevisionStore({ dataDir });
  const store = createWorldModelStore({
    dataDir,
    foundationStore,
    approvalReader: {
      isApproved: async ({ approvalRef, modelRef }) => approvalRef.id === 'decision-approval-1'
        && approvalRef.revision === '3'
        && modelRef.id === model.id
        && modelRef.type === 'model'
        && modelRef.revision === model.revision
    }
  });
  return { dataDir, context: { principal: 'org-1' }, foundationStore, store };
}

const scope = {
  subjectIds: ['hotel-1'],
  validFrom: '2026-01-01T00:00:00.000Z',
  validUntil: '2026-12-31T23:59:59.000Z'
} as const;

const variable: VariableDefinition = {
  id: 'front.total-load',
  type: 'variable',
  revision: '1',
  meaning: 'フロントの直接対応、引き継ぎ、回答修正を含む総対応時間',
  epistemicState: 'supported',
  adoptionState: 'approved',
  authorizedUses: ['draft', 'judgment', 'evaluation'],
  acl: { ownerId: 'org-1', visibility: 'organization', readerIds: ['person-1'], writerIds: ['org-1'] },
  storage: 'ontology',
  provenance: [{ sourceId: 'decision-1', sourceKind: 'decision', evidenceIds: ['evidence-variable-1'] }],
  scope,
  subject: 'hotel front desk',
  valueKind: 'number',
  unit: 'minutes',
  aggregation: 'sum',
  granularity: 'week',
  measurementMethod: 'PMS and support log aggregation'
};

const model: ModelDefinition = {
  id: 'model.front-load-reduction',
  type: 'model',
  revision: '1',
  meaning: '自動完結による削減と引き継ぎ・修正による追加負荷から総負荷を予測する',
  epistemicState: 'hypothesis',
  adoptionState: 'approved',
  authorizedUses: ['draft', 'judgment'],
  acl: { ownerId: 'org-1', visibility: 'organization', readerIds: ['person-1'], writerIds: ['org-1'] },
  storage: 'ontology',
  provenance: [{ sourceId: 'candidate-model-1', sourceKind: 'candidate', evidenceIds: ['evidence-model-1'] }],
  scope,
  inputVariableRefs: [{ id: 'front.auto-complete-rate', type: 'variable', revision: '1' }],
  outputVariableRefs: [{ id: variable.id, type: 'variable', revision: variable.revision }],
  applicability: scope,
  relationship: 'Higher auto-completion may reduce direct load, while handoffs and corrections may add load.',
  uncertainty: 'The handoff and correction rates are not yet estimated for every property.',
  validationState: 'in_progress'
};

function observation(overrides: Partial<WorldModelObservationInput> = {}): WorldModelObservationInput {
  return {
    id: 'observation-1',
    variableRef: { id: variable.id, type: 'variable', revision: variable.revision },
    subjectId: 'hotel-1',
    value: 120,
    occurredAt: '2026-06-10T01:00:00.000Z',
    period: { from: '2026-06-08T00:00:00.000Z', until: '2026-06-14T23:59:59.000Z' },
    recordedAt: '2026-06-11T01:00:00.000Z',
    sourceRef: { sourceId: 'support-log-1', sourceKind: 'observation', evidenceIds: ['evidence-observation-1'] },
    ...overrides
  };
}

describe('world-model observation contract', () => {
  it('keeps a versioned Variable reference, occurrence time, record time, and immutable source data', () => {
    const input = observation();
    const normalized = normalizeWorldModelObservation(input);

    expect(normalized).toEqual(input);
    expect(normalized.variableRef).toEqual({ id: variable.id, type: 'variable', revision: '1' });
    expect(normalized.occurredAt).not.toBe(normalized.recordedAt);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.value)).toBe(true);
    expect(Object.isFrozen(normalized.sourceRef.evidenceIds)).toBe(true);

    const compatible = validateWorldModelObservation(normalized, variable);
    expect(compatible).toEqual({ valid: true, status: 'valid', issues: [] });
  });

  it('rejects malformed and chronologically impossible observations before storage', () => {
    expect(() => normalizeWorldModelObservation(observation({
      occurredAt: '2026-02-30T01:00:00.000Z'
    }))).toThrow(/occurredAt/);
    expect(() => normalizeWorldModelObservation(observation({
      recordedAt: '2026-06-09T01:00:00.000Z'
    }))).toThrow(/RECORDED_BEFORE_OCCURRED/);
    expect(() => normalizeWorldModelObservation(observation({
      supersedes: 'observation-1'
    }))).toThrow(/INVALID_CORRECTION_REFERENCE/);
    expect(() => normalizeWorldModelObservation(observation({
      variableRef: { id: variable.id, type: 'variable', revision: '01' }
    }))).toThrow(/INVALID_VARIABLE_REFERENCE/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => normalizeWorldModelObservation(observation({ value: cyclic as never }))).toThrow(/value/);
  });

  it('reports exact revision, value-kind, subject, and period mismatches', () => {
    const normalized = normalizeWorldModelObservation(observation());
    const wrongRevision = validateWorldModelObservation(normalized, { ...variable, revision: '2' });
    expect(wrongRevision.issues.map((issue) => issue.code)).toContain('INVALID_VARIABLE_REFERENCE');

    const wrongValueKind = validateWorldModelObservation(normalized, { ...variable, valueKind: 'string' });
    expect(wrongValueKind.issues.map((issue) => issue.code)).toContain('VARIABLE_VALUE_KIND_MISMATCH');

    const wrongSubject = validateWorldModelObservation(normalized, { ...variable, scope: { ...scope, subjectIds: ['hotel-2'] } });
    expect(wrongSubject.issues.map((issue) => issue.code)).toContain('OBSERVATION_SCOPE_MISMATCH');

    const wrongPeriod = validateWorldModelObservation(
      normalizeWorldModelObservation(observation({
        period: { from: '2025-12-01T00:00:00.000Z', until: '2025-12-07T23:59:59.000Z' }
      })),
      variable
    );
    expect(wrongPeriod.issues.map((issue) => issue.code)).toContain('OBSERVATION_PERIOD_MISMATCH');
  });

  it('represents corrections as new immutable observations that retain the superseded id', () => {
    const original = normalizeWorldModelObservation(observation());
    const correction = normalizeWorldModelObservation(observation({
      id: 'observation-2',
      value: 135,
      recordedAt: '2026-06-12T01:00:00.000Z',
      supersedes: original.id
    }));

    expect(correction.id).not.toBe(original.id);
    expect(correction.supersedes).toBe(original.id);
    expect(original.value).toBe(120);
    expect(correction.value).toBe(135);
  });
});

describe('world-model model adoption contract', () => {
  it('validates model fields without treating a hypothesis as verified', () => {
    const result = validateWorldModelModel(model, 'judgment');
    expect(result.valid).toBe(true);
    expect(result.status).toBe('unverified');

    const incomplete = validateWorldModelModel({ ...model, relationship: '' }, 'judgment');
    expect(incomplete.valid).toBe(false);
    expect(incomplete.issues.map((issue) => issue.path)).toContain('relationship');
  });

  it('retains candidate hypothesis, evidence, ACL, and decision approval separately', () => {
    const candidate: CandidateModelSnapshot = {
      candidateId: 'candidate-model-1',
      hypothesis: '自動完結が増えると総対応時間が下がる可能性がある',
      evidenceIds: ['evidence-model-1', 'evidence-model-2'],
      acl: { ownerId: 'person-1', visibility: 'project', readerIds: ['person-1'], writerIds: ['person-1'] },
      epistemicState: 'hypothesis'
    };
    const approvalRef: DecisionRevision = { id: 'decision-approval-1', type: 'decision', revision: '3' };
    const retained = retainCandidateModel(candidate, model, {
      adoptionId: 'adoption-1',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      approvalRef
    });

    expect(retained).toMatchObject({
      adoptionId: 'adoption-1',
      modelRef: { id: model.id, type: 'model', revision: model.revision },
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      approvalRef
    });
    expect(retained.candidate).toEqual(candidate);
    expect(retained.candidate.epistemicState).toBe('hypothesis');
    expect(model.epistemicState).toBe('hypothesis');
    expect(model.validationState).toBe('in_progress');
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.candidate.acl)).toBe(true);
  });

  it('rejects adoption when the formal Model is incomplete or already verified', () => {
    const candidate: CandidateModelSnapshot = {
      candidateId: 'candidate-model-1',
      hypothesis: 'hypothesis',
      evidenceIds: ['evidence-model-1'],
      acl: { ownerId: 'person-1', visibility: 'project', readerIds: [], writerIds: [] },
      epistemicState: 'hypothesis'
    };
    const adoption = { adoptionId: 'adoption-1', adoptionState: 'proposed' as const, authorizedUse: 'judgment' as const, adoptedAt: '2026-06-15T01:00:00.000Z' };

    expect(() => retainCandidateModel(candidate, { ...model, relationship: '' }, adoption)).toThrow(/MODEL_CONTRACT_INVALID/);
    expect(() => retainCandidateModel(candidate, { ...model, epistemicState: 'verified' }, adoption)).toThrow(/verified/);
  });

  it('requires an approval reference when an adoption is marked approved', () => {
    const candidate: CandidateModelSnapshot = {
      candidateId: 'candidate-model-1',
      hypothesis: 'hypothesis',
      evidenceIds: ['evidence-model-1'],
      acl: { ownerId: 'person-1', visibility: 'project', readerIds: [], writerIds: [] },
      epistemicState: 'hypothesis'
    };

    expect(() => retainCandidateModel(candidate, model, {
      adoptionId: 'adoption-approved-without-ref',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z'
    })).toThrow(/MISSING_APPROVAL_REFERENCE/);
  });
});

describe('world-model canonical record store', () => {
  it('persists observations in the evidence sidecar and reads the exact Variable revision back', async () => {
    const { dataDir, context, foundationStore, store } = await createCanonicalStore();
    const variableRef = await store.createVariable(variable, context);
    const saved = await store.saveObservation(observation({ variableRef }), context);

    const updatedRef = await foundationStore.update({
      reference: variableRef,
      next: { ...variable, revision: '1', meaning: `${variable.meaning}（更新版）` }
    }, context);
    expect(updatedRef.revision).toBe('2');

    const secondStore = createWorldModelStore({
      dataDir,
      foundationStore: createFoundationRevisionStore({ dataDir }),
      approvalReader: {
        isApproved: async ({ approvalRef, modelRef }) => approvalRef.id === 'decision-approval-1'
          && approvalRef.revision === '3'
          && modelRef.id === model.id
          && modelRef.type === 'model'
          && modelRef.revision === model.revision
      }
    });
    await expect(secondStore.readObservation(saved.id, context)).resolves.toEqual(saved);
    const loaded = await loadPersonalOs(dataDir);
    expect(loaded.graph.version).toBe(2);
    expect('worldModel' in loaded.graph).toBe(false);
    const evidence = JSON.parse(await readFile(join(dataDir, WORLD_MODEL_EVIDENCE_SIDECAR), 'utf8')) as {
      observations: readonly WorldModelObservationInput[];
      adoptions: readonly unknown[];
    };
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.observations[0]?.variableRef).toEqual({
      id: variable.id,
      type: 'variable',
      revision: '1'
    });
  });

  it('stores corrections as new records and keeps the superseded observation readable', async () => {
    const { context, store } = await createCanonicalStore();
    const variableRef = await store.createVariable(variable, context);
    const original = await store.saveObservation(observation({ variableRef }), context);
    const correction = await store.saveObservation(observation({
      id: 'observation-2',
      variableRef,
      value: 135,
      recordedAt: '2026-06-12T01:00:00.000Z',
      supersedes: original.id
    }), context);

    expect(correction.supersedes).toBe(original.id);
    await expect(store.readObservation(original.id, context)).resolves.toEqual(original);
    await expect(store.readObservation(correction.id, context)).resolves.toEqual(correction);
  });

  it('retains candidate evidence references and ACL without copying restricted evidence content', async () => {
    const { dataDir, context, store } = await createCanonicalStore();
    const modelRef = await store.createModel(model, context);
    const candidate: CandidateModelSnapshot = {
      candidateId: 'candidate-model-1',
      hypothesis: '自動完結が増えると総対応時間が下がる可能性がある',
      evidenceIds: ['evidence-model-1', 'evidence-model-2'],
      acl: { ownerId: 'org-1', visibility: 'organization', readerIds: ['person-1'], writerIds: ['org-1'] },
      epistemicState: 'hypothesis'
    };
    const adoption = await store.saveModelAdoption(candidate, modelRef, {
      adoptionId: 'adoption-1',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      approvalRef: { id: 'decision-approval-1', type: 'decision', revision: '3' }
    }, context);

    expect(adoption.candidate).toEqual(candidate);
    expect(adoption.candidate.epistemicState).toBe('hypothesis');
    expect(adoption.adoptionState).toBe('approved');
    const secondStore = createWorldModelStore({
      dataDir,
      foundationStore: createFoundationRevisionStore({ dataDir }),
      approvalReader: {
        isApproved: async ({ approvalRef, modelRef }) => approvalRef.id === 'decision-approval-1'
          && approvalRef.revision === '3'
          && modelRef.id === model.id
          && modelRef.type === 'model'
          && modelRef.revision === model.revision
      }
    });
    await expect(secondStore.readModelAdoption(adoption.adoptionId, context)).resolves.toEqual(adoption);
    const aggregate = await loadPersonalOs(dataDir);
    const evidenceText = await readFile(join(dataDir, WORLD_MODEL_EVIDENCE_SIDECAR), 'utf8');
    const evidence = JSON.parse(evidenceText) as {
      observations: readonly unknown[];
      adoptions: readonly { candidate: { hypothesis: string; evidenceIds: readonly string[] } }[];
    };
    expect(evidence.adoptions).toHaveLength(1);
    expect(evidence.adoptions[0]?.candidate.evidenceIds).toEqual(['evidence-model-1', 'evidence-model-2']);
    expect(evidenceText).not.toContain('restricted-evidence-body');
    expect(JSON.stringify(aggregate.graph)).not.toContain('restricted-evidence-body');
  });

  it('requires a provider that verifies the approval binding before saving an approved adoption', async () => {
    const { dataDir, context, foundationStore, store } = await createCanonicalStore();
    const modelRef = await foundationStore.create(model, context);
    const candidate: CandidateModelSnapshot = {
      candidateId: 'candidate-model-1',
      hypothesis: 'hypothesis',
      evidenceIds: ['evidence-model-1'],
      acl: { ownerId: 'org-1', visibility: 'organization', readerIds: [], writerIds: ['org-1'] },
      epistemicState: 'hypothesis'
    };

    await expect(store.saveModelAdoption(candidate, modelRef, {
      adoptionId: 'adoption-without-ref',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z'
    }, context)).rejects.toMatchObject({ code: 'approval_reference_unresolved' });

    const storeWithoutReader = createWorldModelStore({ dataDir, foundationStore });

    await expect(storeWithoutReader.saveModelAdoption(candidate, modelRef, {
      adoptionId: 'adoption-without-provider',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      approvalRef: { id: 'decision-approval-1', type: 'decision', revision: '3' }
    }, context)).rejects.toMatchObject({ code: 'approval_reference_unresolved' });

    const rejectingStore = createWorldModelStore({
      dataDir,
      foundationStore,
      approvalReader: { isApproved: async () => false }
    });
    await expect(rejectingStore.saveModelAdoption(candidate, modelRef, {
      adoptionId: 'adoption-with-wrong-binding',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      approvalRef: { id: 'decision-approval-1', type: 'decision', revision: '3' }
    }, context)).rejects.toMatchObject({ code: 'approval_reference_unresolved' });

    await expect(readFile(join(dataDir, WORLD_MODEL_EVIDENCE_SIDECAR), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks approval before the atomic append without a post-commit reader failure', async () => {
    const { dataDir, context, foundationStore } = await createCanonicalStore();
    const modelRef = await foundationStore.create(model, context);
    const candidate: CandidateModelSnapshot = {
      candidateId: 'candidate-model-1',
      hypothesis: 'hypothesis',
      evidenceIds: ['evidence-model-1'],
      acl: { ownerId: 'org-1', visibility: 'organization', readerIds: [], writerIds: ['org-1'] },
      epistemicState: 'hypothesis'
    };
    let approvalCalls = 0;
    const store = createWorldModelStore({
      dataDir,
      foundationStore,
      approvalReader: {
        isApproved: async () => {
          approvalCalls += 1;
          if (approvalCalls === 1) return true;
          throw new Error('approval reader became unavailable after commit');
        }
      }
    });

    await expect(store.saveModelAdoption(candidate, modelRef, {
      adoptionId: 'adoption-atomic-approval',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      approvalRef: { id: 'decision-approval-1', type: 'decision', revision: '3' }
    }, context)).resolves.toMatchObject({
      adoptionId: 'adoption-atomic-approval',
      adoptionState: 'approved'
    });
    expect(approvalCalls).toBe(1);

    const evidence = JSON.parse(await readFile(join(dataDir, WORLD_MODEL_EVIDENCE_SIDECAR), 'utf8')) as {
      adoptions: readonly { adoptionId: string }[];
    };
    expect(evidence.adoptions).toHaveLength(1);
    expect(evidence.adoptions[0]?.adoptionId).toBe('adoption-atomic-approval');
  });

  it('revalidates the approval binding on adoption readback', async () => {
    const { dataDir, context, store, foundationStore } = await createCanonicalStore();
    const modelRef = await store.createModel(model, context);
    const adoption = await store.saveModelAdoption({
      candidateId: 'candidate-model-1',
      hypothesis: 'hypothesis',
      evidenceIds: ['evidence-model-1'],
      acl: { ownerId: 'org-1', visibility: 'organization', readerIds: [], writerIds: ['org-1'] },
      epistemicState: 'hypothesis'
    }, modelRef, {
      adoptionId: 'adoption-approval-readback',
      adoptionState: 'approved',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z',
      approvalRef: { id: 'decision-approval-1', type: 'decision', revision: '3' }
    }, context);
    const rejectingStore = createWorldModelStore({
      dataDir,
      foundationStore,
      approvalReader: { isApproved: async () => false }
    });

    await expect(rejectingStore.readModelAdoption(adoption.adoptionId, context)).rejects.toMatchObject({
      code: 'approval_reference_unresolved'
    } satisfies Partial<WorldModelStoreError>);
  });

  it('persists and verifies the exact Model digest on adoption readback', async () => {
    const { dataDir, context, store, foundationStore } = await createCanonicalStore();
    const modelRef = await store.createModel(model, context);
    const adoption = await store.saveModelAdoption({
      candidateId: 'candidate-model-1',
      hypothesis: 'hypothesis',
      evidenceIds: ['evidence-model-1'],
      acl: { ownerId: 'org-1', visibility: 'organization', readerIds: [], writerIds: ['org-1'] },
      epistemicState: 'hypothesis'
    }, modelRef, {
      adoptionId: 'adoption-digest',
      adoptionState: 'proposed',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z'
    }, context);

    expect(adoption.modelDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const sidecarPath = join(dataDir, WORLD_MODEL_EVIDENCE_SIDECAR);
    const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as {
      observations: readonly unknown[];
      adoptions: Array<Record<string, unknown>>;
    };
    sidecar.adoptions[0]!.modelDigest = `sha256:${'0'.repeat(64)}`;
    await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);

    await expect(store.readModelAdoption(adoption.adoptionId, context)).rejects.toMatchObject({
      code: 'readback_mismatch'
    } satisfies Partial<WorldModelStoreError>);

    const reloaded = await foundationStore.read(modelRef, context);
    expect(reloaded?.digest).toBeDefined();
  });

  it('enforces the current definition and candidate ACL on evidence readback', async () => {
    const { context, store } = await createCanonicalStore();
    const variableRef = await store.createVariable(variable, context);
    const savedObservation = await store.saveObservation(observation({ variableRef }), context);

    await expect(store.readObservation(savedObservation.id, { principal: 'person-2' })).rejects.toMatchObject({
      code: 'authorization_denied'
    } satisfies Partial<WorldModelStoreError>);

    const modelRef = await store.createModel(model, context);
    const adoption = await store.saveModelAdoption({
      candidateId: 'candidate-model-1',
      hypothesis: 'hypothesis',
      evidenceIds: ['evidence-model-1'],
      acl: { ownerId: 'org-1', visibility: 'project', readerIds: ['person-1'], writerIds: ['org-1'] },
      epistemicState: 'hypothesis'
    }, modelRef, {
      adoptionId: 'adoption-1',
      adoptionState: 'proposed',
      authorizedUse: 'judgment',
      adoptedAt: '2026-06-15T01:00:00.000Z'
    }, context);

    await expect(store.readModelAdoption(adoption.adoptionId, { principal: 'person-2' })).rejects.toMatchObject({
      code: 'authorization_denied'
    } satisfies Partial<WorldModelStoreError>);
  });

  it('rejects a stale foundation digest inside the SSOT transaction before writing', async () => {
    const { dataDir, context, store, foundationStore } = await createCanonicalStore();
    const variableRef = await store.createVariable(variable, context);
    let firstRead = true;
    const staleFoundationStore = {
      create: foundationStore.create.bind(foundationStore),
      read: async (...args: Parameters<typeof foundationStore.read>) => {
        const actual = await foundationStore.read(...args);
        if (actual && firstRead) {
          firstRead = false;
          return { ...actual, digest: 'sha256:' + '0'.repeat(64) };
        }
        return actual;
      }
    };
    const staleStore = createWorldModelStore({ dataDir, foundationStore: staleFoundationStore });

    await expect(staleStore.saveObservation(observation({ variableRef }), context)).rejects.toMatchObject({
      code: 'revision_conflict'
    } satisfies Partial<WorldModelStoreError>);
    const aggregate = await loadPersonalOs(dataDir);
    expect('worldModel' in aggregate.graph).toBe(false);
    await expect(readFile(join(dataDir, WORLD_MODEL_EVIDENCE_SIDECAR), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

// Keep a compile-time reminder that observations use a typed, versioned ref.
const _variableReference: FoundationRevision = { id: variable.id, type: 'variable', revision: variable.revision };
void _variableReference;
