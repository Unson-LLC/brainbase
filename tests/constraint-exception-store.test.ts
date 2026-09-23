import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConstraintService,
  createSingleOwnerConstraintAuthorization,
  type ConstraintExceptionRecord,
  type ConstraintProjection,
} from '../src/constraint-resolution.js';
import {
  AtomicConstraintExceptionStore,
  CONSTRAINT_EXCEPTION_EVIDENCE_PATH,
} from '../src/constraint-exception-store.js';
import { FoundationConstraintStore } from '../src/foundation-constraint-store.js';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { initializePersonalOs } from '../src/ssot.js';

const context = { actorId: 'owner-1', ownerId: 'owner-1' } as const;
const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createDataDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'brainbase-constraint-evidence-'));
  dataDirs.push(dataDir);
  await initializePersonalOs(dataDir);
  return dataDir;
}

function createConstraint(): ConstraintProjection {
  return {
    id: 'constraint-1',
    type: 'constraint',
    revision: '1',
    meaning: 'MVPは現場に二重入力を要求しない',
    adoptionState: 'draft',
    authorizedUses: ['draft', 'judgment'],
    acl: { ownerId: 'owner-1', visibility: 'private', readerIds: [], writerIds: [] },
    storage: 'ontology',
    provenance: [{ sourceId: 'story-1', sourceKind: 'document', evidenceIds: [] }],
    scope: { subjectIds: ['project-1'], validFrom: '2026-09-01T00:00:00.000Z' },
    condition: '実証範囲に限り適用する',
    appliesTo: ['solution-selection'],
    exceptions: [],
    adoptionBasis: [],
  };
}

function createException(overrides: Partial<ConstraintExceptionRecord> = {}): ConstraintExceptionRecord {
  return {
    id: 'exception-1',
    constraintRef: { id: 'constraint-1', revision: '1' },
    decisionRef: { id: 'decision-1', type: 'decision', revision: '1' },
    approverId: 'owner-1',
    scope: {
      subjectIds: ['project-1'],
      validFrom: '2026-09-10T00:00:00.000Z',
      validUntil: '2026-09-20T00:00:00.000Z',
    },
    expiresAt: '2026-09-20T00:00:00.000Z',
    rationale: '限定実証のため',
    ...overrides,
  };
}

describe('AtomicConstraintExceptionStore', () => {
  it('persists rich exception evidence and reads it back from the common SSOT area', async () => {
    const dataDir = await createDataDir();
    const store = new AtomicConstraintExceptionStore({ dataDir });
    const exception = createException();

    await expect(store.append(exception, context)).resolves.toEqual(exception);
    await expect(store.list({ constraintId: 'constraint-1', constraintRevision: '1' }, context))
      .resolves.toEqual([exception]);
    await expect(readFile(join(dataDir, CONSTRAINT_EXCEPTION_EVIDENCE_PATH), 'utf8'))
      .resolves.toContain('exception-1');
  });

  it('keeps duplicate evidence ids as a revision conflict', async () => {
    const dataDir = await createDataDir();
    const store = new AtomicConstraintExceptionStore({ dataDir });
    const exception = createException();

    await store.append(exception, context);
    await expect(store.append(exception, context)).rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('uses injected authorization before writing through the real Foundation store', async () => {
    const dataDir = await createDataDir();
    const foundationStore = createFoundationRevisionStore({ dataDir });
    const exceptionStore = new AtomicConstraintExceptionStore({ dataDir });
    const store = new FoundationConstraintStore({ foundationStore, exceptionStore });
    const authorization = createSingleOwnerConstraintAuthorization();
    const service = new ConstraintService({
      store,
      authorization,
      decisionReader: { exists: vi.fn(async () => true) },
      evaluator: { evaluate: vi.fn(async () => ({ status: 'resolved' as const, applies: true })) },
    });
    const constraint = createConstraint();
    await service.createConstraint(constraint, context);

    const exception = createException();
    await expect(service.registerException(exception, context)).resolves.toEqual(exception);
    await expect(store.listExceptions({ constraintId: constraint.id, constraintRevision: constraint.revision }, context))
      .resolves.toEqual([exception]);
    await expect(service.registerException(exception, { actorId: 'actor-2', ownerId: 'owner-1' }))
      .rejects.toMatchObject({ code: 'authorization_denied' });
  });
});
