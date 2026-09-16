import { acceptCompanyAuthorityResponse } from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';
function denied() { throw new ContractError('COMPANY_AUTHORITY_REJECTED', { status: 403 }); }

// Only stable authority bindings participate: issuance timestamps change on refresh.
export function authorityBinding(context) {
    const tenant = context.tenant_context;
    return {
        actor: context.actor, scope: context.scope, authority: context.authority,
        evidence: context.evidence, tenant: tenant.tenant,
        workspace_connection: tenant.workspace_connection,
        authorization: tenant.authorization, slack: tenant.slack,
        placement: tenant.placement
    };
}

function observedRequest(context) {
    const tenant = context.tenant_context;
    return {
        provider_identity: {
            provider: 'slack', authenticated_subject_id: context.actor.external_subject_id,
            workspace_id: tenant.workspace_connection.workspace_id,
            app_id: tenant.workspace_connection.app_id,
            ...(tenant.slack.enterprise_id ? { enterprise_id: tenant.slack.enterprise_id } : {})
        },
        requested_action: {
            capability_id: 'runtime.execute', resource_ref: context.scope.resource_ref,
            project_hint: context.scope.project_id, desired_effect: 'external_side_effect'
        },
        delivery: {
            event_id: tenant.slack.event_id, channel_id: tenant.slack.channel_id,
            ...(tenant.slack.thread_ts ? { thread_ts: tenant.slack.thread_ts } : {})
        },
        correlation_id: tenant.correlation_id
    };
}

export class FreshCompanyAuthorityVerifier {
    constructor(options) { Object.assign(this, { audience: 'mana-runtime', now: () => new Date() }, options); }

    verify(response) {
        if (!this.deploymentId) denied();
        const { context } = acceptCompanyAuthorityResponse(response, {
            publicJwk: this.publicJwk, tenantContextPublicJwk: this.publicJwk,
            expectedAudience: this.audience, expectedDeploymentId: this.deploymentId, now: this.now()
        });
        if (!context || context.authority.decision !== 'auto'
            || context.authority.capability_id !== 'runtime.execute'
            || !context.authority.allowed_effects.includes('external_side_effect')
            // These contract conditions are enforced by signature/time verification
            // and the fresh authority comparison below. Unknown conditions deny.
            || context.authority.stop_conditions.some((condition) => !['revision_mismatch', 'signature_invalid', 'context_expired'].includes(condition))
            || context.scope.owner_person_id !== null
            || context.tenant_context.actor.principal_type !== 'person'
            || context.tenant_context.workspace_connection.provider !== 'slack'
            || !/^[CDG][A-Z0-9]+$/.test(context.tenant_context.slack.channel_id)) denied();
        return context;
    }

    async verifyCurrent(response) {
        try {
            const context = this.verify(response);
            const current = this.verify(await this.companyAuthority.resolve(observedRequest(context)));
            if (canonicalJson(authorityBinding(current)) !== canonicalJson(authorityBinding(context))) denied();
            return current;
        } catch { denied(); }
    }
}
