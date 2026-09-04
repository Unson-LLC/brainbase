function requireAccess(access) {
    if (!access?.personId || !access?.organizationId) throw new Error('personal_knowledge_identity_required');
}

async function setAccessContext(client, access) {
    requireAccess(access);
    const settings = [
        ['app.person_id', access.personId],
        ['app.actor_person_id', access.actorPersonId || access.personId],
        ['app.organization_id', access.organizationId],
        ['app.project_codes', (access.projectCodes || []).join(',')],
        ['app.role', access.role || 'member'],
        ['app.clearance', (access.clearance || ['internal']).join(',')]
    ];
    for (const setting of settings) await client.query('SELECT set_config($1, $2, true)', setting);
}

function clientFor(repository, options) {
    requireAccess(options?.access);
    if (!options?.client) throw new Error('personal_knowledge_transaction_required');
    return options.client;
}

export class PgPersonalKnowledgeRepository {
    constructor({ pool }) {
        if (!pool?.query) throw new Error('PgPersonalKnowledgeRepository requires pool');
        this.pool = pool;
    }

    async transaction(work, { access } = {}) {
        requireAccess(access);
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            await setAccessContext(client, access);
            const result = await work({ client, access });
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release?.();
        }
    }

    async findById(eventId, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `SELECT event.*, processing.processing_stage, semantic.semantic_state
             FROM personal_knowledge_events event
             LEFT JOIN LATERAL (
               SELECT processing_stage
               FROM personal_knowledge_event_transitions transition
               WHERE transition.event_id = event.event_id
                 AND transition.processing_stage IS NOT NULL
               ORDER BY occurred_at DESC, id DESC LIMIT 1
             ) processing ON TRUE
             LEFT JOIN LATERAL (
               SELECT semantic_state
               FROM personal_knowledge_event_transitions transition
               WHERE transition.event_id = event.event_id
                 AND transition.semantic_state IS NOT NULL
               ORDER BY occurred_at DESC, id DESC LIMIT 1
             ) semantic ON TRUE
             WHERE event.event_id = $1 LIMIT 1`, [eventId]
        );
        return rows[0] || null;
    }

    async createEvent(event, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `INSERT INTO personal_knowledge_events
             (event_id, owner_person_id, organization_id, occurred_at, captured_at, source, source_pointer,
              body_hash, body, parent_episode_id, permission_snapshot, sensitivity)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11::jsonb,$12)
             ON CONFLICT (event_id) DO NOTHING RETURNING *`,
            [event.event_id, event.owner_person_id, event.organization_id, event.occurred_at, event.captured_at,
                JSON.stringify(event.source || {}), JSON.stringify(event.source_pointer || {}), event.body_hash,
                event.body || null, event.parent_episode_id || null, JSON.stringify(event.permission_snapshot || {}),
                event.sensitivity || 'personal']
        );
        return rows[0] || null;
    }

    async appendTransition(eventId, transition, options = {}) {
        const access = options.access;
        const { rows } = await clientFor(this, options).query(
            `INSERT INTO personal_knowledge_event_transitions
             (event_id, owner_person_id, organization_id, transition_type, processing_stage, semantic_state,
              supersedes_event_id, reason, payload, actor_person_id, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,
            [eventId, access.personId, access.organizationId, transition.transition_type,
                transition.processing_stage || null, transition.semantic_state || null,
                transition.supersedes_event_id || null, transition.reason || null,
                JSON.stringify(transition.payload || {}), access.actorPersonId || access.personId,
                transition.occurred_at || new Date().toISOString()]
        );
        return rows[0];
    }

    async listTransitions(eventId, options = {}) {
        const { rows } = await clientFor(this, options).query(
            'SELECT * FROM personal_knowledge_event_transitions WHERE event_id = $1 ORDER BY occurred_at, id', [eventId]
        );
        return rows;
    }

    async search({ query, limit = 10 }, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `SELECT event.* FROM personal_knowledge_events event
             LEFT JOIN LATERAL (
               SELECT semantic_state FROM personal_knowledge_event_transitions transition
               WHERE transition.event_id = event.event_id ORDER BY occurred_at DESC, id DESC LIMIT 1
             ) latest ON TRUE
             WHERE COALESCE(latest.semantic_state, 'active') = 'active'
               AND ($1::text IS NULL OR event.body ILIKE '%' || $1 || '%')
             ORDER BY event.occurred_at DESC LIMIT $2`, [query || null, Math.min(Number(limit), 50)]
        );
        return rows;
    }

    async summarizeRoutineState(_input = {}, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `WITH current_state AS (
               SELECT event.event_id, event.parent_episode_id,
                 (SELECT transition.processing_stage
                  FROM personal_knowledge_event_transitions transition
                  WHERE transition.event_id = event.event_id
                    AND transition.processing_stage IS NOT NULL
                  ORDER BY transition.occurred_at DESC, transition.id DESC LIMIT 1) AS processing_stage,
                 COALESCE((SELECT transition.semantic_state
                  FROM personal_knowledge_event_transitions transition
                  WHERE transition.event_id = event.event_id
                    AND transition.semantic_state IS NOT NULL
                  ORDER BY transition.occurred_at DESC, transition.id DESC LIMIT 1), 'active') AS semantic_state
               FROM personal_knowledge_events event
             )
             SELECT
               COUNT(*) FILTER (WHERE processing_stage IS DISTINCT FROM 'retrievable')::int AS unprocessed_count,
               COUNT(*) FILTER (WHERE semantic_state = 'contradicted')::int AS contradiction_count,
               COUNT(*) FILTER (WHERE semantic_state = 'expired')::int AS expired_count,
               COALESCE(array_agg(DISTINCT parent_episode_id)
                 FILTER (WHERE parent_episode_id IS NOT NULL AND semantic_state = 'active'), ARRAY[]::text[]) AS episode_ids
             FROM current_state`
        );
        const row = rows[0] || {};
        return {
            unprocessed_count: Number(row.unprocessed_count || 0),
            contradiction_count: Number(row.contradiction_count || 0),
            expired_count: Number(row.expired_count || 0),
            episode_ids: row.episode_ids || []
        };
    }

    async compressRoutineEpisodes({ project_id: projectCode, episode_ids: episodeIds = [] } = {}, options = {}) {
        const ids = [...new Set(episodeIds.filter(Boolean))];
        if (ids.length === 0) return { confirmed: true, episode_ids: [], missing_ids: [] };
        const client = clientFor(this, options);
        const { rows: events } = await client.query(
            `SELECT event_id, parent_episode_id, body_hash, body
             FROM personal_knowledge_events
             WHERE parent_episode_id = ANY($1::text[])
             ORDER BY parent_episode_id, occurred_at, event_id`, [ids]
        );
        const byEpisode = new Map(ids.map((id) => [id, []]));
        for (const event of events) byEpisode.get(event.parent_episode_id)?.push(event);
        for (const [episodeId, sourceEvents] of byEpisode.entries()) {
            if (sourceEvents.length === 0) continue;
            const sourceEventIds = sourceEvents.map((event) => event.event_id);
            const artifact = {
                contract_version: 'episode_compaction.v1',
                scope: 'personal',
                episode_id: episodeId,
                source_event_ids: sourceEventIds,
                summary: {
                    source_event_count: sourceEvents.length,
                    memories: sourceEvents.map((event) => event.body).filter(Boolean).slice(0, 20)
                }
            };
            const serialized = JSON.stringify(artifact);
            const hash = createHash('sha256').update(serialized).digest('hex');
            const artifactId = `episode_compaction_personal_${hash.slice(0, 24)}`;
            await client.query(
                `INSERT INTO episode_compaction_artifacts
                 (artifact_id, scope, owner_person_id, organization_id, project_code, episode_id,
                  source_event_ids, artifact, artifact_hash, version)
                 VALUES ($1, 'personal', $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 1)
                 ON CONFLICT (scope, organization_id, owner_person_id, episode_id, version) DO NOTHING
                 RETURNING artifact_id`,
                [artifactId, options.access.personId, options.access.organizationId, projectCode || null,
                    episodeId, JSON.stringify(sourceEventIds), serialized, hash]
            );
        }
        const { rows: saved } = await client.query(
            `SELECT episode_id FROM episode_compaction_artifacts
             WHERE scope = 'personal' AND episode_id = ANY($1::text[]) AND version = 1`, [ids]
        );
        const savedIds = new Set(saved.map((row) => row.episode_id));
        const missingIds = ids.filter((id) => !savedIds.has(id));
        return { confirmed: missingIds.length === 0, episode_ids: [...savedIds], missing_ids: missingIds };
    }

    async verifyRoutineRetrievability({ episode_ids: episodeIds = [] } = {}, options = {}) {
        const ids = [...new Set(episodeIds.filter(Boolean))];
        if (ids.length === 0) return { retrievable: true, missing_ids: [] };
        const { rows } = await clientFor(this, options).query(
            `SELECT episode_id FROM episode_compaction_artifacts
             WHERE scope = 'personal' AND episode_id = ANY($1::text[]) AND version = 1`, [ids]
        );
        const found = new Set(rows.map((row) => row.episode_id));
        const missingIds = ids.filter((id) => !found.has(id));
        return { retrievable: missingIds.length === 0, missing_ids: missingIds };
    }

    async recordPrivilegedAccess(entry, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `INSERT INTO privileged_knowledge_access_audit
             (actor_person_id, proxy_person_id, organization_id, access_kind, resource_kind,
              resource_id, reason, occurred_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [entry.actorPersonId, entry.personId, entry.organizationId, entry.action,
                entry.resourceKind || 'personal_knowledge', entry.resourceId || null,
                entry.reason || null, entry.occurredAt || new Date().toISOString()]
        );
        return rows[0];
    }

    async createPromotionRequest(request, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `INSERT INTO knowledge_promotion_requests
             (request_id, personal_event_id, owner_person_id, organization_id, project_code, status,
              sanitized_preview, subject, body_hash, normalized_payload, normalized_payload_hash,
              normalized_by_person_id, normalized_at, owner_consent_receipt_id,
              normalization_contract_version, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (request_id) DO UPDATE SET request_id = EXCLUDED.request_id RETURNING *`,
            [request.request_id, request.personal_event_id, request.owner_person_id, request.organization_id,
                request.project_code, request.status, request.sanitized_preview, JSON.stringify(request.subject),
                request.body_hash, JSON.stringify(request.normalized_payload), request.normalized_payload_hash,
                request.normalized_by_person_id, request.normalized_at, request.owner_consent_receipt_id,
                request.normalization_contract_version, request.created_at]
        );
        return rows[0];
    }

    async findPromotionRequest(requestId, options = {}) {
        const { rows } = await clientFor(this, options).query(
            'SELECT * FROM knowledge_promotion_requests WHERE request_id = $1 LIMIT 1 FOR UPDATE', [requestId]
        );
        return rows[0] || null;
    }

    async claimPromotionAuthorityUse(use, options = {}) {
        try {
            await clientFor(this, options).query(
                `INSERT INTO knowledge_promotion_authority_uses
                 (operation_id, idempotency_key, request_id, action, actor_person_id,
                  organization_id, project_code)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [use.operation_id, use.idempotency_key, use.request_id, use.action,
                    use.actor_person_id, use.organization_id, use.project_code]
            );
        } catch (error) {
            if (error?.code === '23505') {
                const replay = new Error('personal_knowledge_promotion_authority_replayed');
                replay.status = 409;
                throw replay;
            }
            throw error;
        }
    }

    async decidePromotionRequest(requestId, decision, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `UPDATE knowledge_promotion_requests SET status = $2, organization_event_id = COALESCE($3, organization_event_id),
             decided_at = $4 WHERE request_id = $1 RETURNING *`,
            [requestId, decision.status, decision.organization_event_id || null, decision.decided_at]
        );
        return rows[0] || null;
    }

    async createLineage(lineage, options = {}) {
        const { rows } = await clientFor(this, options).query(
            `INSERT INTO knowledge_promotion_lineage
             (lineage_id, personal_event_id, organization_event_id, promotion_request_id,
              owner_person_id, organization_id, sanitization, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
             ON CONFLICT (personal_event_id, organization_event_id) DO UPDATE
             SET lineage_id = knowledge_promotion_lineage.lineage_id RETURNING *`,
            [lineage.lineage_id, lineage.personal_event_id, lineage.organization_event_id,
                lineage.promotion_request_id, lineage.owner_person_id, lineage.organization_id,
                JSON.stringify(lineage.sanitization), lineage.created_at]
        );
        return rows[0];
    }
}
import { createHash } from 'node:crypto';
