import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createFixturePersonalOs } from './fixtures.js';
import { callBrainbaseTool, toolDefinitions } from '../src/server.js';

const dirs: string[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-mcp-'));
  dirs.push(dir);
  await createFixturePersonalOs(dir);
  return dir;
}

function createClient(dataDir?: string): { client: Client; transport: StdioClientTransport } {
  const client = new Client({
    name: 'brainbase-contract-test',
    version: '0.0.0'
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: dataDir
      ? {
          ...process.env,
          BRAINBASE_PERSONAL_OS_DIR: dataDir
        }
      : process.env
  });

  return { client, transport };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MCP contract', () => {
  it('C-6 lists exactly the v1 tools', () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      'get_context',
      'list_entities',
      'search',
      'search_personal_kg',
      'onboarding_status',
      'brainbase_onboarding_start',
      'brainbase_onboarding_get',
      'brainbase_onboarding_ingest',
      'brainbase_onboarding_review',
      'brainbase_onboarding_first_value',
      'get_ontology',
      'audit_ontology',
      'infer_decisions',
      'ontology_impact'
    ]);
    const firstValue = toolDefinitions.find((tool) => tool.name === 'brainbase_onboarding_first_value');
    expect(firstValue?.inputSchema).toMatchObject({
      type: 'object',
      required: ['runId', 'action'],
      properties: {
        action: { enum: ['record', 'review'] },
        answerHash: { type: 'string' },
        usedCanonicalIds: { type: 'array' },
        verdict: { enum: ['useful', 'not_useful'] }
      }
    });
    const review = toolDefinitions.find((tool) => tool.name === 'brainbase_onboarding_review');
    expect((review?.inputSchema as { properties?: { actions?: { minItems?: number } } }).properties?.actions?.minItems).toBe(1);
    expect((review?.inputSchema as { properties?: { actions?: { items?: { oneOf?: unknown[] } } } }).properties?.actions?.items?.oneOf).toHaveLength(4);
  });

  it('S-4 lists v1 tools through stdio server startup', async () => {
    const { client, transport } = createClient();

    await client.connect(transport);
    try {
      const result = await client.listTools();
      expect(result.tools.map((tool) => tool.name)).toEqual([
        'get_context',
        'list_entities',
        'search',
        'search_personal_kg',
        'onboarding_status',
        'brainbase_onboarding_start',
        'brainbase_onboarding_get',
        'brainbase_onboarding_ingest',
        'brainbase_onboarding_review',
        'brainbase_onboarding_first_value',
        'get_ontology',
        'audit_ontology',
        'infer_decisions',
        'ontology_impact'
      ]);
    } finally {
      await client.close();
    }
  });

  it('S-4 calls v1 tools through stdio server startup with BRAINBASE_PERSONAL_OS_DIR', async () => {
    const dataDir = await fixtureDir();
    const { client, transport } = createClient(dataDir);

    await client.connect(transport);
    try {
      const context = await client.callTool({
        name: 'get_context',
        arguments: {}
      });
      expect(JSON.stringify(context.content)).toContain('Owner');
      expect(JSON.stringify(context.content)).toContain('Personal OS');

      const entities = await client.callTool({
        name: 'list_entities',
        arguments: { type: 'person' }
      });
      expect(JSON.stringify(entities.content)).toContain('Otawara');

      const allSearch = await client.callTool({
        name: 'search',
        arguments: { query: 'Codex' }
      });
      expect(JSON.stringify(allSearch.content)).toContain('relationships');

      const search = await client.callTool({
        name: 'search_personal_kg',
        arguments: { query: 'local MCP' }
      });
      expect(JSON.stringify(search.content)).toContain('personal-kg');

      const status = await client.callTool({
        name: 'onboarding_status',
        arguments: {}
      });
      const statusText = status.content[0]?.type === 'text' ? status.content[0].text : '{}';
      expect(JSON.parse(statusText)).toMatchObject({
        localBackend: { connected: true, backend: 'local' },
        agentMcp: { status: 'not_verified' },
        operationallyReady: false
      });
    } finally {
      await client.close();
    }
  });

  it('connected-world onboarding completes start through first-value review over stdio', async () => {
    const dataDir = await fixtureDir();
    const { client, transport } = createClient(dataDir);
    await client.connect(transport);
    try {
      const started = await client.callTool({ name: 'brainbase_onboarding_start', arguments: {
        valueTarget: 'いまの重要案件を知る',
        sources: [{ id: 'drive-alpha', mode: 'drive', status: 'ready', evidencePointer: 'drive://folder/alpha', permissionScope: ['folder:alpha'] }]
      } });
      const run = JSON.parse(started.content[0]?.type === 'text' ? started.content[0].text : '{}');
      expect(run).toMatchObject({ path: 'warm', state: 'source_ready' });
      expect(run.runId).toBe(run.id);

      const ingested = await client.callTool({ name: 'brainbase_onboarding_ingest', arguments: {
        runId: run.id,
        source: { sourceId: 'drive-alpha', evidencePointer: 'drive://folder/alpha', contentHash: `sha256:${'a'.repeat(64)}`, permissionSnapshot: { scopes: ['folder:alpha'] }, collectionStatus: 'collected' },
        candidates: [{ kind: 'project', payload: { name: 'Alpha Launch' }, observationClass: 'observed', evidenceId: 'drive-item-1' }]
      } });
      const candidateRun = JSON.parse(ingested.content[0]?.type === 'text' ? ingested.content[0].text : '{}');
      const candidateId = candidateRun.candidates[0].id;

      const reviewed = await client.callTool({ name: 'brainbase_onboarding_review', arguments: {
        runId: run.id,
        actions: [{ candidateId, decision: 'approve', reason: 'folder metadataで確認済み' }]
      } });
      const promotedRun = JSON.parse(reviewed.content[0]?.type === 'text' ? reviewed.content[0].text : '{}');
      expect(promotedRun.promotedCanonicalIds).toContainEqual(expect.stringMatching(/^project-/));

      await client.callTool({ name: 'brainbase_onboarding_first_value', arguments: {
        runId: run.id, action: 'record', answerHash: `sha256:${'b'.repeat(64)}`, usedCanonicalIds: [promotedRun.promotedCanonicalIds[0]]
      } });
      const completed = await client.callTool({ name: 'brainbase_onboarding_first_value', arguments: {
        runId: run.id, action: 'review', verdict: 'useful', missingContext: ['期限']
      } });
      const completedRun = JSON.parse(completed.content[0]?.type === 'text' ? completed.content[0].text : '{}');
      expect(completedRun).toMatchObject({ state: 'first_value_answer_reviewed', firstValueReview: { verdict: 'useful', withinTargetSeconds: true } });

      const context = await client.callTool({ name: 'search', arguments: { query: 'Alpha Launch' } });
      expect(JSON.stringify(context.content)).toContain('Alpha Launch');
    } finally {
      await client.close();
    }
  });

  it('S-8 fails loudly through stdio when canonical SSOT is malformed', async () => {
    const dataDir = await fixtureDir();
    await writeFile(join(dataDir, 'relationships.json'), '{"version":1,"relationships":[{"id":"r1","person":"","context":"missing person"}]}');
    const { client, transport } = createClient(dataDir);

    await client.connect(transport);
    try {
      await expect(client.callTool({
        name: 'get_context',
        arguments: {}
      })).rejects.toThrow(/String must contain at least 1 character|canonical SSOT|relationships/);
    } finally {
      await client.close();
    }
  });

  it('C-6 returns deterministic JSON-compatible tool results from fixture SSOT', async () => {
    const dataDir = await fixtureDir();

    await expect(callBrainbaseTool('get_context', { dataDir })).resolves.toMatchObject({
      owner: { name: 'Owner' }
    });
    await expect(callBrainbaseTool('list_entities', { dataDir, type: 'person' })).resolves.toMatchObject({
      entities: expect.arrayContaining([
        expect.objectContaining({ name: 'Otawara' })
      ])
    });
    await expect(callBrainbaseTool('search_personal_kg', { dataDir, query: 'local MCP' })).resolves.toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({ source: 'personal-kg' })
      ])
    });
    await expect(callBrainbaseTool('onboarding_status', { dataDir })).resolves.toMatchObject({
      localBackend: { connected: true, backend: 'local' },
      agentMcp: { status: 'not_verified' },
      operationallyReady: false
    });
    await expect(callBrainbaseTool('get_ontology')).resolves.toMatchObject({ version: '1.0.0' });
    await expect(callBrainbaseTool('audit_ontology', { dataDir })).resolves.toMatchObject({
      status: 'complete',
      ontologyVersion: '1.0.0',
      violationCount: 0
    });
    await expect(callBrainbaseTool('infer_decisions', { dataDir, asOf: '2026-08-03T00:00:00.000Z' })).resolves.toMatchObject({
      ontologyVersion: '1.0.0',
      activeDecisionIds: ['decision-local-only']
    });
    await expect(callBrainbaseTool('infer_decisions', {
      dataDir,
      asOf: '2026-08-03T09:00:00+09:00'
    })).resolves.toMatchObject({
      ontologyVersion: '1.0.0',
      asOf: '2026-08-03T09:00:00+09:00'
    });
    await expect(callBrainbaseTool('audit_ontology', {
      dataDir,
      ontologyVersion: '0.0.0'
    })).resolves.toMatchObject({
      status: 'complete',
      ontologyVersion: '0.0.0'
    });
    await expect(callBrainbaseTool('infer_decisions', {
      dataDir,
      asOf: '2026-08-03T00:00:00.000Z',
      ontologyVersion: '0.0.0'
    })).resolves.toMatchObject({
      ontologyVersion: '0.0.0',
      evidence: []
    });
    await expect(callBrainbaseTool('audit_ontology', {
      dataDir,
      ontologyVersion: '9.9.9'
    })).rejects.toThrow(/Unsupported ontology version/);
    await expect(callBrainbaseTool('ontology_impact', { fromVersion: '0.0.0' })).resolves.toMatchObject({
      toVersion: '1.0.0',
      supported: true
    });
  });

  it('rejects review fields that do not belong to the selected decision', async () => {
    await expect(callBrainbaseTool('brainbase_onboarding_review', {
      runId: 'run-1',
      actions: [{ candidateId: 'candidate-1', decision: 'merge', reason: '同一', mergeIntoCandidateId: 'candidate-2', payload: { name: 'ignored' } }]
    })).rejects.toThrow();
  });

  it('C-6 suppresses decision inference when another canonical snapshot surface is invalid', async () => {
    const dataDir = await fixtureDir();
    const graphPath = join(dataDir, 'graph.json');
    const graph = JSON.parse(await readFile(graphPath, 'utf8'));
    graph.entities.push({ ...graph.entities[0] });
    await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

    await expect(callBrainbaseTool('audit_ontology', { dataDir })).resolves.toMatchObject({
      status: 'complete',
      violations: [expect.objectContaining({ ruleId: 'ONT-ENTITY-ID-UNIQUE' })]
    });
    await expect(callBrainbaseTool('infer_decisions', {
      dataDir,
      asOf: '2026-08-03T00:00:00.000Z'
    })).resolves.toMatchObject({
      status: 'invalid',
      activeDecisionIds: [],
      violations: [expect.objectContaining({ ruleId: 'ONT-ENTITY-ID-UNIQUE' })]
    });
  });
});
