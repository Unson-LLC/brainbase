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
    it('revisionとkeyを同じUPDATEでclaimし、編集との競合窓を作らない', async () => {
        const { client, repository } = fixture(async (sql) => ({
            rows: sql.includes("SET status='saving'")
                ? [{ draft_id: 'kd_1', revision: 3, status: 'saving', save_idempotency_key: 'save-1' }]
                : []
        }));

        await expect(repository.claimSave('kd_1', {
            expected_revision: 3, idempotency_key: 'save-1'
        }, { access, projectCode: 'alpha' })).resolves.toMatchObject({ status: 'saving' });

        const claim = client.query.mock.calls.find(([sql]) => String(sql).includes("SET status='saving'"));
        expect(claim[0]).toContain("status='draft' OR (status='saving' AND save_idempotency_key=$5)");
        expect(claim[1]).toEqual(['kd_1', 'alpha', 3, 'per_1', 'save-1']);
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
