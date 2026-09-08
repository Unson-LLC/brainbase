import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { JudgmentReceiptPostgresRepository } from '../../../server/services/judgment-receipt/judgment-receipt-postgres-repository.js';

const receipt = {
    resolution_id: 'jr_01',
    turn_id: 'turn_01',
    project_code: 'brainbase',
    status: 'resolved'
};
const actor = {
    personId: 'person_owner', role: 'member', projectCodes: ['brainbase'],
    clearance: ['internal'], organizationId: 'org_unson'
};

function scopedRepository({ rows = [receipt] } = {}) {
    const client = { query: vi.fn().mockResolvedValue({ rows }) };
    const infoSSOTService = { withAccessContext: vi.fn((_access, handler) => handler(client)) };
    return {
        client,
        infoSSOTService,
        repository: new JudgmentReceiptPostgresRepository({ pool: { query: vi.fn() }, infoSSOTService })
    };
}

describe('JudgmentReceiptPostgresRepository', () => {
    it('RLS access context内で本人所有のraw receiptだけを記録・読戻しする', async () => {
        const { repository, client, infoSSOTService } = scopedRepository();

        await repository.record(receipt, actor);
        await repository.findByResolutionId('jr_01', actor);

        expect(infoSSOTService.withAccessContext).toHaveBeenCalledWith({
            role: 'member', projectCodes: ['brainbase'], clearance: ['internal'], organizationId: 'org_unson'
        }, expect.any(Function), { requireCanonicalTenant: true });
        expect(client.query).toHaveBeenCalledWith('SELECT set_config($1, $2, true)', [
            'app.judgment_receipt_owner_id', 'person_owner'
        ]);
        expect(client.query.mock.calls.some(([text]) => text.includes('INSERT INTO judgment_receipts'))).toBe(true);
        expect(client.query.mock.calls.some(([text]) => text.includes('owner_person_id = $4'))).toBe(true);
    });

    it.each([
        ['tenant矛盾', { ...actor, tenantId: 'org_other' }],
        ['本人不在', { ...actor, personId: '' }],
        ['scope外project', { ...actor, projectCodes: ['salestailor'] }]
    ])('%sならRLS contextを開始せず拒否する', async (_label, invalidActor) => {
        const { repository, infoSSOTService } = scopedRepository();
        await expect(repository.record(receipt, invalidActor)).rejects.toMatchObject({ status: 403 });
        expect(infoSSOTService.withAccessContext).not.toHaveBeenCalled();
    });

    it('同じresolution_idの再記録を上書き成功へ変換しない', async () => {
        const { repository, client } = scopedRepository({ rows: [] });
        await expect(repository.record(receipt, actor)).rejects.toMatchObject({
            code: 'judgment_receipt_immutable_conflict', status: 409
        });
        const insert = client.query.mock.calls.find(([text]) => text.includes('INSERT INTO judgment_receipts'))[0];
        expect(insert).toContain('ON CONFLICT (organization_id, project_code, owner_person_id, resolution_id) DO NOTHING');
        expect(insert).not.toContain('UPDATE');
    });

    it('同一組織・本人で複数project候補なら先頭を選ばず409で拒否する', async () => {
        const { repository } = scopedRepository({ rows: [{ ...receipt, project_code: 'brainbase' }, { ...receipt, project_code: 'salestailor' }] });
        await expect(repository.findByResolutionId('jr_01', { ...actor, projectCodes: ['brainbase', 'salestailor'] }))
            .rejects.toMatchObject({ code: 'judgment_receipt_ambiguous', status: 409 });
    });

    it('raw pool.queryを使わずscoped InfoSSOT contextなしの構築を拒否する', () => {
        expect(() => new JudgmentReceiptPostgresRepository({ pool: { query: vi.fn() } }))
            .toThrow('requires scoped InfoSSOT access context');
    });

    it.each([undefined, NaN, Infinity, new Date(), 1n, () => true, new Array(1)])(
        'JSONでない値を変換して元記録と偽らない: %s', async (unsupported) => {
            const { repository, infoSSOTService } = scopedRepository();
            await expect(repository.record({ ...receipt, extra: unsupported }, actor))
                .rejects.toMatchObject({ code: 'judgment_receipt_input_invalid', status: 400 });
            expect(infoSSOTService.withAccessContext).not.toHaveBeenCalled();
        }
    );

    it('standalone schemaはtenant/project/owner RLSと不変triggerを持つ', () => {
        const sql = readFileSync(resolve(process.cwd(), 'server/sql/judgment-receipt-schema.sql'), 'utf8');
        expect(sql).toContain('FORCE ROW LEVEL SECURITY');
        expect(sql).toContain("current_setting('app.judgment_receipt_owner_id', true)");
        expect(sql).toContain('project.organization_id = judgment_receipts.organization_id');
        expect(sql).toContain('judgment_receipts_immutable');
        expect(sql).toContain('BEFORE UPDATE OR DELETE');
    });
});
