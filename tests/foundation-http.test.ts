import { describe, expect, it, vi } from 'vitest';
import {
  createFoundationHttpRouter,
  createObjectiveFoundationHttpHandler,
  createObjectiveFoundationRoute,
  type FoundationHttpRoute,
} from '../src/foundation-http.js';
import { FoundationStoreError } from '../src/foundation-store.js';
import type { ObjectiveDefinition } from '../src/ontology-foundation.js';

const context = { principal: 'trusted-principal', scope: { subjectIds: ['project-1'], validFrom: '2026-09-01T00:00:00.000Z' } };

function objectiveDefinition(id = 'objective-1', revision = '1', overrides: Partial<ObjectiveDefinition> = {}): ObjectiveDefinition {
  return {
    id,
    type: 'objective',
    revision,
    meaning: '総対応負荷を減らす',
    adoptionState: 'draft',
    authorizedUses: ['draft', 'judgment'],
    acl: { ownerId: 'trusted-principal', visibility: 'private', readerIds: [], writerIds: [] },
    storage: 'ontology',
    provenance: [{ sourceId: 'story-objective-editor', sourceKind: 'document', evidenceIds: [] }],
    scope: { subjectIds: ['project-1'], validFrom: '2026-09-01T00:00:00.000Z' },
    beneficiaryIds: ['project-1'],
    desiredState: '顧客対応品質を維持しながら負荷が減っている',
    criteria: [],
    evaluationPeriod: { from: '2026-09-01T00:00:00.000Z', until: '2026-12-31T23:59:59.000Z' },
    ...overrides,
  };
}

function record(definition: ObjectiveDefinition) {
  return { definition, digest: `sha256:${definition.revision.padStart(64, '0')}` };
}

function jsonRequest(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function responseJson(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

function fakeObjectiveOptions() {
  let current = record(objectiveDefinition());
  const objectives = {
    list: vi.fn(async () => [current]),
    readObjective: vi.fn(async (id: string, _context: unknown, revision?: string) => (
      current.definition.id === id && (!revision || current.definition.revision === revision) ? current : null
    )),
    checkObjectiveReadiness: vi.fn(async () => ({ ready: true, issues: [] })),
    createObjective: vi.fn(async (definition: ObjectiveDefinition) => {
      current = record(definition);
      return { id: definition.id, type: 'objective' as const, revision: definition.revision, digest: current.digest };
    }),
    updateObjective: vi.fn(async (id: string, expectedRevision: string, definition: ObjectiveDefinition) => {
      if (current.definition.id !== id || current.definition.revision !== expectedRevision) {
        throw new FoundationStoreError('revision_conflict', 'stale update', { currentRevision: current.definition.revision });
      }
      const next = { ...definition, revision: String(Number(expectedRevision) + 1) };
      current = record(next);
      return { id, type: 'objective' as const, revision: next.revision, digest: current.digest };
    }),
  };
  return { objectives, getCurrent: () => current, setCurrent: (next: ObjectiveDefinition) => { current = record(next); } };
}

function builder({ operation, body, current }: { operation: 'create' | 'update'; body: Readonly<Record<string, unknown>>; current?: ObjectiveDefinition }) {
  const base = current ?? objectiveDefinition(String(body.id ?? 'objective-created'), '1');
  return {
    ...base,
    ...body,
    id: operation === 'update' ? base.id : String(body.id ?? base.id),
    type: 'objective' as const,
    revision: operation === 'update' ? base.revision : '1',
  };
}

describe('Foundation Objective HTTP boundary', () => {
  it('resolves trusted context, rejects authority fields, and delegates a valid create', async () => {
    const fake = fakeObjectiveOptions();
    const resolveContext = vi.fn(async () => context);
    const buildDefinition = vi.fn(builder);
    const handler = createObjectiveFoundationHttpHandler({
      objectives: fake.objectives,
      resolveContext,
      csrf: { verify: vi.fn(async () => true) },
      buildDefinition,
    });

    const forbidden = await handler.handle(jsonRequest('/api/foundation/objectives', {
      method: 'POST',
      body: JSON.stringify({ id: 'objective-attacker', meaning: 'x', tenantId: 'attacker-tenant' }),
    }));
    expect(forbidden.status).toBe(400);
    expect((await responseJson(forbidden)).error.code).toBe('authority_field_in_body');
    expect(fake.objectives.createObjective).not.toHaveBeenCalled();

    const created = await handler.handle(jsonRequest('/api/foundation/objectives', {
      method: 'POST',
      body: JSON.stringify({ id: 'objective-created', meaning: '新しい目的' }),
    }));
    expect(created.status).toBe(201);
    expect((await responseJson(created)).state).toBe('saved_unverified');
    expect(resolveContext).toHaveBeenCalled();
    expect(buildDefinition).toHaveBeenCalledWith(expect.objectContaining({ operation: 'create', context }));
    expect(fake.objectives.createObjective).toHaveBeenCalledWith(expect.objectContaining({
      id: 'objective-created',
      acl: expect.objectContaining({ ownerId: 'trusted-principal' }),
    }), context);
  });

  it('fails closed when auth or CSRF is unavailable', async () => {
    const fake = fakeObjectiveOptions();
    const withoutAuth = createObjectiveFoundationHttpHandler({
      objectives: fake.objectives,
      resolveContext: async () => null,
      csrf: { verify: async () => true },
      buildDefinition: builder,
    });
    expect((await withoutAuth.handle(new Request('http://localhost/api/foundation/objectives'))).status).toBe(401);

    const withoutCsrf = createObjectiveFoundationHttpHandler({
      objectives: fake.objectives,
      resolveContext: async () => context,
      buildDefinition: builder,
    });
    const response = await withoutCsrf.handle(jsonRequest('/api/foundation/objectives', {
      method: 'POST',
      body: JSON.stringify({ id: 'objective-created', meaning: 'x' }),
    }));
    expect(response.status).toBe(501);
    expect((await responseJson(response)).error.code).toBe('csrf_unconfigured');
  });

  it('requires an explicit CAS revision and maps stale updates to 409 without retry', async () => {
    const fake = fakeObjectiveOptions();
    const handler = createObjectiveFoundationHttpHandler({
      objectives: fake.objectives,
      resolveContext: async () => context,
      csrf: { verify: async () => true },
      buildDefinition: builder,
    });

    const missingCas = await handler.handle(jsonRequest('/api/foundation/objectives/objective-1', {
      method: 'PUT',
      body: JSON.stringify({ meaning: 'without CAS' }),
    }));
    expect(missingCas.status).toBe(400);
    expect((await responseJson(missingCas)).error.code).toBe('invalid_input');
    expect(fake.objectives.updateObjective).not.toHaveBeenCalled();

    currentRevisionAdvance(fake);
    const stale = await handler.handle(jsonRequest('/api/foundation/objectives/objective-1', {
      method: 'PUT',
      body: JSON.stringify({ expectedRevision: '1', meaning: 'stale client value' }),
    }));
    expect(stale.status).toBe(409);
    expect((await responseJson(stale)).error).toMatchObject({ code: 'revision_conflict', currentRevision: '2' });
    expect(fake.objectives.updateObjective).toHaveBeenCalledTimes(1);
  });

  it('composes an additional route under the same local router and trusted context', async () => {
    const fake = fakeObjectiveOptions();
    const seenContexts: unknown[] = [];
    const reservationRoute: FoundationHttpRoute = {
      name: 'reservations',
      methods: ['GET'],
      paths: ['/api/foundation/reservations'],
      matches: (request) => new URL(request.url).pathname === '/api/foundation/reservations',
      handle: async (_request, input) => {
        seenContexts.push(input.context);
        return new Response(JSON.stringify({ state: 'ready' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    };
    const router = createFoundationHttpRouter({
      resolveContext: async () => context,
      csrf: { verify: async () => true },
      routes: [reservationRoute, createObjectiveFoundationRoute({ objectives: fake.objectives, buildDefinition: builder })],
    });

    const response = await router.handle(new Request('http://localhost/api/foundation/reservations'));
    expect(response.status).toBe(200);
    expect(seenContexts).toEqual([context]);
    expect(router.contractVersion).toBe('brainbase.foundation-http.v1');
  });
});

function currentRevisionAdvance(fake: ReturnType<typeof fakeObjectiveOptions>) {
  const next = objectiveDefinition('objective-1', '2', { meaning: '別のclientが更新した目的' });
  fake.setCurrent(next);
}
