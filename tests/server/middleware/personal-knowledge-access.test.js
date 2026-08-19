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
        BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: JSON.stringify({
            per_graph_sato: 'sato_keigo',
            per_graph_umeda: 'umeda_ryo'
        })
    };

    it('derives owner, actor, and organization from authenticated human context', () => {
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
            personId: 'person_a', organizationId: 'org_a', actorPersonId: 'person_a', proxied: false
        });
    });

    it('canonicalizes each person alias independently while preserving the authenticated actor', () => {
        const req = {
            authSource: 'bearer',
            access: { personId: 'per_graph_umeda', organizationId: 'unson' },
            body: { owner_person_id: 'umeda_ryo' }, query: {}, headers: {}
        };
        const res = response();
        const next = vi.fn();

        requirePersonalKnowledgeAccess({ env: ownerEnv })(req, res, next);

        expect(next).toHaveBeenCalledOnce();
        expect(req.personalKnowledgeAccess).toMatchObject({
            personId: 'umeda_ryo', organizationId: 'unson', actorPersonId: 'per_graph_umeda'
        });
        expect(req.access.personId).toBe('umeda_ryo');
        expect(req.access.actorPersonId).toBe('per_graph_umeda');
    });

    it('rejects all service-token and internal proxy attempts', () => {
        for (const authSource of ['service-token', 'internal']) {
            const req = {
                authSource,
                access: { personId: 'service_agent', organizationId: 'unson' },
                headers: {
                    'x-brainbase-proxy-person-id': 'per_graph_sato',
                    'x-brainbase-organization-id': 'unson'
                },
                body: {}, query: {}, params: {}
            };
            const res = response();
            const next = vi.fn();

            requirePersonalKnowledgeAccess({ env: ownerEnv })(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'personal_knowledge_service_proxy_denied' });
            expect(next).not.toHaveBeenCalled();
        }
    });

    it('rejects owner spoofing from request input, including another configured person', () => {
        const req = {
            authSource: 'bearer',
            access: { personId: 'per_graph_sato', organizationId: 'unson' },
            body: { owner_person_id: 'per_graph_umeda' }, query: {}, headers: {}
        };
        const res = response();
        const next = vi.fn();

        requirePersonalKnowledgeAccess({ env: ownerEnv })(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'personal_knowledge_scope_spoofing_rejected' });
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects organization spoofing from request input', () => {
        const req = {
            authSource: 'bearer',
            access: { personId: 'person_a', organizationId: 'org_a' },
            body: { organization_id: 'org_b' }, query: {}, headers: {}
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

    it('fails closed when alias configuration is invalid', () => {
        const req = {
            authSource: 'bearer',
            access: { personId: 'person_a', organizationId: 'org_a' },
            body: {}, query: {}, headers: {}
        };
        const res = response();

        requirePersonalKnowledgeAccess({
            env: { BRAINBASE_PERSONAL_KG_OWNER_ALIASES_JSON: '{broken' }
        })(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'personal_knowledge_identity_configuration_invalid' });
    });
});