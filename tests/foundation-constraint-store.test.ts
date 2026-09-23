import { describe, expect, it, vi } from 'vitest';
import {
  FoundationConstraintStore,
  type ConstraintExceptionStore,
} from '../src/foundation-constraint-store.js';
import type {
  ConstraintExceptionRecord,
  ConstraintProjection,
} from '../src/constraint-resolution.js';
import type { FoundationRevisionStore } from '../src/foundation-store.js';

const context = { actorId: 'owner-1', ownerId: 'owner-1' } as const;

function createConstraint(overrides: Partial<ConstraintProjection> = {}): ConstraintProjection {
  return {
    id: 'constraint-1',
    type: 'constraint',
    revision: '1',
    meaning: 'MVPは現場に二重入力を要求しない',
    adoptionState: 'draft',
    authorizedUses: ['judgment'],
    acl: { ownerId: 'owner-1', visibility: 'private', readerIds: [], writerIds: [] },
    storage: 'ontology',
    provenance: [{ sourceId: 'story-1', sourceKind: 'document', evidenceIds: [] }],
    scope: { subjectIds: ['project-1'], validFrom: '2026-09-01T00:00:00.000Z' },
    condition: '実証範囲に限り適用する',
    appliesTo: ['solution-selection'],
    exceptions: [],
    adoptionBasis: [],
    ...overrides,
  };
}

function createFoundationFake(definition: ConstraintProjection) {
  let current = { definition, digest: 'sha256:fake' };
  return {
    create: vi.fn(async () => ({ id: definition.id, type: 'constraint' as const, revision: definition.revision, digest: current.digest })),
    read: vi.fn(async (reference: { revision: string }) => current.definition.revision === reference.revision ? current : null),
    readLatest: vi.fn(async () => current),
    update: vi.fn(async ({ next }: { next: ConstraintProjection }) => {
      current = { definition: next, digest: 'sha256:fake-next' };
      return {
        id: next.id,
        type: 'constraint' as const,
        revision: next.revision,
        digest: current.digest,
      };
    }),
    list: vi.fn(async () => [current]),
    addRelation: vi.fn(async () => undefined),
  } satisfies FoundationRevisionStore;
}

describe('FoundationConstraintStore', () => {
  it('persists Constraint revisions through FoundationRevisionStore with the owner principal', async () => {
    const definition = createConstraint();
    const foundation = createFoundationFake(definition);
    const exceptions: ConstraintExceptionStore = {
      append: vi.fn(async (exception) => exception),
      list: vi.fn(async () => []),
    };
    const store = new FoundationConstraintStore({ foundationStore: foundation, exceptionStore: exceptions });

    await expect(store.append({ record: definition, expectedPreviousRevision: null }, context)).resolves.toEqual(definition);
    expect(foundation.create).toHaveBeenCalledWith(definition, { principal: 'owner-1' });

    const next = createConstraint({ revision: '2', condition: '承認済みの範囲に限り適用する' });
    await expect(store.append({ record: next, expectedPreviousRevision: '1' }, context)).resolves.toEqual(next);
    expect(foundation.update).toHaveBeenCalledWith(expect.objectContaining({
      reference: { id: 'constraint-1', type: 'constraint', revision: '1' },
      expectedRevision: '1',
      next,
    }), { principal: 'owner-1' });
  });

  it('delegates exception metadata to the injected canonical exception boundary', async () => {
    const definition = createConstraint();
    const foundation = createFoundationFake(definition);
    const exception: ConstraintExceptionRecord = {
      id: 'exception-1',
      constraintRef: { id: definition.id, revision: definition.revision },
      decisionRef: { id: 'decision-1', type: 'decision', revision: '1' },
      approverId: 'owner-1',
      scope: definition.scope,
      expiresAt: '2026-10-01T00:00:00.000Z',
      rationale: '限定実証のため',
    };
    const exceptions: ConstraintExceptionStore = {
      append: vi.fn(async (value) => value),
      list: vi.fn(async () => [exception]),
    };
    const store = new FoundationConstraintStore({ foundationStore: foundation, exceptionStore: exceptions });

    await expect(store.appendException(exception, context)).resolves.toEqual(exception);
    await expect(store.listExceptions({ constraintId: definition.id }, context)).resolves.toEqual([exception]);
    expect(exceptions.append).toHaveBeenCalledWith(exception, context);
    expect(exceptions.list).toHaveBeenCalledWith({ constraintId: definition.id }, context);
  });

  it('fails closed when canonical persistence has no authenticated owner context', async () => {
    const definition = createConstraint();
    const foundation = createFoundationFake(definition);
    const exceptions: ConstraintExceptionStore = {
      append: vi.fn(async (exception) => exception),
      list: vi.fn(async () => []),
    };
    const store = new FoundationConstraintStore({ foundationStore: foundation, exceptionStore: exceptions });

    await expect(store.getLatest(definition.id)).rejects.toMatchObject({ code: 'authorization_denied' });
    expect(foundation.readLatest).not.toHaveBeenCalled();
  });
});
