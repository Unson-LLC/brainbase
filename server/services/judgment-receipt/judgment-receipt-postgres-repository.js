import { requireCanonicalTenantIdentity } from '../../lib/canonical-tenant-identity.js';

function failure(code, message, status, cause) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    if (cause) error.cause = cause;
    return error;
}

function accessDenied(cause) {
    return failure('judgment_receipt_access_denied', 'The authenticated actor cannot access this judgment receipt', 403, cause);
}

function unavailable(cause) {
    return failure('judgment_receipt_store_unavailable', 'Judgment receipt store is unavailable', 503, cause);
}

function requiredIdentifier(value, field) {
    if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw failure('judgment_receipt_input_invalid', 'Judgment receipt identifiers are invalid', 400);
    }
    return value;
}

function ownerFromActor(actor = {}) {
    return requiredIdentifier(actor.personId, 'personId');
}

function accessFromActor(actor = {}) {
    return {
        role: typeof actor.role === 'string' && actor.role.trim() ? actor.role.trim() : 'member',
        projectCodes: Array.isArray(actor.projectCodes) ? actor.projectCodes : [],
        clearance: Array.isArray(actor.clearance) ? actor.clearance : [],
        organizationId: requireCanonicalTenantIdentity(actor)
    };
}

function receiptBinding(receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
        throw failure('judgment_receipt_input_invalid', 'Judgment receipt must be an object', 400);
    }
    return {
        resolutionId: requiredIdentifier(receipt.resolution_id, 'resolution_id'),
        turnId: requiredIdentifier(receipt.turn_id, 'turn_id'),
        projectCode: requiredIdentifier(receipt.project_code, 'project_code')
    };
}

function serializeReceipt(receipt) {
    const ancestors = new Set();
    const reject = () => { throw failure('judgment_receipt_input_invalid', 'Judgment receipt must contain only JSON values', 400); };
    const visit = (value) => {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) reject();
            return;
        }
        if (!value || typeof value !== 'object' || ancestors.has(value)) reject();
        const prototype = Object.getPrototypeOf(value);
        if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) reject();
        if (Object.getOwnPropertySymbols(value).length) reject();
        ancestors.add(value);
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                if (!Object.hasOwn(value, i)) reject();
                visit(value[i]);
            }
        } else {
            for (const key of Object.keys(value)) visit(value[key]);
        }
        ancestors.delete(value);
    };
    visit(receipt);
    return JSON.stringify(receipt);
}

export class JudgmentReceiptPostgresRepository {
    constructor({ pool, infoSSOTService } = {}) {
        if (!pool) throw new Error('Judgment receipt PostgreSQL pool is required');
        if (typeof infoSSOTService?.withAccessContext !== 'function') {
            throw new Error('Judgment receipt PostgreSQL repository requires scoped InfoSSOT access context');
        }
        this.pool = pool;
        this.infoSSOTService = infoSSOTService;
    }

    async withOwnerContext(actor, operation) {
        let ownerPersonId;
        let access;
        try {
            ownerPersonId = ownerFromActor(actor);
            access = accessFromActor(actor);
        } catch (error) {
            if (error?.status === 403) throw error;
            throw accessDenied(error);
        }
        try {
            return await this.infoSSOTService.withAccessContext(access, async (client) => {
                await client.query('SELECT set_config($1, $2, true)', [
                    'app.judgment_receipt_owner_id', ownerPersonId
                ]);
                return operation(client, { ...access, ownerPersonId });
            }, { requireCanonicalTenant: true });
        } catch (error) {
            if (error?.code === 'judgment_receipt_immutable_conflict' || error?.code === 'judgment_receipt_ambiguous') throw error;
            if (error?.code === '42501') throw accessDenied(error);
            throw unavailable(error);
        }
    }

    async record(receipt, actor = {}) {
        const binding = receiptBinding(receipt);
        const serializedReceipt = serializeReceipt(receipt);
        const projectCodes = Array.isArray(actor.projectCodes) ? actor.projectCodes : [];
        if (!projectCodes.includes(binding.projectCode)) throw accessDenied();
        return this.withOwnerContext(actor, async (client, access) => {
            const result = await client.query(`
                INSERT INTO judgment_receipts (
                    organization_id, project_code, owner_person_id, resolution_id, turn_id, receipt
                ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                ON CONFLICT (organization_id, project_code, owner_person_id, resolution_id) DO NOTHING
                RETURNING organization_id, project_code, owner_person_id, resolution_id, turn_id, receipt, created_at
            `, [
                access.organizationId, binding.projectCode, access.ownerPersonId,
                binding.resolutionId, binding.turnId, serializedReceipt
            ]);
            if (!result.rows[0]) {
                throw failure('judgment_receipt_immutable_conflict', 'Judgment receipt is already immutable', 409);
            }
            return result.rows[0];
        });
    }

    async findByResolutionId(resolutionId, actor = {}) {
        const exactResolutionId = requiredIdentifier(resolutionId, 'resolution_id');
        return this.withOwnerContext(actor, async (client, access) => {
            const result = await client.query(`
                SELECT organization_id, project_code, owner_person_id, resolution_id, turn_id, receipt, created_at
                  FROM judgment_receipts
                 WHERE resolution_id = $1
                   AND project_code = ANY($2::text[])
                   AND organization_id = NULLIF($3, '')
                   AND owner_person_id = $4
                 ORDER BY created_at ASC
            `, [exactResolutionId, access.projectCodes, access.organizationId, access.ownerPersonId]);
            if (result.rows.length > 1) {
                throw failure('judgment_receipt_ambiguous', 'Judgment receipt lookup is ambiguous', 409);
            }
            return result.rows[0] || null;
        });
    }
}
