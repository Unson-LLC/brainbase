import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DECISION_ADAPTER_SIDECAR,
  DecisionAdapterError,
  createDecisionAdapter,
  type DecisionAdapterConditions,
  type DecisionAdapterContext,
  type DecisionAdapterDecisionRequest
} from '../src/decision-adapter.js';
import type { ObjectiveDefinition } from '../src/ontology-foundation.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import {
  initializePersonalOs,
  loadPersonalOs,
  mutatePersonalOs,
  mutatePersonalOsWithSidecar,
  readPersonalOsSidecar
} from '../src/ssot.js';

const dataDirs: string[] = [];

afterEach(async () => {
  delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;
  delete process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS;
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-decision-adapter-'));
  dataDirs.push(directory);
  await initializePersonalOs(directory);
  return directory;
}

function context(principal = 'person-1'): DecisionAdapterContext {
  return { principal };
}

function conditions(overrides: Partial<DecisionAdapterConditions> = {}): DecisionAdapterConditions {
  return {
    problem_snapshot: {
      snapshot_id: `sha256:${'a'.repeat(64)}`,
      problem_id: 'problem-1',
      revision: '1'
    },
    method: { id: 'method-1', version: '1' },
    objective_refs: [{ id: 'objective-1', type: 'objective', revision: '1' }],
    ...overrides
  };
}

function decisionRequest(overrides: Partial<DecisionAdapterDecisionRequest> = {}): DecisionAdapterDecisionRequest {
  return {
    decision_id: 'decision-1',
    title: 'Use the bounded pilot',
    decision: 'Run a bounded pilot before expanding the change.',
    conditions: conditions(),
    ...overrides
  };
}

function objectiveDefinition(): ObjectiveDefinition {
  return {
    id: 'objective-1',
    type: 'objective',
    revision: '1',
    meaning: 'Reduce front-desk response load',
    adoptionState: 'draft',
    authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl: {
      ownerId: 'person-1',
      visibility: 'private',
      readerIds: [],
      writerIds: []
    },
    storage: 'ontology',
    provenance: [{ sourceId: 'decision-adapter-test', sourceKind: 'document', evidenceIds: [] }],
    scope: { subjectIds: ['org-1'], validFrom: '2026-01-01T00:00:00.000Z' },
    beneficiaryIds: ['org-1'],
    desiredState: 'Reduce total front-desk response load.',
    criteria: [],
    evaluationPeriod: {
      from: '2026-01-01T00:00:00.000Z',
      until: '2026-03-31T23:59:59.000Z'
    },
    accountableId: 'person-1'
  };
}

describe('DecisionAdapterPort', () => {
  it('requires a problem snapshot, method revision, and Objective revision on new writes', async () => {
    const dataDir = await makeDataDir();
    const store = createDecisionAdapter({ dataDir });

    await expect(store.createDecision({
      ...decisionRequest(),
      conditions: undefined as never
    }, context())).rejects.toMatchObject({ code: 'validation_error' });

    await expect(store.createDecision({
      ...decisionRequest(),
      conditions: conditions({
        objective_refs: []
      })
    }, context())).rejects.toMatchObject({ code: 'validation_error' });

    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({ decisions: [] });
    await expect(readPersonalOsSidecar(dataDir, DECISION_ADAPTER_SIDECAR)).resolves.toBeUndefined();
  });

  it('keeps the legacy response identifiers while writing one canonical Decision and reference-only sidecar', async () => {
    const dataDir = await makeDataDir();
    const store = createDecisionAdapter({ dataDir });
    const response = await store.createDecision(decisionRequest(), context());

    // An anonymized fixture from the retired organization route requires these keys.
    expect(response).toEqual({
      decision_id: 'decision-1',
      event_id: expect.stringMatching(/^evt-/u)
    });
    expect(response).not.toHaveProperty('guard_status');

    const read = await store.readDecision({ decision_id: response.decision_id }, context());
    expect(read).toMatchObject({
      decision: { id: 'decision-1', title: 'Use the bounded pilot' },
      graph_entity: { id: 'decision-1', type: 'decision' },
      condition_status: 'recorded',
      conditions: conditions(),
      authority_status: 'unrecorded',
      ai_logs: []
    });

    const os = await loadPersonalOs(dataDir);
    expect(os.decisions).toHaveLength(1);
    expect(os.decisions[0]?.id).toBe('decision-1');
    expect(os.graph.version).toBe(2);
    if (os.graph.version === 2) {
      expect(os.graph.entities.filter((entity) => entity.id === 'decision-1')).toHaveLength(1);
    }

    const sidecar = JSON.parse(await readFile(join(dataDir, DECISION_ADAPTER_SIDECAR), 'utf8')) as {
      decisions: Record<string, { conditions: DecisionAdapterConditions; ai_logs: unknown[] }>;
    };
    expect(sidecar.decisions['decision-1']).toMatchObject({
      decision_id: 'decision-1',
      conditions: conditions(),
      ai_logs: []
    });
    expect(JSON.stringify(sidecar)).not.toContain('Use the bounded pilot');
  });

  it('attaches AI decision-log metadata to the existing Decision without creating an ai_decision Graph entity', async () => {
    const dataDir = await makeDataDir();
    const store = createDecisionAdapter({ dataDir });
    await store.createDecision(decisionRequest(), context());

    const response = await store.createAiDecisionLog({
      related_decision_id: 'decision-1',
      summary: 'The bounded pilot is the least risky next step.',
      decision_type: 'recommendation',
      confidence: 0.8,
      references: ['evidence-1'],
      conditions: conditions()
    }, context());

    expect(response).toEqual({
      ai_decision_id: expect.stringMatching(/^aid-/u),
      event_id: expect.stringMatching(/^evt-/u)
    });
    expect(response).not.toHaveProperty('guard_status');

    const read = await store.readDecision({ decision_id: 'decision-1' }, context());
    expect(read.ai_logs).toHaveLength(1);
    expect(read.ai_logs[0]).toMatchObject({
      ai_decision_id: response.ai_decision_id,
      summary: 'The bounded pilot is the least risky next step.',
      conditions: conditions()
    });
    const os = await loadPersonalOs(dataDir);
    if (os.graph.version === 2) {
      expect(os.graph.entities.some((entity) => entity.id === response.ai_decision_id)).toBe(false);
      expect(os.graph.entities.filter((entity) => entity.type === 'decision')).toHaveLength(1);
    }
  });

  it('reads legacy Decisions as condition-unrecorded without inferring Objective or authority references', async () => {
    const dataDir = await makeDataDir();
    await mutatePersonalOs(dataDir, (current) => ({
      ...current,
      decisions: [...current.decisions, {
        id: 'legacy-decision',
        title: 'Legacy decision mentions objective-1',
        decision: 'The old record has no structured judgment conditions.'
      }]
    }));

    const store = createDecisionAdapter({ dataDir });
    await expect(store.readDecision({ decision_id: 'legacy-decision' }, context())).resolves.toMatchObject({
      condition_status: 'unrecorded',
      authority_status: 'unrecorded',
      ai_logs: []
    });
    const read = await store.readDecision({ decision_id: 'legacy-decision' }, context());
    expect(read.conditions).toBeUndefined();
    expect(read.graph_entity).toBeUndefined();
  });

  it('fails closed when a trusted current-reference provider rejects the conditions', async () => {
    const dataDir = await makeDataDir();
    const validate = vi.fn(async () => false);
    const store = createDecisionAdapter({
      dataDir,
      conditionValidator: { validate }
    });

    await expect(store.createDecision(decisionRequest(), context())).rejects.toMatchObject({
      code: 'condition_unavailable'
    });
    expect(validate).toHaveBeenCalledOnce();
    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({ decisions: [] });
    await expect(readPersonalOsSidecar(dataDir, DECISION_ADAPTER_SIDECAR)).resolves.toBeUndefined();
  });

  it('runs real SSOT-reading condition and authorization providers outside the mutation lock', async () => {
    const dataDir = await makeDataDir();
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '100';
    const foundation = createFoundationRevisionStore({ dataDir });
    await foundation.create(objectiveDefinition(), { principal: 'person-1' });
    const validate = vi.fn(async ({ conditions: input, context: currentContext }: {
      conditions: DecisionAdapterConditions;
      context: DecisionAdapterContext;
    }) => {
      for (const reference of input.objective_refs) {
        if (!(await foundation.read(reference, { principal: currentContext.principal }))) return false;
      }
      return true;
    });
    const authorize = vi.fn(async ({ context: currentContext }: {
      context: DecisionAdapterContext;
    }) => Boolean(await foundation.readLatest('objective', 'objective-1', {
      principal: currentContext.principal
    })));
    const store = createDecisionAdapter({
      dataDir,
      conditionValidator: { validate },
      authorization: { authorize }
    });

    await expect(store.createDecision(decisionRequest(), context())).resolves.toMatchObject({
      decision_id: 'decision-1'
    });
    expect(validate).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it('rejects a canonical aggregate changed while trusted references are being validated', async () => {
    const dataDir = await makeDataDir();
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '100';
    let validationStarted!: () => void;
    let releaseValidation!: () => void;
    const started = new Promise<void>((resolve) => {
      validationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const store = createDecisionAdapter({
      dataDir,
      conditionValidator: {
        validate: async () => {
          validationStarted();
          await gate;
          return true;
        }
      }
    });
    const pending = store.createDecision(decisionRequest(), context());
    await started;
    await mutatePersonalOs(dataDir, (current) => ({
      ...current,
      personalKg: [...current.personalKg, {
        id: 'validation-race',
        type: 'judgment',
        text: 'Concurrent canonical update'
      }]
    }));
    releaseValidation();

    await expect(pending).rejects.toMatchObject({ code: 'decision_conflict' });
    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({
      decisions: [],
      personalKg: [expect.objectContaining({ id: 'validation-race' })]
    });
    await expect(readPersonalOsSidecar(dataDir, DECISION_ADAPTER_SIDECAR)).resolves.toBeUndefined();
  });

  it('rejects a sidecar changed while trusted references are being validated', async () => {
    const dataDir = await makeDataDir();
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '100';
    let validationStarted!: () => void;
    let releaseValidation!: () => void;
    const started = new Promise<void>((resolve) => {
      validationStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const store = createDecisionAdapter({
      dataDir,
      conditionValidator: {
        validate: async () => {
          validationStarted();
          await gate;
          return true;
        }
      }
    });
    const pending = store.createDecision(decisionRequest(), context());
    await started;
    await mutatePersonalOsWithSidecar(dataDir, DECISION_ADAPTER_SIDECAR, (current, content) => ({
      next: current,
      sidecarContent: content ?? JSON.stringify({ version: 'decision-adapter.v1', decisions: {} }),
      result: undefined
    }));
    releaseValidation();

    await expect(pending).rejects.toMatchObject({ code: 'decision_conflict' });
    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({ decisions: [] });
    await expect(readPersonalOsSidecar(dataDir, DECISION_ADAPTER_SIDECAR)).resolves.toContain('decision-adapter.v1');
  });

  it('returns commit acknowledgements without rolling back when a later current read is denied', async () => {
    const dataDir = await makeDataDir();
    let validationCalls = 0;
    const store = createDecisionAdapter({
      dataDir,
      conditionValidator: {
        validate: async () => ++validationCalls <= 2
      }
    });

    await expect(store.createDecision(decisionRequest(), context())).resolves.toMatchObject({
      decision_id: 'decision-1',
      event_id: expect.stringMatching(/^evt-/u)
    });
    expect(validationCalls).toBe(1);

    await expect(store.createAiDecisionLog({
      decision_id: 'decision-1',
      summary: 'Keep the bounded pilot as the next step.',
      conditions: conditions()
    }, context())).resolves.toMatchObject({
      ai_decision_id: expect.stringMatching(/^aid-/u),
      event_id: expect.stringMatching(/^evt-/u)
    });
    expect(validationCalls).toBe(2);
    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({
      decisions: [{ id: 'decision-1' }]
    });
    const sidecar = JSON.parse(await readFile(join(dataDir, DECISION_ADAPTER_SIDECAR), 'utf8')) as {
      decisions: Record<string, { ai_logs: unknown[] }>;
    };
    expect(sidecar.decisions['decision-1']?.ai_logs).toHaveLength(1);

    await expect(store.readDecision({ decision_id: 'decision-1' }, context()))
      .rejects.toMatchObject({ code: 'condition_unavailable' });
    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({
      decisions: [{ id: 'decision-1' }]
    });
  });

  it('uses the canonical Graph owner boundary when no organization policy is injected', async () => {
    const dataDir = await makeDataDir();
    await mutatePersonalOs(dataDir, (current) => ({
      ...current,
      graph: current.graph.version === 2
        ? { ...current.graph, owner: { id: 'owner-1' } }
        : current.graph
    }));
    const store = createDecisionAdapter({ dataDir });
    await store.createDecision(decisionRequest(), context('owner-1'));

    await expect(store.readDecision({ decision_id: 'decision-1' }, context('outsider')))
      .rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('rolls back canonical Decision, Graph, and sidecar when the atomic publication fails', async () => {
    const dataDir = await makeDataDir();
    const store = createDecisionAdapter({ dataDir });
    process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH = '5';
    await expect(store.createDecision(decisionRequest(), context())).rejects.toMatchObject({
      code: 'store_corrupt'
    });
    delete process.env.BRAINBASE_SSOT_FAIL_AFTER_PUBLISH;

    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({ decisions: [] });
    await expect(readPersonalOsSidecar(dataDir, DECISION_ADAPTER_SIDECAR)).resolves.toBeUndefined();
  });

  it('rejects mismatched AI-log conditions without appending a second record', async () => {
    const dataDir = await makeDataDir();
    const store = createDecisionAdapter({ dataDir });
    await store.createDecision(decisionRequest(), context());

    await expect(store.createAiDecisionLog({
      decision_id: 'decision-1',
      summary: 'Mismatched conditions must not be accepted.',
      conditions: conditions({
        method: { id: 'different-method', version: '1' }
      })
    }, context())).rejects.toMatchObject({ code: 'condition_unavailable' });

    await expect(store.readDecision({ decision_id: 'decision-1' }, context())).resolves.toMatchObject({ ai_logs: [] });
  });

  it('keeps the old record readable when a sidecar is absent after initialization', async () => {
    const dataDir = await makeDataDir();
    await mutatePersonalOs(dataDir, (current) => ({
      ...current,
      decisions: [{ id: 'legacy-2', title: 'Old', decision: 'Old record' }]
    }));
    const store = createDecisionAdapter({ dataDir });
    const result = await store.readDecision({ decision_id: 'legacy-2' }, context());
    expect(result.condition_status).toBe('unrecorded');
    expect(result.authority_status).toBe('unrecorded');
  });

  it('exposes domain error codes rather than treating invalid conditions as success', async () => {
    const dataDir = await makeDataDir();
    const store = createDecisionAdapter({ dataDir });
    try {
      await store.createDecision(decisionRequest({
        conditions: conditions({
          problem_snapshot: {
            snapshot_id: 'sha256:not-a-digest',
            problem_id: 'problem-1',
            revision: '1'
          }
        })
      }), context());
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(DecisionAdapterError);
      expect(error).toMatchObject({ code: 'validation_error' });
    }
    await expect(loadPersonalOs(dataDir)).resolves.toMatchObject({ decisions: [] });
  });
});
