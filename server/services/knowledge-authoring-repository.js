export class PgKnowledgeAuthoringRepository {
    constructor({ pool }) {
        if (!pool?.query) throw new TypeError('PgKnowledgeAuthoringRepository requires pool');
        this.pool = pool;
    }

    async _run(access, work) {
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.organization_id', $1, true)", [access.organizationId || access.tenantId]);
            await client.query("SELECT set_config('app.person_id', $1, true)", [access.personId]);
            await client.query("SELECT set_config('app.project_codes', $1, true)", [access.projectCodes.join(',')]);
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release?.();
        }
    }

    async createDraft(draft, { access }) {
        return this._run(access, async (client) => (await client.query(
            `INSERT INTO knowledge_authoring_drafts
             (draft_id, organization_id, owner_person_id, project_code, kind, title, content,
              applicability, source_pointer, revision, status, canonical_owner_person_id, relations)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb) RETURNING *`,
            [draft.draft_id, draft.organization_id, draft.owner_person_id, draft.project_code, draft.kind,
                draft.title, draft.content, JSON.stringify(draft.applicability), JSON.stringify(draft.source_pointer),
                draft.revision, draft.status, draft.canonical_owner_person_id || draft.owner_person_id,
                JSON.stringify(draft.relations || [])]
        )).rows[0]);
    }

    async getDraft(draftId, { access, projectCode }) {
        return this._run(access, async (client) => (await client.query(
            'SELECT * FROM knowledge_authoring_drafts WHERE draft_id = $1 AND project_code = $2', [draftId, projectCode]
        )).rows[0] || null);
    }

    async updateDraft(draftId, patch, { access, projectCode }) {
        return this._run(access, async (client) => (await client.query(
            `UPDATE knowledge_authoring_drafts SET title=$3, content=$4, applicability=$5::jsonb,
                source_pointer=$6::jsonb, canonical_owner_person_id=$7, relations=$8::jsonb,
                revision=revision+1, updated_at=NOW()
             WHERE draft_id=$1 AND project_code=$2 AND revision=$9 AND status='draft' RETURNING *`,
            [draftId, projectCode, patch.title, patch.content, JSON.stringify(patch.applicability || {}),
                JSON.stringify(patch.source_pointer || null), patch.canonical_owner_person_id,
                JSON.stringify(patch.relations || []), patch.expected_revision]
        )).rows[0] || null);
    }

    async transitionDraft(draftId, transition, { access, projectCode }) {
        return this._run(access, async (client) => (await client.query(
            `UPDATE knowledge_authoring_drafts SET status=$3, revision=revision+1, updated_at=NOW()
             WHERE draft_id=$1 AND project_code=$2 AND revision=$4 AND status='draft' RETURNING *`,
            [draftId, projectCode, transition.status, transition.expected_revision]
        )).rows[0] || null);
    }

    async findSave(key, { access, projectCode }) {
        return this._run(access, async (client) => (await client.query(
            'SELECT * FROM knowledge_authoring_saves WHERE idempotency_key=$1 AND project_code=$2', [key, projectCode]
        )).rows[0] || null);
    }

    async findReuse(key, { access, projectCode }) {
        return this._run(access, async (client) => (await client.query(
            'SELECT * FROM knowledge_authoring_reuses WHERE idempotency_key=$1 AND project_code=$2', [key, projectCode]
        )).rows[0] || null);
    }

    async claimSave(draftId, claim, { access, projectCode }) {
        return this._run(access, async (client) => (await client.query(
            `UPDATE knowledge_authoring_drafts
             SET status='saving', save_idempotency_key=$5, save_decision_domain=$6, updated_at=NOW()
             WHERE draft_id=$1 AND project_code=$2 AND revision=$3
               AND (status='draft' OR (status='saving' AND save_idempotency_key=$5 AND save_decision_domain=$6))
               AND owner_person_id=$4
             RETURNING *`,
            [draftId, projectCode, claim.expected_revision, access.personId, claim.idempotency_key, claim.decision_domain]
        )).rows[0] || null);
    }

    async completeSave(save, { access, projectCode }) {
        return this._run(access, async (client) => {
            const draft = await client.query(
                `UPDATE knowledge_authoring_drafts SET status='saved', canonical_id=$3, saved_event_id=$4, updated_at=NOW()
                 WHERE draft_id=$1 AND project_code=$2 AND revision=$5 AND status='saving'
                   AND save_idempotency_key=$6 RETURNING *`,
                [save.draft_id, projectCode, save.canonical_id, save.event_id, save.draft_revision, save.idempotency_key]
            );
            if (!draft.rows[0]) {
                const completed = await client.query(
                    `SELECT result FROM knowledge_authoring_saves
                     WHERE organization_id=$1 AND owner_person_id=$2 AND project_code=$3
                       AND idempotency_key=$4 AND draft_id=$5 AND draft_revision=$6`,
                    [access.organizationId || access.tenantId, access.personId, projectCode,
                        save.idempotency_key, save.draft_id, save.draft_revision]
                );
                if (completed.rows[0]) return null;
                throw Object.assign(new Error('knowledge_draft_revision_conflict'), { code: 'knowledge_draft_revision_conflict' });
            }
            await client.query(
                `INSERT INTO knowledge_authoring_saves
                 (idempotency_key, draft_id, draft_revision, organization_id, project_code, canonical_id, event_id, result, owner_person_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
                 ON CONFLICT (organization_id, owner_person_id, project_code, idempotency_key) DO NOTHING`,
                [save.idempotency_key, save.draft_id, save.draft_revision, access.organizationId || access.tenantId,
                    projectCode, save.canonical_id, save.event_id, JSON.stringify(save.result), access.personId]
            );
            return draft.rows[0];
        });
    }

    async completeReuse(reuse, { access, projectCode }) {
        return this._run(access, async (client) => (await client.query(
            `INSERT INTO knowledge_authoring_reuses
             (reuse_id, idempotency_key, draft_id, draft_revision, organization_id, owner_person_id,
              project_code, canonical_id, expected_version, result)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
             ON CONFLICT (organization_id, owner_person_id, project_code, idempotency_key)
             DO NOTHING RETURNING *`,
            [reuse.reuse_id, reuse.idempotency_key, reuse.draft_id, reuse.draft_revision,
                access.organizationId || access.tenantId, access.personId, projectCode,
                reuse.canonical_id, reuse.expected_version, JSON.stringify(reuse.result)]
        )).rows[0] || null);
    }
}
