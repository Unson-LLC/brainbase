// @vitest-environment node

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { requirePersonalKnowledgeAccess } from '../../../../server/middleware/personal-knowledge-access.js';
import { requirePersonalKnowledgeCompanyAuthority } from '../../../../server/middleware/personal-knowledge-company-authority.js';
import { createPersonalKnowledgeRouter } from '../../../../server/routes/personal-knowledge.js';
import { PersonalKnowledgeService } from '../../../../server/services/personal-knowledge/personal-knowledge-service.js';
import { createTrustedProviderForwardersFromEnv } from '../../../../server/services/multitenant/trusted-provider-forwarder.js';
import { createPersonalKnowledgeAuthority } from '../../../helpers/personal-knowledge-client-authority.js';

class InMemoryPersonalKnowledgeRepository {
    constructor() {
        this.events = new Map();
    }

    async transaction(work) {
        return work({ client: this });
    }

    async findById(eventId) {
        const event = this.events.get(eventId);
        return event ? structuredClone(event) : null;
    }

    async createEvent(event) {
        if (this.events.has(event.event_id)) return null;
        this.events.set(event.event_id, structuredClone(event));
        return structuredClone(event);
    }

    async appendTransition(eventId, transition) {
        const event = this.events.get(eventId);
        if (event) {
            if (transition.processing_stage) event.processing_stage = transition.processing_stage;
            if (transition.semantic_state) event.semantic_state = transition.semantic_state;
        }
        return structuredClone(transition);
    }

    async search({ query, limit }) {
        return [...this.events.values()]
            .filter((event) => !query || event.body?.includes(query))
            .filter((event) => event.semantic_state !== 'retracted')
            .slice(0, limit)
            .map((event) => structuredClone(event));
    }
}

function createApp({ authority, repository, requests, connectionRegistry = {
    resolveProjectBindingById: async ({ tenant_id, project_id }) => ({
        tenant_id,
        project_id,
        project_code: 'project-a',
        project_status: 'active'
    })
} }) {
    const service = new PersonalKnowledgeService({ repository });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        if (req.get('authorization') !== 'Bearer personal-kg-service-jwt') {
            return res.status(401).json({ error: 'service_token_invalid' });
        }
        requests.push({
            method: req.method,
            path: req.path,
            authorization: req.get('authorization'),
            operation: req.get('brainbase-provider-operation'),
            body: structuredClone(req.body)
        });
        req.authSource = 'service-token';
        req.access = { projectCodes: ['project-a'] };
        return next();
    });
    app.use('/api/personal-knowledge',
        requirePersonalKnowledgeCompanyAuthority({ env: authority.env, connectionRegistry }),
        requirePersonalKnowledgeAccess(),
        createPersonalKnowledgeRouter({ personalKnowledgeService: service, promotionService: {} }));
    return app;
}

function appFetch(app) {
    return async (rawUrl, init = {}) => {
        const url = new URL(rawUrl);
        const method = String(init.method || 'GET').toLowerCase();
        const client = request(app)[method](url.pathname);
        const headers = new Headers(init.headers);
        for (const [name, value] of headers) client.set(name, value);
        const response = init.body === undefined
            ? await client
            : await client.send(JSON.parse(String(init.body)));
        return {
            status: response.status,
            headers: { get: (name) => response.headers[String(name).toLowerCase()] || null },
            text: async () => response.text || ''
        };
    };
}

function createForwarders({ authority, fetchImpl }) {
    const env = {
        ...authority.env,
        BB_PERSONAL_KG_SERVICE_JWT: 'personal-kg-service-jwt',
        BRAINBASE_TENANT_PROVIDER_FORWARDERS_JSON: JSON.stringify({
            'bb.unson.jp': {
                provider: 'brainbase',
                base_url: 'https://bb.unson.jp',
                operations: {
                    'brainbase.personal_knowledge.search': {
                        method: 'POST',
                        path: '/api/personal-knowledge/search',
                        body_encoding: 'json',
                        response_encoding: 'utf8',
                        credential_placement: 'none',
                        allow_binding_provider_mismatch: true,
                        service_bearer_env: 'BB_PERSONAL_KG_SERVICE_JWT'
                    },
                    'brainbase.personal_knowledge.register': {
                        method: 'POST',
                        path: '/api/personal-knowledge/events',
                        body_encoding: 'json',
                        response_encoding: 'utf8',
                        credential_placement: 'none',
                        allow_binding_provider_mismatch: true,
                        service_bearer_env: 'BB_PERSONAL_KG_SERVICE_JWT'
                    }
                }
            }
        })
    };
    return createTrustedProviderForwardersFromEnv({ env, fetchImpl })['bb.unson.jp'];
}

describe('Personal KG trusted provider forwarder integration', () => {
    it('forwards signed register/search to the real middleware and service, preserving a UTF-8 result array', async () => {
        const authority = createPersonalKnowledgeAuthority({ project: 'project-id-a' });
        const writeAuthority = createPersonalKnowledgeAuthority({ effect: 'write', project: 'project-id-a' });
        const repository = new InMemoryPersonalKnowledgeRepository();
        const requests = [];
        const fetchCalls = [];
        const app = createApp({ authority, repository, requests });
        const forwarder = createForwarders({
            authority,
            fetchImpl: async (url, init) => {
                fetchCalls.push({ url, init });
                return appFetch(app)(url, init);
            }
        });
        const eventBody = {
            event_id: 'pke_forwarder_register_1',
            body: 'forwarder private decision',
            body_hash: 'sha256:forwarder-private-decision',
            source: { type: 'manual' },
            source_pointer: { fixture: 'forwarder' },
            company_authority_response: writeAuthority.response
        };

        const registered = await forwarder.forward({
            credential: Buffer.alloc(0),
            operation: 'brainbase.personal_knowledge.register',
            request: { body: eventBody }
        });

        expect(registered.status).toBe(201);
        expect(registered.response_encoding).toBe('utf8');
        expect(JSON.parse(registered.body)).toMatchObject({
            event_id: eventBody.event_id,
            owner_person_id: 'person-sato',
            organization_id: 'organization-tenant-a'
        });
        expect(requests[0]).toMatchObject({
            method: 'POST',
            path: '/api/personal-knowledge/events',
            authorization: 'Bearer personal-kg-service-jwt',
            operation: 'brainbase.personal_knowledge.register',
            body: eventBody
        });
        expect(fetchCalls[0]).toMatchObject({
            url: 'https://bb.unson.jp/api/personal-knowledge/events',
            init: { method: 'POST', redirect: 'error' }
        });

        const searchBody = {
            query: 'forwarder private',
            limit: 5,
            company_authority_response: authority.response
        };
        const searched = await forwarder.forward({
            credential: Buffer.alloc(0),
            operation: 'brainbase.personal_knowledge.search',
            request: { body: searchBody }
        });

        expect(searched).toMatchObject({ status: 200, response_encoding: 'utf8' });
        expect(typeof searched.body).toBe('string');
        expect(JSON.parse(searched.body)).toEqual([
            expect.objectContaining({
                event_id: eventBody.event_id,
                body: eventBody.body,
                owner_person_id: 'person-sato',
                organization_id: 'organization-tenant-a'
            })
        ]);
        expect(requests[1]).toMatchObject({
            method: 'POST',
            path: '/api/personal-knowledge/search',
            authorization: 'Bearer personal-kg-service-jwt',
            operation: 'brainbase.personal_knowledge.search',
            body: searchBody
        });
        expect(fetchCalls[1]).toMatchObject({
            url: 'https://bb.unson.jp/api/personal-knowledge/search',
            init: { method: 'POST', redirect: 'error' }
        });
    });

    it('rejects an unsigned service request before the real service can persist an event', async () => {
        const authority = createPersonalKnowledgeAuthority();
        const repository = new InMemoryPersonalKnowledgeRepository();
        const requests = [];
        const fetchCalls = [];
        const app = createApp({ authority, repository, requests });
        const forwarder = createForwarders({
            authority,
            fetchImpl: async (url, init) => {
                fetchCalls.push({ url, init });
                return appFetch(app)(url, init);
            }
        });

        const result = await forwarder.forward({
            credential: Buffer.alloc(0),
            operation: 'brainbase.personal_knowledge.register',
            request: {
                body: {
                    event_id: 'pke_forwarder_unsigned_1',
                    body: 'must not persist',
                    body_hash: 'sha256:unsigned'
                }
            }
        });

        expect(result).toMatchObject({ status: 403, response_encoding: 'utf8' });
        expect(JSON.parse(result.body)).toEqual({ error: 'personal_knowledge_service_proxy_denied' });
        expect(repository.events.size).toBe(0);
        expect(requests[0]).toMatchObject({
            path: '/api/personal-knowledge/events',
            operation: 'brainbase.personal_knowledge.register'
        });
        expect(fetchCalls[0]).toMatchObject({
            url: 'https://bb.unson.jp/api/personal-knowledge/events',
            init: { method: 'POST', redirect: 'error' }
        });
    });
});
