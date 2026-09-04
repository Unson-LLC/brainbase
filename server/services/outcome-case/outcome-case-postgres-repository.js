import { requireCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';

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
        evaluation_history: row.evaluation_history || [],
        reference_resolution: row.reference_resolution || {},
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

function tenantDenied(error) {
    const wrapped = new Error('The authenticated organization cannot access this OutcomeCase');
    wrapped.code = 'outcome_case_tenant_access_denied';
    wrapped.status = 403;
    wrapped.details = { audit_event: 'outcome_case_cross_tenant_denied' };
    wrapped.cause = error;
    return wrapped;
}

function accessFromActor(actor = {}) {
    return {
        role: typeof actor.role === 'string' && actor.role.trim() ? actor.role.trim() : 'member',
        projectCodes: Array.isArray(actor.projectCodes) ? actor.projectCodes : [],
        clearance: Array.isArray(actor.clearance) ? actor.clearance : [],
        organizationId: requireCanonicalTenantIdentity(actor)
    };
}

export class OutcomeCasePostgresRepository {
    constructor({ pool, infoSSOTService } = {}) {
        if (!pool) throw new Error('OutcomeCase PostgreSQL pool is required');
        if (typeof infoSSOTService?.withAccessContext !== 'function') {
            throw new Error('OutcomeCase PostgreSQL repository requires scoped InfoSSOT access context');
        }
        this.pool = pool;
        this.infoSSOTService = infoSSOTService;
    }

    async query(actor, text, values = []) {
        try {
            // All OutcomeCase operations must use the transaction-local RLS
            // context. Do not replace this with pool.query: FORCE RLS only
            // protects requests which establish app.project_codes first.
            return await this.infoSSOTService.withAccessContext(
                accessFromActor(actor),
                (client) => client.query(text, values),
                { requireCanonicalTenant: true }
            );
        } catch (error) {
            if (error?.code === '42501') throw tenantDenied(error);
            throw unavailable(error);
        }
    }

    async findByCaseId(caseId, actor = {}) {
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        const organizationId = requireCanonicalTenantIdentity(actor);
        const result = await this.query(actor,
            `SELECT * FROM outcome_cases
              WHERE case_id = $1
                AND project_code = ANY($2::text[])
                AND organization_id = NULLIF($3, '')`,
            [caseId, projectCodes, organizationId]
        );
        return normalizeRow(result.rows[0]);
    }

    async create(outcomeCase, actor = {}) {
        const result = await this.query(actor, `
            INSERT INTO outcome_cases (
                case_id, organization_id, project_code, capability_id, user_observable_outcome,
                protected_constraints, non_goals, authority, selected_domain_pack,
                reference_resolution, evaluation_history, terminal_evaluation, closure_status, current_external_state,
                technical_story_refs, run_receipt_refs, prior_attempt_refs,
                unresolved_failure_boundary, revision, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9,
                $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb,
                $18, $19, $20::timestamptz, $21::timestamptz
            ) RETURNING *
        `, [
            outcomeCase.case_id, outcomeCase.organization_id, outcomeCase.project_code, outcomeCase.capability_id,
            outcomeCase.user_observable_outcome, JSON.stringify(outcomeCase.protected_constraints),
            JSON.stringify(outcomeCase.non_goals), JSON.stringify(outcomeCase.authority),
            outcomeCase.selected_domain_pack, JSON.stringify(outcomeCase.reference_resolution),
            JSON.stringify(outcomeCase.evaluation_history), JSON.stringify(outcomeCase.terminal_evaluation),
            outcomeCase.closure_status, outcomeCase.current_external_state,
            JSON.stringify(outcomeCase.technical_story_refs), JSON.stringify(outcomeCase.run_receipt_refs),
            JSON.stringify(outcomeCase.prior_attempt_refs), outcomeCase.unresolved_failure_boundary,
            outcomeCase.revision, outcomeCase.created_at, outcomeCase.updated_at
        ]);
        return normalizeRow(result.rows[0]);
    }

    async update(outcomeCase, { expectedRevision, actor = {} } = {}) {
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        const organizationId = requireCanonicalTenantIdentity(actor);
        const result = await this.query(actor, `
            UPDATE outcome_cases
               SET run_receipt_refs = $2::jsonb,
                   authority = $3::jsonb,
                   reference_resolution = $4::jsonb,
                   evaluation_history = $5::jsonb,
                   terminal_evaluation = $6::jsonb,
                   closure_status = $7,
                   current_external_state = $8,
                   unresolved_failure_boundary = $9,
                   revision = $10,
                   updated_at = $11::timestamptz
             WHERE case_id = $1 AND revision = $12 AND project_code = ANY($13::text[])
               AND organization_id = NULLIF($14, '')
         RETURNING *
        `, [
            outcomeCase.case_id, JSON.stringify(outcomeCase.run_receipt_refs), JSON.stringify(outcomeCase.authority),
            JSON.stringify(outcomeCase.reference_resolution), JSON.stringify(outcomeCase.evaluation_history),
            JSON.stringify(outcomeCase.terminal_evaluation), outcomeCase.closure_status,
            outcomeCase.current_external_state, outcomeCase.unresolved_failure_boundary,
            outcomeCase.revision, outcomeCase.updated_at, expectedRevision, projectCodes,
            organizationId
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
