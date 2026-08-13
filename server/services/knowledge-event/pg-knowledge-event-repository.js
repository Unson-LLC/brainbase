import { createHash } from 'node:crypto';

const SENSITIVITY_ORDER = ['public', 'internal', 'restricted', 'confidential', 'top-secret'];
const ROLE_ORDER = ['member', 'gm', 'ceo'];

function mostRestrictive(rows, field, order, fallback) {
    return rows.reduce((selected, row) => {
        const value = row[field] || fallback;
        return order.indexOf(value) > order.indexOf(selected) ? value : selected;
    }, fallback);
}

function queryable(repository, options = {}) {
    return options.client || repository.pool;
}

function normalizeEvent(row) {
    if (!row) return null;
    const result = row.current_result || row.result || undefined;
    return {
        ...row,
        result,
        semantic_state: row.current_semantic_state || row.semantic_state,
        ...(result?.candidate_id ? { candidate_id: result.candidate_id } : {}),
        ...(result?.graph_entity_id ? { graph_entity_id: result.graph_entity_id } : {}),
        occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
        captured_at: row.captured_at instanceof Date ? row.captured_at.toISOString() : row.captured_at,
        stage_history: Array.isArray(row.stage_history) ? row.stage_history : []
    };
}

function scopedRepository(repository, client, access = null) {
    return {
        client,
        findById: (eventId, options = {}) => repository.findById(eventId, { ...options, client, access }),
        create: (event) => repository.create(event, { client, access }),
        appendStage: (eventId, stage) => repository.appendStage(eventId, stage, { client }),
        saveResult: (eventId, result) => repository.saveResult(eventId, result, { client, access }),
        lockDecisionSubject: (subjectId) => repository.lockDecisionSubject(subjectId, { client }),
        getEvent: (eventId) => repository.findById(eventId, { client }),
        insertEvent: (event) => repository.create(event, { client }),
        updateSemanticState: (eventId, state) => repository.updateSemanticState(eventId, state, { client, access }),
        replaceSearchDocument: async () => undefined,
        removeSearchDocument: async () => undefined,
        appendFeedback: (feedback) => repository.appendFeedback(feedback, { client }),
        findFeedbackById: (feedbackId) => repository.findFeedbackById(feedbackId, { client })
    };
}

export class PgKnowledgeEventRepository {
    constructor({ pool }) {
        if (!pool || typeof pool.query !== 'function') {
            throw new Error('PgKnowledgeEventRepository requires a pg pool/client with query(sql, params)');
        }
        this.pool = pool;
    }

    async ensureSchema() {
        // Schema ownership belongs to the M5-A migration manifest. Runtime code
        // deliberately performs no DDL so a missing migration fails loudly.
    }

    async findById(eventId, options = {}) {
        const params = [eventId];
        const projectClause = options.projectCode
            ? ` AND e.applicability_scope->>'project_code' = $${params.push(options.projectCode)}`
            : '';
        const { rows } = await queryable(this, options).query(
            `SELECT e.*, COALESCE((
                SELECT jsonb_agg(jsonb_build_object('stage', h.stage, 'occurred_at', h.occurred_at)
                    ORDER BY h.occurred_at)
                FROM knowledge_event_stage_history h WHERE h.event_id = e.event_id
             ), '[]'::jsonb) AS stage_history
             FROM knowledge_event_current e
             WHERE e.event_id = $1${projectClause}`,
            params
        );
        const row = rows[0];
        if (!row) return null;
        return normalizeEvent({ ...(row.payload || {}), ...row });
    }

    async create(event, options = {}) {
        const organizationId = event.organization_id
            || event.applicability_scope?.organization_id
            || options.access?.organizationId
            || '__quarantine__';
        const { rows } = await queryable(this, options).query(
            `INSERT INTO knowledge_events (
                event_id, schema_version, occurred_at, captured_at, source, subject,
                decision_authority, applicability_scope, project_code, permission_snapshot,
                source_pointer, body_hash, parent_episode_id, payload, semantic_state,
                organization_id, sensitivity, role_min, venue
             ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
                $9, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15,
                $16, $17, $18, $19)
             ON CONFLICT (event_id) DO NOTHING
             RETURNING *`,
            [
                event.event_id, event.schema_version, event.occurred_at, event.captured_at,
                JSON.stringify(event.source), JSON.stringify(event.subject),
                JSON.stringify(event.decision_authority), JSON.stringify(event.applicability_scope),
                event.applicability_scope?.project_code, JSON.stringify(event.permission_snapshot), JSON.stringify(event.source_pointer),
                event.body_hash, event.parent_episode_id, JSON.stringify(event),
                event.semantic_state || 'active', organizationId,
                event.sensitivity || event.permission_snapshot?.sensitivity || 'internal',
                event.role_min || event.permission_snapshot?.role_min || 'member',
                event.venue || event.source?.venue || event.source?.type || 'unknown'
            ]
        );
        if (rows[0]) return normalizeEvent({ ...event, ...rows[0], stage_history: [] });
        const existing = await this.findById(event.event_id, options);
        return existing ? { ...existing, idempotent: true } : null;
    }

    async appendStage(eventId, entry, options = {}) {
        const { rows } = await queryable(this, options).query(
            `INSERT INTO knowledge_event_stage_history (event_id, stage, occurred_at)
             VALUES ($1, $2, COALESCE($3::timestamptz, NOW())) RETURNING event_id, stage, occurred_at`,
            [eventId, entry.stage, entry.occurred_at || null]
        );
        return rows[0];
    }

    async saveResult(eventId, result, options = {}) {
        const { rows } = await queryable(this, options).query(
            `INSERT INTO knowledge_event_transitions (
                event_id, organization_id, project_code, transition_type,
                processing_stage, semantic_state, reason, result, actor_person_id
             )
             SELECT event_id, organization_id, project_code, 'result_recorded',
                $2, $3, $4, $5::jsonb, $6
             FROM knowledge_events WHERE event_id = $1
             RETURNING *`,
            [
                eventId,
                result.processing_stage || null,
                result.semantic_state || 'active',
                result.quarantine_reason || null,
                JSON.stringify(result),
                options.access?.personId || 'brainbase_runtime'
            ]
        );
        if (!rows[0]) return null;
        return this.findById(eventId, options);
    }

    async updateSemanticState(eventId, state, options = {}) {
        const { rows } = await queryable(this, options).query(
            `INSERT INTO knowledge_event_transitions (
                event_id, organization_id, project_code, transition_type,
                semantic_state, reason, actor_person_id
             )
             SELECT event_id, organization_id, project_code, 'semantic_state_changed',
                $2, $3, $4
             FROM knowledge_events WHERE event_id = $1
             RETURNING *`,
            [eventId, state, options.reason || null, options.access?.personId || 'brainbase_runtime']
        );
        if (!rows[0]) return null;
        return this.findById(eventId, options);
    }

    async appendFeedback(feedback, options = {}) {
        const { rows } = await queryable(this, options).query(
            `INSERT INTO knowledge_feedback (feedback_id, event_id, action, payload)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (feedback_id) DO NOTHING
             RETURNING *`,
            [feedback.feedback_id, feedback.event_id, feedback.action, JSON.stringify(feedback)]
        );
        return rows[0] || null;
    }

    async findFeedbackById(feedbackId, options = {}) {
        if (!feedbackId) return null;
        const { rows } = await queryable(this, options).query(
            'SELECT payload FROM knowledge_feedback WHERE feedback_id = $1 LIMIT 1',
            [feedbackId]
        );
        return rows[0]?.payload || null;
    }

    async lockDecisionSubject(subjectId, options = {}) {
        await queryable(this, options).query(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            [`knowledge_decision_subject:${subjectId}`]
        );
    }

    async summarizeRoutineState({ project_id: projectId, since = null, until = null }, context = {}) {
        return this.transaction(async ({ client }) => {
            const { rows } = await client.query(
                `WITH latest_stage AS (
                    SELECT DISTINCT ON (event_id) event_id, stage, occurred_at
                    FROM knowledge_event_stage_history
                    ORDER BY event_id, occurred_at DESC, id DESC
                 ), feedback_counts AS (
                    SELECT
                        COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE action = 'correct')::int AS corrections,
                        COUNT(*) FILTER (WHERE action = 'reject')::int AS rejections
                    FROM knowledge_feedback feedback
                    JOIN knowledge_events event ON event.event_id = feedback.event_id
                    WHERE event.project_code = $1
                      AND ($2::timestamptz IS NULL OR feedback.created_at >= $2::timestamptz)
                      AND ($3::timestamptz IS NULL OR feedback.created_at < $3::timestamptz)
                 ), event_stats AS (
                    SELECT
                        COUNT(*) FILTER (
                            WHERE event.current_semantic_state NOT IN ('retracted', 'expired')
                              AND COALESCE(stage.stage, 'received') <> 'retrievable'
                        )::int AS unprocessed_count,
                        COUNT(*) FILTER (WHERE event.current_semantic_state = 'contradicted')::int AS contradiction_count,
                        COUNT(*) FILTER (WHERE event.current_semantic_state = 'expired')::int AS expired_count,
                        COUNT(*) FILTER (
                            WHERE event.current_semantic_state = 'contradicted'
                               OR (
                                   event.current_semantic_state = 'quarantined'
                                   AND event.current_result->>'quarantine_reason' = 'unresolved_conflict'
                               )
                        )::int
                            AS open_contradictions,
                        COALESCE(AVG(EXTRACT(EPOCH FROM (stage.occurred_at - event.captured_at)) * 1000)
                            FILTER (WHERE stage.stage = 'retrievable'), 0)::bigint AS processing_time_ms,
                        COALESCE(array_agg(DISTINCT event.parent_episode_id)
                            FILTER (WHERE event.parent_episode_id IS NOT NULL), '{}') AS episode_ids,
                        COUNT(*)::int AS event_count
                    FROM knowledge_event_current event
                    LEFT JOIN latest_stage stage ON stage.event_id = event.event_id
                    WHERE event.project_code = $1
                      AND ($2::timestamptz IS NULL OR event.occurred_at >= $2::timestamptz)
                      AND ($3::timestamptz IS NULL OR event.occurred_at < $3::timestamptz)
                 )
                 SELECT event_stats.*, feedback_counts.total AS feedback_count,
                    feedback_counts.corrections, feedback_counts.rejections
                 FROM event_stats CROSS JOIN feedback_counts`,
                [projectId, since, until]
            );
            const row = rows[0] || {};
            const eventCount = Number(row.event_count || 0);
            const feedbackCount = Number(row.feedback_count || 0);
            return {
                unprocessed_count: Number(row.unprocessed_count || 0),
                contradiction_count: Number(row.contradiction_count || 0),
                expired_count: Number(row.expired_count || 0),
                misregistration_rate: eventCount > 0 ? Number(row.rejections || 0) / eventCount : 0,
                correction_rate: feedbackCount > 0 ? Number(row.corrections || 0) / feedbackCount : 0,
                open_contradictions: Number(row.open_contradictions || 0),
                processing_time_ms: Number(row.processing_time_ms || 0),
                episode_ids: Array.isArray(row.episode_ids) ? row.episode_ids : []
            };
        }, { access: context.access });
    }

    async compressRoutineEpisodes({ project_id: projectId, episode_ids: episodeIds }, context = {}) {
        return this.transaction(async ({ client }) => {
            const requestedEpisodeIds = [...new Set(Array.isArray(episodeIds) ? episodeIds : [])];
            const { rows } = await client.query(
                `SELECT DISTINCT parent_episode_id, event_id, subject, payload,
                        current_semantic_state AS semantic_state, current_result AS result,
                        organization_id, sensitivity, role_min
                 FROM knowledge_event_current
                 WHERE project_code = $1 AND parent_episode_id = ANY($2::text[])
                 ORDER BY parent_episode_id, event_id`,
                [projectId, requestedEpisodeIds]
            );
            const eventsByEpisode = rows.reduce((episodes, row) => {
                if (!episodes.has(row.parent_episode_id)) episodes.set(row.parent_episode_id, []);
                if (row.event_id) episodes.get(row.parent_episode_id).push(row.event_id);
                return episodes;
            }, new Map());
            const compressedEpisodeIds = [...eventsByEpisode.keys()];
            const missingEpisodeIds = requestedEpisodeIds.filter((id) => !eventsByEpisode.has(id));
            const persistedEpisodeIds = [];
            for (const episodeId of compressedEpisodeIds) {
                const sourceEventIds = [...new Set(eventsByEpisode.get(episodeId))].sort();
                const episodeRows = rows.filter((row) => row.parent_episode_id === episodeId);
                const artifactSeed = JSON.stringify({ episode_id: episodeId, source_event_ids: sourceEventIds });
                const artifact = {
                    schema_version: 'episode_compaction.v1',
                    episode_id: episodeId,
                    source_event_ids: sourceEventIds,
                    version: 1,
                    hash: `sha256:${createHash('sha256').update(artifactSeed).digest('hex')}`,
                    summary: {
                        decisions: episodeRows.filter((row) => row.subject?.type === 'decision')
                            .map((row) => row.payload?.decision?.statement || row.payload?.summary).filter(Boolean),
                        outcomes: episodeRows.map((row) => row.result?.outcome).filter(Boolean),
                        unresolved_items: episodeRows.flatMap((row) => row.result?.unresolved_items || [])
                    },
                    source_pointer: { type: 'knowledge_event_set', event_ids: sourceEventIds },
                    compacted_at: new Date().toISOString(),
                    completed_at: new Date().toISOString()
                };
                const artifactId = `epc_${createHash('sha256').update(`${projectId}:${episodeId}:1`).digest('hex').slice(0, 32)}`;
                const sensitivity = mostRestrictive(
                    episodeRows, 'sensitivity', SENSITIVITY_ORDER, 'internal'
                );
                const roleMin = mostRestrictive(episodeRows, 'role_min', ROLE_ORDER, 'member');
                const update = await client.query(
                    `INSERT INTO episode_compaction_artifacts (
                        artifact_id, scope, organization_id, project_code, episode_id,
                        source_event_ids, artifact, artifact_hash, version, created_at,
                        sensitivity, role_min
                     ) VALUES ($1, 'organization', $2, $3, $4, $5::jsonb, $6::jsonb, $7, 1, $8::timestamptz,
                        $9, $10)
                     ON CONFLICT (artifact_id) DO NOTHING`,
                    [
                        artifactId,
                        episodeRows[0]?.organization_id || context.access?.organizationId || '__quarantine__',
                        projectId,
                        episodeId,
                        JSON.stringify(sourceEventIds),
                        JSON.stringify(artifact),
                        artifact.hash,
                        artifact.completed_at,
                        sensitivity,
                        roleMin
                    ]
                );
                if (update.rowCount !== 1) {
                    const existing = await client.query(
                        `SELECT artifact_id FROM episode_compaction_artifacts
                         WHERE artifact_id = $1 AND artifact_hash = $2`,
                        [artifactId, artifact.hash]
                    );
                    if (existing.rows.length !== 1) continue;
                }
                const readback = await client.query(
                    `SELECT artifact_id, (artifact_hash = $2) AS compaction_matches
                     FROM episode_compaction_artifacts WHERE artifact_id = $1`,
                    [artifactId, artifact.hash]
                );
                if (readback.rows.length === 1 && readback.rows[0].compaction_matches === true) {
                    persistedEpisodeIds.push(episodeId);
                }
            }
            const unconfirmedEpisodeIds = requestedEpisodeIds.filter((id) => !persistedEpisodeIds.includes(id));
            return {
                episode_ids: compressedEpisodeIds,
                confirmed: unconfirmedEpisodeIds.length === 0,
                ...(missingEpisodeIds.length > 0 ? { missing_episode_ids: missingEpisodeIds } : {})
            };
        }, { access: context.access });
    }

    async verifyRoutineRetrievability({ project_id: projectId, episode_ids: episodeIds }, context = {}) {
        return this.transaction(async ({ client }) => {
            const { rows } = await client.query(
                `WITH latest_stage AS (
                    SELECT DISTINCT ON (event_id) event_id, stage
                    FROM knowledge_event_stage_history
                    ORDER BY event_id, occurred_at DESC, id DESC
                 )
                 SELECT event.event_id
                 FROM knowledge_event_current event
                 LEFT JOIN latest_stage stage ON stage.event_id = event.event_id
                 WHERE event.project_code = $1
                   AND event.parent_episode_id = ANY($2::text[])
                   AND event.current_semantic_state NOT IN ('retracted', 'expired', 'quarantined')
                   AND COALESCE(stage.stage, 'received') <> 'retrievable'
                 ORDER BY event.event_id`,
                [projectId, Array.isArray(episodeIds) ? episodeIds : []]
            );
            return {
                retrievable: rows.length === 0,
                missing_ids: rows.map((row) => row.event_id)
            };
        }, { access: context.access });
    }

    async transaction(work, { access } = {}) {
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            if (access) {
                if (access.personId) {
                    await client.query('SELECT set_config($1, $2, true)', ['app.person_id', access.personId]);
                }
                if (access.organizationId || access.tenantId) {
                    await client.query('SELECT set_config($1, $2, true)', [
                        'app.organization_id', access.organizationId || access.tenantId
                    ]);
                }
                await client.query('SELECT set_config($1, $2, true)', ['app.role', access.role || 'member']);
                await client.query('SELECT set_config($1, $2, true)', ['app.project_codes', (access.projectCodes || []).join(',')]);
                await client.query('SELECT set_config($1, $2, true)', ['app.clearance', (access.clearance || ['internal']).join(',')]);
            }
            const result = await work(scopedRepository(this, client, access));
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            if (typeof client.release === 'function') client.release();
        }
    }

    async withTransaction(work, options = {}) {
        return this.transaction(work, options);
    }
}
