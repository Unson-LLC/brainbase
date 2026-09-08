import { requireCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';
import { OutcomeCaseError } from './outcome-case-service.js';
import { createVibeproHandoffSnapshot } from './vibepro-managed-handoff.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const MANAGED_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const PROJECT_CODE = /^[a-z0-9][a-z0-9._-]{0,99}$/u;
const ADOPT_FIELDS = new Set(['caseId', 'resolutionId', 'expectedRevision', 'target', 'technicalAcceptance', 'productionProbe']);
const TARGET_FIELDS = new Set(['repository', 'repository_root', 'base_sha', 'story_id']);
const ACCEPTANCE_FIELDS = new Set(['id', 'criterion']);
const PROBE_FIELDS = new Set(['id', 'procedure', 'terminal_receipt_target']);

function failure(code, status, message) {
    return new OutcomeCaseError(code, message, { status });
}

function object(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function identifier(value, pattern) {
    return typeof value === 'string' && value === value.trim() && pattern.test(value) ? value : null;
}

function assertExactObject(value, fields) {
    const prototype = object(value) ? Object.getPrototypeOf(value) : null;
    return object(value)
        && (prototype === Object.prototype || prototype === null)
        && Object.getOwnPropertySymbols(value).length === 0
        && Object.keys(value).every((key) => fields.has(key));
}

function adoptionInput(value) {
    if (!assertExactObject(value, ADOPT_FIELDS)
        || !identifier(value.caseId, SAFE_ID)
        || !identifier(value.resolutionId, MANAGED_ID)
        || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1
        || !assertExactObject(value.target, TARGET_FIELDS)
        || !Array.isArray(value.technicalAcceptance) || !value.technicalAcceptance.length
        || value.technicalAcceptance.some((entry) => !assertExactObject(entry, ACCEPTANCE_FIELDS))
        || !assertExactObject(value.productionProbe, PROBE_FIELDS)) {
        throw failure('vibepro_handoff_adoption_input_invalid', 422, 'VibePro handoff adoption input is invalid');
    }
    return value;
}

function accessFromActor(actor = {}) {
    const personId = identifier(actor.personId, SAFE_ID);
    const organizationId = requireCanonicalTenantIdentity(actor);
    const projectCodes = Array.isArray(actor.projectCodes)
        ? actor.projectCodes.filter((value) => identifier(value, PROJECT_CODE))
        : [];
    if (!personId || !projectCodes.length) throw failure('vibepro_handoff_adoption_denied', 403, 'VibePro handoff adoption is not authorized');
    return {
        ownerPersonId: personId,
        organizationId,
        projectCodes: [...new Set(projectCodes)],
        clearance: Array.isArray(actor.clearance) ? actor.clearance : [],
        role: typeof actor.role === 'string' && actor.role.trim() ? actor.role.trim() : 'member'
    };
}

function sourceFromRow(row) {
    if (!row) return null;
    return {
        status: 'adopted',
        organization_id: row.organization_id,
        project_code: row.project_code,
        case_id: row.case_id,
        resolution_id: row.resolution_id,
        outcome_case_revision: Number(row.outcome_case_revision),
        owner_person_id: row.owner_person_id,
        decision: row.decision,
        target: row.target,
        technicalAcceptance: row.technical_acceptance,
        productionProbe: row.production_probe
    };
}

function sourceFor({ access, outcomeCase, resolutionId, receipt, snapshot }) {
    return {
        status: 'adopted',
        organization_id: access.organizationId,
        project_code: outcomeCase.project_code,
        case_id: outcomeCase.case_id,
        resolution_id: resolutionId,
        outcome_case_revision: Number(outcomeCase.revision),
        decision: snapshot.decision,
        target: snapshot.target,
        technicalAcceptance: snapshot.technicalAcceptance,
        productionProbe: snapshot.productionProbe,
        owner_person_id: access.ownerPersonId,
        judgment_receipt_owner_person_id: receipt.owner_person_id
    };
}

/**
 * Persists only an adopted projection.  The raw judgment receipt remains in
 * judgment_receipts and is never copied into this source.  Both the adopted
 * projection and its readback are limited to the authenticated receipt author.
 */
export class VibeproHandoffPostgresStore {
    constructor({ pool, infoSSOTService } = {}) {
        if (!pool) throw new Error('VibePro handoff PostgreSQL pool is required');
        if (typeof infoSSOTService?.withAccessContext !== 'function') {
            throw new Error('VibePro handoff PostgreSQL store requires scoped InfoSSOT access context');
        }
        this.pool = pool;
        this.infoSSOTService = infoSSOTService;
    }

    async withOwnerContext(actor, operation) {
        let access;
        try {
            access = accessFromActor(actor);
        } catch (error) {
            if (error instanceof OutcomeCaseError) throw error;
            throw failure('vibepro_handoff_adoption_denied', 403, 'VibePro handoff adoption is not authorized');
        }
        try {
            return await this.infoSSOTService.withAccessContext({
                role: access.role,
                projectCodes: access.projectCodes,
                clearance: access.clearance,
                organizationId: access.organizationId
            }, async (client) => {
                await client.query('SELECT set_config($1, $2, true)', [
                    'app.judgment_receipt_owner_id', access.ownerPersonId
                ]);
                await client.query('SELECT set_config($1, $2, true)', [
                    'app.vibepro_handoff_adoption_owner_id', access.ownerPersonId
                ]);
                return operation(client, access);
            }, { requireCanonicalTenant: true });
        } catch (error) {
            if (error instanceof OutcomeCaseError) throw error;
            if (error?.code === '42501') {
                throw failure('vibepro_handoff_adoption_denied', 403, 'VibePro handoff adoption is not authorized');
            }
            throw failure('vibepro_handoff_store_unavailable', 503, 'VibePro handoff store is unavailable');
        }
    }

    async adopt(request, actor = {}) {
        const input = adoptionInput(request);
        return this.withOwnerContext(actor, async (client, access) => {
            const caseResult = await client.query(`
                SELECT case_id, organization_id, project_code, revision, user_observable_outcome
                  FROM outcome_cases
                 WHERE case_id = $1
                   AND organization_id = $2
                   AND project_code = ANY($3::text[])
                 FOR SHARE
            `, [input.caseId, access.organizationId, access.projectCodes]);
            const outcomeCase = caseResult.rows[0];
            if (!outcomeCase) {
                throw failure('vibepro_handoff_case_not_found', 404, 'VibePro handoff outcome case was not found');
            }
            if (Number(outcomeCase.revision) !== input.expectedRevision) {
                throw failure('vibepro_handoff_adoption_revision_conflict', 409, 'VibePro handoff outcome case changed');
            }
            const receiptResult = await client.query(`
                SELECT organization_id, project_code, owner_person_id, resolution_id, turn_id
                  FROM judgment_receipts
                 WHERE organization_id = $1
                   AND project_code = $2
                   AND owner_person_id = $3
                   AND resolution_id = $4
                 FOR SHARE
            `, [access.organizationId, outcomeCase.project_code, access.ownerPersonId, input.resolutionId]);
            const receipt = receiptResult.rows[0];
            if (!receipt) {
                throw failure('vibepro_handoff_receipt_not_found', 404, 'VibePro handoff judgment receipt was not found');
            }
            const grantResult = await client.query(`
                SELECT 1 AS allowed
                  FROM vibepro_handoff_adoption_grants
                 WHERE organization_id = $1 AND project_code = $2 AND person_id = $3
            `, [access.organizationId, outcomeCase.project_code, access.ownerPersonId]);
            if (!grantResult.rows[0]) {
                throw failure('vibepro_handoff_adoption_denied', 403, 'VibePro handoff adoption is not authorized');
            }
            let snapshot;
            try {
                snapshot = createVibeproHandoffSnapshot({
                    outcomeCase,
                    decision: {
                        case_id: outcomeCase.case_id,
                        project_code: outcomeCase.project_code,
                        resolution_id: input.resolutionId,
                        turn_id: receipt.turn_id,
                        judgment_receipt_ref: `brainbase://judgment-receipts/${input.resolutionId}`
                    },
                    target: {
                        ...input.target,
                        case_id: outcomeCase.case_id,
                        project_code: outcomeCase.project_code
                    },
                    technicalAcceptance: input.technicalAcceptance,
                    productionProbe: input.productionProbe
                });
            } catch {
                throw failure('vibepro_handoff_adoption_input_invalid', 422, 'VibePro handoff adoption input is invalid');
            }
            const source = sourceFor({ access, outcomeCase, resolutionId: input.resolutionId, receipt, snapshot });
            const inserted = await client.query(`
                INSERT INTO vibepro_handoff_adoptions (
                    organization_id, project_code, owner_person_id, case_id, resolution_id,
                    outcome_case_revision, decision, target, technical_acceptance, production_probe
                ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
                ON CONFLICT (organization_id, project_code, owner_person_id, case_id, resolution_id) DO NOTHING
                RETURNING organization_id, project_code, owner_person_id, case_id, resolution_id,
                          outcome_case_revision, decision, target, technical_acceptance, production_probe
            `, [
                source.organization_id, source.project_code, source.owner_person_id, source.case_id,
                source.resolution_id, source.outcome_case_revision, JSON.stringify(source.decision),
                JSON.stringify(source.target), JSON.stringify(source.technicalAcceptance), JSON.stringify(source.productionProbe)
            ]);
            if (!inserted.rows[0]) {
                throw failure('vibepro_handoff_adoption_conflict', 409, 'VibePro handoff adoption already exists');
            }
            return sourceFromRow(inserted.rows[0]);
        });
    }

    async readAdoptedHandoff({ caseId, resolutionId, organizationId, projectCode, actor } = {}) {
        if (!identifier(caseId, SAFE_ID) || !identifier(resolutionId, MANAGED_ID)
            || !identifier(organizationId, SAFE_ID) || !identifier(projectCode, PROJECT_CODE)) {
            throw failure('vibepro_handoff_adoption_input_invalid', 422, 'VibePro handoff adoption input is invalid');
        }
        return this.withOwnerContext(actor, async (client, access) => {
            if (organizationId !== access.organizationId || !access.projectCodes.includes(projectCode)) {
                throw failure('vibepro_handoff_adoption_denied', 403, 'VibePro handoff adoption is not authorized');
            }
            const result = await client.query(`
                SELECT organization_id, project_code, owner_person_id, case_id, resolution_id,
                       outcome_case_revision, decision, target, technical_acceptance, production_probe
                  FROM vibepro_handoff_adoptions
                 WHERE organization_id = $1 AND project_code = $2 AND owner_person_id = $3
                   AND case_id = $4 AND resolution_id = $5
            `, [organizationId, projectCode, access.ownerPersonId, caseId, resolutionId]);
            return sourceFromRow(result.rows[0] || null);
        });
    }
}
