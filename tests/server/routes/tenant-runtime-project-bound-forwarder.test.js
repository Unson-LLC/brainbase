import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTenantRuntimeRouter } from '../../../server/routes/tenant-runtime.js';

const BASE_CONTEXT = {
    tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '3' },
    workspace_connection: {
        connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        connection_revision: '1',
        workspace_id: 'workspace-opaque',
        app_id: 'app-opaque'
    },
    placement: { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    contract_revision: '1',
    actor: { principal_id: 'person-sato' },
    authorization: { project_ids: ['project-unson'] },
    credential: { mode: 'customer_oauth', credential_ref: 'credref:opaque' }
};

function createApp({ context = BASE_CONTEXT, resolveProjectBindingById, credentialBroker } = {}) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/runtime', createTenantRuntimeRouter({
        serviceAuth: (_req, _res, next) => next(),
        tenantContextVerifier: (input) => input,
        connectionRegistry: {
            validateRevision: (input) => ({
                valid: true,
                authoritative: true,
                ...input,
                credential_ref: context.credential.credential_ref,
                credential_mode: context.credential.mode
            }),
            resolveProjectBindingById
        },
        credentialBroker: credentialBroker ?? {
            forwardProviderRequest: vi.fn(async () => ({
                status: 200,
                response_encoding: 'json',
                content_type: 'application/json',
                body: { ok: true }
            }))
        },
        usageLedger: {},
        tenantBoundaryGateway: {}
    }));
    return app;
}

function forwardPayload(context = BASE_CONTEXT, providerOperation = 'brainbase.authority_mcp.post') {
    return {
        tenant_context: context,
        lease_id: 'lease_01ARZ3NDEKTSV4RRFFQ69G5FB1',
        lease_token: 'opaque-lease-token',
        audience: 'bb.unson.jp',
        provider_operation: providerOperation,
        request: {
            body: {
                jsonrpc: '2.0',
                method: 'tools/call',
                project_id: 'caller-project',
                project_code: 'caller-code',
                project_ids: ['caller-project'],
                params: {
                    project_id: 'nested-caller-project',
                    project_code: 'nested-caller-code'
                }
            },
            idempotency_key: 'request-1'
        }
    };
}

function forwardRequest(app, payload) {
    return request(app)
        .post('/api/v1/runtime/provider-requests:forward')
        .set({
            authorization: 'Bearer service-test',
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': payload.tenant_context.placement.deployment_id
        })
        .send(payload);
}

describe('authority provider forwarding project binding', () => {
    it('derives one signed project id, resolves its canonical code, and binds the MCP forward', async () => {
        const resolveProjectBindingById = vi.fn(async ({ tenant_id, project_id }) => ({
            tenant_id,
            project_id,
            project_code: 'unson',
            project_payload: { status: 'active' }
        }));
        const forwardProviderRequest = vi.fn(async () => ({
            status: 200,
            response_encoding: 'json',
            content_type: 'application/json',
            body: { ok: true }
        }));
        const context = structuredClone(BASE_CONTEXT);
        const app = createApp({
            context,
            resolveProjectBindingById,
            credentialBroker: { forwardProviderRequest }
        });

        const response = await forwardRequest(app, forwardPayload(context));

        expect(response.status).toBe(200);
        expect(resolveProjectBindingById).toHaveBeenCalledOnce();
        expect(resolveProjectBindingById).toHaveBeenCalledWith({
            tenant_id: context.tenant.tenant_id,
            project_id: 'project-unson'
        });
        expect(forwardProviderRequest).toHaveBeenCalledOnce();
        expect(forwardProviderRequest.mock.calls[0][0]).toMatchObject({
            provider_operation: 'brainbase.authority_mcp.post',
            authority_project_binding: {
                project_id: 'project-unson',
                project_code: 'unson'
            }
        });
        expect(forwardProviderRequest.mock.calls[0][0]).not.toHaveProperty('project_code');
    });

    it('does not resolve project scope for existing generic operations', async () => {
        const resolveProjectBindingById = vi.fn();
        const forwardProviderRequest = vi.fn(async () => ({
            status: 200,
            response_encoding: 'json',
            content_type: 'application/json',
            body: { ok: true }
        }));
        const context = structuredClone(BASE_CONTEXT);
        const app = createApp({
            context,
            resolveProjectBindingById,
            credentialBroker: { forwardProviderRequest }
        });

        const response = await forwardRequest(app, forwardPayload(context, 'responses.create'));

        expect(response.status).toBe(200);
        expect(resolveProjectBindingById).not.toHaveBeenCalled();
        expect(forwardProviderRequest).toHaveBeenCalledWith(expect.not.objectContaining({
            authority_project_binding: expect.anything()
        }));
    });

    it.each([
        ['zero signed projects', [], undefined],
        ['multiple signed projects', ['project-unson', 'project-other'], undefined],
        ['unknown project', ['project-unson'], null],
        ['inactive project', ['project-unson'], {
            tenant_id: BASE_CONTEXT.tenant.tenant_id,
            project_id: 'project-unson',
            project_code: 'unson',
            project_payload: { status: 'inactive' }
        }],
        ['project without explicit active status', ['project-unson'], {
            tenant_id: BASE_CONTEXT.tenant.tenant_id,
            project_id: 'project-unson',
            project_code: 'unson',
            project_payload: {}
        }],
        ['cross-tenant project', ['project-unson'], {
            tenant_id: 'ten_other',
            project_id: 'project-unson',
            project_code: 'unson',
            project_payload: { status: 'active' }
        }],
        ['tenant-less project', ['project-unson'], {
            project_id: 'project-unson',
            project_code: 'unson',
            project_payload: { status: 'active' }
        }]
    ])('rejects %s before credential broker forwarding', async (_name, projectIds, project) => {
        const context = structuredClone(BASE_CONTEXT);
        context.authorization.project_ids = projectIds;
        const resolveProjectBindingById = vi.fn(async () => project);
        const forwardProviderRequest = vi.fn();
        const app = createApp({
            context,
            resolveProjectBindingById,
            credentialBroker: { forwardProviderRequest }
        });

        const response = await forwardRequest(app, forwardPayload(context));

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: 'PROJECT_SCOPE_MISMATCH' });
        expect(forwardProviderRequest).not.toHaveBeenCalled();
        if (projectIds.length === 1) {
            expect(resolveProjectBindingById).toHaveBeenCalledOnce();
        } else {
            expect(resolveProjectBindingById).not.toHaveBeenCalled();
        }
    });

    it('keeps the judgment hook fail-closed before credential broker forwarding', async () => {
        const context = structuredClone(BASE_CONTEXT);
        const resolveProjectBindingById = vi.fn(async () => ({
            tenant_id: context.tenant.tenant_id,
            project_id: 'project-unson',
            project_code: 'unson',
            project_payload: { status: 'active' }
        }));
        const forwardProviderRequest = vi.fn();
        const app = createApp({
            context,
            resolveProjectBindingById,
            credentialBroker: { forwardProviderRequest }
        });

        const response = await forwardRequest(app, forwardPayload(context, 'brainbase.authority_judgment_hook.post'));

        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({ code: 'COMPANY_AUTHORITY_HOOK_SCOPE_UNAVAILABLE' });
        expect(resolveProjectBindingById).toHaveBeenCalledOnce();
        expect(forwardProviderRequest).not.toHaveBeenCalled();
    });
});
