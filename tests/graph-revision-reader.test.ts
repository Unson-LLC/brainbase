import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalEdgeId } from '../src/canonical-graph.js';
import {
  createJudgmentProblemGraphReferenceResolver,
  graphRevisionDigest,
  type GraphRevisionReadRequest,
  type GraphRevisionRecord,
  type GraphRevisionReference,
  type GraphRevisionScope
} from '../src/graph-revision-reader.js';
import {
  createJudgmentProblemFoundationReferenceProvider,
  type JudgmentProblemReference
} from '../src/judgment-problem-snapshot.js';
import type { FoundationAcl } from '../src/ontology-foundation.js';
import type { CanonicalEdge, CanonicalEntity } from '../src/types.js';

const scope: GraphRevisionScope = { type: 'project', id: 'hotel-alpha' };

function acl(overrides: Partial<FoundationAcl> = {}): FoundationAcl {
  return {
    ownerId: 'alice',
    visibility: 'private',
    readerIds: ['bob'],
    writerIds: [],
    ...overrides
  };
}

function entityRecord(): GraphRevisionRecord {
  const payload: CanonicalEntity = {
    id: 'person-alice',
    type: 'person',
    name: 'Alice'
  };
  const identity = { kind: 'entity' as const, id: payload.id, revision: '3', payload };
  return {
    ...identity,
    digest: graphRevisionDigest(identity),
    currentAcl: acl(),
    currentScope: scope
  };
}

function edgeRecord(): GraphRevisionRecord {
  const payload: CanonicalEdge = {
    id: canonicalEdgeId({ fromId: 'person-alice', relation: 'participates_in', toId: 'project-hotel' }),
    fromId: 'person-alice',
    relation: 'participates_in',
    toId: 'project-hotel'
  };
  const identity = { kind: 'edge' as const, id: payload.id, revision: '2', payload };
  return {
    ...identity,
    digest: graphRevisionDigest(identity),
    currentAcl: acl(),
    currentScope: scope
  };
}

function referenceFor(record: GraphRevisionRecord): JudgmentProblemReference {
  return {
    kind: record.kind,
    id: record.id,
    revision: record.revision,
    digest: record.digest,
    scope,
    valid_from: '2026-01-01T00:00:00.000Z'
  };
}

function resolveInput(record: GraphRevisionRecord, principal = 'alice') {
  return {
    reference: referenceFor(record),
    phase: 'historical_read' as const,
    context: { principal }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Graph revision reader contract', () => {
  it('resolves entity and edge revisions through JudgmentProblem resolveOther', async () => {
    const entity = entityRecord();
    const edge = edgeRecord();
    const calls: GraphRevisionReadRequest[] = [];
    const reader = {
      read(input: GraphRevisionReadRequest) {
        calls.push(input);
        return {
          status: 'resolved' as const,
          record: input.reference.kind === 'entity' ? entity : edge
        };
      }
    };
    const resolveOther = createJudgmentProblemGraphReferenceResolver({ reader });
    const provider = createJudgmentProblemFoundationReferenceProvider({
      store: { read: async () => null },
      resolveOther
    });

    await expect(provider.resolve(resolveInput(entity))).resolves.toEqual({
      status: 'resolved',
      digest: entity.digest
    });
    await expect(provider.resolve(resolveInput(edge))).resolves.toEqual({
      status: 'resolved',
      digest: edge.digest
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      phase: 'historical_read',
      context: { principal: 'alice', scope }
    });
    expect(calls[1].reference).toMatchObject({
      kind: 'edge',
      id: edge.id,
      revision: '2',
      digest: edge.digest,
      scope
    });
  });

  it.each([
    ['missing', 'missing'],
    ['unauthorized', 'unauthorized'],
    ['corrupt', 'unresolved']
  ] as const)('fails closed for a reader %s result', async (readerStatus, expectedStatus) => {
    const record = entityRecord();
    const resolver = createJudgmentProblemGraphReferenceResolver({
      reader: { read: async () => ({ status: readerStatus }) }
    });

    await expect(resolver(resolveInput(record))).resolves.toMatchObject({ status: expectedStatus });
  });

  it('rejects a digest or payload that does not match the immutable revision', async () => {
    const record = entityRecord();
    const resolver = createJudgmentProblemGraphReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: {
            ...record,
            payload: { ...record.payload, name: 'tampered' }
          }
        })
      }
    });

    await expect(resolver(resolveInput(record))).resolves.toMatchObject({ status: 'unresolved' });
  });

  it('rejects calendar dates that Date.parse would normalize', () => {
    const record = entityRecord();
    expect(() => graphRevisionDigest({
      ...record,
      payload: { ...record.payload, validFrom: '2026-02-30T00:00:00Z' }
    })).toThrow(/validFrom is invalid/u);
  });

  it('rechecks current ACL and scope for a historical read', async () => {
    const record = entityRecord();
    const resolver = createJudgmentProblemGraphReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: {
            ...record,
            currentAcl: acl({ ownerId: 'other-user', readerIds: [], writerIds: [] }),
            currentScope: record.currentScope
          }
        })
      }
    });

    await expect(resolver(resolveInput(record))).resolves.toMatchObject({ status: 'unauthorized' });
  });

  it('rejects a revision outside the requested scope even when ACL permits the principal', async () => {
    const record = entityRecord();
    const resolver = createJudgmentProblemGraphReferenceResolver({
      reader: {
        read: async () => ({
          status: 'resolved' as const,
          record: {
            ...record,
            currentAcl: acl({ visibility: 'public' }),
            currentScope: { type: 'project', id: 'other-project' }
          }
        })
      }
    });

    await expect(resolver(resolveInput(record))).resolves.toMatchObject({ status: 'unauthorized' });
  });

  it('fails closed when the reader throws instead of returning a result', async () => {
    const record = entityRecord();
    const resolver = createJudgmentProblemGraphReferenceResolver({
      reader: { read: async () => { throw new Error('storage unavailable'); } }
    });

    await expect(resolver(resolveInput(record))).resolves.toMatchObject({ status: 'unresolved' });
  });

  it('keeps the content digest stable when only current ACL changes', () => {
    const record = entityRecord();
    expect(graphRevisionDigest(record)).toBe(record.digest);
    expect(graphRevisionDigest({
      ...record,
      currentAcl: acl({ visibility: 'public' })
    })).toBe(record.digest);
  });

  it('does not resolve unhandled reference kinds', async () => {
    const resolver = createJudgmentProblemGraphReferenceResolver({
      reader: { read: async () => ({ status: 'missing' as const }) }
    });
    const result = await resolver({
      ...resolveInput(entityRecord()),
      reference: {
        ...referenceFor(entityRecord()),
        kind: 'objective'
      }
    });
    expect(result.status).toBe('unresolved');
  });
});
