import { describe, expect, it } from 'vitest';
import { validateOwnershipSurvey, OWNERSHIP_SURVEY_WAVES } from '../src/ownership-survey.js';

describe('ownership survey', () => {
    const contract = {
        version: 1,
        components: [
            { id: 'pending-move', lifecycle: 'migration_pending', current_paths: ['server/pending.js'] },
            { id: 'already-moved', lifecycle: 'canonical' }
        ]
    };
    const entry = { id: 'pending-move', wave: '4b', duplicate: 'same', production_use: 'used', disposition: 'switch_and_delete', files: [{ path: 'server/pending.js' }] };

    it('accepts a survey that assigns every pending move a wave, duplication, and production use', () => {
        expect(validateOwnershipSurvey(contract, { version: 1, components: [entry] })).toEqual([]);
    });

    it('reports a pending move that has no survey entry, so a new move cannot skip wave assignment', () => {
        expect(validateOwnershipSurvey(contract, { version: 1, components: [] })).toEqual([
            '移設待ちの項目に調査結果（段・重複・本番での利用）がありません: pending-move'
        ]);
    });

    it('rejects values outside the survey vocabulary instead of accepting free text', () => {
        const errors = validateOwnershipSurvey(contract, {
            version: 1,
            components: [{ ...entry, wave: '6', duplicate: 'maybe', production_use: 'probably', disposition: 'later' }]
        });
        expect(errors).toEqual([
            'pending-move の調査結果の disposition が不正です: later',
            'pending-move の調査結果の duplicate が不正です: maybe',
            'pending-move の調査結果の production_use が不正です: probably',
            'pending-move の調査結果の wave が不正です: 6'
        ]);
    });

    it('rejects canonical and unknown survey entries but permits retired entries', () => {
        const withRetired = { ...contract, components: [...contract.components, { id: 'retired', lifecycle: 'retired' }] };
        expect(validateOwnershipSurvey(withRetired, { version: 1, components: [entry, { ...entry, id: 'retired' }] })).toEqual([]);
        expect(validateOwnershipSurvey(contract, { version: 1, components: [entry, { ...entry, id: 'already-moved' }, { ...entry, id: 'unknown' }] })).toEqual([
            '調査結果の項目は台帳の移設待ちか退役である必要があります: already-moved',
            '調査結果の項目は台帳の移設待ちか退役である必要があります: unknown'
        ]);
    });

    it('rejects stale and missing paths even when the file counts match', () => {
        expect(validateOwnershipSurvey(contract, { version: 1, components: [{ ...entry, files: [{ path: 'server/old.js' }] }] })).toEqual([
            'pending-move の調査結果に台帳にないパスがあります: server/old.js',
            'pending-move の調査結果に台帳のパスがありません: server/pending.js'
        ]);
    });

    it('requires retained sources and external package paths alongside current paths', () => {
        const pending = { id: entry.id, lifecycle: 'migration_pending', current_paths: ['@unson/org/schema.sql'], retained_source_paths: ['server/host.js'] };
        const files = [{ path: 'server/host.js' }, { path: '@unson/org/schema.sql' }];
        expect(validateOwnershipSurvey({ components: [pending] }, { version: 1, components: [{ ...entry, files }] })).toEqual([]);
        expect(validateOwnershipSurvey({ components: [pending] }, { version: 1, components: [{ ...entry, files: files.slice(1) }] })).toContain(
            'pending-move の調査結果に台帳のパスがありません: server/host.js'
        );
    });

    it('requires an explicit files array and rejects repeated paths', () => {
        expect(validateOwnershipSurvey(contract, { version: 1, components: [{ ...entry, files: undefined }] })).toContain('pending-move の調査結果に files 配列がありません');
        expect(validateOwnershipSurvey(contract, { version: 1, components: [{ ...entry, files: [...entry.files, ...entry.files] }] })).toContain('pending-move の調査結果のパスが重複しています: server/pending.js');
    });

    it('accepts deleted local copies awaiting readback without closing the ledger', () => {
        const pending = { id: entry.id, lifecycle: 'migration_pending', current_paths: [], retired_source_paths: ['server/old.js'] };
        expect(validateOwnershipSurvey({ components: [pending] }, { version: 1, components: [{ ...entry, files: [], disposition: 'readback_and_close' }] })).toEqual([]);
        expect(validateOwnershipSurvey({ components: [pending] }, { version: 1, components: [{ ...entry, files: [{ path: 'server/old.js' }] }] })).toContain('pending-move の調査結果に台帳にないパスがあります: server/old.js');
    });

    it('accepts every wave of the move plan', () => {
        expect(OWNERSHIP_SURVEY_WAVES).toEqual(['1', '2', '3a', '3b', '3c', '3d', '4a', '4b', '4c', '4d', '4e', '5']);
    });
});

it('keeps diagnostics in a fixed order regardless of ledger or survey ordering', () => {
    const components = ['z', 'a'].map(id => ({ id, lifecycle: 'migration_pending', current_paths: ['z.js', 'a.js'] }));
    const entries = components.map(({ id }) => ({ id, wave: '1', duplicate: 'none', production_use: 'used', disposition: 'move', files: [{ path: 'old-z.js' }, { path: 'old-a.js' }] }));
    const first = validateOwnershipSurvey({ components }, { version: 1, components: entries });
    const reversed = validateOwnershipSurvey({ components: [...components].reverse() }, { version: 1, components: [...entries].reverse().map(e => ({ ...e, files: [...e.files].reverse() })) });
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(reversed);
    expect(first).toEqual([...first].sort());
});

it('exposes the validator through the built package subpath', async () => {
    const published = await import('@unson/brainbase-mcp/ownership-survey');
    expect(published.validateOwnershipSurvey({ components: [] }, { version: 1, components: [] })).toEqual([]);
    expect(published.OWNERSHIP_SURVEY_WAVES).toEqual(OWNERSHIP_SURVEY_WAVES);
});
