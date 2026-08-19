import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';

function receipt(prefix, value) {
    return `${prefix}_${createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 32)}`;
}

function unavailable(error) {
    if (error instanceof ContractError) return error;
    return new ContractError('UPSTREAM_UNAVAILABLE', {
        status: 503,
        retryable: true,
        fault_domain: 'brainbase_cloud',
        message: 'Company authority repository is unavailable'
    });
}

function expectSingle(rows, { unresolved, ambiguous }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new ContractError(unresolved, { status: 403, fault_domain: 'protocol' });
    }
    if (rows.length !== 1) {
        throw new ContractError(ambiguous, { status: 409, fault_domain: 'protocol' });
    }
    return rows[0];
}

function membershipStatus(payload) {
    return payload && typeof payload === 'object' ? payload.status : null;
}

function membershipRevision(payload) {
    const value = payload && typeof payload === 'object' ? payload.revision : null;
    return value == null ? null : String(value);
}

export class PostgresCompanyAuthorityRepository {
    constructor({ pool, now = () => new Date() } = {}) {
        if (!pool) throw new Error('PostgresCompanyAuthorityRepository requires pool');
        this.pool = pool;
        this.now = now;
    }

    async withTenant(tenantId, operation) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantId]);
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Preserve the first failure.
            }
            throw unavailable(error);
        } finally {
            client.release();
        }
    }

    async resolveCanonicalIdentity({
        tenant_id,
        provider,
        authenticated_subject_id,
        workspace_id,
        app_id,
        project_hint
    }) {
        return this.withTenant(tenant_id, async (client) => {
            const result = await client.query(
                `SELECT identity.identity_id,
                        identity.identity_revision,
                        identity.tenant_id,
                        identity.principal_type,
                        identity.placement_id,
                        identity.status AS identity_status,
                        membership.membership_id,
                        membership.principal_id AS canonical_person_id,
                        membership.organization_id,
                        membership.membership_payload,
                        project.project_id,
                        project.project_code
                   FROM company_external_identities identity
                   JOIN tenant_memberships membership
                     ON membership.tenant_id = identity.tenant_id
                    AND membership.membership_id = identity.membership_id
                   JOIN tenant_projects project
                     ON project.tenant_id = identity.tenant_id
                    AND project.project_id = identity.project_id
                  WHERE identity.tenant_id = $1
                    AND identity.provider = $2
                    AND identity.authenticated_subject_id = $3
                    AND identity.workspace_id = $4
                    AND identity.app_id = $5
                    AND identity.status = 'active'
                    AND ($6::TEXT IS NULL OR project.project_id = $6 OR project.project_code = $6)
                  ORDER BY identity.identity_revision DESC
                  LIMIT 2
                  FOR SHARE OF identity, membership, project`,
                [tenant_id, provider, authenticated_subject_id, workspace_id, app_id, project_hint ?? null]
            );
            const row = expectSingle(result.rows, {
                unresolved: 'COMPANY_IDENTITY_UNRESOLVED',
                ambiguous: 'COMPANY_IDENTITY_AMBIGUOUS'
            });
            const status = membershipStatus(row.membership_payload);
            const revision = membershipRevision(row.membership_payload);
            if (row.identity_status !== 'active' || status !== 'active' || !revision) {
                throw new ContractError('COMPANY_MEMBERSHIP_INACTIVE', {
                    status: 403,
                    fault_domain: 'protocol'
                });
            }
            const identity = {
                tenant_id: row.tenant_id,
                canonical_person_id: row.canonical_person_id,
                principal_type: row.principal_type,
                membership_id: row.membership_id,
                membership_revision: revision,
                organization_id: row.organization_id,
                project_id: row.project_id,
                project_code: row.project_code,
                placement_id: row.placement_id,
                status: 'active',
                identity_revision: String(row.identity_revision)
            };
            return {
                ...identity,
                identity_resolution_receipt_id: receipt('idres', identity)
            };
        });
    }

    async resolveCanonicalAuthority({
        tenant_id,
        canonical_person_id,
        membership_id,
        organization_id,
        project_id,
        resource_ref,
        capability_id,
        desired_effect
    }) {
        return this.withTenant(tenant_id, async (client) => {
            const result = await client.query(
                `SELECT binding.binding_id,
                        binding.binding_revision,
                        binding.capability_id,
                        binding.decision,
                        binding.allowed_effects,
                        binding.responsible_person_id,
                        binding.accountable_person_id,
                        binding.approver_person_id,
                        binding.delegated_by_person_id,
                        binding.policy_revision,
                        binding.raci_revision,
                        binding.resource_revision,
                        binding.stop_conditions,
                        membership.principal_id AS canonical_person_id
                   FROM company_authority_bindings binding
                   JOIN tenant_memberships membership
                     ON membership.tenant_id = binding.tenant_id
                    AND membership.membership_id = binding.membership_id
                  WHERE binding.tenant_id = $1
                    AND binding.membership_id = $2
                    AND binding.organization_id = $3
                    AND binding.project_id = $4
                    AND binding.resource_ref = $5
                    AND binding.capability_id = $6
                    AND $7 = ANY(binding.allowed_effects)
                    AND binding.status = 'active'
                    AND binding.valid_from <= $8
                    AND (binding.valid_until IS NULL OR binding.valid_until > $8)
                  ORDER BY binding.binding_revision DESC
                  LIMIT 2
                  FOR SHARE OF binding, membership`,
                [
                    tenant_id,
                    membership_id,
                    organization_id,
                    project_id,
                    resource_ref,
                    capability_id,
                    desired_effect,
                    this.now().toISOString()
                ]
            );
            const row = expectSingle(result.rows, {
                unresolved: 'COMPANY_AUTHORITY_UNRESOLVED',
                ambiguous: 'COMPANY_AUTHORITY_AMBIGUOUS'
            });
            if (row.canonical_person_id !== canonical_person_id) {
                throw new ContractError('ACTOR_SCOPE_MISMATCH', {
                    status: 403,
                    fault_domain: 'protocol'
                });
            }
            const authority = {
                binding_id: row.binding_id,
                binding_revision: String(row.binding_revision),
                capability_id: row.capability_id,
                decision: row.decision,
                allowed_effects: [...row.allowed_effects],
                responsible_person_id: row.responsible_person_id ?? null,
                accountable_person_id: row.accountable_person_id ?? null,
                approver_person_id: row.approver_person_id ?? null,
                delegated_by_person_id: row.delegated_by_person_id ?? null,
                policy_revision: String(row.policy_revision),
                raci_revision: String(row.raci_revision),
                resource_revision: String(row.resource_revision),
                stop_conditions: [...(row.stop_conditions ?? [])]
            };
            return {
                ...authority,
                authority_resolution_receipt_id: receipt('authres', authority)
            };
        });
    }
}
