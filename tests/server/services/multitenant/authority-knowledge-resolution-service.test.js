// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AuthorityKnowledgeResolutionService } from '../../../../server/services/multitenant/authority-knowledge-resolution-service.js';
import { createPersonalKnowledgeAuthority } from '../../../helpers/personal-knowledge-client-authority.js';

const now = new Date('2026-09-16T08:00:00.000Z');

function authority(options = {}) {
    const { mutate: extraMutate, ...overrides } = options;
    return createPersonalKnowledgeAuthority({
        now,
        owner: 'person-requester',
        externalSubjectId: 'UREQUESTER',
        channel: 'CDEST',
        capability: 'knowledge.retrieve',
        effect: 'read',
        resourceRef: 'project:project-a',
        dataScopes: ['internal'],
        ...overrides,
        mutate: ({ context, request: authorityRequest }) => {
            context.scope.owner_person_id = null;
            extraMutate?.({ context, request: authorityRequest });
        }
    });
}

function setup({ proof = authority(), current = proof, project = {} } = {}) {
    const tenantId = proof.context.tenant_context.tenant.tenant_id;
    const projectId = proof.context.scope.project_id;
    const companyAuthority = {
        resolve: vi.fn(async () => current.response)
    };
    const connectionRegistry = {
        resolveProjectBindingById: vi.fn(async () => ({
            tenant_id: tenantId,
            project_id: projectId,
            project_code: 'project-a',
            status: 'active',
            ...project
        }))
    };
    const service = new AuthorityKnowledgeResolutionService({
        companyAuthority,
        connectionRegistry,
        deploymentId: proof.context.scope.placement_id,
        publicJwk: proof.publicJwk,
        now: () => now
    });
    const input = {
        company_authority_response: proof.response,
        project_code: 'project-a',
        intent: 'find the canonical person record',
        audience: 'team',
        content_type: 'canonical_fact'
    };
    return { companyAuthority, connectionRegistry, input, service, proof };
}

describe('AuthorityKnowledgeResolutionService', () => {
    it('resolves a valid C-channel authority for the bound project', async () => {
        const test = setup();

        await expect(test.service.resolve(test.input)).resolves.toMatchObject({
            status: 'resolved',
            project_code: 'project-a',
            content_type: 'canonical_fact',
            source_class: 'graph',
            retrieval_capability: 'graph.search'
        });
        expect(test.connectionRegistry.resolveProjectBindingById).toHaveBeenCalledWith({
            tenant_id: test.proof.context.tenant_context.tenant.tenant_id,
            project_id: 'project-a'
        });
        expect(test.companyAuthority.resolve).toHaveBeenCalledWith(expect.objectContaining({
            provider_identity: expect.objectContaining({
                provider: 'slack',
                authenticated_subject_id: 'UREQUESTER',
                workspace_id: test.proof.context.tenant_context.workspace_connection.workspace_id
            }),
            requested_action: {
                capability_id: 'knowledge.retrieve',
                resource_ref: 'project:project-a',
                project_hint: 'project-a',
                desired_effect: 'read'
            },
            delivery: expect.objectContaining({ channel_id: 'CDEST' })
        }));
    });

    it('rejects a tampered authority before calling current authority or project resolution', async () => {
        const test = setup();
        const tampered = structuredClone(test.input.company_authority_response);
        tampered.context.tenant_context.slack.channel_id = 'COTHER';

        await expect(test.service.resolve({
            ...test.input,
            company_authority_response: tampered
        })).rejects.toMatchObject({ code: 'COMPANY_AUTHORITY_REJECTED', status: 403 });
        expect(test.companyAuthority.resolve).not.toHaveBeenCalled();
        expect(test.connectionRegistry.resolveProjectBindingById).not.toHaveBeenCalled();
    });

    it('rejects an external-effect authority on the knowledge route', async () => {
        const test = setup({ proof: authority({ capability: 'runtime.execute', effect: 'external_side_effect' }) });

        await expect(test.service.resolve(test.input)).rejects.toMatchObject({
            code: 'COMPANY_AUTHORITY_REJECTED',
            status: 403
        });
        expect(test.companyAuthority.resolve).not.toHaveBeenCalled();
        expect(test.connectionRegistry.resolveProjectBindingById).not.toHaveBeenCalled();
    });

    it('rejects an expired authority before calling dependencies', async () => {
        const proof = authority({
            issuedAt: new Date(now.getTime() - 300_000),
            expiresAt: new Date(now.getTime() - 60_000)
        });
        const test = setup({ proof });

        await expect(test.service.resolve(test.input)).rejects.toMatchObject({
            code: 'COMPANY_AUTHORITY_REJECTED',
            status: 403
        });
        expect(test.companyAuthority.resolve).not.toHaveBeenCalled();
        expect(test.connectionRegistry.resolveProjectBindingById).not.toHaveBeenCalled();
    });

    it('rejects a revoked authority response from the current authority service', async () => {
        const test = setup();
        test.companyAuthority.resolve.mockResolvedValue({
            context: null,
            error: { code: 'MEMBERSHIP_INACTIVE' }
        });

        await expect(test.service.resolve(test.input)).rejects.toMatchObject({
            code: 'COMPANY_AUTHORITY_REJECTED',
            status: 403
        });
        expect(test.companyAuthority.resolve).toHaveBeenCalledOnce();
        expect(test.connectionRegistry.resolveProjectBindingById).not.toHaveBeenCalled();
    });

    it.each([
        ['actor', ({ context }) => {
            context.actor.canonical_person_id = 'person-other';
            context.tenant_context.actor.principal_id = 'person-other';
        }],
        ['tenant revision', ({ context }) => {
            context.tenant_context.tenant.tenant_revision = '999';
        }],
        ['destination channel', ({ context }) => {
            context.tenant_context.slack.channel_id = 'COTHER';
        }],
        ['membership revision', ({ context }) => {
            context.actor.membership_revision = '999';
        }]
    ])('rejects when the current %s binding changes', async (_binding, mutate) => {
        const test = setup({ current: authority({ mutate }) });

        await expect(test.service.resolve(test.input)).rejects.toMatchObject({
            code: 'COMPANY_AUTHORITY_REJECTED',
            status: 403
        });
        expect(test.companyAuthority.resolve).toHaveBeenCalledOnce();
        expect(test.connectionRegistry.resolveProjectBindingById).not.toHaveBeenCalled();
    });

    it('rejects a project code that differs from the canonical authority project', async () => {
        const test = setup();

        await expect(test.service.resolve({
            ...test.input,
            project_code: 'project-other'
        })).rejects.toMatchObject({ code: 'PROJECT_SCOPE_MISMATCH', status: 403 });
        expect(test.companyAuthority.resolve).toHaveBeenCalledOnce();
        expect(test.connectionRegistry.resolveProjectBindingById).toHaveBeenCalledOnce();
    });

    it.each([
        ['a cross-tenant canonical project', { tenant_id: 'tenant-other' }],
        ['an inactive canonical project', { status: 'inactive' }]
    ])('rejects %s', async (_description, project) => {
        const test = setup({ project });

        await expect(test.service.resolve(test.input)).rejects.toMatchObject({
            code: 'PROJECT_SCOPE_MISMATCH',
            status: 403
        });
        expect(test.connectionRegistry.resolveProjectBindingById).toHaveBeenCalledOnce();
    });
});
