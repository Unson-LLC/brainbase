import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createWikiRouter, WIKI_RETIREMENT } from '../../../server/routes/wiki.js';

function createApp(wikiService) {
    const app = express();
    app.use(express.json());
    app.use('/api/wiki', createWikiRouter(wikiService));
    return app;
}

describe('Wiki retirement boundary', () => {
    it.each([
        ['post', '/api/wiki/page'],
        ['delete', '/api/wiki/page?path=legacy/page'],
        ['put', '/api/wiki/page/access'],
        ['post', '/api/wiki/sync/push']
    ])('%s %s refuses writes without calling the Wiki service', async (method, url) => {
        const wikiService = {
            savePage: vi.fn(),
            deletePage: vi.fn(),
            setPageAccess: vi.fn(),
            bulkSavePages: vi.fn()
        };
        const response = await request(createApp(wikiService))[method](url).send({});

        expect(response.status).toBe(410);
        expect(response.body).toEqual(WIKI_RETIREMENT);
        expect(wikiService.savePage).not.toHaveBeenCalled();
        expect(wikiService.deletePage).not.toHaveBeenCalled();
        expect(wikiService.setPageAccess).not.toHaveBeenCalled();
        expect(wikiService.bulkSavePages).not.toHaveBeenCalled();
    });

    it('keeps manifest reads available for migration export', async () => {
        const wikiService = { getManifest: vi.fn(async () => [{ path: 'legacy/page' }]) };
        const response = await request(createApp(wikiService)).get('/api/wiki/sync/manifest');

        expect(response.status).toBe(200);
        expect(response.body).toEqual([{ path: 'legacy/page' }]);
    });
});
