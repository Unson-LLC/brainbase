import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createFoundationGraphHttpHandler,
  FOUNDATION_GRAPH_READY_SQL,
  type FoundationGraphTrustedIdentity
} from '../src/foundation-graph-http.js';
import {
  GRAPH_FOUNDATION_LATEST_SQL,
  GRAPH_FOUNDATION_LIST_SQL,
  GRAPH_PHILOSOPHY_LIST_SQL,
  type GraphFoundationHistoryRow
} from '../src/graph-foundation-reader.js';
import type { FoundationDefinition } from '../src/ontology-foundation.js';

const identity: FoundationGraphTrustedIdentity = {
  principal: 'alice',
  organizationId: 'org-a',
  projectScopeIds: ['project-a']
};

function jsonRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://foundation.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
  });
}

function objectiveDefinition(): FoundationDefinition {
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
    scope: { subjectIds: ['project-a'], validFrom: '2026-01-01T00:00:00.000Z' },
    beneficiaryIds: ['team-1'],
    desiredState: 'Operators can continue using the service',
    criteria: [],
    evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z' }
  } as FoundationDefinition;
}

function objectiveRow(options: { details?: boolean } = {}): GraphFoundationHistoryRow {
  const definition = objectiveDefinition();
  const payload = options.details
    ? {
        foundation: definition,
        title: 'Improve operator continuity',
        criteria_text: 'Operators can complete the workflow',
        beneficiary_description: 'The operators who rely on the service',
        evaluation_period_note: 'Review at the end of each quarter',
        evaluator_note: 'The operations lead reviews the record',
        current_state: 'Recorded state at import time',
        private_secret: 'must not be projected'
      }
    : { foundation: definition };
  return {
    entity_id: definition.id,
    entity_type: definition.type,
    revision: definition.revision,
    payload,
    project_id: 'project-a',
    storage_digest: `sha256:${createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')}`,
    storage_digest_valid: true,
    current_entity_id: definition.id,
    current_entity_type: definition.type,
    current_payload: payload,
    current_project_id: 'project-a',
    current_project_code: 'project-a',
    current_lifecycle_status: 'active',
    current_visible: true
  };
}

function variableRow(): GraphFoundationHistoryRow {
  const definition = {
    ...objectiveDefinition(),
    id: 'variable-1',
    type: 'variable',
    meaning: 'Operator continuity',
    subject: 'operator workflow',
    valueKind: 'number',
    aggregation: 'average',
    granularity: 'day',
    measurementMethod: 'workflow completion count'
  } as FoundationDefinition;
  const payload = { foundation: definition };
  return {
    ...objectiveRow(),
    entity_id: definition.id,
    entity_type: definition.type,
    revision: definition.revision,
    payload,
    storage_digest: `sha256:${createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')}`,
    current_entity_id: definition.id,
    current_entity_type: definition.type,
    current_payload: payload
  };
}

function modelRow(): GraphFoundationHistoryRow {
  const definition = {
    ...objectiveDefinition(),
    id: 'model-1',
    type: 'model',
    meaning: 'Workflow continuity may improve with consistent operations',
    epistemicState: 'hypothesis',
    inputVariableRefs: [],
    outputVariableRefs: [],
    applicability: { subjectIds: ['project-a'], validFrom: '2026-01-01T00:00:00.000Z' },
    relationship: 'Consistent operations may improve continuity',
    uncertainty: 'Causal relationship is unverified',
    validationState: 'unverified'
  } as FoundationDefinition;
  const payload = { foundation: definition };
  return {
    ...objectiveRow(),
    entity_id: definition.id,
    entity_type: definition.type,
    revision: definition.revision,
    payload,
    storage_digest: `sha256:${createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')}`,
    current_entity_id: definition.id,
    current_entity_type: definition.type,
    current_payload: payload
  };
}

function philosophyRow(): GraphFoundationHistoryRow {
  const payload = {
    title: 'Prefer sustainable use',
    statement: 'Keep the service useful to its operators',
    judgmentApplicability: {
      scope: { type: 'project' as const, id: 'project-a' },
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-12-31T00:00:00.000Z'
    }
  };
  return {
    entity_id: 'philosophy-1',
    entity_type: 'philosophy',
    revision: '2',
    payload,
    project_id: 'project-a',
    storage_digest: `sha256:${createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')}`,
    storage_digest_valid: true,
    current_entity_id: 'philosophy-1',
    current_entity_type: 'philosophy',
    current_payload: { judgmentApplicability: payload.judgmentApplicability },
    current_project_id: 'project-a',
    current_project_code: 'project-a',
    current_lifecycle_status: 'active',
    current_visible: true
  };
}

function fixture(options: { ready?: boolean; csrfResult?: boolean; catalog?: boolean; failPhilosophyList?: boolean } = {}) {
  const ready = options.ready ?? true;
  const csrf = vi.fn(async () => options.csrfResult ?? true);
  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    if (text === FOUNDATION_GRAPH_READY_SQL) return { rows: [{ ready }] };
    if (text === GRAPH_PHILOSOPHY_LIST_SQL) {
      if (options.failPhilosophyList) throw new Error('philosophy list unavailable');
      return { rows: options.catalog ? [philosophyRow()] : [] };
    }
    if (text === GRAPH_FOUNDATION_LIST_SQL) {
      if (values[0] === 'objective') return { rows: [objectiveRow({ details: options.catalog })] };
      if (values[0] === 'variable') return { rows: options.catalog ? [variableRow()] : [] };
      if (values[0] === 'model') return { rows: options.catalog ? [modelRow()] : [] };
      return { rows: [] };
    }
    if (text === GRAPH_FOUNDATION_LATEST_SQL) return { rows: [objectiveRow()] };
    return { rows: [] };
  });
  const withAccessContext = vi.fn(async (
    _trustedIdentity: FoundationGraphTrustedIdentity,
    callback: (client: { query: typeof query }) => Promise<Response>
  ) => callback({ query }));
  const handler = createFoundationGraphHttpHandler({
    resolveTrustedIdentity: () => identity,
    withAccessContext,
    csrf: { verify: csrf },
    bodyLimitBytes: 65_536
  });
  return { handler, csrf, query, withAccessContext };
}

describe('Graph Foundation public HTTP adapter', () => {
  it('runs the public contract through the selected project transaction', async () => {
    const f = fixture();
    const response = await f.handler.handle(jsonRequest('/api/foundation/contract?scope_id=project-a'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      contractVersion: 'foundation-public.v1',
      philosophy: { connected: true },
      executionPermission: 'none'
    });
    expect(f.withAccessContext).toHaveBeenCalledWith(identity, expect.any(Function));
    expect(f.query).toHaveBeenCalledWith(FOUNDATION_GRAPH_READY_SQL);
    expect(FOUNDATION_GRAPH_READY_SQL).toContain('tgtype = 34');
  });

  it.each([
    ['/api/foundation/contract', 400],
    ['/api/foundation/contract?scope_id=project-a&scope_id=project-b', 400],
    ['/api/foundation/contract?scope_id=project-b', 403]
  ])('rejects an invalid or ungranted project selector before storage (%s)', async (path, status) => {
    const f = fixture();
    await expect(f.handler.handle(jsonRequest(path))).resolves.toHaveProperty('status', status);
    expect(f.withAccessContext).not.toHaveBeenCalled();
  });

  it('fails closed when the immutable history migration is not ready', async () => {
    const f = fixture({ ready: false });
    const response = await f.handler.handle(jsonRequest('/api/foundation/contract?scope_id=project-a'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'foundation_migration_required' } });
  });

  it('uses the injected CSRF verifier for mutations', async () => {
    const f = fixture({ csrfResult: false });
    const response = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      { method: 'POST', body: JSON.stringify({}) }
    ));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('csrf_failed');
    expect(f.csrf).toHaveBeenCalled();
  });

  it('allows only a canonical organization philosophy reference through the boundary', async () => {
    const f = fixture();
    const allowed = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      {
        method: 'POST',
        body: JSON.stringify({ reference: { kind: 'philosophy', scope: { type: 'organization', id: 'org-a' } } })
      }
    ));
    expect(allowed.status).not.toBe(403);
    expect(f.withAccessContext).toHaveBeenCalledTimes(1);

    const denied = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      {
        method: 'POST',
        body: JSON.stringify({ reference: { kind: 'objective', scope: { type: 'organization', id: 'org-a' } } })
      }
    ));
    expect(denied.status).toBe(403);
    expect(f.withAccessContext).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another organization philosophy', { reference: { kind: 'philosophy', scope: { type: 'organization', id: 'org-b' } } }],
    ['another project reference', { reference: { kind: 'model', scope: { type: 'project', id: 'project-b' } } }],
    ['organization owner scope', { snapshot: { owner_scope: { type: 'organization', id: 'org-a' } } }],
    ['organization measurement scope', {
      snapshot: {
        references: [{
          kind: 'objective',
          scope: { type: 'project', id: 'project-a' },
          measurement: { scope: { subjectIds: ['org-a'] } }
        }]
      }
    }]
  ])('rejects %s before the shared transaction can widen scope', async (_label, body) => {
    const f = fixture();
    const path = 'snapshot' in body
      ? '/api/foundation/judgment-problems/validate?scope_id=project-a'
      : '/api/foundation/judgment-references/validate?scope_id=project-a';
    const response = await f.handler.handle(jsonRequest(path, {
      method: 'POST',
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(403);
    expect(f.withAccessContext).not.toHaveBeenCalled();
  });

  it('leaves malformed bodies to the shared validator instead of making an auth decision', async () => {
    const f = fixture();
    const response = await f.handler.handle(jsonRequest(
      '/api/foundation/judgment-references/validate?scope_id=project-a',
      { method: 'POST', body: JSON.stringify({ reference: { kind: 'objective', scope: { type: 'organization' } } }) }
    ));

    expect(response.status).toBe(400);
    expect(f.withAccessContext).toHaveBeenCalledTimes(1);
  });

  it('serves the Objective list, latest detail, and readiness from the Graph history reader', async () => {
    const f = fixture();

    const list = await f.handler.handle(jsonRequest('/api/foundation/objectives?scope_id=project-a'));
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      state: 'ready',
      absence_confirmed: true,
      records: [{ definition: { id: 'objective-1', type: 'objective', revision: '1' } }]
    });

    const detail = await f.handler.handle(jsonRequest('/api/foundation/objectives/objective-1?scope_id=project-a'));
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      state: 'ready',
      objective: { definition: { id: 'objective-1', type: 'objective', revision: '1' } }
    });

    const readiness = await f.handler.handle(jsonRequest('/api/foundation/objectives/objective-1/readiness?scope_id=project-a'));
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toMatchObject({
      state: 'ready',
      ready: false,
      issues: [{ code: 'MISSING_FIELD', path: 'criteria' }]
    });
    expect(f.query).toHaveBeenCalledWith(GRAPH_FOUNDATION_LIST_SQL, ['objective', 'project-a']);
    expect(f.query).toHaveBeenCalledWith(GRAPH_FOUNDATION_LATEST_SQL, ['objective-1', 'objective']);
  });

  it('serves the selected project foundation overview catalog', async () => {
    const f = fixture({ catalog: true });
    const response = await f.handler.handle(jsonRequest('/api/foundation/catalog?scope_id=project-a'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      contractVersion: 'foundation-overview.v1',
      scopeId: 'project-a',
      objectives: [{ definition: { id: 'objective-1', type: 'objective' } }],
      variables: [{ definition: { id: 'variable-1', type: 'variable' } }],
      models: [{ definition: { id: 'model-1', type: 'model' } }],
      philosophies: [{ kind: 'philosophy', id: 'philosophy-1', revision: '2' }]
    });
    expect(body.objectives[0].details).toEqual({
      title: 'Improve operator continuity',
      criteria_text: 'Operators can complete the workflow',
      beneficiary_description: 'The operators who rely on the service',
      evaluation_period_note: 'Review at the end of each quarter',
      evaluator_note: 'The operations lead reviews the record',
      current_state: 'Recorded state at import time'
    });
    expect(body.objectives[0].details.private_secret).toBeUndefined();
    expect(f.query).toHaveBeenCalledWith(GRAPH_FOUNDATION_LIST_SQL, ['objective', 'project-a']);
    expect(f.query).toHaveBeenCalledWith(GRAPH_FOUNDATION_LIST_SQL, ['variable', 'project-a']);
    expect(f.query).toHaveBeenCalledWith(GRAPH_FOUNDATION_LIST_SQL, ['model', 'project-a']);
    expect(f.query).toHaveBeenCalledWith(GRAPH_PHILOSOPHY_LIST_SQL, ['project-a']);
  });

  it.each([
    '/api/foundation/catalog?scope_id=project-a&unexpected=true',
    '/api/foundation/catalog?scope_id=project-a&scope_id=project-a'
  ])('rejects a catalog request with a non-canonical query (%s)', async (path) => {
    const f = fixture({ catalog: true });
    const response = await f.handler.handle(jsonRequest(path));
    expect(response.status).toBe(400);
    expect(f.withAccessContext).not.toHaveBeenCalled();
  });

  it('keeps the catalog read-only and rejects partial list failures', async () => {
    const f = fixture({ catalog: true });
    const mutation = await f.handler.handle(jsonRequest('/api/foundation/catalog?scope_id=project-a', {
      method: 'POST',
      body: JSON.stringify({})
    }));
    expect(mutation.status).toBe(405);
    expect(f.csrf).not.toHaveBeenCalled();

    const failed = fixture({ catalog: true, failPhilosophyList: true });
    const response = await failed.handler.handle(jsonRequest('/api/foundation/catalog?scope_id=project-a'));
    expect(response.status).not.toBe(200);
    expect((await response.json()).objectives).toBeUndefined();
  });

  it('keeps Objective mutations and unconnected relations explicitly unavailable', async () => {
    const f = fixture();

    const create = await f.handler.handle(jsonRequest('/api/foundation/objectives?scope_id=project-a', {
      method: 'POST',
      body: JSON.stringify({ meaning: 'new objective' })
    }));
    expect(create.status).toBe(501);
    expect((await create.json()).error.code).toBe('api_unavailable');

    const storyLinks = await f.handler.handle(jsonRequest('/api/foundation/stories/story-1/objectives?scope_id=project-a'));
    expect(storyLinks.status).toBe(501);
    expect((await storyLinks.json()).error.code).toBe('api_unavailable');

    const constraints = await f.handler.handle(jsonRequest('/api/foundation/objectives/objective-1/constraints?scope_id=project-a'));
    expect(constraints.status).toBe(501);
    expect((await constraints.json()).error.code).toBe('api_unavailable');
  });
});
