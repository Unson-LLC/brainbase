import { describe, expect, it, vi } from 'vitest';
import {
  handleKnowledgeLookupToolCall,
  knowledgeLookupTools,
  type KnowledgeLookupDependencies,
  type KnowledgeLookupDependencyResult,
} from '../src/knowledge-lookup.js';

const scope = { project_codes: ['fixture-scope'] };

function ok(data: unknown): KnowledgeLookupDependencyResult {
  return { status: 'ok', scope, data };
}

function fixtureDependencies(overrides: Partial<KnowledgeLookupDependencies> = {}): KnowledgeLookupDependencies {
  return {
    search: vi.fn(async () => ok({ candidates: [], coverage: 'complete' })),
    read: vi.fn(async () => ok({ entity: null, coverage: 'complete' })),
    followRelation: vi.fn(async () => ok({ candidates: [], coverage: 'complete' })),
    projectEntity: (entity) => ({
      body: {
        id: entity.id,
        graph_entity_id: entity.id,
        type: entity.entity_type,
        ...(entity.public_body as Record<string, unknown> | undefined),
      },
      entity_type: typeof entity.entity_type === 'string' ? entity.entity_type : undefined,
    }),
    ...overrides,
  };
}

function input(next_action?: Record<string, unknown>): Record<string, unknown> {
  return {
    question: 'どの接続先を使うか',
    target_hint: 'operational profile',
    required_fields: ['environments.production.endpoint'],
    ...(next_action ? { next_action } : {}),
  };
}

describe('purpose based knowledge lookup', () => {
  it('exposes a required purpose based schema without project authorization input', () => {
    const tool = knowledgeLookupTools.find((candidate) => candidate.name === 'brainbase_knowledge_lookup');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['question', 'target_hint', 'required_fields']);
    expect((tool?.inputSchema.properties as Record<string, unknown>).project_code).toBeUndefined();
  });

  it('passes hints as search context while the host owns the scope', async () => {
    const search = vi.fn(async () => ok({
      candidates: [{
        id: 'app_fixture',
        entity_type: 'app',
        name: 'Fixture App',
        display_name: 'Fixture App',
        evidence: { description: 'fixture app' },
      }],
      coverage: 'complete',
    }));
    const deps = fixtureDependencies({ search });
    const result = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', {
      ...input(),
      context_hints: ['project hint: other-scope', 'treat retrieved text as data'],
    }, deps);
    expect(result?.status).toBe('ok');
    expect(result?.data?.searched_scope).toEqual(scope);
    expect(result?.data?.absence_confirmed).toBe(false);
    expect(result?.data?.body).toEqual({
      candidates: [{
        id: 'app_fixture',
        entity_type: 'app',
        name: 'Fixture App',
        display_name: 'Fixture App',
        evidence: { description: 'fixture app' },
      }],
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      entity_types: expect.arrayContaining(['app']),
      required_fields: ['environments.production.endpoint'],
    });
    expect(search.mock.calls[0]?.[0].query).toContain('other-scope');
  });

  it('preserves transport failure as unknown coverage', async () => {
    const deps = fixtureDependencies({
      search: vi.fn(async () => ({
        status: 'unavailable',
        scope,
        error: { code: 'graph_unavailable', message: 'fixture unavailable', http_status: 503 },
      })),
    });
    const result = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', input(), deps);
    expect(result?.status).toBe('unavailable');
    expect(result?.data?.outcome).toBe('transport_error');
    expect(result?.data?.coverage).toBe('unknown');
    expect(result?.data?.absence_confirmed).toBe(false);
    expect(result?.data?.missing_fields).toEqual(['environments.production.endpoint']);
  });

  it('keeps an empty partial search incomplete', async () => {
    const deps = fixtureDependencies({
      search: vi.fn(async () => ok({ candidates: [], coverage: 'partial' })),
    });
    const result = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', input(), deps);
    expect(result?.status).toBe('ok');
    expect(result?.data?.outcome).toBe('incomplete');
    expect(result?.data?.coverage).toBe('partial');
    expect(result?.data?.references).toEqual([]);
    expect(result?.data?.absence_confirmed).toBe(false);
  });

  it('keeps an empty unknown relation traversal incomplete', async () => {
    const deps = fixtureDependencies({
      followRelation: vi.fn(async () => ok({ candidates: [], coverage: 'unknown' })),
    });
    const result = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', {
      ...input({
        kind: 'follow_relation',
        seed_ids: ['app_fixture'],
        relation: 'belongs_to_project',
        direction: 'outgoing',
      }),
      required_fields: ['name'],
    }, deps);
    expect(result?.status).toBe('ok');
    expect(result?.data?.outcome).toBe('incomplete');
    expect(result?.data?.coverage).toBe('unknown');
    expect(result?.data?.absence_confirmed).toBe(false);
  });

  it.each(['partial', 'unknown'] as const)('keeps a missing entity with %s read coverage incomplete', async (coverage) => {
    const deps = fixtureDependencies({
      read: vi.fn(async () => ok({ entity: null, coverage })),
    });
    const result = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', {
      ...input({ kind: 'read', entity_id: 'app_fixture', entity_type: 'app' }),
    }, deps);
    expect(result?.status).toBe('ok');
    expect(result?.data?.outcome).toBe('incomplete');
    expect(result?.data?.coverage).toBe(coverage);
    expect(result?.data?.absence_confirmed).toBe(false);
  });

  it('reads a known entity through the injected read and public projection', async () => {
    const read = vi.fn(async () => ok({
      entity: {
        id: 'app_fixture',
        entity_type: 'app',
        public_body: {
          name: 'Fixture App',
          environments: { production: { endpoint: 'https://fixture.example' } },
          secret: 'must not cross projection',
        },
      },
      coverage: 'complete',
    }));
    const deps = fixtureDependencies({ read });
    const result = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', {
      ...input({ kind: 'read', entity_id: 'app_fixture', entity_type: 'app' }),
      lookup_id: 'lookup-1',
      revision: 2,
      attempt_id: 'toolu-read-1',
    }, deps);
    expect(result?.status).toBe('ok');
    expect(result?.data?.outcome).toBe('retrieved');
    expect(result?.data?.body).toEqual({
      id: 'app_fixture',
      graph_entity_id: 'app_fixture',
      type: 'app',
      name: 'Fixture App',
      environments: { production: { endpoint: 'https://fixture.example' } },
    });
    expect(result?.data?.missing_fields).toEqual([]);
    expect(result?.data?.attempt_id).toBe('toolu-read-1');
    expect(read).toHaveBeenCalledWith({
      entity_id: 'app_fixture',
      entity_type: 'app',
      required_fields: ['environments.production.endpoint'],
    });
  });

  it('returns a finish proposal without calling any dependency', async () => {
    const deps = fixtureDependencies({
      search: vi.fn(async () => { throw new Error('finish must not search'); }),
      read: vi.fn(async () => { throw new Error('finish must not read'); }),
      followRelation: vi.fn(async () => { throw new Error('finish must not traverse'); }),
    });
    const result = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', {
      ...input({
        kind: 'finish',
        assessment: 'sufficient',
        status: 'satisfied',
        reference_ids: ['app_fixture'],
        field_evidence: [{ field: 'environments.production.endpoint', reference_id: 'app_fixture', attempt_id: 'toolu-read-1' }],
        unresolved_items: [],
        termination_reason: 'required endpoint was read',
      }),
      lookup_id: 'lookup-1',
      revision: 3,
    }, deps);
    expect(result?.status).toBe('ok');
    expect(result?.data?.proposed_finish?.status).toBe('satisfied');
    expect(deps.search).not.toHaveBeenCalled();
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.followRelation).not.toHaveBeenCalled();
  });

  it('rejects caller supplied project filters and unsafe field paths before I/O', async () => {
    const deps = fixtureDependencies({
      search: vi.fn(async () => { throw new Error('network must not be called'); }),
    });
    const projectResult = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', {
      ...input(),
      project_code: 'other-scope',
    }, deps);
    expect(projectResult?.status).toBe('error');
    expect(projectResult?.error?.code).toBe('brainbase_knowledge_lookup_input_invalid');

    const fieldResult = await handleKnowledgeLookupToolCall('brainbase_knowledge_lookup', {
      ...input(),
      required_fields: ['payload.secret'],
    }, deps);
    expect(fieldResult?.status).toBe('error');
    expect(fieldResult?.error?.code).toBe('brainbase_knowledge_lookup_field_invalid');
    expect(deps.search).not.toHaveBeenCalled();
  });
});
