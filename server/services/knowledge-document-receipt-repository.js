function requireAccess(access) {
    const organizationId = access?.organizationId || access?.tenantId;
    if (!organizationId || !access?.personId
        || !Array.isArray(access?.projectCodes) || access.projectCodes.length === 0) {
        const error = new Error('document receipt access context is required');
        error.code = 'knowledge_document_receipt_access_required';
        error.status = 403;
        throw error;
    }
    return { organizationId, personId: access.personId };
}

function queryable(repository, options = {}) {
    return options.client || repository.pool;
}

/**
 * Durable receipts for remote canonical document writes and authoring saves.
 * This is intentionally separate from knowledge_authoring_saves: document
 * writes do not create knowledge_events and must not be made to satisfy an
 * event foreign key merely to obtain idempotency.
 */
export class PgKnowledgeDocumentReceiptRepository {
    constructor({ pool }) {
        if (!pool?.query) throw new TypeError('PgKnowledgeDocumentReceiptRepository requires pool');
        this.pool = pool;
    }

    async _run(access, work) {
        const principal = requireAccess(access);
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.organization_id', $1, true)", [principal.organizationId]);
            await client.query("SELECT set_config('app.person_id', $1, true)", [principal.personId]);
            await client.query("SELECT set_config('app.project_codes', $1, true)", [access.projectCodes.join(',')]);
            const result = await work(client, principal);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release?.();
        }
    }

    async find(request = {}) {
        const projectCode = request.project_code;
        const idempotencyKey = request.idempotency_key;
        return this._run(request.access, async (client, principal) => {
            const result = await client.query(
                `SELECT * FROM knowledge_document_write_receipts
                 WHERE organization_id=$1 AND owner_person_id=$2 AND project_code=$3
                   AND idempotency_key=$4`,
                [principal.organizationId, principal.personId, projectCode, idempotencyKey]
            );
            return result.rows?.[0] || null;
        });
    }

    async put(request = {}) {
        const result = request.result || {};
        return this._run(request.access, async (client, principal) => {
            const inserted = await client.query(
                `INSERT INTO knowledge_document_write_receipts
                 (organization_id, owner_person_id, project_code, idempotency_key,
                  request_fingerprint, path, content_hash, base_hash, base_revision,
                  revision, canonical_url, result)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
                 ON CONFLICT (organization_id, owner_person_id, project_code, idempotency_key)
                 DO NOTHING RETURNING *`,
                [principal.organizationId, principal.personId, request.project_code,
                    request.idempotency_key, request.request_fingerprint, request.path,
                    request.content_hash, request.base_hash, request.base_revision,
                    result.revision, result.canonical_url || null, JSON.stringify(result)]
            );
            if (inserted.rows?.[0]) return inserted.rows[0];
            return this._findWriteReceipt(client, principal, request);
        });
    }

    async _findWriteReceipt(client, principal, request) {
        const result = await client.query(
            `SELECT * FROM knowledge_document_write_receipts
             WHERE organization_id=$1 AND owner_person_id=$2 AND project_code=$3
               AND idempotency_key=$4`,
            [principal.organizationId, principal.personId, request.project_code, request.idempotency_key]
        );
        return result.rows?.[0] || null;
    }

    async findAuthoringSave({ access, projectCode, idempotencyKey }) {
        return this._run(access, async (client, principal) => {
            const result = await client.query(
                `SELECT * FROM knowledge_document_authoring_saves
                 WHERE organization_id=$1 AND owner_person_id=$2 AND project_code=$3
                   AND idempotency_key=$4`,
                [principal.organizationId, principal.personId, projectCode, idempotencyKey]
            );
            return result.rows?.[0] || null;
        });
    }

    async completeAuthoringSave(save = {}, { access, projectCode }) {
        return this._run(access, async (client, principal) => {
            const draft = await client.query(
                `UPDATE knowledge_authoring_drafts
                 SET status='saved', updated_at=NOW()
                 WHERE draft_id=$1 AND project_code=$2 AND revision=$3 AND status='saving'
                   AND save_idempotency_key=$4 RETURNING *`,
                [save.draft_id, projectCode, save.draft_revision, save.idempotency_key]
            );
            if (!draft.rows?.[0]) {
                const existing = await client.query(
                    `SELECT result FROM knowledge_document_authoring_saves
                     WHERE organization_id=$1 AND owner_person_id=$2 AND project_code=$3
                       AND idempotency_key=$4 AND draft_id=$5 AND draft_revision=$6`,
                    [principal.organizationId, principal.personId, projectCode,
                        save.idempotency_key, save.draft_id, save.draft_revision]
                );
                if (existing.rows?.[0]) return null;
                const error = new Error('knowledge_draft_revision_conflict');
                error.code = 'knowledge_draft_revision_conflict';
                error.status = 409;
                throw error;
            }
            await client.query(
                `INSERT INTO knowledge_document_authoring_saves
                 (organization_id, owner_person_id, project_code, idempotency_key,
                  draft_id, draft_revision, result)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
                 ON CONFLICT (organization_id, owner_person_id, project_code, idempotency_key)
                 DO NOTHING`,
                [principal.organizationId, principal.personId, projectCode,
                    save.idempotency_key, save.draft_id, save.draft_revision, JSON.stringify(save.result)]
            );
            return draft.rows[0];
        });
    }
}

export const knowledgeDocumentReceiptInternals = { requireAccess, queryable };
