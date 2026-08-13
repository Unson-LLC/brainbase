function queryable(repository, options = {}) {
    return options.client || repository.pool;
}

function normalizeEvent(row) {
    if (!row) return null;
    return {
        ...row,
        ...(row.result?.candidate_id ? { candidate_id: row.result.candidate_id } : {}),
        ...(row.result?.graph_entity_id ? { graph_entity_id: row.result.graph_entity_id } : {}),
        occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
        captured_at: row.captured_at instanceof Date ? row.captured_at.toISOString() : row.captured_at,
        stage_history: Array.isArray(row.stage_history) ? row.stage_history : []
    };
}

function scopedRepository(repository, client) {
    return {
        client,
        findById: (eventId, options = {}) => repository.findById(eventId, { ...options, client }),
        create: (event) => repository.create(event, { client }),
        appendStage: (eventId, stage) => repository.appendStage(eventId, stage, { client }),
        saveResult: (eventId, result) => repository.saveResult(eventId, result, { client }),
        lockDecisionSubject: (subjectId) => repository.lockDecisionSubject(subjectId, { client }),
        getEvent: (eventId) => repository.findById(eventId, { client }),
        insertEvent: (event) => repository.create(event, { client }),
        updateSemanticState: (eventId, state) => repository.updateSemanticState(eventId, state, { client }),
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
            `SELECT e.*, COALESCE(
                jsonb_agg(jsonb_build_object('stage', h.stage, 'occurred_at', h.occurred_at)
                    ORDER BY h.occurred_at) FILTER (WHERE h.id IS NOT NULL), '[]'::jsonb
             ) AS stage_history
             FROM knowledge_events e
             LEFT JOIN knowledge_event_stage_history h ON h.event_id = e.event_id
             WHERE e.event_id = $1${projectClause}
             GROUP BY e.event_id`,
            params
        );
        const row = rows[0];
        if (!row) return null;
        return normalizeEvent({ ...(row.payload || {}), ...row, result: row.result || undefined });
    }

    async create(event, options = {}) {
        const { rows } = await queryable(this, options).query(
            `INSERT INTO knowledge_events (
                event_id, schema_version, occurred_at, captured_at, source, subject,
                decision_authority, applicability_scope, project_code, permission_snapshot,
                source_pointer, body_hash, parent_episode_id, payload, semantic_state
             ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
                $9, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15)
             ON CONFLICT (event_id) DO NOTHING
             RETURNING *`,
            [
                event.event_id, event.schema_version, event.occurred_at, event.captured_at,
                JSON.stringify(event.source), JSON.stringify(event.subject),
                JSON.stringify(event.decision_authority), JSON.stringify(event.applicability_scope),
                event.applicability_scope?.project_code, JSON.stringify(event.permission_snapshot), JSON.stringify(event.source_pointer),
                event.body_hash, event.parent_episode_id, JSON.stringify(event),
                event.semantic_state || 'active'
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
            `UPDATE knowledge_events SET result = $2::jsonb, semantic_state = $3, updated_at = NOW()
             WHERE event_id = $1 RETURNING *`,
            [eventId, JSON.stringify(result), result.semantic_state || 'active']
        );
        return normalizeEvent(rows[0]);
    }

    async updateSemanticState(eventId, state, options = {}) {
        const { rows } = await queryable(this, options).query(
            `UPDATE knowledge_events SET semantic_state = $2, updated_at = NOW()
             WHERE event_id = $1 RETURNING *`,
            [eventId, state]
        );
        return normalizeEvent(rows[0]);
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

    async transaction(work, { access } = {}) {
        const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
        await client.query('BEGIN');
        try {
            if (access) {
                await client.query('SELECT set_config($1, $2, true)', ['app.role', access.role || 'member']);
                await client.query('SELECT set_config($1, $2, true)', ['app.project_codes', (access.projectCodes || []).join(',')]);
                await client.query('SELECT set_config($1, $2, true)', ['app.clearance', (access.clearance || ['internal']).join(',')]);
            }
            const result = await work(scopedRepository(this, client));
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
