import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixturePersonalOs } from './fixtures.js';
import { loadPersonalOs } from '../src/ssot.js';
import { getContext, onboardingStatus, searchAll, searchPersonalKg } from '../src/tools.js';

const dirs: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-tools-'));
  dirs.push(dir);
  await createFixturePersonalOs(dir);
  return loadPersonalOs(dir);
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MCP tool functions', () => {
  it('combines self, work, relationships, and decisions for get_context', async () => {
    const os = await fixture();
    const context = getContext(os);

    expect(context).toMatchObject({
      owner: { name: 'Owner' }
    });
    expect(JSON.stringify(context)).toContain('local canonical facts');
    expect(JSON.stringify(context)).toContain('Personal OS');
    expect(JSON.stringify(context)).toContain('Otawara');
    expect(JSON.stringify(context)).toContain('local personal SSOT only');
  });

  it('search_personal_kg searches only owner-local JSONL entries', async () => {
    const os = await fixture();
    const results = searchPersonalKg(os, 'Otawara local MCP');

    expect(results.every((result) => result.source === 'personal-kg')).toBe(true);
    expect(results.map((result) => result.text).join('\n')).toContain('local MCP context');
    expect(results.map((result) => result.text).join('\n')).not.toContain('Otawara');
  });

  it('search crosses graph and Personal KG while preferring canonical data over sources', async () => {
    const os = await fixture();
    const results = searchAll(os, 'hosted server canonical', 10);

    expect(results.some((result) => result.text.includes('canonical Personal KG wins'))).toBe(true);
    expect(results.every((result) => !result.text.includes('Remote hosted server should be preferred'))).toBe(true);
  });

  it('reports onboarding status', async () => {
    const os = await fixture();
    const status = onboardingStatus(os);

    expect(status).toMatchObject({
      connected: true,
      backend: 'local',
      seeded: {
        self: true,
        work: true,
        relationships: true
      }
    });
  });
});
