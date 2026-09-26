import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGraphFoundationReaders,
  type GraphFoundationHistoryRow,
  type GraphFoundationQuery
} from '../src/graph-foundation-reader.js';
import { digestFoundationDefinition } from '../src/foundation-catalog.js';
import { philosophyRevisionDigest } from '../src/philosophy-revision-reader.js';
import type { FoundationDefinition } from '../src/ontology-foundation.js';

const validFrom = '2026-01-01T00:00:00.000Z';
const projectScope = { type: 'project' as const, id: 'project-1' };

function foundationDefinition(overrides: Partial<FoundationDefinition> = {}): FoundationDefinition {
  return {
    id: 'objective-1',
    type: 'objective',
    revision: '1',
    meaning: 'Keep the service useful to its operators',
    adoptionState: 'draft',
    authorizedUses: ['draft', 'judgment'],
    acl: { ownerId: 'alice', visibility: 'private', readerIds: [], writerIds: [] },
    storage: 'candidate',
    provenance: [{ sourceId: 'source-1', sourceKind: 'document', evidenceIds: [] }],
    scope: { subjectIds: ['project-1'], validFrom },
    beneficiaryIds: ['team-1'],
    desiredState: 'Operators can continue using the service',
    criteria: [],
    evaluationPeriod: { from: validFrom, until: '2026-12-31T00:00:00.000Z' },
    ...overrides
  } as FoundationDefinition;
}

function storageDigest(payload: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')}`;
}

function foundationRow(options: {
  history?: FoundationDefinition;
  current?: FoundationDefinition;
  historyProjectId?: string;
  currentProjectId?: string;
  currentVisible?: boolean;
  active?: boolean;
  digestValid?: boolean;
} = {}): GraphFoundationHistoryRow {
  const history = options.history ?? foundationDefinition();
  const current = options.current ?? history;
  const payload = { foundation: history };
  return {
    entity_id: history.id,
    entity_type: history.type,
    revision: history.revision,
    payload,
    project_id: options.historyProjectId ?? 'project-1',
    storage_digest: storageDigest(payload),
    storage_digest_valid: options.digestValid ?? true,
    current_entity_id: current.id,
    current_entity_type: current.type,
    current_payload: { foundation: current },
    current_project_id: options.currentProjectId ?? 'project-1',
    current_lifecycle_status: options.active === false ? 'retired' : 'active',
    current_visible: options.currentVisible ?? true
  };
}

function queryReturning(row: GraphFoundationHistoryRow | null, calls: Array<{ text: string; values: readonly unknown[] }> = []): GraphFoundationQuery {
  return async (text, values) => {
    calls.push({ text, values });
    return { rows: row === null ? [] : [row] };
  };
}

function trustedContext() {
  return {
    principal: 'alice',
    scope: { subjectIds: ['project-1', 'org-1'], validFrom }
  } as const;
}

describe('Graph foundation history reader', () => {
  it('reads an immutable foundation payload through the current active Graph row', async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const definition = foundationDefinition();
    const { store } = createGraphFoundationReaders({ context: trustedContext(), query: queryReturning(foundationRow(), calls) });

    await expect(store.read({ id: definition.id, type: definition.type, revision: definition.revision }, trustedContext())).resolves.toEqual({
      definition,
      digest: digestFoundationDefinition(definition)
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual(['objective-1', 'objective', '1']);
    expect(calls[0]!.text).toContain('storage_digest_valid');
    expect(calls[0]!.text).toContain('public.graph_entities');
    expect(calls[0]!.text).toContain('public.projects');
  });

  it('rejects a read whose supplied principal is different from the trusted context', async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const { store } = createGraphFoundationReaders({ context: trustedContext(), query: queryReturning(foundationRow(), calls) });

    await expect(store.read({ id: 'objective-1', type: 'objective', revision: '1' }, { principal: 'mallory' })).rejects.toMatchObject({
      code: 'authorization_denied'
    });
    expect(calls).toHaveLength(0);
  });

  it('fails closed when the current row is hidden, inactive, or ACL-revoked', async () => {
    const hidden = createGraphFoundationReaders({
      context: trustedContext(),
      query: queryReturning(foundationRow({ currentVisible: false }))
    });
    await expect(hidden.store.read({ id: 'objective-1', type: 'objective', revision: '1' }, trustedContext())).rejects.toMatchObject({
      code: 'authorization_denied'
    });

    const inactive = createGraphFoundationReaders({
      context: trustedContext(),
      query: queryReturning(foundationRow({ active: false }))
    });
    await expect(inactive.store.read({ id: 'objective-1', type: 'objective', revision: '1' }, trustedContext())).rejects.toMatchObject({
      code: 'authorization_denied'
    });

    const revokedDefinition = foundationDefinition({ acl: { ownerId: 'bob', visibility: 'private', readerIds: [], writerIds: [] } });
    const revoked = createGraphFoundationReaders({
      context: trustedContext(),
      query: queryReturning(foundationRow({ history: revokedDefinition, current: revokedDefinition }))
    });
    await expect(revoked.store.read({ id: 'objective-1', type: 'objective', revision: '1' }, trustedContext())).rejects.toMatchObject({
      code: 'authorization_denied'
    });
  });

  it('rejects tampered storage, malformed definitions, and a moved current project', async () => {
    const tampered = createGraphFoundationReaders({
      context: trustedContext(),
      query: queryReturning(foundationRow({ digestValid: false }))
    });
    await expect(tampered.store.read({ id: 'objective-1', type: 'objective', revision: '1' }, trustedContext())).rejects.toMatchObject({
      code: 'corrupt_catalog'
    });

    const malformed = foundationDefinition({ meaning: '' });
    const malformedReader = createGraphFoundationReaders({
      context: trustedContext(),
      query: queryReturning(foundationRow({ history: malformed, current: malformed }))
    });
    await expect(malformedReader.store.read({ id: 'objective-1', type: 'objective', revision: '1' }, trustedContext())).rejects.toMatchObject({
      code: 'corrupt_catalog'
    });

    const moved = createGraphFoundationReaders({
      context: trustedContext(),
      query: queryReturning(foundationRow({ currentProjectId: 'project-2' }))
    });
    await expect(moved.store.read({ id: 'objective-1', type: 'objective', revision: '1' }, trustedContext())).rejects.toMatchObject({
      code: 'scope_violation'
    });
  });

  it('returns null when history is absent instead of treating absence as a successful empty record', async () => {
    const { store } = createGraphFoundationReaders({ context: trustedContext(), query: queryReturning(null) });
    await expect(store.read({ id: 'objective-1', type: 'objective', revision: '99' }, trustedContext())).resolves.toBeNull();
  });
});

describe('Graph philosophy history reader', () => {
  function philosophyPayload() {
    return {
      title: 'Prefer sustainable use',
      judgmentApplicability: {
        scope: projectScope,
        validFrom,
        validUntil: '2026-12-31T00:00:00.000Z'
      }
    };
  }

  function philosophyRow(payload = philosophyPayload(), options: { currentPayload?: unknown; currentProjectId?: string; currentVisible?: boolean } = {}): GraphFoundationHistoryRow {
    return {
      entity_id: 'philosophy-1',
      entity_type: 'philosophy',
      revision: '4',
      payload,
      project_id: 'project-1',
      storage_digest: storageDigest(payload),
      storage_digest_valid: true,
      current_entity_id: 'philosophy-1',
      current_entity_type: 'philosophy',
      current_payload: options.currentPayload ?? { judgmentApplicability: payload.judgmentApplicability },
      current_project_id: options.currentProjectId ?? 'project-1',
      current_lifecycle_status: 'active',
      current_visible: options.currentVisible ?? true
    };
  }

  it('resolves philosophy with fixed applicability and a current Graph ACL projection', async () => {
    const payload = philosophyPayload();
    const applicability = payload.judgmentApplicability;
    const digest = philosophyRevisionDigest({ kind: 'philosophy', id: 'philosophy-1', revision: '4', payload, applicability });
    const { philosophyReader } = createGraphFoundationReaders({ context: trustedContext(), query: queryReturning(philosophyRow(payload)) });

    await expect(philosophyReader.read({
      reference: { kind: 'philosophy', id: 'philosophy-1', revision: '4', digest, scope: projectScope, valid_from: validFrom, valid_to: '2026-12-31T00:00:00.000Z' },
      phase: 'historical_read',
      context: { principal: 'alice', scope: projectScope }
    })).resolves.toMatchObject({
      status: 'resolved',
      record: {
        id: 'philosophy-1',
        revision: '4',
        digest,
        payload,
        currentAcl: { ownerId: 'alice', visibility: 'private', readerIds: [], writerIds: [] },
        currentScope: projectScope,
        applicability: { scope: projectScope, validFrom, validUntil: '2026-12-31T00:00:00.000Z' }
      }
    });
  });

  it('requires explicit applicability, current visibility, and trusted scope for philosophy reads', async () => {
    const missingApplicability = { title: 'No scope' };
    const missing = createGraphFoundationReaders({ context: trustedContext(), query: queryReturning(philosophyRow(missingApplicability)) });
    await expect(missing.philosophyReader.read({
      reference: { kind: 'philosophy', id: 'philosophy-1', revision: '4', digest: 'sha256:' + '0'.repeat(64), scope: projectScope, valid_from: validFrom },
      phase: 'historical_read',
      context: { principal: 'alice', scope: projectScope }
    })).resolves.toMatchObject({ status: 'corrupt' });

    const hidden = createGraphFoundationReaders({ context: trustedContext(), query: queryReturning(philosophyRow(undefined, { currentVisible: false })) });
    const payload = philosophyPayload();
    const digest = philosophyRevisionDigest({ kind: 'philosophy', id: 'philosophy-1', revision: '4', payload, applicability: payload.judgmentApplicability });
    await expect(hidden.philosophyReader.read({
      reference: { kind: 'philosophy', id: 'philosophy-1', revision: '4', digest, scope: projectScope, valid_from: validFrom },
      phase: 'historical_read',
      context: { principal: 'alice', scope: projectScope }
    })).resolves.toMatchObject({ status: 'unauthorized' });

    const outside = createGraphFoundationReaders({ context: trustedContext(), query: queryReturning(philosophyRow()) });
    await expect(outside.philosophyReader.read({
      reference: { kind: 'philosophy', id: 'philosophy-1', revision: '4', digest, scope: { type: 'project', id: 'project-2' }, valid_from: validFrom },
      phase: 'historical_read',
      context: { principal: 'alice', scope: { type: 'project', id: 'project-2' } }
    })).resolves.toMatchObject({ status: 'unauthorized' });
  });
});
