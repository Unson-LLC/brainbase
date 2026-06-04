import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
      'onboarding_status'
    ]);
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
        'onboarding_status'
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
      expect(JSON.parse(statusText)).toMatchObject({ backend: 'local' });
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
      connected: true,
      backend: 'local'
    });
  });
});
