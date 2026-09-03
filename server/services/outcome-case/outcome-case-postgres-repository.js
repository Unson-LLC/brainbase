function normalizeTimestamp(value) {
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeRow(row) {
    if (!row) return null;
    return {
        ...row,
        protected_constraints: row.protected_constraints || [],
        non_goals: row.non_goals || [],
        authority: row.authority || {},
        technical_story_refs: row.technical_story_refs || [],
        run_receipt_refs: row.run_receipt_refs || [],
        prior_attempt_refs: row.prior_attempt_refs || [],
        terminal_evaluation: row.terminal_evaluation || null,
        revision: Number(row.revision),
        created_at: normalizeTimestamp(row.created_at),
        updated_at: normalizeTimestamp(row.updated_at)
    };
}

function unavailable(error) {
    const wrapped = new Error('OutcomeCase PostgreSQL store is unavailable');
    wrapped.code = 'outcome_case_store_unavailable';
    wrapped.status = 503;
    wrapped.cause = error;
    return wrapped;
}

export class OutcomeCasePostgresRepository {
    constructor({ pool } = {}) {
        if (!pool) throw new Error('OutcomeCase PostgreSQL pool is required');
        this.pool = pool;
    }

    async query(text, values = []) {
        try {
            return await this.pool.query(text, values);
        } catch (error) {
            throw unavailable(error);
        }
    }

    async findByCaseId(caseId) {
        const result = await this.query('SELECT * FROM outcome_cases WHERE case_id = $1', [caseId]);
        return normalizeRow(result.rows[0]);
    }

    async create(outcomeCase) {
        const result = await this.query(`
            INSERT INTO outcome_cases (
                case_id, project_code, capability_id, user_observable_outcome,
                protected_constraints, non_goals, authority, selected_domain_pack,
                terminal_evaluation, closure_status, current_external_state,
                technical_story_refs, run_receipt_refs, prior_attempt_refs,
                unresolved_failure_boundary, revision, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8,
                $9::jsonb, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb,
                $15, $16, $17::timestamptz, $18::timestamptz
            ) RETURNING *
        `, [
            outcomeCase.case_id, outcomeCase.project_code, outcomeCase.capability_id,
            outcomeCase.user_observable_outcome, JSON.stringify(outcomeCase.protected_constraints),
            JSON.stringify(outcomeCase.non_goals), JSON.stringify(outcomeCase.authority),
            outcomeCase.selected_domain_pack, JSON.stringify(outcomeCase.terminal_evaluation),
            outcomeCase.closure_status, outcomeCase.current_external_state,
            JSON.stringify(outcomeCase.technical_story_refs), JSON.stringify(outcomeCase.run_receipt_refs),
            JSON.stringify(outcomeCase.prior_attempt_refs), outcomeCase.unresolved_failure_boundary,
            outcomeCase.revision, outcomeCase.created_at, outcomeCase.updated_at
        ]);
        return normalizeRow(result.rows[0]);
    }

    async update(outcomeCase, { expectedRevision } = {}) {
        const result = await this.query(`
            UPDATE outcome_cases
               SET run_receipt_refs = $2::jsonb,
                   terminal_evaluation = $3::jsonb,
                   closure_status = $4,
                   current_external_state = $5,
                   unresolved_failure_boundary = $6,
                   revision = $7,
                   updated_at = $8::timestamptz
             WHERE case_id = $1 AND revision = $9
         RETURNING *
        `, [
            outcomeCase.case_id, JSON.stringify(outcomeCase.run_receipt_refs),
            JSON.stringify(outcomeCase.terminal_evaluation), outcomeCase.closure_status,
            outcomeCase.current_external_state, outcomeCase.unresolved_failure_boundary,
            outcomeCase.revision, outcomeCase.updated_at, expectedRevision
        ]);
        if (!result.rows[0]) {
            const error = new Error('OutcomeCase was changed by another evaluation');
            error.code = 'outcome_case_revision_conflict';
            error.status = 409;
            throw error;
        }
        return normalizeRow(result.rows[0]);
    }
}
