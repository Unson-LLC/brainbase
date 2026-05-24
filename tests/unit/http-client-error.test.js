import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../../public/modules/core/http-client.js';

describe('HttpClient error payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves structured error payload fields such as hibernation blockers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({
        error: 'Session is not eligible for hibernation',
        blockers: ['active_turn', 'pending_input']
      })
    })));

    const client = new HttpClient();

    await expect(client.get('/api/sessions/session-alpha/hibernate/eligibility')).rejects.toMatchObject({
      message: 'Session is not eligible for hibernation',
      status: 409,
      blockers: ['active_turn', 'pending_input']
    });
  });
});
