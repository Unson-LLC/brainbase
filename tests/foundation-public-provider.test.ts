import { describe, expect, it, vi } from 'vitest';
import { createFoundationPublicProvider, callFoundationPublicTool } from '../src/foundation-public-provider.js';

describe('public foundation boundary', () => {
  it('fails closed without a trusted host connection', async () => {
    await expect(callFoundationPublicTool('foundation_read', { type: 'model', id: 'm', revision: '1' }))
      .rejects.toThrow('foundation_provider_unconfigured');
  });
  it('rejects caller authority before accessing the store', async () => {
    const read = vi.fn();
    const provider = createFoundationPublicProvider({ store: { read } });
    await expect(provider.read({ type: 'model', id: 'm', revision: '1', principal: 'admin' }, { principal: 'alice' }))
      .rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it('binds every read to the current trusted context and distinguishes missing data', async () => {
    const read = vi.fn().mockResolvedValue(null);
    const provider = createFoundationPublicProvider({ store: { read } });
    const context = { principal: 'alice', scope: { subjectIds: ['team'], validFrom: '2026-01-01T00:00:00Z' } };
    await expect(provider.read({ type: 'model', id: 'm', revision: '1' }, context)).rejects.toThrow('foundation_revision_missing');
    expect(read).toHaveBeenCalledWith({ type: 'model', id: 'm', revision: '1' }, context);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { createFoundationRevisionStore } from '../src/foundation-store.js';
import { initializePersonalOs } from '../src/ssot.js';
import { createFoundationHttpRouter } from '../src/foundation-http.js';
import { createFoundationPublicRoute } from '../src/foundation-public-provider.js';
import { createServer } from '../src/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ObjectiveDefinition, VariableDefinition } from '../src/ontology-foundation.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const context = { principal: 'alice', scope: { subjectIds: ['project-a'], validFrom: '2026-01-01T00:00:00.000Z' } };
function variable(): VariableDefinition {
  return {
    id: 'load', type: 'variable', revision: '1', meaning: '総負荷', adoptionState: 'approved', authorizedUses: ['draft', 'judgment', 'evaluation'],
    acl: { ownerId: 'alice', visibility: 'private', readerIds: ['bob'], writerIds: [] }, storage: 'ontology',
    provenance: [{ sourceId: 'spec', sourceKind: 'document', evidenceIds: [] }], scope: context.scope,
    subject: 'project-a', valueKind: 'number', unit: 'minutes', aggregation: 'sum', granularity: 'week', measurementMethod: '記録時間の合計'
  };
}
async function connected() {
  const dir = await mkdtemp(join(tmpdir(), 'foundation-public-')); dirs.push(dir); await initializePersonalOs(dir);
  const store = createFoundationRevisionStore({ dataDir: dir });
  const ref = await store.create(variable(), context);
  return { store, ref, provider: createFoundationPublicProvider({ store }) };
}
function judgmentRef(ref: { id: string; revision: string; digest: string }, kind = 'variable') {
  return { id: ref.id, revision: ref.revision, digest: ref.digest, kind, scope: { type: 'project', id: 'project-a' }, valid_from: context.scope.validFrom };
}
describe('canonical store through public transports', () => {
  it('MCP discovers connected tools, reads exact revisions, and rechecks current ACL', async () => {
    const { store, ref, provider } = await connected();
    const server = createServer({ foundation: { provider, resolveContext: () => ({ ...context, principal: 'bob' }) } });
    const client = new Client({ name: 'foundation-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try {
      expect((await client.listTools()).tools.some((tool) => tool.name === 'foundation_read')).toBe(true);
      const result = await client.callTool({ name: 'foundation_read', arguments: ref });
      const record = JSON.parse((result.content as { text: string }[])[0]!.text);
      expect(record.digest).toBe(ref.digest);
      await store.update({ reference: ref, next: { ...variable(), acl: { ownerId: 'alice', visibility: 'private', readerIds: [], writerIds: [] } } }, context);
      await expect(client.callTool({ name: 'foundation_read', arguments: ref })).rejects.toThrow();
    } finally { await client.close(); await server.close(); }
  });
  it('HTTP uses the same revision and dependency validation, and requires trusted auth', async () => {
    const { store, ref, provider } = await connected();
    const router = createFoundationHttpRouter({ routes: [createFoundationPublicRoute(provider)], resolveContext: () => context, csrf: { verify: () => true } });
    const read = await router.handle(new Request(`https://local/api/foundation/definitions/variable/load?revision=1&digest=${ref.digest}`));
    expect(read.status).toBe(200); expect((await read.json()).digest).toBe(ref.digest);
    const mismatch = await router.handle(new Request('https://local/api/foundation/definitions/variable/load?revision=1&digest=sha256:' + '0'.repeat(64)));
    expect(mismatch.status).toBe(422);
    const objective: ObjectiveDefinition = { ...variable(), type: 'objective', id: 'goal', beneficiaryIds: ['project-a'], desiredState: '負荷を減らす', criteria: [{ variableRef: { type: 'variable', id: 'missing', revision: '1' }, operator: 'at_most', target: 10 }], evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-01-07T00:00:00.000Z' } };
    const goal = await store.create(objective, context);
    const validation = await router.handle(new Request('https://local/api/foundation/judgment-references/validate', { method: 'POST', body: JSON.stringify({ reference: judgmentRef(goal, 'objective') }) }));
    expect(validation.status).toBe(422);
    expect((await validation.json()).status).not.toBe('resolved');
    const anonymous = createFoundationHttpRouter({ routes: [createFoundationPublicRoute(provider)], resolveContext: () => null });
    expect((await anonymous.handle(new Request('https://local/api/foundation/contract'))).status).toBe(401);
  });
});

import { philosophyRevisionDigest, type PhilosophyRevisionRecord } from '../src/philosophy-revision-reader.js';
it('uses the canonical philosophy resolver and trusted scope through the public boundary', async () => {
  const base = { kind: 'philosophy' as const, id: 'continuous-use', revision: '2', payload: { statement: '継続利用を導入件数より優先する' }, applicability: { scope: { type: 'project' as const, id: 'project-a' }, validFrom: context.scope.validFrom } };
  let record: PhilosophyRevisionRecord = { ...base, digest: philosophyRevisionDigest(base), currentAcl: variable().acl, currentScope: base.applicability.scope };
  const read = vi.fn(async () => ({ status: 'resolved' as const, record }));
  const provider = createFoundationPublicProvider({ store: { read: vi.fn() }, philosophyReader: { read } });
  const reference = { kind: 'philosophy', id: record.id, revision: record.revision, digest: record.digest, scope: record.currentScope, valid_from: context.scope.validFrom };
  expect(await provider.validate({ reference }, context)).toMatchObject({ status: 'resolved', digest: record.digest });
  expect(await provider.validate({ reference: { ...reference, scope: { type: 'project', id: 'other-project' } } }, context)).toMatchObject({ status: 'unauthorized' });
  expect(read).toHaveBeenCalledTimes(1);
  record = { ...record, currentAcl: { ownerId: 'other', visibility: 'private', readerIds: [], writerIds: [] } };
  expect(await provider.validate({ reference, phase: 'historical_read' }, context)).toMatchObject({ status: 'unauthorized' });
});

import type { ConstraintDefinition, FoundationEvaluationDescriptor, ModelDefinition } from '../src/ontology-foundation.js';
import type { JudgmentProblemSnapshot, JudgmentProblemReference } from '../src/judgment-problem-snapshot.js';
it('validates the complete bundle over HTTP using canonical observation conditions', async () => {
  const { store, ref } = await connected();
  const period = { from: '2026-01-01T00:00:00.000Z', until: '2026-01-07T00:00:00.000Z' };
  const objective: ObjectiveDefinition = { ...variable(), type: 'objective', id: 'weekly-goal', beneficiaryIds: ['project-a'], desiredState: '負荷を減らす', criteria: [{ variableRef: ref, operator: 'at_most', target: 10 }], evaluationPeriod: period };
  const model: ModelDefinition = { ...variable(), type: 'model', id: 'load-model', epistemicState: 'hypothesis', inputVariableRefs: [ref], outputVariableRefs: [ref], applicability: context.scope, relationship: '導入と負荷の関係', uncertainty: '観測誤差', validationState: 'verified' };
  const constraint: ConstraintDefinition = { ...variable(), type: 'constraint', id: 'limit', condition: '制約を守る', appliesTo: ['project-a'], exceptions: [], adoptionBasis: [{ type: 'decision', id: 'approved-limit', revision: '1' }] };
  const references = [];
  for (const definition of [objective, model, constraint]) {
    references.push(judgmentRef(await store.create(definition, context), definition.type));
  }
  for (const kind of ['criterion', 'observation', 'authority', 'resource', 'deadline']) {
    references.push({ kind, id: kind, revision: '1', digest: 'sha256:' + '1'.repeat(64), scope: { type: 'project', id: 'project-a' }, valid_from: context.scope.validFrom });
  }
  const snapshot: JudgmentProblemSnapshot = { snapshot_version: 'judgment-problem-snapshot.v1', problem_id: 'weekly-load', revision: '1', question: '負荷を減らせるか', owner_scope: { type: 'project', id: 'project-a' }, references: references as JudgmentProblemReference[], read_policy: variable().acl, execution_permission: 'none', created_at: context.scope.validFrom };
  let measurement: FoundationEvaluationDescriptor = { variableRef: { type: 'variable', id: ref.id, revision: ref.revision }, unit: 'minutes', aggregation: 'sum', granularity: 'week', scope: context.scope, period };
  const pinnedSnapshot = { ...snapshot, references: snapshot.references.map((item) => item.kind === 'observation' ? { ...item, measurement: structuredClone(measurement) } : item) };
  const provider = createFoundationPublicProvider({ store, resolveOther: ({ reference }) => ({ status: 'resolved', digest: reference.digest, ...(reference.kind === 'observation' ? { canonical: { measurement } } : {}) }) });
  const router = createFoundationHttpRouter({ routes: [createFoundationPublicRoute(provider)], resolveContext: () => context, csrf: { verify: () => true } });
  const request = () => new Request('https://local/api/foundation/judgment-problems/validate', { method: 'POST', body: JSON.stringify({ snapshot: pinnedSnapshot }) });
  expect(await callFoundationPublicTool('foundation_validate_problem', { snapshot: pinnedSnapshot }, { provider, resolveContext: () => context })).toEqual({ status: 'resolved', executionPermission: 'none' });
  const valid = await router.handle(request());
  expect(valid.status).toBe(200);
  expect(await valid.json()).toEqual({ status: 'resolved', executionPermission: 'none' });
  measurement = { ...measurement, granularity: 'month' };
  expect((await router.handle(request())).status).toBe(422);
  measurement = { ...measurement, granularity: 'week', period: { ...period, until: '2026-02-01T00:00:00.000Z' } };
  expect((await router.handle(request())).status).toBe(422);
});
