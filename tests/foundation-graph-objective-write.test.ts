import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFoundationGraphHttpHandler, FOUNDATION_GRAPH_READY_SQL, type FoundationGraphObjectiveWriteInput } from '../src/foundation-graph-http.js';
import { GRAPH_FOUNDATION_LATEST_SQL, GRAPH_FOUNDATION_READ_SQL, GRAPH_FOUNDATION_LIST_SQL, type GraphFoundationHistoryRow } from '../src/graph-foundation-reader.js';
import { FoundationStoreError } from '../src/foundation-store.js';
import type { ObjectiveDefinition } from '../src/ontology-foundation.js';

const identity = { principal: 'alice', organizationId: 'org-a', projectScopeIds: ['project-a'] };
const path = '/api/foundation/objectives?scope_id=project-a';
const body = { id: 'objective-1', meaning: 'Make the service useful', adoptionState: 'draft', beneficiaryIds: [], criteria: [], evaluationPeriod: { from: '', until: '' } };
function request(url = path, method = 'POST', payload: unknown = body) {
  return new Request(`https://foundation.test${url}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }) });
}
function row(definition: ObjectiveDefinition): GraphFoundationHistoryRow {
  const payload = { foundation: definition };
  return {
    entity_id: definition.id, entity_type: definition.type, revision: definition.revision, payload,
    project_id: 'project-a', storage_digest: `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`,
    storage_digest_valid: true, current_entity_id: definition.id, current_entity_type: definition.type,
    current_payload: payload, current_project_id: 'project-a', current_project_code: 'project-a',
    current_lifecycle_status: 'active', current_visible: true
  };
}
function fixture(options: { csrf?: boolean; ready?: boolean; missingReadback?: boolean } = {}) {
  let current: ObjectiveDefinition | undefined;
  const history: ObjectiveDefinition[] = [];
  const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
    if (sql === FOUNDATION_GRAPH_READY_SQL) return { rows: [{ ready: options.ready ?? true }] };
    if (sql === GRAPH_FOUNDATION_LATEST_SQL || sql === GRAPH_FOUNDATION_LIST_SQL) return { rows: current ? [row(current)] : [] };
    if (sql === GRAPH_FOUNDATION_READ_SQL) {
      const saved = history.find((item) => item.revision === values[2]);
      return { rows: !options.missingReadback && saved ? [{ ...row(saved), current_payload: { foundation: current } }] : [] };
    }
    return { rows: [] };
  });
  const client = { query };
  const write = vi.fn(async (input: FoundationGraphObjectiveWriteInput) => {
    expect(input.client).toBe(client);
    expect(input.identity).toEqual(identity);
    expect(input.projectCode).toBe('project-a');
    if ((current?.revision ?? null) !== input.expectedRevision) throw new FoundationStoreError('revision_conflict', 'CAS rejected');
    current = structuredClone(input.definition);
    history.push(current);
  });
  const rolledBack = vi.fn();
  const withAccessContext = vi.fn(async (_identity: unknown, callback: (input: typeof client) => Promise<Response>) => {
    const prior = structuredClone(current);
    const priorHistoryLength = history.length;
    try { return await callback(client); }
    catch (error) { current = prior; history.length = priorHistoryLength; rolledBack(); throw error; }
  });
  const handler = createFoundationGraphHttpHandler({ resolveTrustedIdentity: () => identity, withAccessContext, csrf: { verify: () => options.csrf ?? true }, writeObjectiveDraft: write });
  return { handler, write, rolledBack, withAccessContext, getCurrent: () => current, changeCurrent: (change: (value: ObjectiveDefinition) => void) => change(current!) };
}

describe('Graph Objective canonical write port', () => {
  it('saves an incomplete private draft and reads the exact canonical revision back', async () => {
    const f = fixture();
    const response = await f.handler.handle(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ state: 'saved_unverified', reference: { id: body.id, revision: '1', type: 'objective', digest: expect.stringMatching(/^sha256:/) } });
    expect(f.getCurrent()).toMatchObject({ id: body.id, adoptionState: 'draft', storage: 'candidate', authorizedUses: ['draft'], acl: { ownerId: 'alice', visibility: 'private', readerIds: [], writerIds: [] }, scope: { subjectIds: ['project-a'] }, provenance: [{ sourceId: 'foundation-objective-editor', sourceKind: 'candidate' }] });
    expect(f.getCurrent()?.evaluationPeriod).toBeUndefined();
    const read = await f.handler.handle(request('/api/foundation/objectives/objective-1?scope_id=project-a', 'GET'));
    expect(read.status).toBe(200);
    expect((await read.json()).record.definition).toEqual(f.getCurrent());
  });

  it('updates with CAS, preserving every authority field, and rejects stale/repeated create', async () => {
    const f = fixture();
    await f.handler.handle(request());
    const original = structuredClone(f.getCurrent());
    const repeated = await f.handler.handle(request());
    expect(repeated.status).toBe(409);
    const updateBody = { expectedRevision: '1', definition: { ...body, meaning: 'Updated desired outcome' } };
    const updatePath = '/api/foundation/objectives/objective-1?scope_id=project-a';
    expect((await f.handler.handle(request(updatePath, 'PUT', updateBody))).status).toBe(200);
    expect(f.getCurrent()).toEqual({ ...original, meaning: 'Updated desired outcome', revision: '2' });
    expect((await f.handler.handle(request(updatePath, 'PUT', updateBody))).status).toBe(409);
    expect(f.getCurrent()?.revision).toBe('2');
    expect(f.write).toHaveBeenCalledTimes(3); // create, rejected repeated create, update
  });

  it.each([
    { acl: { ownerId: 'mallory' } }, { scope: { subjectIds: ['other'] } }, { organizationId: 'org-b' },
    { authorizedUses: ['execution'] }, { storage: 'ontology' }, { provenance: [{ sourceId: 'spoof' }] }
  ])('rejects body authority before the canonical writer: %j', async (override) => {
    const f = fixture();
    expect((await f.handler.handle(request(path, 'POST', { ...body, ...override }))).status).toBe(400);
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each(['adopted', 'active', 'deprecated'])('rejects non-draft adoption %s', async (adoptionState) => {
    const f = fixture();
    expect((await f.handler.handle(request(path, 'POST', { ...body, adoptionState }))).status).toBe(400);
    expect(f.write).not.toHaveBeenCalled();
  });

  it('rejects a partial invalid date rather than silently removing it', async () => {
    const f = fixture();
    expect((await f.handler.handle(request(path, 'POST', { ...body, evaluationPeriod: { from: 'bad', until: '' } }))).status).toBe(400);
    expect(f.write).not.toHaveBeenCalled();
  });

  it('enforces the Graph request body limit on writes', async () => {
    const f = fixture();
    const response = await f.handler.handle(request(path, 'POST', { ...body, meaning: 'x'.repeat(65_537) }));
    expect(response.status).toBe(413);
    expect(f.write).not.toHaveBeenCalled();
  });

  it('rejects another project, CSRF failure, and absent migration before writing', async () => {
    const f = fixture();
    expect((await f.handler.handle(request('/api/foundation/objectives?scope_id=project-b'))).status).toBe(403);
    expect(f.withAccessContext).not.toHaveBeenCalled();
    const csrf = fixture({ csrf: false });
    expect((await csrf.handler.handle(request())).status).toBe(403);
    expect(csrf.write).not.toHaveBeenCalled();
    const migration = fixture({ ready: false });
    expect((await migration.handler.handle(request())).status).toBe(503);
    expect(migration.write).not.toHaveBeenCalled();
  });

  it('rechecks current ACL before updates and denies a revoked writer', async () => {
    const f = fixture();
    await f.handler.handle(request());
    f.changeCurrent((value) => { value.acl.ownerId = 'bob'; });
    expect((await f.handler.handle(request('/api/foundation/objectives/objective-1?scope_id=project-a', 'PUT', { expectedRevision: '1', definition: body }))).status).toBe(403);
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  it('rolls back the host transaction if canonical readback is missing', async () => {
    const f = fixture({ missingReadback: true });
    const response = await f.handler.handle(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('readback_mismatch');
    expect(f.rolledBack).toHaveBeenCalledOnce();
    expect(f.getCurrent()).toBeUndefined();
  });
});
