import { describe, expect, it, vi } from 'vitest';

import {
    backfillCanonicalTaskIdempotencyKeys,
    buildLegacyIdempotencyKey,
    parseIdempotencyKeyBackfillArgs,
    planIdempotencyKeyBackfill
} from '../../../scripts/backfill-canonical-task-idempotency-keys.js';

function fakeStore(initialRecords) {
    const records = initialRecords.map(record => ({ ...record }));
    const fetchImpl = vi.fn(async (url, options = {}) => {
        if (!options.method || options.method === 'GET') {
            const parsed = new URL(url);
            const limit = Number(parsed.searchParams.get('limit'));
            const offset = Number(parsed.searchParams.get('offset'));
            const page = records.slice(offset, offset + limit);
            return {
                ok: true,
                json: async () => ({
                    list: page,
                    pageInfo: { totalRows: records.length, isLastPage: offset + page.length >= records.length }
                })
            };
        }
        const body = JSON.parse(options.body);
        const target = records.find(record => String(record.Id) === String(body.Id));
        if (!target) return { ok: false, status: 404 };
        Object.assign(target, body);
        return { ok: true, json: async () => target };
    });
    return { records, fetchImpl };
}

describe('Canonical Task idempotency key backfill', () => {
    it('requires exactly one of --dry-run or --apply', () => {
        expect(() => parseIdempotencyKeyBackfillArgs([])).toThrow('exactly one');
        expect(() => parseIdempotencyKeyBackfillArgs(['--dry-run', '--apply'])).toThrow('exactly one');
        expect(parseIdempotencyKeyBackfillArgs(['--apply'])).toEqual({ apply: true });
        expect(parseIdempotencyKeyBackfillArgs(['--dry-run'])).toEqual({ apply: false });
    });

    it('builds deterministic legacy keys from the NocoDB record ID', () => {
        expect(buildLegacyIdempotencyKey('42')).toBe('legacy:nocodb:42');
        expect(buildLegacyIdempotencyKey(42)).toBe('legacy:nocodb:42');
    });

    it('plans keys only for rows without an idempotency key', () => {
        const summary = planIdempotencyKeyBackfill([
            { Id: 1, '冪等キー': 'existing-key' },
            { Id: 2, '冪等キー': '' },
            { Id: 3 },
            { fields: { Id: 4, '冪等キー': null } }
        ]);
        expect(summary).toMatchObject({ total: 4, existing: 1, missing: 3 });
        expect(summary.plan).toEqual([
            { record_id: '2', idempotency_key: 'legacy:nocodb:2' },
            { record_id: '3', idempotency_key: 'legacy:nocodb:3' },
            { record_id: '4', idempotency_key: 'legacy:nocodb:4' }
        ]);
        expect(summary.conflicts).toEqual([]);
    });

    it('rejects rows without a record ID and duplicate record IDs', () => {
        expect(() => planIdempotencyKeyBackfill([{ '冪等キー': 'k' }])).toThrow('without a record ID');
        expect(() => planIdempotencyKeyBackfill([{ Id: 1 }, { Id: 1 }])).toThrow('duplicate record IDs');
    });

    it('reports a conflict when the planned key is already used by another row', () => {
        const summary = planIdempotencyKeyBackfill([
            { Id: 1, '冪等キー': 'legacy:nocodb:2' },
            { Id: 2 }
        ]);
        expect(summary.plan).toEqual([]);
        expect(summary.conflicts).toEqual([
            { record_id: '2', idempotency_key: 'legacy:nocodb:2' }
        ]);
    });

    it('dry-run reports counts without writing to NocoDB', async () => {
        const { records, fetchImpl } = fakeStore([
            { Id: 1, '冪等キー': 'existing-key' },
            { Id: 2 }
        ]);

        const result = await backfillCanonicalTaskIdempotencyKeys({
            apply: false,
            fetchImpl,
            baseUrl: 'https://noco.example',
            apiToken: 'secret',
            tableId: 'table-1'
        });

        expect(result).toMatchObject({ mode: 'dry-run', total: 2, existing: 1, missing: 1, updated: 0 });
        expect(records.find(record => record.Id === 2)['冪等キー']).toBeUndefined();
        expect(fetchImpl).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'PATCH' }));
    });

    it('apply backfills missing keys and verifies zero remaining rows', async () => {
        const { records, fetchImpl } = fakeStore([
            { Id: 1, '冪等キー': 'existing-key' },
            { Id: 2 },
            { Id: 3 }
        ]);

        const result = await backfillCanonicalTaskIdempotencyKeys({
            apply: true,
            fetchImpl,
            baseUrl: 'https://noco.example',
            apiToken: 'secret',
            tableId: 'table-1'
        });

        expect(result).toMatchObject({ mode: 'apply', total: 3, existing: 1, missing: 2, updated: 2, verified_missing: 0 });
        expect(records.find(record => record.Id === 2)['冪等キー']).toBe('legacy:nocodb:2');
        expect(records.find(record => record.Id === 3)['冪等キー']).toBe('legacy:nocodb:3');
    });

    it('apply refuses to write when a planned key conflicts with an existing key', async () => {
        const { records, fetchImpl } = fakeStore([
            { Id: 1, '冪等キー': 'legacy:nocodb:2' },
            { Id: 2 }
        ]);

        await expect(backfillCanonicalTaskIdempotencyKeys({
            apply: true,
            fetchImpl,
            baseUrl: 'https://noco.example',
            apiToken: 'secret',
            tableId: 'table-1'
        })).rejects.toThrow('idempotency key conflicts: 1');
        expect(records.find(record => record.Id === 2)['冪等キー']).toBeUndefined();
    });

    it('paginates across multiple pages before planning', async () => {
        const many = Array.from({ length: 5 }, (_, index) => ({ Id: index + 1 }));
        const { fetchImpl } = fakeStore(many);

        const result = await backfillCanonicalTaskIdempotencyKeys({
            apply: false,
            fetchImpl,
            baseUrl: 'https://noco.example',
            apiToken: 'secret',
            tableId: 'table-1',
            pageSize: 2
        });

        expect(result).toMatchObject({ total: 5, existing: 0, missing: 5 });
    });
});
