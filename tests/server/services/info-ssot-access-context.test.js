import { describe, expect, it } from 'vitest';
import { withAccessContext } from '../../../server/services/info-ssot-service.js';

const access = {
  role: 'member',
  projectCodes: ['atlas', 'nova'],
  clearance: ['internal', 'restricted'],
  organizationId: 'org-1',
  personId: 'person-1'
};

function fakeClient() {
  const queries = [];
  return {
    queries,
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [] };
    }
  };
}

describe('withAccessContext', () => {
  it('turns jit off inside the local transaction before the handler', async () => {
    const client = fakeClient();
    const seen = [];
    const result = await withAccessContext(client, access, async () => {
      seen.push(client.queries.map((query) => query.text));
      return 'listed';
    });

    expect(result).toBe('listed');
    expect(client.queries.map((query) => query.text)).toEqual([
      'BEGIN',
      "SELECT set_config('jit', 'off', true)",
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'COMMIT'
    ]);
    expect(seen[0][1]).toBe("SELECT set_config('jit', 'off', true)");
    expect(client.queries[2].values).toEqual(['app.role', 'member']);
    expect(client.queries[3].values).toEqual(['app.project_codes', 'atlas,nova']);
    expect(client.queries[4].values).toEqual(['app.clearance', 'internal,restricted']);
    expect(client.queries[5].values).toEqual(['app.organization_id', 'org-1']);
    expect(client.queries[7].values).toEqual(['app.graph_maintenance_mode', 'false']);
  });

  it('rolls the access context back when the handler fails', async () => {
    const client = fakeClient();
    await expect(withAccessContext(client, access, async () => {
      throw new Error('query failed');
    })).rejects.toThrow('query failed');
    expect(client.queries.at(-1).text).toBe('ROLLBACK');
    expect(client.queries.some((query) => query.text === 'COMMIT')).toBe(false);
  });
});
