import { createHash, createPrivateKey, sign } from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { PROTECTED_TYP } from './tenant-context.js';

export const OUTCOME_SERVICE_CONTEXT_ISSUE_PATH = '/v1/outcome-service-context:issue';
const deny = (code, status = 403) => { throw new ContractError(code, { status }); };
const nonempty = value => typeof value === 'string' && value.length > 0;
const revision = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const sharedId = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}[0-9A-HJKMNP-TV-Z]{26}$`).test(value);
const same = (actual, expected) => nonempty(actual) && actual === expected;
export function outcomeOperationId(runId) {
    const bytes = createHash('sha256').update(`outcome-generator\n${runId}`).digest().subarray(0, 16);
    const bits = `00${Array.from(bytes, byte => byte.toString(2).padStart(8, '0')).join('')}`;
    let value = '';
    for (let i = 0; i < 130; i += 5) value += '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[parseInt(bits.slice(i, i + 5), 2)];
    return `op_${value}`;
}

/** All resolvers are trusted server adapters. Request fields only constrain authority; they never grant it. */
export function createOutcomeServiceContextIssuer({ signingKey, resolveProfile, resolveTenant,
    resolveConnection, readback, authorizeService, now = () => new Date() } = {}) {
    return {
        async issue(request, serviceIdentity) {
            if (![resolveProfile, resolveTenant, resolveConnection, readback, authorizeService].every(fn => typeof fn === 'function')
                || !signingKey?.private_key || !nonempty(signingKey?.key_id)) deny('outcome_issuer_unconfigured', 503);
            const { principal, persisted, required, profile: profileId } = request ?? {};
            if (!principal || !persisted || !required || !nonempty(profileId)
                || !['tenant_id', 'project_id', 'actor_principal_id'].every(key => nonempty(principal[key]))
                || !['contract_id', 'run_id', 'resource_ref'].every(key => nonempty(persisted[key]))
                || typeof persisted.contract_version !== 'string' || !/^[1-9][0-9]*$/.test(persisted.contract_version)
                || Object.keys(principal).some(key => !['tenant_id', 'project_id', 'actor_principal_id'].includes(key))
                || Object.keys(persisted).some(key => !['contract_id', 'contract_version', 'run_id', 'resource_ref'].includes(key))
                || !['normal', 'safe_test'].includes(required.run_mode)) deny('outcome_issuer_request_invalid', 400);
            if (!serviceIdentity || await authorizeService(serviceIdentity, request) !== true) deny('outcome_issuer_service_denied');
            const profile = await resolveProfile({ tenant_id: principal.tenant_id, project_id: principal.project_id, profile_id: profileId });
            if (!profile || profile.profile_id !== profileId) deny('outcome_issuer_profile_missing', 503);
            for (const key of ['audience', 'capability_id', 'deployment_id', 'workspace_id', 'app_id', 'authenticated_subject_id']) {
                if (!same(required[key], profile[key])) deny('outcome_issuer_scope_mismatch');
            }
            if (!same(persisted.resource_ref, profile.resource_ref)
                || required.operation_id !== outcomeOperationId(persisted.run_id)) deny('outcome_issuer_scope_mismatch');
            const authority = await readback({ tenant: principal.tenant_id, project: principal.project_id,
                actor: principal.actor_principal_id, contract: persisted.contract_id,
                version: persisted.contract_version, run: persisted.run_id, resource: profile.resource_ref,
                mode: required.run_mode, profile }, serviceIdentity);
            if (!authority || !Object.keys(principal).every(key => same(authority.principal?.[key], principal[key]))
                || !Object.keys(persisted).every(key => same(authority.persisted?.[key], persisted[key]))
                || !same(authority.profile_id, profileId) || !nonempty(authority.authority_revision)
                || authority.run_mode !== required.run_mode
                || !(required.run_mode === 'normal' ? authority.contract_status === 'active'
                    : ['draft', 'active'].includes(authority.contract_status))) deny('outcome_issuer_authority_mismatch');
            const tenant = await resolveTenant(principal.tenant_id);
            const connection = await resolveConnection(profile.connection_id);
            const snapshot = connection?.snapshot;
            if (!tenant || tenant.tenant_id !== principal.tenant_id || !nonempty(tenant.tenant_revision)
                || !snapshot || snapshot.status !== 'active' || snapshot.tenant_id !== principal.tenant_id
                || snapshot.connection_id !== profile.connection_id
                || !['deployment_id', 'workspace_id', 'app_id'].every(key => same(snapshot[key], profile[key]))
                || !snapshot.granted_scopes?.includes(profile.capability_id)
                || !Array.isArray(profile.organization_ids) || !profile.organization_ids.length
                || profile.organization_ids.some(value => !nonempty(value))
                || !Array.isArray(profile.data_scopes) || profile.data_scopes.some(value => !nonempty(value))
                || !sharedId(tenant.tenant_id, 'ten_') || !revision(tenant.tenant_revision)
                || !sharedId(snapshot.connection_id, 'wsc_') || !sharedId(snapshot.deployment_id, 'dep_')
                || !revision(snapshot.connection_revision) || !revision(snapshot.contract_revision)
                || !['installation_id', 'profile', 'credential_mode'].every(key => nonempty(snapshot[key]))
                || !connection.credential || connection.credential.mode !== snapshot.credential_mode
                || !['credential_ref', 'billing_principal_id'].every(key => nonempty(connection.credential[key]))) deny('outcome_issuer_connection_mismatch');
            const issued = new Date(now());
            const unsigned = {
                schema_version: '1.0', protocol_id: 'mana-brainbase-tenant-context', protocol_version: '1.0',
                issuer: 'brainbase', context_kind: 'outcome_service_actor', audience: [profile.audience],
                tenant: { tenant_id: tenant.tenant_id, tenant_revision: tenant.tenant_revision },
                workspace_connection: { connection_id: snapshot.connection_id, connection_revision: snapshot.connection_revision,
                    provider: 'service', installation_id: snapshot.installation_id, workspace_id: snapshot.workspace_id,
                    app_id: snapshot.app_id, status: snapshot.status },
                actor: { principal_id: principal.actor_principal_id, principal_type: 'service',
                    authenticated_subject_id: profile.authenticated_subject_id },
                authorization: { organization_ids: profile.organization_ids, project_ids: [principal.project_id],
                    data_scopes: profile.data_scopes, capability_ids: [profile.capability_id] },
                placement: { deployment_id: snapshot.deployment_id, profile: snapshot.profile },
                service_actor: { ...persisted, authority_revision: authority.authority_revision, run_mode: authority.run_mode },
                correlation_id: required.operation_id.replace(/^op_/, 'cor_'), operation_id: required.operation_id,
                idempotency_key: `ik1_${createHash('sha256').update(canonicalJson({ principal, persisted, run_mode: authority.run_mode })).digest('base64url')}`,
                contract_revision: snapshot.contract_revision, credential: { mode: connection.credential.mode,
                    credential_ref: connection.credential.credential_ref, billing_principal_id: connection.credential.billing_principal_id },
                issued_at: issued.toISOString(), expires_at: new Date(issued.getTime() + 60000).toISOString()
            };
            const protected64 = Buffer.from(canonicalJson({ alg: 'EdDSA', b64: false, crit: ['b64'],
                kid: signingKey.key_id, typ: PROTECTED_TYP })).toString('base64url');
            const key = signingKey.private_key;
            const privateKey = typeof key === 'object' && !key.type ? createPrivateKey({ key, format: 'jwk' }) : key;
            const signature = sign(null, Buffer.from(`${protected64}.${canonicalJson(unsigned)}`), privateKey).toString('base64url');
            return deepFreeze({ tenant_context: { ...unsigned, integrity: { method: 'jws_detached', algorithm: 'EdDSA',
                key_id: signingKey.key_id, value: `${protected64}..${signature}` } }, authoritative_snapshot: structuredClone(snapshot) });
        }
    };
}
