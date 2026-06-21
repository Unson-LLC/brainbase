// @ts-check
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerStaticRoutes } from '../../../server/bootstrap/static-routes.js';

describe('static routes', () => {
    let publicDir;

    beforeEach(async () => {
        publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-static-routes-'));
        await fs.writeFile(
            path.join(publicDir, 'admin.html'),
            '<!doctype html><html lang="ja"><body><div data-admin-root></div></body></html>',
            'utf-8'
        );
    });

    afterEach(async () => {
        if (publicDir) {
            await fs.rm(publicDir, { recursive: true, force: true });
        }
    });

    it('serves admin.html without browser storage cache so stale admin modules are not reused', async () => {
        const app = express();
        registerStaticRoutes(app, { publicDir, log: { error: () => {} } });

        const res = await request(app).get('/admin.html').expect(200);

        expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
        expect(res.headers.pragma).toBe('no-cache');
        expect(res.headers.expires).toBe('0');
        expect(res.text).toContain('data-admin-root');
    });
});
