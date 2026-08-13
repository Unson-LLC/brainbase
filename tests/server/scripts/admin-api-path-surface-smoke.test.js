import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const servers = [];
const temporaryDirectories = [];

function noCacheHeaders() {
    return {
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        pragma: 'no-cache',
        expires: '0',
        'content-type': 'application/json'
    };
}

async function startAdminApiFixture({ expectedAccessToken } = {}) {
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push({ url: req.url, method: req.method, headers: req.headers });
        const authenticated = expectedAccessToken
            ? req.headers.authorization === `Bearer ${expectedAccessToken}`
                && req.headers['x-internal-api-key'] === undefined
            : req.headers['x-internal-api-key'] === 'internal-secret'
                && req.headers.authorization === undefined;
        if (req.url === '/api/csrf-token') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ token: 'csrf-token' }));
            return;
        }
        if (!authenticated) {
            res.writeHead(401, noCacheHeaders());
            res.end(JSON.stringify({ message: 'Unauthorized' }));
            return;
        }
        if (req.method === 'POST' && (
            req.headers['x-csrf-token'] !== 'csrf-token'
            || req.headers['x-session-id'] !== 'admin-path-surface-smoke'
        )) {
            res.writeHead(403, noCacheHeaders());
            res.end(JSON.stringify({ message: 'Invalid CSRF token' }));
            return;
        }
        const payload = req.url.startsWith('/api/admin/personal-kg')
            ? { summary: { total: 1 }, source_class: 'fixture' }
            : req.url === '/api/admin/overview' || req.url === '/api/admin/health'
                ? { runtime_config: { database: { connection_status: 'connected', value_redacted: true } }, source_class: 'fixture' }
                : { source_class: 'fixture' };
        res.writeHead(200, noCacheHeaders());
        res.end(JSON.stringify(payload));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('admin API path-surface smoke authentication', () => {
    it('prefers the internal API key and completes when both credentials exist', async () => {
        const fixture = await startAdminApiFixture();
        const { stdout, stderr } = await execFileAsync(
            process.execPath,
            ['scripts/admin-api-path-surface-smoke.mjs', '--base-url', fixture.baseUrl],
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    INTERNAL_API_SECRET: 'internal-secret',
                    BRAINBASE_AUTH_TOKEN: 'access-token'
                }
            }
        );

        expect(stderr).toBe('');
        expect(JSON.parse(stdout)).toMatchObject({
            auth: 'env:INTERNAL_API_SECRET; credential value not recorded'
        });
        const authenticatedRequests = fixture.requests.filter((request) => request.url !== '/api/csrf-token'
            && request.headers['x-internal-api-key']);
        expect(authenticatedRequests.length).toBeGreaterThan(0);
        expect(authenticatedRequests.every((request) => request.headers.authorization === undefined)).toBe(true);
    });

    it('completes with the access token when no internal API key exists', async () => {
        const fixture = await startAdminApiFixture({ expectedAccessToken: 'access-token' });
        const env = { ...process.env, BRAINBASE_AUTH_TOKEN: 'access-token' };
        delete env.INTERNAL_API_SECRET;
        env.HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-smoke-home-'));
        temporaryDirectories.push(env.HOME);

        const { stdout, stderr } = await execFileAsync(
            process.execPath,
            ['scripts/admin-api-path-surface-smoke.mjs', '--base-url', fixture.baseUrl],
            { cwd: process.cwd(), env }
        );

        expect(stderr).toBe('');
        expect(JSON.parse(stdout)).toMatchObject({
            auth: 'env:BRAINBASE_AUTH_TOKEN; credential value not recorded'
        });
        expect(fixture.requests.some((request) => request.headers.authorization === 'Bearer access-token')).toBe(true);
        expect(fixture.requests.every((request) => request.headers['x-internal-api-key'] === undefined)).toBe(true);
    });
});
