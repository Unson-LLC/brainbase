import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createJudgmentProblemPhilosophyReferenceResolver,
  isPhilosophyRevisionReference,
  philosophyRevisionDigest,
  type PhilosophyRevisionReadRequest,
  type PhilosophyRevisionRecord,
  type PhilosophyRevisionReference,
  type PhilosophyRevisionScope
} from '../src/philosophy-revision-reader.js';
import {
  createJudgmentProblemFoundationReferenceProvider,
  type JudgmentProblemReference
} from '../src/judgment-problem-snapshot.js';
import type { FoundationAcl } from '../src/ontology-foundation.js';

const scope: PhilosophyRevisionScope = { type: 'project', id: 'hotel-alpha' };

function acl(overrides: Partial<FoundationAcl> = {}): FoundationAcl {
  return {
    ownerId: 'alice',
    visibility: 'private',
    readerIds: ['bob'],
    writerIds: [],
    ...overrides
  };
}

function philosophyRecord(): PhilosophyRevisionRecord {
  const payload = {
    principle: '継続利用を導入件数より優先する',
    canonicalSource: 'brainbase://philosophy/customer-value'
  } as const;
  const applicability = {
    scope,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T23:59:59.000Z'
  } as const;
  const identity = {
    kind: 'philosophy' as const,
    id: 'philosophy-customer-value',
    revision: '3',
    payload,
    applicability
  };
  return {
    ...identity,
    digest: philosophyRevisionDigest(identity),
    currentAcl: acl(),
    currentScope: scope
  };
}

function referenceFor(record: PhilosophyRevisionRecord): JudgmentProblemReference {
  return {
    kind: 'philosophy' as unknown as JudgmentProblemReference['kind'],
    id: record.id,
    revision: record.revision,
    digest: record.digest,
    scope,
    valid_from: '2026-02-01T00:00:00.000Z',
    valid_to: '2026-03-01T00:00:00.000Z'
  } as JudgmentProblemReference;
}

function resolveInput(record: PhilosophyRevisionRecord, principal = 'alice') {
  return {
    reference: referenceFor(record),
    phase: 'historical_read' as const,
    context: { principal }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Philosophy revision reader contract', () => {
  it('resolves an existing canonical philosophy revision through resolveOther', async () => {
    const record = philosophyRecord();
    const calls: PhilosophyRevisionReadRequest[] = [];
    const reader = {
      read(input: PhilosophyRevisionReadRequest) {
        calls.push(input);
        return { status: 'resolved' as const, record };
      }
    };
    const resolveOther = createJudgmentProblemPhilosophyReferenceResolver({ reader });
    const provider = createJudgmentProblemFoundationReferenceProvider({
      store: { read: async () => null },
      resolveOther
    });

    await expect(provider.resolve(resolveInput(record))).resolves.toEqual({
      status: 'resolved',
      digest: record.digest
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      phase: 'historical_read',
      context: { principal: 'alice', scope },
      reference: {
        kind: 'philosophy',
        id: record.id,
        revision: record.revision,
        digest: record.digest,
        scope,
        valid_from: '2026-02-01T00:00:00.000Z',
        valid_to: '2026-03-01T00:00:00.000Z'
      }
    });
  });

  it('accepts a structurally valid philosophy reference and rejects malformed periods', () => {
    const record = philosophyRecord();
    const reference: PhilosophyRevisionReference = {
      kind: 'philosophy',
      id: record.id,
      revision: record.revision,
      digest: record.digest,
      scope,
      valid_from: '2026-02-01T00:00:00.000Z',
      valid_to: '2026-03-01T00:00:00.000Z'
    };
    expect(isPhilosophyRevisionReference(reference)).toBe(true);
    expect(isPhilosophyRevisionReference({ ...reference, valid_from: '2026-02-30T00:00:00Z' })).toBe(false);
    expect(isPhilosophyRevisionReference({ ...reference, valid_to: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it.each([
    ['missing', 'missing'],
    ['unauthorized', 'unauthorized'],
    ['corrupt', 'unresolved']
  ] as const)('fails closed for a reader %s result', async (readerStatus, expectedStatus) => {
    const record = philosophyRecord();
    const resolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: { read: async () => ({ status: readerStatus }) }
    });

    await expect(resolver(resolveInput(record))).resolves.toMatchObject({ status: expectedStatus });
  });

  it('rejects a payload tampered after the canonical digest was recorded', async () => {
    const record = philosophyRecord();
    const resolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: {
            ...record,
            payload: { ...record.payload, principle: '改ざんされた価値基準' }
          }
        })
      }
    });

    await expect(resolver(resolveInput(record))).resolves.toMatchObject({ status: 'unresolved' });
  });

  it('rejects a changed applicability period during a current read even when the reference uses that digest', async () => {
    const record = philosophyRecord();
    const applicability = { ...record.applicability, validFrom: '2026-04-01T00:00:00.000Z' };
    const digest = philosophyRevisionDigest({ ...record, applicability });
    const resolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: {
        read: async () => ({ status: 'resolved' as const, record: { ...record, applicability, digest } })
      }
    });

    await expect(resolver({
      ...resolveInput(record),
      phase: 'read',
      reference: { ...referenceFor(record), digest }
    })).resolves.toMatchObject({ status: 'not_applicable' });
  });

  it('rejects malformed calendar values before they can become a digest', () => {
    const record = philosophyRecord();
    expect(() => philosophyRevisionDigest({
      ...record,
      applicability: { ...record.applicability, validFrom: '2026-02-30T00:00:00Z' }
    })).toThrow(/applicability is invalid/u);
  });

  it('rechecks the current ACL and scope for historical reads', async () => {
    const record = philosophyRecord();
    const revokedResolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: {
            ...record,
            currentAcl: acl({ ownerId: 'other-user', readerIds: [], writerIds: [] })
          }
        })
      }
    });
    await expect(revokedResolver(resolveInput(record))).resolves.toMatchObject({ status: 'unauthorized' });

    const scopeResolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: { ...record, currentScope: { type: 'project', id: 'other-project' } }
        })
      }
    });
    await expect(scopeResolver(resolveInput(record))).resolves.toMatchObject({ status: 'unauthorized' });
  });

  it('rejects an applicability scope or period that does not cover the judgment reference', async () => {
    const record = philosophyRecord();
    const scopeApplicability = { ...record.applicability, scope: { type: 'project' as const, id: 'other-project' } };
    const scopeDigest = philosophyRevisionDigest({ ...record, applicability: scopeApplicability });
    const scopeResolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: {
            ...record,
            applicability: scopeApplicability,
            digest: scopeDigest
          }
        })
      }
    });
    await expect(scopeResolver({
      ...resolveInput(record),
      phase: 'read',
      reference: { ...referenceFor(record), digest: scopeDigest }
    })).resolves.toMatchObject({ status: 'not_applicable' });

    const periodApplicability = { ...record.applicability, validUntil: '2026-01-15T00:00:00.000Z' };
    const periodDigest = philosophyRevisionDigest({ ...record, applicability: periodApplicability });
    const periodResolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: {
            ...record,
            applicability: periodApplicability,
            digest: periodDigest
          }
        })
      }
    });
    await expect(periodResolver({
      ...resolveInput(record),
      phase: 'read',
      reference: { ...referenceFor(record), digest: periodDigest }
    })).resolves.toMatchObject({ status: 'not_applicable' });
  });

  it('does not re-evaluate applicability for historical reads', async () => {
    const record = philosophyRecord();
    const applicability = { ...record.applicability, scope: { type: 'project' as const, id: 'other-project' } };
    const digest = philosophyRevisionDigest({ ...record, applicability });
    const resolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: {
        read: async () => ({ status: 'resolved' as const, record: { ...record, applicability, digest } })
      }
    });

    await expect(resolver({
      ...resolveInput(record),
      phase: 'historical_read',
      reference: { ...referenceFor(record), digest }
    })).resolves.toEqual({ status: 'resolved', digest });
  });

  it('keeps the content digest stable when only current ACL or scope changes', () => {
    const record = philosophyRecord();
    expect(philosophyRevisionDigest(record)).toBe(record.digest);
    expect(philosophyRevisionDigest({ ...record, currentAcl: acl({ visibility: 'public' }) })).toBe(record.digest);
    expect(philosophyRevisionDigest({ ...record, currentScope: { type: 'organization', id: 'org-1' } })).toBe(record.digest);
    expect(philosophyRevisionDigest({
      ...record,
      applicability: { ...record.applicability, validUntil: '2027-01-01T00:00:00.000Z' }
    })).not.toBe(record.digest);
  });

  it('fails closed when the reader throws and does not resolve other reference kinds', async () => {
    const record = philosophyRecord();
    const throwingResolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: { read: async () => { throw new Error('storage unavailable'); } }
    });
    await expect(throwingResolver(resolveInput(record))).resolves.toMatchObject({ status: 'unresolved' });

    const resolver = createJudgmentProblemPhilosophyReferenceResolver({
      reader: { read: async () => ({ status: 'missing' as const }) }
    });
    await expect(resolver({
      ...resolveInput(record),
      reference: { ...referenceFor(record), kind: 'objective' } as JudgmentProblemReference
    })).resolves.toMatchObject({ status: 'unresolved' });
  });
});
