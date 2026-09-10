import { createEmptyIndex, resolveEntities } from '../../src/indexer/index.js';
import { GraphAPISource } from '../../src/sources/graphapi-source.js';
import type { Organization } from '../../src/indexer/types.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { __testing } from '../../src/server.js';
import { retrieveGraphEntity } from '../../src/tools/graph-retrieval.js';

const canonicalId = 'dec_known_graph_identity';
const args = { type: 'decision', id: canonicalId, include_philosophy: false };
const row = (payload: Record<string, unknown> = { title: 'Known decision', statement: 'The actual decision body.' }) => ({
  id: canonicalId, entity_type: 'decision', project_code: 'p', payload,
});
function fixture(records: unknown[], status = 200, scope = ['p']) {
  const request = mock.fn(async () => new Response(JSON.stringify({ records }), { status }));
  return {
    apiUrl: 'https://fixture.invalid', configuredProjectCodes: ['p'],
    tokenManager: { getToken: async () => `x.${Buffer.from(JSON.stringify({ projectCodes: scope })).toString('base64url')}.x` },
    fetch: request as typeof fetch,
  };
}
function audit(result: Awaited<ReturnType<typeof __testing.dispatchGetEntity>>) {
  const marker = result.content.find(item => item.text.startsWith('<!-- brainbase-knowledge-owner-audit:'));
  return marker ? JSON.parse(marker.text.replace('<!-- brainbase-knowledge-owner-audit:', '').replace(' -->', '')) : null;
}

test('cold index reads canonical ID through bounded authorized API and renders body with owner evidence', async () => {
  const deps = fixture([row({ title: 'Known decision', decision_id: 'legacy-alias', statement: 'The actual decision body.' })]);
  const result = await __testing.dispatchGetEntity(args, deps);
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /The actual decision body/);
  assert.match(result.content[0].text, new RegExp(canonicalId));
  assert.equal(deps.fetch.mock.callCount(), 1);
  const [url, init] = deps.fetch.mock.calls[0].arguments as unknown as [string, RequestInit];
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('ids'), canonicalId);
  assert.equal(parsed.searchParams.get('type'), 'decision');
  assert.equal(parsed.searchParams.get('types'), null);
  assert.equal(parsed.searchParams.get('limit'), '2');
  assert.equal((init.headers as Record<string, string>)['x-brainbase-projects'], 'p');
  assert.match((init.headers as Record<string, string>).Authorization, /^Bearer /);
  assert.deepEqual(audit(result).retrieval, {
    status: 'retrieved', coverage: 'complete', sufficiency: 'needs_model_verification',
    references: [{ id: canonicalId, entity_type: 'decision', evidence_status: 'present', evidence_fields: ['statement'] }], absence_confirmed: false,
  });
});

test('successful empty lookup preserves absence uncertainty', async () => {
  const result = await __testing.dispatchGetEntity(args, fixture([]));
  assert.match(result.content[0].text, /Entity not found/);
  assert.equal(audit(result).retrieval.status, 'empty');
  assert.equal(audit(result).retrieval.absence_confirmed, false);
});

test('title-only entity is retrieved with missing body evidence', async () => {
  const result = await __testing.dispatchGetEntity(args, fixture([row({ title: 'Title only' })]));
  assert.equal(audit(result).retrieval.status, 'retrieved');
  assert.equal(audit(result).retrieval.sufficiency, 'insufficient');
  assert.equal(audit(result).retrieval.references[0].evidence_status, 'missing');
});

test('API outage and malformed payload never become empty or success audit', async () => {
  for (const deps of [fixture([], 503), fixture([{ id: canonicalId, entity_type: 'decision', payload: null }])]) {
    const result = await __testing.dispatchGetEntity(args, deps);
    assert.equal(result.isError, true);
    assert.equal(audit(result), null);
    assert.doesNotMatch(result.content[0].text, /Entity not found/);
  }
});

test('inaccessible scopes are rejected before fetch and unexpected scope is rejected after fetch', async () => {
  for (const deps of [fixture([], 200, ['other']), fixture([])]) {
    const result = await retrieveGraphEntity({ ...args, project: 'other' }, deps);
    assert.equal(result.error?.code, 'brainbase_project_not_accessible');
    assert.equal(deps.fetch.mock.callCount(), 0);
  }
  const result = await retrieveGraphEntity(args, fixture([{ ...row(), project_code: 'other' }]));
  assert.equal(result.error?.code, 'brainbase_project_not_accessible');
});

test('rejects wrong identities, duplicate rows, and multiple requested IDs', async () => {
  for (const records of [[{ ...row(), id: 'wrong' }], [row(), row()], [{ ...row(), entity_type: 'person' }]]) {
    assert.equal((await retrieveGraphEntity(args, fixture(records))).error?.code, 'graph_retrieval_response_invalid');
  }
  const deps = fixture([]);
  assert.equal((await retrieveGraphEntity({ ...args, id: 'a,b' }, deps)).error?.code, 'graph_retrieval_input_invalid');
  assert.equal(deps.fetch.mock.callCount(), 0);
});

test('maps public raci type to storage type and allows philosophy identities returned by search', async () => {
  const deps = fixture([{ ...row(), entity_type: 'raci_assignment' }]);
  assert.equal((await retrieveGraphEntity({ ...args, type: 'raci' }, deps)).status, 'ok');
  assert.equal(new URL(String(deps.fetch.mock.calls[0].arguments[0])).searchParams.get('type'), 'raci_assignment');
  const result = await __testing.dispatchGetEntity({ ...args, type: 'philosophy' }, fixture([{ ...row(), entity_type: 'philosophy' }]));
  assert.equal(audit(result).retrieval.references[0].entity_type, 'philosophy');
  assert.equal(audit(result).retrieval.references[0].evidence_status, 'present');
});


test('Graph legacy display alias resolves to canonical ID accepted by get_entity and list_entities', async () => {
  const raw = { id: 'canonical-org', entity_type: 'org', project_code: 'p', payload: { org_id: 'legacy-org', name: 'Example Organization', description: 'Organization body' } };
  const deps = fixture([raw]);
  const org = new GraphAPISource(deps.apiUrl, deps.tokenManager).convertEntity({ ...raw, entity_id: raw.id }) as Organization;
  assert.equal(org.id, 'legacy-org');
  assert.equal(org.graph_entity_id, 'canonical-org');
  const index = createEmptyIndex();
  index.orgs.set(org.id, org);
  for (const query of ['Example Organization', 'legacy-org', 'canonical-org']) {
    const resolved = resolveEntities(index, { query, types: ['org'] });
    assert.equal(resolved.candidates[0].entity_id, 'canonical-org');
    const result = await __testing.dispatchGetEntity({ type: 'org', id: resolved.candidates[0].entity_id, include_philosophy: false }, deps);
    assert.equal(result.isError, undefined);
    assert.equal(audit(result).retrieval.references[0].id, 'canonical-org');
  }
  for (const call of deps.fetch.mock.calls) {
    assert.equal(new URL(String(call.arguments[0])).searchParams.get('ids'), 'canonical-org');
  }
  __testing.setEntityIndex(index);
  __testing.setIndexRefreshEnabled(false);
  const listed = await __testing.handleToolCall('list_entities', { type: 'org', include_philosophy: false });
  assert.match(listed, /ID: canonical-org/);
  assert.match(__testing.formatEntity(org), /\*\*ID\*\*: canonical-org/);
});
