import { FreshCompanyAuthorityVerifier } from './fresh-company-authority-verifier.js';
import { authorityProjectBinding, deriveSingleAuthorityProjectId } from './authority-project-binding.js';
import { KnowledgeResolutionService } from '../knowledge-resolution-service.js';
import { ContractError } from './errors.js';

export class AuthorityKnowledgeResolutionService extends FreshCompanyAuthorityVerifier {
    constructor({ connectionRegistry, ...options }) {
        super(options);
        this.connectionRegistry = connectionRegistry;
        this.resolver = new KnowledgeResolutionService();
    }

    async resolve(input) {
        const allowed = ['company_authority_response', 'project_code', 'intent', 'audience', 'content_type'];
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
}
