import { createHash } from 'node:crypto';
import { acceptCompanyAuthorityResponse } from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';

const FIELD_NAMES = ['name', 'affiliation', 'role'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
function denied() { throw new ContractError('PERSON_PROFILE_AUTHORITY_REJECTED', { status: 403 }); }

// Only stable authority bindings participate: issuance timestamps change on refresh.
function authorityBinding(context) {
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

export class ShareablePersonProfileService {
    constructor({ profileRepository, companyAuthority, publicJwk, audience = 'mana-runtime', deploymentId, now = () => new Date() }) {
        Object.assign(this, { profileRepository, companyAuthority, publicJwk, audience, deploymentId, now });
    }

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

    async read(input) {
        if (!exactKeys(input, ['company_authority_response', 'target_slack_user_id'])
            || typeof input.target_slack_user_id !== 'string'
            || !/^U[A-Z0-9]+$/.test(input.target_slack_user_id)) {
            throw new ContractError('PERSON_PROFILE_INPUT_INVALID', { status: 400 });
        }
        let context;
        try {
            context = this.verify(input.company_authority_response);
            // Re-resolve from the authoritative store on EVERY read, including delivery checks.
            const current = this.verify(await this.companyAuthority.resolve(observedRequest(context)));
            if (canonicalJson(authorityBinding(current)) !== canonicalJson(authorityBinding(context))) denied();
            context = current;
        } catch { denied(); }

        const unavailable = { status: 'unavailable', target_slack_user_id: input.target_slack_user_id, fields: {} };
        let record;
        try {
            record = await this.profileRepository.readProfile({ context, targetSlackUserId: input.target_slack_user_id });
        } catch {
            throw new ContractError('PERSON_PROFILE_UNAVAILABLE', { status: 503, retryable: true });
        }
        const profile = record?.profile;
        if (!record?.person_id || !exactKeys(profile, ['version', 'revision', 'fields'])
            || profile.version !== 'shareable-person-profile.v1'
            || typeof profile.revision !== 'string' || !/^[1-9][0-9]*$/.test(profile.revision)
            || !exactKeys(profile.fields, FIELD_NAMES)) return unavailable;
        const fields = {};
        const workspaceId = context.tenant_context.workspace_connection.workspace_id;
        const channelId = context.tenant_context.slack.channel_id;
        for (const name of FIELD_NAMES) {
            const rule = profile.fields[name];
            if (!exactKeys(rule, ['value', 'reader_person_ids', 'audiences'])
                || typeof rule.value !== 'string' || !rule.value.trim() || rule.value.length > 300
                || !Array.isArray(rule.reader_person_ids)
                || !rule.reader_person_ids.every((id) => typeof id === 'string' && id.length > 0)
                || !rule.reader_person_ids.includes(context.actor.canonical_person_id)
                || !Array.isArray(rule.audiences)
                || !rule.audiences.every((audience) => exactKeys(audience, ['workspace_id', 'channel_id'])
                    && typeof audience.workspace_id === 'string' && typeof audience.channel_id === 'string')
                || !rule.audiences.some((audience) => audience.workspace_id === workspaceId && audience.channel_id === channelId)) continue;
            fields[name] = rule.value;
        }
        if (Object.keys(fields).length === 0) return unavailable;
        const disclosure = {
            workspace_id: workspaceId, channel_id: channelId,
            thread_ts: context.tenant_context.slack.thread_ts ?? null,
            requester_person_id: context.actor.canonical_person_id,
            target_person_id: record.person_id, policy_revision: profile.revision
        };
        const digest = createHash('sha256').update(canonicalJson({
            binding: authorityBinding(context), target: input.target_slack_user_id,
            disclosure, fields, profile
        })).digest('hex');
        return { status: 'ok', target_slack_user_id: input.target_slack_user_id, fields, disclosure: { ...disclosure, digest } };
    }
}
