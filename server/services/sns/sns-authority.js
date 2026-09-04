// @ts-check

export class SnsAuthorityError extends Error {
    constructor(message, { status = 403, code = 'sns_authority_invalid' } = {}) {
        super(message);
        this.name = 'SnsAuthorityError';
        this.status = status;
        this.code = code;
    }
}

function requiredString(value, field) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        throw new SnsAuthorityError(`${field} is required`, {
            status: 401,
            code: 'sns_authority_required'
        });
    }
    return normalized;
}

export function requireSnsAuthority(input = {}) {
    const ownerPersonId = requiredString(
        input.owner_person_id || input.ownerPersonId || input.person_id || input.personId || input.sub,
        'owner_person_id'
    );
    const actorPersonId = requiredString(
        input.actor_person_id || input.actorPersonId || input.person_id || input.personId || input.sub,
        'actor_person_id'
    );
    const organizationId = requiredString(
        input.organization_id || input.organizationId || input.tenant_id || input.tenantId,
        'organization_id'
    );
    if (ownerPersonId !== actorPersonId) {
        throw new SnsAuthorityError('delegated SNS authority is not configured', {
            code: 'sns_delegation_required'
        });
    }
    return {
        owner_person_id: ownerPersonId,
        actor_person_id: actorPersonId,
        organization_id: organizationId,
        sub: actorPersonId,
        role: input.role || 'member',
        org_ids: Array.from(new Set([
            organizationId,
            ...(Array.isArray(input.org_ids) ? input.org_ids : [])
        ])),
        projectCodes: Array.isArray(input.projectCodes)
            ? input.projectCodes
            : (Array.isArray(input.project_codes) ? input.project_codes : [])
    };
}

export function snsAuthorityFromRequest(req) {
    const access = req?.access || {};
    return requireSnsAuthority({
        ...access,
        personId: access.personId || req?.auth?.person_id || req?.auth?.personId || req?.auth?.sub,
        actorPersonId: access.actorPersonId || access.personId || req?.auth?.person_id || req?.auth?.personId || req?.auth?.sub,
        organizationId: access.organizationId || access.tenantId
    });
}

export function isSnsRecordInAuthority(record, authority) {
    if (!record || !authority) return false;
    return record.owner_person_id === authority.owner_person_id
        && record.organization_id === authority.organization_id;
}

export function assertSnsRecordAuthority(record, authority) {
    if (!isSnsRecordInAuthority(record, authority)) {
        throw new SnsAuthorityError('SNS record is outside the authenticated authority scope', {
            code: 'sns_record_scope_mismatch'
        });
    }
    return record;
}
