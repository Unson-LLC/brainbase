import { acceptCompanyAuthorityResponse } from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';
import { authorityBinding } from './fresh-company-authority-verifier.js';

const ALLOWED_STOP_CONDITIONS = new Set([
    'revision_mismatch',
    'signature_invalid',
    'context_expired'
]);

function denied() {
    throw new ContractError('COMPANY_AUTHORITY_REJECTED', { status: 403 });
}

/**
 * Rebuild the observed request for the read-only knowledge capability from
 * the signed context. The provider and delivery binding come from the
 * accepted context; they are never replaced by a Slack default. v1 currently
 * accepts only the Slack-backed nested envelope, but keeping this mapping
 * provider-preserving prevents the knowledge verifier from acquiring the
 * external-effect assumptions of FreshCompanyAuthorityVerifier.
 */
export function observedKnowledgeRequest(context) {
    const tenant = context.tenant_context;
    const connection = tenant.workspace_connection;
    const request = {
        provider_identity: {
            provider: connection.provider,
            authenticated_subject_id: context.actor.external_subject_id,
            workspace_id: connection.workspace_id,
            app_id: connection.app_id,
            ...(tenant.slack?.enterprise_id ? { enterprise_id: tenant.slack.enterprise_id } : {})
        },
        requested_action: {
            capability_id: 'knowledge.retrieve',
            resource_ref: context.scope.resource_ref,
            project_hint: context.scope.project_id,
            desired_effect: 'read'
        },
        correlation_id: tenant.correlation_id
    };
    if (tenant.slack?.event_id && tenant.slack?.channel_id) {
        request.delivery = {
            event_id: tenant.slack.event_id,
            channel_id: tenant.slack.channel_id,
            ...(tenant.slack.thread_ts ? { thread_ts: tenant.slack.thread_ts } : {})
        };
    }
    return request;
}

export class KnowledgeCompanyAuthorityVerifier {
    constructor(options) {
        Object.assign(this, { audience: 'mana-runtime', now: () => new Date() }, options);
    }

    verify(response) {
        if (!this.deploymentId) denied();
        const { context } = acceptCompanyAuthorityResponse(response, {
            publicJwk: this.publicJwk,
            tenantContextPublicJwk: this.publicJwk,
            expectedAudience: this.audience,
            expectedDeploymentId: this.deploymentId,
            now: this.now()
        });
        const authority = context?.authority;
        const authorization = context?.tenant_context?.authorization;
        if (!context || authority?.decision !== 'auto'
            || authority.capability_id !== 'knowledge.retrieve'
            || !authority.allowed_effects.includes('read')
            || authority.stop_conditions.some((condition) => !ALLOWED_STOP_CONDITIONS.has(condition))
            || context.scope.owner_person_id !== null
            || context.tenant_context.actor.principal_type !== 'person'
            || !authorization.capability_ids.includes('knowledge.retrieve')) denied();
        return context;
    }

    async verifyCurrent(response) {
        try {
            const context = this.verify(response);
            const currentResponse = await this.companyAuthority.resolve(observedKnowledgeRequest(context));
            const current = this.verify(currentResponse);
            if (canonicalJson(authorityBinding(current)) !== canonicalJson(authorityBinding(context))) denied();
            return current;
        } catch {
            denied();
        }
    }
}
