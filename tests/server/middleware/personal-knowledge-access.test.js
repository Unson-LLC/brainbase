import { describe, expect, it, vi } from 'vitest';

import { requirePersonalKnowledgeAccess } from '../../../server/middleware/personal-knowledge-access.js';

function response() {
    return {
        status: vi.fn(function status() { return this; }),
        json: vi.fn(function json() { return this; })
    };
}

describe('requirePersonalKnowledgeAccess', () => {
    const ownerEnv = {
        BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID: 'sato_keigo',
        BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS: 'per_graph_sato'
    };

    it('derives owner and organization from authenticated human context', () => {
        const req = {
            authSource: 'bearer',
            access: { personId: 'person_a', organizationId: 'org_a', tenantId: 'org_a' },
            body: {}, query: {}, headers: {}
        };
        const res = response();
        const next = vi.fn();

        requirePersonalKnowledgeAccess()(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.personalKnowledgeAccess).toMatchObject({
            personId: 'person_a', organizationId: 'org_a', actorPersonId: 'person_a'
        });
    });

    it('canonicalizes a configured Personal KG owner alias while preserving the actor identity', () => {
        const req = {
            authSource: 'bearer',
            access: { personId: 'per_graph_sato', organizationId: 'unson' },
            body: { owner_person_id: 'per_graph_sato' }, query: {}, headers: {}
        };
        const res = response();
        const next = vi.fn();

        requirePersonalKnowledgeAccess({ env: ownerEnv })(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.personalKnowledgeAccess).toMatchObject({
            personId: 'sato_keigo', organizationId: 'unson', actorPersonId: 'per_graph_sato'
        });
        expect(req.access.personId).toBe('sato_keigo');
        expect(req.access.actorPersonId).toBe('per_graph_sato');
    });

    it('canonicalizes a proxied owner alias but keeps the service as the actor', async () => {
        const req = {
            authSource: 'service-token',
            access: { personId: 'service_agent', organizationId: 'unson' },
            headers: {
                'x-brainbase-proxy-person-id': 'per_graph_sato',
                'x-brainbase-organization-id': 'unson'
            },
            body: {}, query: {}, params: {}
        };
        const audit = vi.fn(async () => {});
        const next = vi.fn();

        await requirePersonalKnowledgeAccess({ audit, env: ownerEnv })(req, response(), next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.access).toMatchObject({
            personId: 'sato_keigo', actorPersonId: 'service_agent', organizationId: 'unson'
        });
        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            personId: 'sato_keigo', actorPersonId: 'service_agent'
        }));
    });

    it('rejects owner spoofing from request input', () => {
        const req = {
            authSource: 'bearer',
            access: { personId: 'person_a', organizationId: 'org_a' },
            body: { owner_person_id: 'person_b' }, query: {}, headers: {}
        };
        const res = response();
        const next = vi.fn();

        requirePersonalKnowledgeAccess()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('fails closed when human identity or organization is absent', () => {
        const req = { authSource: 'bearer', access: { personId: 'person_a' }, body: {}, query: {}, headers: {} };
        const res = response();

        requirePersonalKnowledgeAccess()(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'personal_knowledge_identity_required' });
    });

    it('requires explicit proxy person and organization for service authentication', () => {
        const req = {
            authSource: 'service-token',
            access: { personId: 'service_agent', organizationId: 'org_a' },
            headers: {}, body: {}, query: {}
        };
        const res = response();

        requirePersonalKnowledgeAccess()(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'personal_knowledge_proxy_required' });
    });

    it('audits service proxy access before continuing and fails closed when audit fails', async () => {
        const req = {
            authSource: 'service-token',
            access: { personId: 'service_agent', organizationId: 'org_a' },
            headers: {
                'x-brainbase-proxy-person-id': 'person_a',
                'x-brainbase-organization-id': 'org_a',
                'x-brainbase-access-reason': 'routine'
            },
            body: {}, query: {}, params: {}
        };
        const next = vi.fn();
        const audit = vi.fn(async () => { throw new Error('db unavailable'); });
        const res = response();

        await requirePersonalKnowledgeAccess({ audit })(req, res, next);

        expect(audit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'personal_knowledge_proxy', personId: 'person_a', actorPersonId: 'service_agent'
        }));
        expect(res.status).toHaveBeenCalledWith(500);
        expect(next).not.toHaveBeenCalled();
    });
});
