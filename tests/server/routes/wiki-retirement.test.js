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
        ['get', '/api/wiki/pages'],
        ['get', '/api/wiki/page?path=legacy/page'],
        ['post', '/api/wiki/page'],
        ['delete', '/api/wiki/page?path=legacy/page'],
        ['put', '/api/wiki/page/access'],
        ['get', '/api/wiki/sync/manifest'],
        ['post', '/api/wiki/sync/pull'],
        ['post', '/api/wiki/sync/push']
    ])('%s %s refuses without calling the Wiki service', async (method, url) => {
        const wikiService = {
            listPages: vi.fn(),
            getPage: vi.fn(),
            getManifest: vi.fn(),
            bulkGetPages: vi.fn(),
            savePage: vi.fn(),
            deletePage: vi.fn(),
            setPageAccess: vi.fn(),
            bulkSavePages: vi.fn()
        };
        const response = await request(createApp(wikiService))[method](url).send({});

        expect(response.status).toBe(410);
        expect(response.body).toEqual(WIKI_RETIREMENT);
        for (const methodName of Object.keys(wikiService)) {
            expect(wikiService[methodName]).not.toHaveBeenCalled();
        }
    });
});
