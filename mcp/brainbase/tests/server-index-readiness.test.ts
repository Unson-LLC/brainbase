import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { __testing } from '../src/server.js';
import { GraphAPISource } from '../src/sources/graphapi-source.js';
import { TokenManager } from '../src/auth/token-manager.js';

const fixtureTenantScope = new AsyncLocalStorage<string>();

class ControlledSource extends GraphAPISource {
  failure = false;
  loads = 0;
  philosophyLoads = 0;
  release: Promise<void> = Promise.resolve();
  constructor() { super('http://unused.invalid', new TokenManager()); }
  override async initialize() {
    this.loads++;
    await this.release;
    if (this.failure) throw new Error('GRAPH_UNAVAILABLE');
  }
  override async getPhilosophyContext() {
    this.philosophyLoads++;
    if (this.failure) throw new Error('PHILOSOPHY_UNAVAILABLE');
    return {mode: 'test', project_code: 'brainbase', scope: 'graph', prompt_block: 'VERIFIED_PHILOSOPHY'};
  }
  override async getProjects() {
    const tenant = fixtureTenantScope.getStore();
    return tenant ? [{id: `project-${tenant}`, name: `Project ${tenant}`} as never] : [];
  }
}
afterEach(() => {
  __testing.setIndexRefreshEnabled(false);
  __testing.setGraphSource(null);
  __testing.resetEntityIndexStates();
});
function useSource() {
  const source = new ControlledSource();
  __testing.setGraphSource(source);
  __testing.setIndexRefreshEnabled(true);
  return source;
}

test('all index consumers reject failed initialization instead of returning absence', async () => {
  const source = useSource();
  source.failure = true;
  for (const [name, args] of [
    ['get_entity', {type: 'project', id: 'missing'}],
    ['list_entities', {type: 'project'}],
    ['search', {query: 'missing'}],
    ['resolve_entity', {query: 'missing'}],
    ['list_extension_entities', {type: 'initiative'}],
    ['search_personal_kg', {query: 'missing', person_entity_id: 'per_fixture'}],
  ] as const) {
    await assert.rejects(__testing.handleToolCall(name, args), /GRAPH_UNAVAILABLE/);
  }
});

test('concurrent readers share initialization and recover on the same server after failure', async () => {
  const source = useSource();
  source.failure = true;
  await assert.rejects(__testing.handleToolCall('resolve_entity', {query: 'missing'}));
  source.failure = false;
  let release!: () => void;
  source.release = new Promise<void>(resolve => { release = resolve; });
  let completed = false;
  const reads = Promise.all([
    __testing.handleToolCall('resolve_entity', {query: 'missing'}),
    __testing.handleToolCall('list_entities', {type: 'project'}),
    __testing.handleToolCall('get_entity', {type: 'project', id: 'missing'}),
  ]).then(results => { completed = true; return results; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(source.loads, 2);
  release();
  const results = await reads;
  for (const result of results) assert.match(result, /VERIFIED_PHILOSOPHY/);
  assert.equal(source.philosophyLoads, 3);
});

test('concurrent tenant scopes never share an in-flight entity index refresh', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let initializations = 0;
  class TenantBoundSource extends ControlledSource {
    tenant = '';
    override async initialize() {
      initializations++;
      this.tenant = fixtureTenantScope.getStore() ?? '';
      await gate;
    }
    override async getProjects() {
      return [{id: `project-${this.tenant}`, name: `Project ${this.tenant}`} as never];
    }
  }
  __testing.setGraphSourceFactory(() => new TenantBoundSource());
  __testing.setIndexRefreshEnabled(true);

  const reads = Promise.all([
    fixtureTenantScope.run('org-a', () =>
      __testing.runWithEntityIndexScope('tenant:org-a', () =>
        __testing.handleToolCall('list_entities', {type: 'project'}))),
    fixtureTenantScope.run('org-b', () =>
      __testing.runWithEntityIndexScope('tenant:org-b', () =>
        __testing.handleToolCall('list_entities', {type: 'project'}))),
  ]);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(initializations, 2);
  release();
  const [orgA, orgB] = await reads;
  assert.match(orgA, /project-org-a/);
  assert.doesNotMatch(orgA, /project-org-b/);
  assert.match(orgB, /project-org-b/);
  assert.doesNotMatch(orgB, /project-org-a/);
});

test('philosophy failure is propagated after a successful index load', async () => {
  const source = useSource();
  source.getPhilosophyContext = async () => { throw new Error('PHILOSOPHY_UNAVAILABLE'); };
  await assert.rejects(__testing.handleToolCall('resolve_entity', {query: 'missing'}), /PHILOSOPHY_UNAVAILABLE/);
});

 test('retired search paths reject before loading the Graph index', async () => {
  const source = useSource(); source.failure = true;
  for (const [name, args] of [
    ['get_context', {topic: 'question'}],
    ['search_wiki', {query: 'question'}],
    ['get_wiki_page', {path: 'brainbase/project'}],
    ['search', {query: 'question', mode: 'lexical'}],
  ] as const) await assert.rejects(__testing.handleToolCall(name, args), /removed|disabled|retired/);
  assert.equal(source.loads, 0); assert.equal(source.philosophyLoads, 0);
});
