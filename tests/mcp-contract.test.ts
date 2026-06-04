import { mkdtemp, rm } from 'node:fs/promises';
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
    const client = new Client({
      name: 'brainbase-contract-test',
      version: '0.0.0'
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/index.js']
    });

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
