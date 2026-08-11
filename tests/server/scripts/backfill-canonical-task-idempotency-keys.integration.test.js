import http from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    backfillCanonicalTaskIdempotencyKeys,
    parseIdempotencyKeyBackfillArgs
} from '../../../scripts/backfill-canonical-task-idempotency-keys.js';

describe('Canonical Task idempotency key backfill (real HTTP integration)', () => {
    const rows = [
        { Id: 1, 'タイトル': 't1', '冪等キー': 'existing-key' },
        { Id: 2, 'タイトル': 't2' },
        { Id: 3, 'タイトル': 't3' }
    ];
    let patchCount = 0;
    let server;
    let baseUrl;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.method === 'GET') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ list: rows, pageInfo: { totalRows: rows.length, isLastPage: true } }));
                return;
            }
            if (req.method === 'PATCH') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    patchCount += 1;
                    const parsed = JSON.parse(body);
                    const target = rows.find(row => String(row.Id) === String(parsed.Id));
                    Object.assign(target, parsed);
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify(target));
                });
                return;
            }
            res.statusCode = 405;
            res.end();
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
    });

    it('dry-run reads over real HTTP and issues no PATCH', async () => {
        const args = parseIdempotencyKeyBackfillArgs(['--dry-run']);
        const result = await backfillCanonicalTaskIdempotencyKeys({
            ...args,
            baseUrl,
            apiToken: 'integration-test-token',
            tableId: 'integration-table'
        });

        expect(result).toMatchObject({ mode: 'dry-run', total: 3, existing: 1, missing: 2, updated: 0 });
        expect(patchCount).toBe(0);
        expect(rows.filter(row => !row['冪等キー'])).toHaveLength(2);
    });

    it('apply backfills over real HTTP, keeps existing keys, and verifies zero remaining', async () => {
        const args = parseIdempotencyKeyBackfillArgs(['--apply']);
        const result = await backfillCanonicalTaskIdempotencyKeys({
            ...args,
            baseUrl,
            apiToken: 'integration-test-token',
            tableId: 'integration-table'
        });

        expect(result).toMatchObject({ mode: 'apply', updated: 2, verified_missing: 0 });
        expect(patchCount).toBe(2);
        expect(rows.find(row => row.Id === 2)['冪等キー']).toBe('legacy:nocodb:2');
        expect(rows.find(row => row.Id === 3)['冪等キー']).toBe('legacy:nocodb:3');
        expect(rows.find(row => row.Id === 1)['冪等キー']).toBe('existing-key');
        expect(rows.filter(row => !row['冪等キー'])).toHaveLength(0);
    });
});
