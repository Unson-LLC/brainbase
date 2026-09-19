import { describe, expect, it, vi } from 'vitest';

import { PgKnowledgeAuthoringRepository } from '../../server/services/knowledge-authoring-repository.js';

const access = { organizationId: 'org_1', personId: 'per_1', projectCodes: ['alpha'] };

function fixture(respond) {
    const client = {
        query: vi.fn(async (sql, params) => respond(String(sql), params)),
        release: vi.fn()
    };
    const pool = { query: vi.fn(), connect: async () => client };
    return { client, repository: new PgKnowledgeAuthoringRepository({ pool }) };
}

describe('PgKnowledgeAuthoringRepository', () => {
    it('draftのcanonical ownerとrelationsを同じrecordへ保存する', async () => {
        const { client, repository } = fixture(async (sql) => {
            if (sql.includes('INSERT INTO knowledge_authoring_drafts')) {
                return { rows: [{ draft_id: 'kd_1', canonical_owner_person_id: 'per_2', relations: [] }] };
            }
            return { rows: [] };
        });

        await repository.createDraft({
            draft_id: 'kd_1', organization_id: 'org_1', owner_person_id: 'per_1',
            canonical_owner_person_id: 'per_2', project_code: 'alpha', kind: 'decision',
            title: 'Decision', summary: 'Short summary', content: 'body', applicability: {}, source_pointer: null,
            revision: 1, status: 'draft', relations: [{ relation: 'references', to_id: 'dec_old' }]
        }, { access });

        const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO knowledge_authoring_drafts'));
        expect(insert[0]).toContain('title, summary, content');
        expect(insert[1].slice(-2)).toEqual(['per_2', JSON.stringify([{ relation: 'references', to_id: 'dec_old' }])]);
    });

    it('canonical reuse receiptは既存正本IDと版を別テーブルへ保存する', async () => {
        const { client, repository } = fixture(async (sql) => {
            if (sql.includes('INSERT INTO knowledge_authoring_reuses')) return { rows: [{ reuse_id: 'reuse_1' }] };
            return { rows: [] };
        });

        await repository.completeReuse({
            reuse_id: 'reuse_1', idempotency_key: 'reuse-key', draft_id: 'kd_1', draft_revision: 2,
            canonical_id: 'decision_existing', expected_version: '7', result: { status: 'reused' }
        }, { access, projectCode: 'alpha' });

        const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO knowledge_authoring_reuses'));
        expect(insert[0]).toContain('canonical_id, expected_version, result');
        expect(insert[1]).toEqual([
            'reuse_1', 'reuse-key', 'kd_1', 2, 'org_1', 'per_1', 'alpha',
            'decision_existing', '7', JSON.stringify({ status: 'reused' })
        ]);
    });

    it('revisionとkeyを同じUPDATEでclaimし、編集との競合窓を作らない', async () => {
        const { client, repository } = fixture(async (sql) => ({
            rows: sql.includes("SET status='saving'")
                ? [{ draft_id: 'kd_1', revision: 3, status: 'saving', save_idempotency_key: 'save-1' }]
                : []
        }));

        await expect(repository.claimSave('kd_1', {
            expected_revision: 3, idempotency_key: 'save-1', decision_domain: 'engineering'
        }, { access, projectCode: 'alpha' })).resolves.toMatchObject({ status: 'saving' });

        const claim = client.query.mock.calls.find(([sql]) => String(sql).includes("SET status='saving'"));
        expect(claim[0]).toContain("status='draft' OR (status='saving' AND save_idempotency_key=$5 AND save_decision_domain=$6)");
        expect(claim[1]).toEqual(['kd_1', 'alpha', 3, 'per_1', 'save-1', 'engineering']);
    });

    it('receiptはowner/projectスコープ付きkeyで確定し、claim済みdraftだけsavedにする', async () => {
        const { client, repository } = fixture(async (sql) => {
            if (sql.includes("SET status='saved'")) return { rows: [{ draft_id: 'kd_1', status: 'saved' }] };
            return { rows: [] };
        });

        await repository.completeSave({
            idempotency_key: 'save-1', draft_id: 'kd_1', draft_revision: 3,
            canonical_id: 'decision_1', event_id: 'event_1', result: { status: 'saved' }
        }, { access, projectCode: 'alpha' });

        const update = client.query.mock.calls.find(([sql]) => String(sql).includes("SET status='saved'"));
        expect(update[0]).toContain("status='saving'");
        expect(update[0]).toContain('save_idempotency_key=$6');
        const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO knowledge_authoring_saves'));
        expect(insert[0]).toContain('ON CONFLICT (organization_id, owner_person_id, project_code, idempotency_key)');
        expect(insert[1].at(-1)).toBe('per_1');
    });
});
