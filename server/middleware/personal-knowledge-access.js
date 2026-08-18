import { canonicalPersonalKgOwner } from '../services/personal-kg-owner.js';

function firstValue(source, keys) {
    for (const key of keys) {
        if (source?.[key] !== undefined && source[key] !== null && source[key] !== '') return String(source[key]);
    }
    return null;
}

export function requirePersonalKnowledgeAccess({ audit = null, env = process.env } = {}) {
    return (req, res, next) => {
        const isService = ['service-token', 'internal'].includes(req.authSource);
        const proxyPersonId = firstValue(req.headers, ['x-brainbase-proxy-person-id']);
        const proxyOrganizationId = firstValue(req.headers, ['x-brainbase-organization-id']);
        if (isService && (!proxyPersonId || !proxyOrganizationId)) {
            return res.status(403).json({ error: 'personal_knowledge_proxy_required' });
        }

        const actorPersonId = req.access?.personId || req.auth?.sub || proxyPersonId;
        const rawPersonId = isService ? proxyPersonId : req.access?.personId;
        const personId = canonicalPersonalKgOwner(rawPersonId, env);
        const organizationId = isService
            ? proxyOrganizationId
            : (req.access?.organizationId || req.access?.tenantId);
        if (!personId || !organizationId) {
            return res.status(403).json({ error: 'personal_knowledge_identity_required' });
        }

        const claimedPerson = firstValue(req.body, ['owner_person_id', 'ownerPersonId'])
            || firstValue(req.query, ['owner_person_id', 'ownerPersonId']);
        const claimedOrganization = firstValue(req.body, ['organization_id', 'organizationId'])
            || firstValue(req.query, ['organization_id', 'organizationId']);
        if ((claimedPerson && canonicalPersonalKgOwner(claimedPerson, env) !== personId)
            || (claimedOrganization && claimedOrganization !== organizationId)) {
            return res.status(403).json({ error: 'personal_knowledge_scope_spoofing_rejected' });
        }

        req.personalKnowledgeAccess = {
            personId,
            organizationId,
            actorPersonId: actorPersonId || personId,
            role: req.access?.role || 'member',
            projectCodes: req.access?.projectCodes || [],
            clearance: req.access?.clearance || ['internal'],
            proxied: isService
        };
        req.access = {
            ...req.access,
            personId,
            organizationId,
            actorPersonId: actorPersonId || personId
        };
        if (isService && audit) {
            return Promise.resolve(audit({
                action: 'personal_knowledge_proxy',
                resourceKind: 'personal_knowledge_api',
                resourceId: req.params?.eventId || req.params?.requestId || null,
                reason: firstValue(req.headers, ['x-brainbase-access-reason']),
                ...req.personalKnowledgeAccess
            })).then(() => next()).catch(() => res.status(500).json({ error: 'personal_knowledge_audit_failed' }));
        }
        return next();
    };
}
