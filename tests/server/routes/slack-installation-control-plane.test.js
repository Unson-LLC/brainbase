import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerSlackInstallationControlPlaneApiRoute } from '../../../server/bootstrap/register-api-routes.js';

const binding = {
    installation_intent_id: 'insi_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAX',
    app_id: 'A0123456789',
    expected_workspace_id: 'T0123456789',
    initiated_by_person_id: 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY'
};

function createApp({ controlPlane, access = { role: 'admin', tenantId: binding.tenant_id, personId: binding.initiated_by_person_id } } = {}) {
    const app = express();
    app.use(express.json());
    registerSlackInstallationControlPlaneApiRoute(app, {
        controlPlane: controlPlane ?? {
            authorize: vi.fn(),
            authorizeBinding: vi.fn(async () => binding),
            exchange_and_register: vi.fn(async () => ({
                connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
                connection_revision: '1',
                tenant_id: binding.tenant_id,
                workspace_id: binding.expected_workspace_id,
                app_id: binding.app_id,
                status: 'active'
            }))
        },
        authMiddleware: (req, _res, next) => {
            req.access = access;
            next();
        },
        appId: binding.app_id
    });
    return app;
}

describe('Slack installation control-plane HTTP contract', () => {
    it('POST /api/v1/slack-installations:authorize returns a bounded binding without secrets', async () => {
        const controlPlane = {
            authorize: vi.fn(),
            authorizeBinding: vi.fn(async () => binding),
            exchange_and_register: vi.fn()
        };
        const response = await request(createApp({ controlPlane }))
            .post('/api/v1/slack-installations:authorize')
            .send({ expected_workspace_id: binding.expected_workspace_id });

        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.body).toEqual({ result: binding });
        expect(controlPlane.authorizeBinding).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: binding.tenant_id,
            app_id: binding.app_id
        }));
    });

    it('POST /api/v1/slack-installations:exchange-and-register forwards only the canonical request', async () => {
        const exchange = vi.fn(async () => ({
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAZ',
            connection_revision: '1',
            tenant_id: binding.tenant_id,
            workspace_id: binding.expected_workspace_id,
            app_id: binding.app_id,
            status: 'active'
        }));
        const controlPlane = {
            authorize: vi.fn(),
            authorizeBinding: vi.fn(),
            exchange_and_register: exchange
        };
        const body = {
            authorization_code: 'short-lived-code',
            redirect_uri: 'https://mana.example.test/slack/oauth/callback',
            intent: binding
        };
        const response = await request(createApp({ controlPlane }))
            .post('/api/v1/slack-installations:exchange-and-register')
            .send(body);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ result: { tenant_id: binding.tenant_id, status: 'active' } });
        expect(exchange).toHaveBeenCalledWith(body);
        expect(JSON.stringify(response.body)).not.toContain('short-lived-code');
    });

    it('rejects unknown fields and unauthorized roles before control-plane calls', async () => {
        const controlPlane = {
            authorize: vi.fn(),
            authorizeBinding: vi.fn(),
            exchange_and_register: vi.fn()
        };
        const response = await request(createApp({
            controlPlane,
            access: { role: 'member', tenantId: binding.tenant_id, personId: binding.initiated_by_person_id }
        }))
            .post('/api/v1/slack-installations:authorize')
            .send({ credential_material: 'must-not-be-accepted' });

        expect(response.status).toBe(403);
        expect(controlPlane.authorizeBinding).not.toHaveBeenCalled();

        const schemaResponse = await request(createApp({ controlPlane }))
            .post('/api/v1/slack-installations:exchange-and-register')
            .send({
                authorization_code: 'code',
                redirect_uri: 'https://mana.example.test/slack/oauth/callback',
                intent: binding,
                credential_material: 'unknown-field'
            });
        expect(schemaResponse.status).toBe(400);
        expect(controlPlane.exchange_and_register).not.toHaveBeenCalled();
    });
});
