import { createHash } from 'node:crypto';
import { FreshCompanyAuthorityVerifier, authorityBinding } from './fresh-company-authority-verifier.js';
import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';

const FIELD_NAMES = ['name', 'affiliation', 'role'];
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
function denied() { throw new ContractError('PERSON_PROFILE_AUTHORITY_REJECTED', { status: 403 }); }

export class ShareablePersonProfileService extends FreshCompanyAuthorityVerifier {
    constructor({ profileRepository, companyAuthority, publicJwk, audience = 'mana-runtime', deploymentId, now = () => new Date() }) {
        super({ companyAuthority, publicJwk, audience, deploymentId, now });
        this.profileRepository = profileRepository;
    }

    async read(input) {
        if (!exactKeys(input, ['company_authority_response', 'target_slack_user_id'])
            || typeof input.target_slack_user_id !== 'string'
            || !/^U[A-Z0-9]+$/.test(input.target_slack_user_id)) {
            throw new ContractError('PERSON_PROFILE_INPUT_INVALID', { status: 400 });
        }
        let context;
        try {
            context = await this.verifyCurrent(input.company_authority_response);
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
