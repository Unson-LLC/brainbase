import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FoundationAcl, FoundationScope, ObjectiveDefinition, VariableDefinition } from '../src/ontology-foundation.js';
import {
  FoundationStoreError,
  createLocalStoryResolver,
  createFoundationRevisionStore
} from '../src/foundation-store.js';
import { createCompanyOsObjectives } from '../src/company-os-objectives.js';
import { initializePersonalOs, loadPersonalOs } from '../src/ssot.js';

const dataDirs: string[] = [];

afterEach(async () => {
  await Promise.all(dataDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeDataDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-foundation-'));
  dataDirs.push(directory);
  await initializePersonalOs(directory);
  return directory;
}

function baseDefinition(id: string, type: 'objective' | 'variable') {
  return {
    id,
    type,
    revision: '1',
    meaning: `${type} meaning`,
    adoptionState: 'draft' as const,
    authorizedUses: ['draft', 'judgment', 'evaluation'] as const,
    acl: {
      ownerId: 'owner-1',
      visibility: 'private' as const,
      readerIds: ['reader-1'],
      writerIds: []
    },
    storage: 'ontology' as const,
    provenance: [{ sourceId: 'story-02', sourceKind: 'document' as const, evidenceIds: [] }],
    scope: { subjectIds: ['org-1'], validFrom: '2026-01-01T00:00:00.000Z' }
  };
}

function variableDefinition(): VariableDefinition {
  return {
    ...baseDefinition('variable-response-time', 'variable'),
    subject: 'org-1/front-desk',
    valueKind: 'number',
    unit: 'minutes',
    aggregation: 'sum',
    granularity: 'week',
    measurementMethod: 'ticket and handoff duration'
  };
}

function objectiveDefinition(): ObjectiveDefinition {
  return {
    ...baseDefinition('objective-reduce-load', 'objective'),
    beneficiaryIds: ['org-1'],
    desiredState: 'Reduce total front-desk response load without reducing service quality.',
    criteria: [{
      variableRef: { id: 'variable-response-time', type: 'variable', revision: '1' },
      operator: 'at_most',
      target: 120
    }],
    evaluationPeriod: {
      from: '2026-01-01T00:00:00.000Z',
      until: '2026-03-31T23:59:59.000Z'
    },
    accountableId: 'owner-1'
  };
}

function storyRevision(
  id = 'story-ai-phone-pilot',
  revision = '1',
  overrides: { acl?: Partial<FoundationAcl>; scope?: Partial<FoundationScope> } = {}
) {
  return {
    id,
    revision,
    acl: {
      ownerId: 'owner-1',
      visibility: 'private' as const,
      readerIds: ['reader-1'],
      writerIds: [],
      ...overrides.acl
    },
    scope: {
      subjectIds: ['org-1'],
      validFrom: '2026-01-01T00:00:00.000Z',
      ...overrides.scope
    }
  };
}

describe('GraphFoundationRevisionStore', () => {
  it('persists objective and variable revisions in Graph SSOT and reads them back', async () => {
    const dataDir = await makeDataDir();
    const firstStore = createFoundationRevisionStore({ dataDir });
    const variableRef = await firstStore.create(variableDefinition(), { principal: 'owner-1' });
    const objectiveRef = await firstStore.create(objectiveDefinition(), { principal: 'owner-1' });

    expect(variableRef).toMatchObject({ id: 'variable-response-time', type: 'variable', revision: '1' });
    expect(variableRef.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(objectiveRef).toMatchObject({ id: 'objective-reduce-load', type: 'objective', revision: '1' });

    const secondStore = createFoundationRevisionStore({ dataDir });
    const readObjective = await secondStore.readLatest('objective', 'objective-reduce-load', { principal: 'owner-1' });
    expect(readObjective?.definition).toEqual(objectiveDefinition());
    expect(readObjective?.digest).toBe(objectiveRef.digest);
    expect((await secondStore.read(variableRef, { principal: 'reader-1' }))?.definition).toEqual(variableDefinition());
  });

  it('allows incomplete drafts while keeping ACL and readback boundaries explicit', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const draft = {
      ...baseDefinition('objective-draft', 'objective'),
      desiredState: '',
      beneficiaryIds: [],
      criteria: [],
      evaluationPeriod: { from: '2026-01-01T00:00:00.000Z', until: '2026-01-01T00:00:00.001Z' }
    } as ObjectiveDefinition;
    await expect(store.create(draft, { principal: 'owner-1' })).resolves.toMatchObject({ revision: '1' });
    await expect(store.readLatest('objective', 'objective-draft', { principal: 'reader-1' })).resolves.toMatchObject({
      definition: { id: 'objective-draft', criteria: [] }
    });
    await expect(store.readLatest('objective', 'objective-draft', { principal: 'outsider' }))
      .rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('preserves old revisions and rejects stale compare-and-swap updates', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const created = await store.create(variableDefinition(), { principal: 'owner-1' });
    const nextDefinition = { ...variableDefinition(), meaning: 'Updated measurement meaning' };
    const updated = await store.update({ reference: created, next: nextDefinition }, { principal: 'owner-1' });

    expect(updated.revision).toBe('2');
    expect((await store.read(created, { principal: 'owner-1' }))?.definition.meaning).toBe('variable meaning');
    expect((await store.read(updated, { principal: 'owner-1' }))?.definition.meaning).toBe('Updated measurement meaning');
    await expect(store.update({ reference: created, next: nextDefinition }, { principal: 'owner-1' }))
      .rejects.toMatchObject({ code: 'revision_conflict', currentRevision: '2' });
    expect((await store.readLatest('variable', 'variable-response-time', { principal: 'owner-1' }))?.definition.revision).toBe('2');
  });

  it('serializes concurrent updates through the canonical SSOT lock', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const created = await store.create(variableDefinition(), { principal: 'owner-1' });
    const updates = await Promise.allSettled([
      store.update({
        reference: created,
        next: { ...variableDefinition(), meaning: 'Concurrent update A' }
      }, { principal: 'owner-1' }),
      store.update({
        reference: created,
        next: { ...variableDefinition(), meaning: 'Concurrent update B' }
      }, { principal: 'owner-1' })
    ]);

    expect(updates.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = updates.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'revision_conflict', currentRevision: '2' } });
    expect((await store.readLatest('variable', 'variable-response-time', { principal: 'owner-1' }))?.definition.revision).toBe('2');
  });

  it('authorizes historical reads against the current revision ACL', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const created = await store.create(variableDefinition(), { principal: 'owner-1' });
    const updated = await store.update({
      reference: created,
      next: {
        ...variableDefinition(),
        acl: { ...variableDefinition().acl, readerIds: ['reader-2'] }
      }
    }, { principal: 'owner-1' });

    await expect(store.read(created, { principal: 'reader-1' }))
      .rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(store.read(created, { principal: 'reader-2' }))
      .resolves.toMatchObject({ definition: { revision: '1' } });
    await expect(store.read(updated, { principal: 'reader-2' }))
      .resolves.toMatchObject({ definition: { revision: '2' } });
  });

  it('resolves relation endpoints under the canonical lock and enforces endpoint scope', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const variableRef = await store.create(variableDefinition(), { principal: 'owner-1' });
    const objectiveRef = await store.create(objectiveDefinition(), { principal: 'owner-1' });
    const relation = {
      relation: 'evaluated_by' as const,
      source: objectiveRef,
      target: variableRef
    };

    await expect(store.addRelation(relation, { principal: 'owner-1' })).resolves.toBeUndefined();
    await expect(store.addRelation(relation, { principal: 'outsider' }))
      .rejects.toMatchObject({ code: 'authorization_denied' });
    await expect(store.addRelation({
      ...relation,
      target: { ...variableRef, revision: '9' }
    }, { principal: 'owner-1' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps Story/Objective contribution, execution dependency, and time condition distinct', async () => {
    const dataDir = await makeDataDir();
    const api = createCompanyOsObjectives(createFoundationRevisionStore({
      dataDir,
      endpointResolver: createLocalStoryResolver([storyRevision()])
    }));
    const objective = await api.createObjective(objectiveDefinition(), { principal: 'owner-1' });
    const context = { principal: 'owner-1' };

    await api.linkObjectiveStory({
      storyId: 'story-ai-phone-pilot',
      objective,
      linkKind: 'contribution'
    }, context);
    await api.linkObjectiveStory({
      storyId: 'story-ai-phone-pilot',
      objective,
      linkKind: 'execution_dependency'
    }, context);
    await api.linkObjectiveStory({
      storyId: 'story-ai-phone-pilot',
      objective,
      linkKind: 'time_condition',
      timeCondition: {
        kind: 'evaluation_window',
        period: objectiveDefinition().evaluationPeriod
      }
    }, context);

    const saved = await loadPersonalOs(dataDir);
    expect(saved.graph.version).toBe(2);
    if (saved.graph.version !== 2) throw new Error('Expected Graph v2');
    expect(saved.graph.foundation?.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relation: 'contributes_to',
        source: { id: 'story-ai-phone-pilot', type: 'story', revision: '1' },
        target: objective
      }),
      expect.objectContaining({
        relation: 'execution_depends_on',
        source: { id: 'story-ai-phone-pilot', type: 'story', revision: '1' },
        target: objective
      }),
      expect.objectContaining({
        relation: 'time_condition',
        source: { id: 'story-ai-phone-pilot', type: 'story', revision: '1' },
        target: objective,
        timeCondition: {
          kind: 'evaluation_window',
          period: objectiveDefinition().evaluationPeriod
        }
      })
    ]));
    expect(saved.graph.foundation?.relations).toHaveLength(3);
  });

  it('fails closed for a missing Story and leaves the canonical aggregate unchanged', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({
      dataDir,
      endpointResolver: createLocalStoryResolver([])
    });
    const objective = await store.create(objectiveDefinition(), { principal: 'owner-1' });

    await expect(store.addRelation({
      relation: 'contributes_to',
      source: { id: 'story-does-not-exist', type: 'story' },
      target: objective
    }, { principal: 'owner-1' })).rejects.toMatchObject({ code: 'not_found' });

    const saved = await loadPersonalOs(dataDir);
    expect(saved.graph.version).toBe(2);
    if (saved.graph.version !== 2) throw new Error('Expected Graph v2');
    expect(saved.graph.foundation?.relations ?? []).toEqual([]);
  });

  it('fails closed when no trusted resolver is configured for a Story endpoint', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({ dataDir });
    const objective = await store.create(objectiveDefinition(), { principal: 'owner-1' });

    await expect(store.addRelation({
      relation: 'contributes_to',
      source: { id: 'story-provider-owned', type: 'story' },
      target: objective
    }, { principal: 'owner-1' })).rejects.toMatchObject({ code: 'authorization_denied' });
  });

  it('rejects a Story outside the trusted subject scope before writing a relation', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({
      dataDir,
      endpointResolver: createLocalStoryResolver([storyRevision('story-other-org', '1', {
        scope: { subjectIds: ['org-2'] }
      })])
    });
    const objective = await store.create(objectiveDefinition(), { principal: 'owner-1' });

    await expect(store.addRelation({
      relation: 'contributes_to',
      source: { id: 'story-other-org', type: 'story' },
      target: objective
    }, {
      principal: 'owner-1',
      scope: { subjectIds: ['org-1'], validFrom: '2026-01-01T00:00:00.000Z' }
    })).rejects.toMatchObject({ code: 'scope_violation' });

    const saved = await loadPersonalOs(dataDir);
    if (saved.graph.version !== 2) throw new Error('Expected Graph v2');
    expect(saved.graph.foundation?.relations ?? []).toEqual([]);
  });

  it('uses the current Story ACL when linking an older Story revision', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({
      dataDir,
      endpointResolver: createLocalStoryResolver([
        storyRevision('story-revoked', '1'),
        storyRevision('story-revoked', '2', { acl: { ownerId: 'different-owner' } })
      ])
    });
    const objective = await store.create(objectiveDefinition(), { principal: 'owner-1' });

    await expect(store.addRelation({
      relation: 'contributes_to',
      source: { id: 'story-revoked', type: 'story', revision: '1' },
      target: objective
    }, { principal: 'owner-1' })).rejects.toMatchObject({ code: 'authorization_denied' });

    const saved = await loadPersonalOs(dataDir);
    if (saved.graph.version !== 2) throw new Error('Expected Graph v2');
    expect(saved.graph.foundation?.relations ?? []).toEqual([]);
  });

  it('rejects an ID-only Story link when the resolver returns an older revision', async () => {
    const dataDir = await makeDataDir();
    const localResolver = createLocalStoryResolver([
      storyRevision('story-stale-id', '1'),
      storyRevision('story-stale-id', '2')
    ]);
    const store = createFoundationRevisionStore({
      dataDir,
      endpointResolver: {
        async resolve(request) {
          const resource = await localResolver.resolve(request);
          return resource ? { ...resource, revision: '1' } : null;
        }
      }
    });
    const objective = await store.create(objectiveDefinition(), { principal: 'owner-1' });

    await expect(store.addRelation({
      relation: 'contributes_to',
      source: { id: 'story-stale-id', type: 'story' },
      target: objective
    }, { principal: 'owner-1' })).rejects.toMatchObject({ code: 'authorization_denied' });

    const saved = await loadPersonalOs(dataDir);
    if (saved.graph.version !== 2) throw new Error('Expected Graph v2');
    expect(saved.graph.foundation?.relations ?? []).toEqual([]);
  });

  it('passes only Story authorization metadata to policy and persists the resolved revision', async () => {
    const dataDir = await makeDataDir();
    const storyResolver = createLocalStoryResolver([storyRevision('story-resolved', '1')]);
    const linkResources: unknown[][] = [];
    let resolverSawCurrentAggregate = false;
    const store = createFoundationRevisionStore({
      dataDir,
      endpointResolver: {
        async resolve(request) {
          resolverSawCurrentAggregate = request.current.graph.version === 2;
          return storyResolver.resolve(request);
        }
      },
      policy: {
        authorize(request) {
          if (request.action === 'link') linkResources.push([...(request.resources ?? [])]);
        }
      }
    });
    const objective = await store.create(objectiveDefinition(), { principal: 'owner-1' });

    await store.addRelation({
      relation: 'contributes_to',
      source: { id: 'story-resolved', type: 'story' },
      target: objective
    }, { principal: 'owner-1' });

    expect(resolverSawCurrentAggregate).toBe(true);
    const story = linkResources[0]?.find((resource) => (
      typeof resource === 'object' && resource !== null && 'type' in resource && resource.type === 'story'
    )) as Record<string, unknown> | undefined;
    expect(story).toMatchObject({
      id: 'story-resolved',
      type: 'story',
      revision: '1',
      currentRevision: '1',
      acl: { ownerId: 'owner-1' },
      scope: { subjectIds: ['org-1'] }
    });
    expect(story).not.toHaveProperty('meaning');
    expect(story).not.toHaveProperty('desiredState');

    const saved = await loadPersonalOs(dataDir);
    if (saved.graph.version !== 2) throw new Error('Expected Graph v2');
    expect(saved.graph.foundation?.relations).toEqual([
      expect.objectContaining({
        relation: 'contributes_to',
        source: { id: 'story-resolved', type: 'story', revision: '1' },
        target: objective
      })
    ]);
  });

  it('provides typed Objective and Variable operations with definition-only readiness', async () => {
    const dataDir = await makeDataDir();
    const api = createCompanyOsObjectives(createFoundationRevisionStore({ dataDir }));
    await api.createVariable(variableDefinition(), { principal: 'owner-1' });
    const objective = await api.createObjective(objectiveDefinition(), { principal: 'owner-1' });

    await expect(api.checkObjectiveReadiness('objective-reduce-load', { principal: 'owner-1' }))
      .resolves.toMatchObject({ ready: true, issues: [] });

    const draft = {
      ...objectiveDefinition(),
      id: 'objective-awaiting-input',
      desiredState: '',
      beneficiaryIds: [],
      criteria: [{
        variableRef: { id: 'missing-variable', type: 'variable' as const, revision: '1' },
        operator: 'at_most' as const,
        target: 0
      }]
    };
    await api.createObjective(draft, { principal: 'owner-1' });
    const readiness = await api.checkObjectiveReadiness('objective-awaiting-input', { principal: 'owner-1' });
    expect(readiness.ready).toBe(false);
    expect(readiness.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'MISSING_FIELD',
      'MISSING_VARIABLE_REVISION'
    ]));
    expect(objective.revision).toBe('1');
  });

  it('rejects criterion targets whose operator or value kind is incompatible with the Variable', async () => {
    const dataDir = await makeDataDir();
    const api = createCompanyOsObjectives(createFoundationRevisionStore({ dataDir }));
    await api.createVariable({
      ...variableDefinition(),
      id: 'variable-status',
      valueKind: 'string',
      unit: undefined,
      aggregation: 'last'
    }, { principal: 'owner-1' });
    await api.createVariable({
      ...variableDefinition(),
      id: 'variable-flag',
      valueKind: 'boolean',
      unit: undefined,
      aggregation: 'last'
    }, { principal: 'owner-1' });

    await api.createObjective({
      ...objectiveDefinition(),
      id: 'objective-bad-threshold',
      criteria: [{
        variableRef: { id: 'variable-status', type: 'variable', revision: '1' },
        operator: 'at_most',
        target: 'slow'
      }]
    }, { principal: 'owner-1' });
    await api.createObjective({
      ...objectiveDefinition(),
      id: 'objective-bad-equals',
      criteria: [{
        variableRef: { id: 'variable-flag', type: 'variable', revision: '1' },
        operator: 'equals',
        target: 'true'
      }]
    }, { principal: 'owner-1' });

    await expect(api.checkObjectiveReadiness('objective-bad-threshold', { principal: 'owner-1' }))
      .resolves.toMatchObject({ ready: false, issues: expect.arrayContaining([
        expect.objectContaining({ code: 'CRITERION_TYPE_MISMATCH', path: 'criteria[0]' })
      ]) });
    await expect(api.checkObjectiveReadiness('objective-bad-equals', { principal: 'owner-1' }))
      .resolves.toMatchObject({ ready: false, issues: expect.arrayContaining([
        expect.objectContaining({ code: 'CRITERION_TYPE_MISMATCH', path: 'criteria[0]' })
      ]) });
  });

  it('uses an injected policy for tenant authorization instead of trusting request fields', async () => {
    const dataDir = await makeDataDir();
    const actions: string[] = [];
    const store = createFoundationRevisionStore({
      dataDir,
      policy: {
        authorize(request) {
          actions.push(request.action);
          if (request.context.principal !== 'tenant-owner') throw new FoundationStoreError('scope_violation', 'tenant scope denied');
        }
      }
    });
    const definition = { ...variableDefinition(), acl: { ...variableDefinition().acl, ownerId: 'untrusted-body-owner' } };
    await expect(store.create(definition, { principal: 'tenant-owner' })).resolves.toMatchObject({ revision: '1' });
    // The candidate is authorized for read before commit and read back once
    // from the canonical store after commit.
    expect(actions).toEqual(['create', 'read', 'read']);
    await expect(store.readLatest('variable', definition.id, { principal: 'other-tenant' }))
      .rejects.toMatchObject({ code: 'scope_violation' });
  });

  it('fails closed when a stored digest is corrupted', async () => {
    const dataDir = await makeDataDir();
    const store = createFoundationRevisionStore({ dataDir });
    await store.create(variableDefinition(), { principal: 'owner-1' });
    const graphPath = join(dataDir, 'graph.json');
    const graph = JSON.parse(await readFile(graphPath, 'utf8')) as { foundation: { records: Array<{ digest: string }> } };
    graph.foundation.records[0].digest = `sha256:${'0'.repeat(64)}`;
    await writeFile(graphPath, `${JSON.stringify(graph)}\n`);

    await expect(store.readLatest('variable', 'variable-response-time', { principal: 'owner-1' }))
      .rejects.toMatchObject({ code: 'corrupt_catalog' });
  });
});
