import { describe, expect, it, vi } from 'vitest';
import {
  ConstraintError,
  ConstraintService,
  InMemoryConstraintStore,
  createSingleOwnerConstraintAuthorization,
  type ConstraintDecisionReference,
  type ConstraintEvaluationProvider,
  type ConstraintExceptionRecord,
  type ConstraintProjection,
} from '../src/constraint-resolution.js';

const ownerContext = { actorId: 'owner-1', ownerId: 'owner-1' } as const;
const decision: ConstraintDecisionReference = {
  id: 'decision-1',
  type: 'decision',
  revision: 'r1',
};

function createConstraint(overrides: Partial<ConstraintProjection> = {}): ConstraintProjection {
  return {
    id: 'constraint-1',
    type: 'constraint',
    revision: 'r1',
    meaning: 'MVPは現場に二重入力を要求しない',
    adoptionState: 'draft',
    authorizedUses: ['judgment'],
    acl: {
      ownerId: 'owner-1',
      visibility: 'private',
      readerIds: [],
      writerIds: [],
    },
    storage: 'ontology',
    provenance: [{ sourceId: 'story-1', sourceKind: 'document', evidenceIds: [] }],
    scope: {
      subjectIds: ['project-1'],
      validFrom: '2026-09-01T00:00:00.000Z',
      validUntil: '2026-10-01T00:00:00.000Z',
    },
    condition: '採用方式がMVPの実証範囲に属する場合',
    appliesTo: ['solution-selection'],
    exceptions: [],
    adoptionBasis: [],
    ...overrides,
  };
}

function createFixture(options: {
  decisionExists?: boolean;
  evaluator?: ConstraintEvaluationProvider;
  authorization?: ReturnType<typeof createSingleOwnerConstraintAuthorization>;
} = {}) {
  const store = new InMemoryConstraintStore();
  const decisionReader = {
    exists: vi.fn(async () => options.decisionExists ?? true),
  };
  const evaluator: ConstraintEvaluationProvider = options.evaluator ?? {
    evaluate: vi.fn(async () => ({ status: 'resolved' as const, applies: true })),
  };
  const service = new ConstraintService({
    store,
    authorization: options.authorization ?? createSingleOwnerConstraintAuthorization(),
    decisionReader,
    evaluator,
  });
  return { store, service, decisionReader, evaluator };
}

describe('ConstraintService', () => {
  it('stores qualitative conditions immutably and rejects stale revisions', async () => {
    const fixture = createFixture();
    const created = await fixture.service.createConstraint(createConstraint(), ownerContext);
    expect(created.revision).toBe('r1');
    expect(created.condition).toContain('MVP');

    const updated = await fixture.service.updateConstraint(
      created.id,
      created.revision,
      { condition: '承認済みの実証範囲に限り採用する' },
      ownerContext,
    );
    expect(updated.revision).toBe('r2');
    expect((await fixture.store.get({ id: created.id, revision: 'r1' }))?.condition).toContain('MVP');
    expect((await fixture.store.getLatest(created.id))?.condition).toContain('承認済み');

    await expect(
      fixture.service.updateConstraint(created.id, 'r1', { meaning: 'stale' }, ownerContext),
    ).rejects.toMatchObject<Partial<ConstraintError>>({ code: 'revision_conflict' });
  });

  it('adopts only an exact Decision revision and preserves the basis', async () => {
    const fixture = createFixture();
    const created = await fixture.service.createConstraint(createConstraint(), ownerContext);
    const adopted = await fixture.service.adoptConstraint(created.id, created.revision, decision, ownerContext);

    expect(adopted).toMatchObject({
      revision: 'r2',
      adoptionState: 'approved',
      adoptionBasis: [decision],
    });
    await expect(
      fixture.service.adoptConstraint('constraint-missing', 'r1', decision, ownerContext),
    ).rejects.toMatchObject<Partial<ConstraintError>>({ code: 'constraint_not_found' });

    const missingDecision = createFixture({ decisionExists: false });
    const draft = await missingDecision.service.createConstraint(createConstraint(), ownerContext);
    await expect(
      missingDecision.service.adoptConstraint(draft.id, draft.revision, decision, ownerContext),
    ).rejects.toMatchObject<Partial<ConstraintError>>({ code: 'decision_reference_unresolved' });
    expect(await missingDecision.store.getLatest(draft.id)).toMatchObject({ revision: 'r1', adoptionState: 'draft' });
  });

  it('resolves only matching owner, target, subject and time, without granting execution', async () => {
    const evaluator = {
      evaluate: vi.fn(async ({ constraint }: { constraint: ConstraintProjection }) => ({
        status: 'resolved' as const,
        applies: constraint.id === 'constraint-1',
      })),
    };
    const fixture = createFixture({ evaluator });
    const draft = await fixture.service.createConstraint(createConstraint(), ownerContext);
    await fixture.service.adoptConstraint(draft.id, draft.revision, decision, ownerContext);

    const resolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );
    expect(resolved).toMatchObject({ status: 'resolved', executionAuthority: 'not_granted' });
    expect(resolved.constraints).toHaveLength(1);
    expect(evaluator.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      constraint: expect.objectContaining({ condition: expect.any(String) }),
    }));

    const outsideTarget = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'deployment',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );
    expect(outsideTarget).toMatchObject({ status: 'resolved', constraints: [], executionAuthority: 'not_granted' });
  });

  it.each([
    [{ status: 'unknown' as const, reason: 'PMS連携可否が未確認' }, 'evaluation_unknown'],
    [{ status: 'conflict' as const, reason: '方式Aと方式Bの条件が競合' }, 'constraint_conflict'],
  ])('fails closed when the evaluation provider returns %s', async (evaluation, reason) => {
    const fixture = createFixture({ evaluator: { evaluate: vi.fn(async () => evaluation) } });
    const draft = await fixture.service.createConstraint(createConstraint(), ownerContext);
    await fixture.service.adoptConstraint(draft.id, draft.revision, decision, ownerContext);

    const resolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );
    expect(resolved.status).toBe('unresolved');
    expect(resolved.constraints).toEqual([]);
    expect(resolved.executionAuthority).toBe('not_granted');
    expect(resolved.unresolvedReasons[0]?.code).toBe(reason);
  });

  it('does not infer conflicts by comparing qualitative condition text', async () => {
    const evaluator = { evaluate: vi.fn(async () => ({ status: 'resolved' as const, applies: true })) };
    const fixture = createFixture({ evaluator });
    const first = await fixture.service.createConstraint(createConstraint(), ownerContext);
    await fixture.service.adoptConstraint(first.id, first.revision, decision, ownerContext);
    const second = await fixture.service.createConstraint(
      createConstraint({
        id: 'constraint-2',
        condition: '同じ対象に別の定性的条件を適用する',
      }),
      ownerContext,
    );
    await fixture.service.adoptConstraint(second.id, second.revision, decision, ownerContext);

    const resolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.constraints.map((constraint) => constraint.id)).toEqual(['constraint-1', 'constraint-2']);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(2);
  });

  it('keeps an expired exception from weakening the base constraint and passes active exceptions to the provider', async () => {
    const evaluator = {
      evaluate: vi.fn(async () => ({ status: 'resolved' as const, applies: true })),
    };
    const fixture = createFixture({ evaluator });
    const draft = await fixture.service.createConstraint(createConstraint(), ownerContext);
    const adopted = await fixture.service.adoptConstraint(draft.id, draft.revision, decision, ownerContext);
    const expired: ConstraintExceptionRecord = {
      id: 'exception-expired',
      constraintRef: { id: adopted.id, revision: adopted.revision },
      decisionRef: decision,
      approverId: 'owner-1',
      scope: {
        subjectIds: ['project-1'],
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: '2026-09-30T00:00:00.000Z',
      },
      expiresAt: '2026-09-15T00:00:00.000Z',
      rationale: '期限付きの実証例外',
    };
    await fixture.service.registerException(expired, ownerContext);
    const active: ConstraintExceptionRecord = {
      ...expired,
      id: 'exception-active',
      expiresAt: '2026-09-25T00:00:00.000Z',
    };
    await fixture.service.registerException(active, ownerContext);

    const resolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );
    expect(resolved.status).toBe('resolved');
    expect(evaluator.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      activeExceptions: [expect.objectContaining({ id: 'exception-active' })],
    }));
  });

  it('rejects cross-owner resolution and exception authorization', async () => {
    const fixture = createFixture();
    const constraint = createConstraint();
    await expect(
      fixture.service.createConstraint(constraint, { actorId: 'owner-2', ownerId: 'owner-2' }),
    ).rejects.toMatchObject<Partial<ConstraintError>>({ code: 'scope_violation' });

    const created = await fixture.service.createConstraint(constraint, ownerContext);
    const adopted = await fixture.service.adoptConstraint(created.id, created.revision, decision, ownerContext);
    const exception: ConstraintExceptionRecord = {
      id: 'exception-cross-owner',
      constraintRef: { id: adopted.id, revision: adopted.revision },
      decisionRef: decision,
      approverId: 'owner-1',
      scope: adopted.scope,
      expiresAt: '2026-09-25T00:00:00.000Z',
      rationale: 'cross-owner attempt',
    };
    await expect(
      fixture.service.registerException(exception, { actorId: 'owner-2', ownerId: 'owner-2' }),
    ).rejects.toMatchObject<Partial<ConstraintError>>({ code: 'scope_violation' });

    const unresolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      { actorId: 'owner-2', ownerId: 'owner-2' },
    );
    expect(unresolved).toMatchObject({ status: 'unresolved', executionAuthority: 'not_granted' });
    expect(unresolved.unresolvedReasons[0]?.code).toBe('scope_violation');
  });

  it('requires a known Decision revision before resolving an adopted constraint', async () => {
    const fixture = createFixture({ decisionExists: false });
    const record = createConstraint({
      adoptionState: 'approved',
      adoptionBasis: [decision],
    });
    await fixture.service.createConstraint(record, ownerContext);
    const resolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );
    expect(resolved.status).toBe('unresolved');
    expect(resolved.unresolvedReasons.map((reason) => reason.code)).toContain('decision_reference_unresolved');
  });

  it('does not apply an active exception when its Decision revision is no longer readable', async () => {
    const fixture = createFixture({ decisionExists: true });
    const draft = await fixture.service.createConstraint(createConstraint(), ownerContext);
    const adopted = await fixture.service.adoptConstraint(draft.id, draft.revision, decision, ownerContext);
    const exception: ConstraintExceptionRecord = {
      id: 'exception-unreadable-decision',
      constraintRef: { id: adopted.id, revision: adopted.revision },
      decisionRef: { ...decision, revision: 'r2' },
      approverId: 'owner-1',
      scope: adopted.scope,
      expiresAt: '2026-09-25T00:00:00.000Z',
      rationale: '例外の承認根拠を確認できない場合は適用しない',
    };
    await fixture.service.registerException(exception, ownerContext);
    fixture.decisionReader.exists.mockImplementation(async (reference) => reference.revision === 'r1');

    const resolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );

    expect(resolved.status).toBe('unresolved');
    expect(resolved.constraints).toEqual([]);
    expect(resolved.unresolvedReasons.map((reason) => reason.code)).toContain('decision_reference_unresolved');
    expect(fixture.evaluator.evaluate).not.toHaveBeenCalled();
  });

  it('does not apply an active exception when its approver is not authorized', async () => {
    const evaluator = { evaluate: vi.fn(async () => ({ status: 'resolved' as const, applies: true })) };
    const fixture = createFixture({ evaluator });
    const draft = await fixture.service.createConstraint(createConstraint(), ownerContext);
    const adopted = await fixture.service.adoptConstraint(draft.id, draft.revision, decision, ownerContext);
    await fixture.store.appendException({
      id: 'exception-unauthorized-approver',
      constraintRef: { id: adopted.id, revision: adopted.revision },
      decisionRef: decision,
      approverId: 'owner-2',
      scope: adopted.scope,
      expiresAt: '2026-09-25T00:00:00.000Z',
      rationale: 'canonical store corruption fixture',
    });

    const resolved = await fixture.service.resolveConstraints(
      {
        ownerId: 'owner-1',
        subjectId: 'project-1',
        targetId: 'solution-selection',
        asOf: '2026-09-20T00:00:00.000Z',
      },
      ownerContext,
    );

    expect(resolved.status).toBe('unresolved');
    expect(resolved.constraints).toEqual([]);
    expect(resolved.unresolvedReasons.map((reason) => reason.code)).toContain('exception_invalid');
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });
});
