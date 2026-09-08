import { canonicalPersonalKgOwner } from '../services/personal-kg-owner.js';

function firstValue(source, keys) {
    for (const key of keys) {
        if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') {
            return String(source[key]).trim();
        }
    }
    return null;
}

function authenticatedPersonId(req) {
    return firstValue(req.access, ['personId', 'person_id'])
        || firstValue(req.auth, ['person_id', 'personId', 'sub']);
}

function authenticatedOrganizationId(req) {
    return firstValue(req.access, ['organizationId', 'organization_id', 'tenantId', 'tenant_id'])
        || firstValue(req.auth, ['organization_id', 'organizationId', 'tenant_id', 'tenantId']);
}

export function requirePersonalKnowledgeAccess({ env = process.env } = {}) {
    return (req, res, next) => {
        const companyAuthorityAccess = req.companyAuthorityAccess || null;
        // A service credential authenticates only the transport. It may enter a
        // human Personal KG boundary only after signed company authority has
        // independently fixed the owner, actor, organization, and project.
        if (['service-token', 'internal'].includes(req.authSource) && !companyAuthorityAccess) {
            return res.status(403).json({ error: 'personal_knowledge_service_proxy_denied' });
        }

        const actorPersonId = companyAuthorityAccess?.actorPersonId || authenticatedPersonId(req);
        const organizationId = companyAuthorityAccess?.organizationId || authenticatedOrganizationId(req);
        let personId;
        try {
            personId = canonicalPersonalKgOwner(companyAuthorityAccess?.personId || actorPersonId, env);
        } catch {
            return res.status(500).json({ error: 'personal_knowledge_identity_configuration_invalid' });
        }
        if (!personId || !organizationId) {
            return res.status(403).json({ error: 'personal_knowledge_identity_required' });
        }

        const claimedPerson = firstValue(req.body, ['owner_person_id', 'ownerPersonId'])
            || firstValue(req.query, ['owner_person_id', 'ownerPersonId']);
        const claimedOrganization = firstValue(req.body, ['organization_id', 'organizationId'])
            || firstValue(req.query, ['organization_id', 'organizationId']);
        let canonicalClaimedPerson = null;
        try {
            canonicalClaimedPerson = claimedPerson ? canonicalPersonalKgOwner(claimedPerson, env) : null;
        } catch {
            return res.status(403).json({ error: 'personal_knowledge_scope_spoofing_rejected' });
        }
        if ((canonicalClaimedPerson && canonicalClaimedPerson !== personId)
            || (claimedOrganization && claimedOrganization !== organizationId)) {
            return res.status(403).json({ error: 'personal_knowledge_scope_spoofing_rejected' });
        }

        const access = {
            personId,
            organizationId,
            actorPersonId,
            role: req.access?.role || 'member',
            projectCodes: companyAuthorityAccess?.projectCodes
                || (Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : []),
            clearance: companyAuthorityAccess?.clearance
                || (Array.isArray(req.access?.clearance) && req.access.clearance.length
                    ? req.access.clearance
                    : ['internal']),
            authorityResolutionReceiptId: companyAuthorityAccess?.authorityResolutionReceiptId || null,
            identityResolutionReceiptId: companyAuthorityAccess?.identityResolutionReceiptId || null,
            proxied: Boolean(companyAuthorityAccess)
        };
        req.personalKnowledgeAccess = access;
        req.access = {
            ...req.access,
            ...access
        };
        return next();
    };
}
