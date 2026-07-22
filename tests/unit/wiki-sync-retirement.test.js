import { describe, expect, it } from 'vitest';

import { push } from '../../cli/sync.js';

describe('Wiki CLI retirement boundary', () => {
    it('refuses push before reading auth or contacting the server', async () => {
        await expect(push()).rejects.toThrow('Wiki writes are retired');
    });
});
