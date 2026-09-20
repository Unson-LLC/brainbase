import { afterEach, describe, expect, it, vi } from 'vitest';

import { pull, push, sync, wikiStatus } from '../../cli/sync.js';

vi.mock('../../cli/config.js', () => ({
    getConfig: () => { throw new Error('Unexpected config access'); },
    getAuth: () => { throw new Error('Unexpected auth access'); },
    getSyncState: () => { throw new Error('Unexpected sync state access'); },
    saveSyncState: () => { throw new Error('Unexpected sync state write'); }
}));

describe('Wiki CLI retirement boundary', () => {
    afterEach(() => vi.unstubAllGlobals());

    it.each([['sync', sync], ['pull', pull], ['push', push], ['status', wikiStatus]])('%s refuses before reading config/auth or contacting the server', async (_name, operation) => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        await expect(operation()).rejects.toThrow('Wiki is retired');
        expect(fetch).not.toHaveBeenCalled();
    });
});
