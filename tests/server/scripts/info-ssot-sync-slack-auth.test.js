import { describe, expect, it, vi } from 'vitest';

import { assertOrganizationProjectScope } from '../../../scripts/info-ssot-sync-slack-auth.js';

describe('Slack auth grant project scope', () => {
  it('keeps only normalized project codes owned by the organization', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ code: 'brainbase' }, { code: 'mana' }]
      })
    };

    const projectCodes = await assertOrganizationProjectScope(
      client,
      'unson',
      [' brainbase ', 'mana', 'brainbase']
    );

    expect(projectCodes).toEqual(['brainbase', 'mana']);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('organization_id = $2'),
      [['brainbase', 'mana'], 'unson']
    );
  });

  it('rejects cross-organization and unknown project codes instead of persisting them', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ code: 'brainbase' }] })
    };

    await expect(assertOrganizationProjectScope(
      client,
      'unson',
      ['brainbase', 'techknight', 'unknown-project']
    )).rejects.toThrow(
      'project scope violation for unson: techknight,unknown-project'
    );
  });
});
