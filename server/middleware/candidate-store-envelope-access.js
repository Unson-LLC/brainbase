import { canonicalPersonalKgOwner } from '../services/personal-kg-owner.js';

function normalized(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value).trim() || null;
}

/** Bind Candidate Store access only to fields covered by the source HMAC. */
export function requireCandidateStoreEnvelopeAccess({ env = process.env } = {}) {
    return (req, res, next) => {
        const actorPersonId = normalized(req.body?.actor_person_id);
        const organizationId = normalized(req.body?.workspace);
        const projectCode = normalized(req.body?.project_code);
        let personId;
        try {
            personId = canonicalPersonalKgOwner(actorPersonId, env);
        } catch {
            return res.status(500).json({ error: 'personal_knowledge_identity_configuration_invalid' });
        }
        if (!personId || !organizationId) {
            return res.status(403).json({ error: 'personal_knowledge_identity_required' });
        }

        const access = {
            personId,
            organizationId,
            actorPersonId,
            role: 'member',
            projectCodes: projectCode ? [projectCode] : [],
            clearance: Array.isArray(req.body?.permission_snapshot?.clearance)
                ? req.body.permission_snapshot.clearance
                : ['internal'],
            proxied: false,
            authoritySource: 'hmac_signed_raw_ledger_envelope'
        };
        req.personalKnowledgeAccess = access;
        req.access = { ...req.access, ...access };
        return next();
    };
}
