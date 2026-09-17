import http from 'node:http';

import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { registerKnowledgeCatalogApiRoute } from '../../server/bootstrap/register-api-routes.js';
import { KnowledgeCatalogService } from '../../server/services/knowledge-catalog-service.js';
import { handleKnowledgeResolutionToolCall } from '../../mcp/brainbase/src/tools/knowledge-resolution-tools.ts';

function encode(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function codexJwt(claims) {
    return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.codex-test-signature`;
}

function createFixture() {
    const tokenClaims = {
        sub: 'person-codex',
        organizationId: 'org-codex',
        projectCodes: ['alpha'],
        role: 'member',
        clearance: ['internal'],
        authProvider: 'codex',
        providerSubject: 'codex-person',
        providerTenant: 'codex-workspace'
    };
    const token = codexJwt(tokenClaims);
    const accessLog = [];
    const decision = {
        id: 'decision-alpha',
        entity_type: 'decision',
        project_code: 'alpha',
        payload: {
            title: 'Alpha canonical decision',
            statement: 'Codex may use the alpha decision.',
            status: 'active',
            version: '7',
            source_url: 'brainbase://graph/decision-alpha'
        },
        updated_at: '2026-09-17T00:00:00.000Z'
    };
    const infoSSOTService = {
        async listGraphEntities(access, options = {}) {
            accessLog.push({ access, options });
            if (options.id === decision.id && options.projectCode === decision.project_code) {
                return [decision];
            }
            return [];
        },
        async listGraphEdges() {
            return [];
        }
    };
    const authService = {
        verifyToken(value) {
            if (value !== token) throw new Error('unknown token');
            return tokenClaims;
        }
    };
    const catalogService = new KnowledgeCatalogService({ infoSSOTService });
    const app = express();
    app.use(express.json());
    registerKnowledgeCatalogApiRoute(app, {
        authService,
        infoSSOTService,
        service: catalogService
    });
    return { app, authService, catalogService, accessLog, decision, token };
}

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

function close(server) {
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('Codex principal knowledge retrieval', () => {
    it('Codex-shaped JWT reaches the catalog and cannot read another project', async () => {
        // Doubles are limited to authService.verifyToken and Graph list reads;
        // the route registration, requireAuth, catalog service, and HTTP server
        // are the production implementations under test.
        const fixture = createFixture();
        const headers = { Authorization: `Bearer ${fixture.token}` };
        const args = {
            project_code: 'alpha',
            refs: [{ id: fixture.decision.id, version: '7' }]
        };

        const direct = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set(headers)
            .send(args)
            .expect(200);
        expect(direct.body).toMatchObject({
            project_code: 'alpha',
            results: [{
                id: fixture.decision.id,
                status: 'resolved',
                requested_version: '7',
                resolved_version: '7',
                content: 'Codex may use the alpha decision.',
                retrieval_receipt_id: 'graph:decision-alpha:7'
            }]
        });
        expect(fixture.accessLog[0].access).toMatchObject({
            personId: 'person-codex',
            organizationId: 'org-codex',
            projectCodes: ['alpha'],
            authProvider: 'codex'
        });

        const denied = await request(fixture.app)
            .post('/api/knowledge/retrieve-principal')
            .set(headers)
            .send({ ...args, project_code: 'beta' })
            .expect(403);
        expect(denied.body.error).toMatchObject({ code: 'knowledge_project_not_accessible' });

        const server = await listen(fixture.app);
        try {
            const address = server.address();
            const apiUrl = `http://127.0.0.1:${address.port}`;
            const mcp = await handleKnowledgeResolutionToolCall('brainbase_knowledge_retrieve', args, {
                apiUrl,
                configuredProjectCodes: ['alpha'],
                tokenManager: { getToken: async () => fixture.token }
            });
            expect(mcp).toMatchObject({
                status: 'ok',
                scope: { project_codes: ['alpha'] },
                data: {
                    project_code: 'alpha',
                    results: [{
                        id: fixture.decision.id,
                        status: 'resolved',
                        content: 'Codex may use the alpha decision.',
                        retrieval_receipt_id: 'graph:decision-alpha:7'
                    }]
                }
            });
        } finally {
            await close(server);
        }
    });
});
