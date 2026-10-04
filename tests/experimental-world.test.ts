import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectWorldBusinesses, readWorldBusinesses } from '../src/experimental-world.js';

const record = (id: string, projectCode: string, payload: Record<string, unknown>, lifecycle = 'active') => ({
  id,
  project_code: projectCode,
  organization_id: 'unson',
  lifecycle_status: lifecycle,
  payload,
});

describe('experimental world: businesses from the organization Graph', () => {
  it('draws active catalog projects as cities and attaches engagements by project_code', () => {
    const projection = projectWorldBusinesses([
      record('prj_baao', 'baao', { code: 'baao', kind: 'internal', name: 'BAAO', purpose: '研修' }),
      record('prj_zeims', 'zeims', { code: 'zeims', kind: 'product', name: 'Zeims' }),
      record('eng_nec', 'baao', { name: 'NEC AI研修', summary: '研修案件' }),
      record('eng_growin', 'baao', { name: 'Growin SNS PoC' }),
    ]);
    expect(projection.businesses.map((business) => business.code)).toEqual(['zeims', 'baao']);
    const baao = projection.businesses.find((business) => business.code === 'baao');
    expect(baao?.engagements.map((engagement) => engagement.name)).toEqual(['Growin SNS PoC', 'NEC AI研修']);
    expect(projection.unplaced).toEqual([]);
  });

  it('counts retired, superseded and unnamed records instead of drawing them', () => {
    const projection = projectWorldBusinesses([
      record('prj_st', 'unson-salestailor', { code: 'unson-salestailor', kind: 'product', name: 'SalesTailor' }, 'retired'),
      record('old_mana', 'mana', { name: 'mana' }, 'superseded'),
      record('blank', 'unson', {}),
    ]);
    expect(projection.businesses).toEqual([]);
    expect(projection.excluded).toEqual({ inactive: 2, unnamed: 1 });
  });

  it('keeps an engagement whose business is not listed visible as unplaced, never dropping it', () => {
    const projection = projectWorldBusinesses([record('eng_orphan', 'no-such-business', { name: '行き先のない案件' })]);
    expect(projection.unplaced.map((engagement) => engagement.name)).toEqual(['行き先のない案件']);
  });

  it('reports a missing connection as a state, not as zero businesses', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bb-world-'));
    const result = await readWorldBusinesses({ home });
    expect(result.status).toBe('not_connected');
  });

  it('reports an expired token as auth_failed without leaking the token', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bb-world-'));
    await mkdir(join(home, '.brainbase'));
    await writeFile(join(home, '.brainbase', 'config.json'), JSON.stringify({ server_url: 'https://graph.example' }));
    await writeFile(join(home, '.brainbase', 'tokens.json'), JSON.stringify({ access_token: 'secret-token-value' }));
    const result = await readWorldBusinesses({
      home,
      fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch,
    });
    expect(result).toMatchObject({ status: 'auth_failed', reason: 'http_401' });
    expect(JSON.stringify(result)).not.toContain('secret-token-value');
  });
});
