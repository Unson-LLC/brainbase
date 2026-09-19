import { KnowledgeCompanyAuthorityVerifier } from './knowledge-company-authority-verifier.js';
import { authorityProjectBinding, deriveSingleAuthorityProjectId } from './authority-project-binding.js';
import { KnowledgeResolutionService } from '../knowledge-resolution-service.js';
import { ContractError } from './errors.js';

const GRAPH_ROLES = new Set(['member', 'gm', 'ceo']);
const GRAPH_CLEARANCES = new Set(['internal', 'restricted', 'finance', 'hr', 'contract']);

function authorityAccess(tenant, context, binding) {
    // The company-authority v1 wire intentionally carries only its four
    // authorization arrays. Membership access therefore travels in the
    // opaque data_scopes array using a namespaced representation; never trust
    // an authority-shaped object injected into the signed context.
    const scopes = Array.isArray(tenant.authorization?.data_scopes)
        ? tenant.authorization.data_scopes
        : [];
    const clearance = [...new Set(scopes.flatMap((scope) => {
        if (typeof scope !== 'string' || scope.length === 0) return [];
        const value = scope.startsWith('clearance:') ? scope.slice('clearance:'.length) : scope;
        return GRAPH_CLEARANCES.has(value) ? [value] : [];
    }))];
    const scopedRole = scopes.find((scope) => (
        typeof scope === 'string' && scope.startsWith('role:')
    ))?.slice('role:'.length).toLowerCase();
    const role = GRAPH_ROLES.has(scopedRole) ? scopedRole : 'member';
    return {
        personId: context.actor?.canonical_person_id ?? null,
        actorPersonId: context.actor?.canonical_person_id ?? null,
        role,
        projectCodes: [binding.project_code],
        clearance,
        organizationId: context.scope?.organization_id ?? tenant.authorization?.organization_ids?.[0] ?? null,
        tenantId: tenant.tenant.tenant_id,
        capability: 'knowledge.retrieve',
        authSource: 'company-authority'
    };
}

export class AuthorityKnowledgeResolutionService extends KnowledgeCompanyAuthorityVerifier {
    constructor({ connectionRegistry, knowledgeCatalogService = null, ...options }) {
        super(options);
        this.connectionRegistry = connectionRegistry;
        this.knowledgeCatalogService = knowledgeCatalogService;
        this.resolver = new KnowledgeResolutionService();
    }

    setKnowledgeCatalogService(service) {
        this.knowledgeCatalogService = service;
    }

    async resolveAuthorityScope(input, allowed) {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).some((key) => !allowed.includes(key))) {
            throw new ContractError('SCHEMA_INVALID', { status: 400 });
        }
        const context = await this.verifyCurrent(input.company_authority_response);
        const tenant = context.tenant_context;
        const projectId = deriveSingleAuthorityProjectId(tenant);
        if (projectId !== context.scope.project_id || !this.connectionRegistry?.resolveProjectBindingById) {
            throw new ContractError('PROJECT_SCOPE_MISMATCH', { status: 403 });
        }
        const binding = authorityProjectBinding(await this.connectionRegistry.resolveProjectBindingById({
            tenant_id: tenant.tenant.tenant_id, project_id: projectId
        }), { tenantId: tenant.tenant.tenant_id, projectId });
        if (input.project_code !== undefined && input.project_code !== binding.project_code) {
            throw new ContractError('PROJECT_SCOPE_MISMATCH', { status: 403 });
        }
        return {
            context,
            tenant,
            binding,
            access: authorityAccess(tenant, context, binding)
        };
    }

    async resolve(input) {
        const allowed = ['company_authority_response', 'project_code', 'intent', 'audience', 'content_type'];
        const { binding } = await this.resolveAuthorityScope(input, allowed);
        // This is a routing receipt only. Each subsequent retrieval retains its own authorization.
        try {
            return this.resolver.resolve({
                project_code: binding.project_code, intent: input.intent,
                audience: input.audience, content_type: input.content_type
            });
        } catch (error) {
            if (error instanceof TypeError) throw new ContractError('SCHEMA_INVALID', { status: 400 });
            throw error;
        }
    }

    async retrieve(input) {
        const allowed = ['company_authority_response', 'project_code', 'refs'];
        const { binding, access } = await this.resolveAuthorityScope(input, allowed);
        if (typeof this.knowledgeCatalogService?.retrieve !== 'function') {
            throw new ContractError('UPSTREAM_UNAVAILABLE', { status: 503, retryable: true });
        }
        return this.knowledgeCatalogService.retrieve(access, {
            project_code: binding.project_code,
            refs: input.refs
        });
    }
}
