import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = path.resolve(process.cwd(), 'server/sql/tenant-production-provisioning-schema.sql');

describe('tenant production provisioning schema', () => {
    it('defines tenant key, append-only revision history, and revision FKs', async () => {
        const sql = await readFile(schemaPath, 'utf8');
        for (const table of [
            'brainbase_tenant_revisions',
            'tenant_provisioning_operations',
            'brainbase_service_actors',
            'brainbase_capabilities',
            'brainbase_service_actor_capabilities',
            'tenant_contract_revision_runtime_bindings'
        ]) {
            expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`, 'i'));
        }
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS tenant_key TEXT');
        expect(sql).toContain("RAISE EXCEPTION 'tenant_key backfill is required before provisioning schema activation'");
        expect(sql).toContain('UNIQUE INDEX IF NOT EXISTS brainbase_tenants_tenant_key_uq');
        expect(sql).toContain('ON CONFLICT (tenant_id, tenant_revision) DO NOTHING');
        expect(sql).toContain('FOREIGN KEY (tenant_id, tenant_revision_at_write) REFERENCES brainbase_tenant_revisions(tenant_id, tenant_revision)');
        expect(sql).toMatch(/FOREIGN KEY \(tenant_id, connection_id, connection_revision\)\s+REFERENCES workspace_connection_revisions\(tenant_id, connection_id, connection_revision\)/u);
        expect(sql).toContain('workspace_connections_current_revision_fk');
        expect(sql).not.toContain('workspace_connection_revisions_current_identity_fk');
        expect(sql).toContain('CREATE CONSTRAINT TRIGGER workspace_connection_revision_requires_current');
        expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
        expect(sql).toContain('workspace_connection_revisions_immutable');
    });

    it('enforces workspace logical uniqueness, provisioning idempotency, and service capabilities', async () => {
        const sql = await readFile(schemaPath, 'utf8');
        expect(sql).toContain('tenant_projects');
        expect(sql).toContain('tenant_contract_revisions');
        expect(sql).toContain('workspace_connections_tenant_provider_workspace_app_uq');
        expect(sql).toContain("WHERE status IN ('pending', 'active')");
        expect(sql).toContain('UNIQUE (tenant_key, idempotency_key)');
        expect(sql).toContain('desired_state_sha256');
        expect(sql).toContain('canonical_project_id');
        expect(sql).toContain('brainbase_service_actor_capabilities');
        expect(sql).toContain('public_jwk');
        expect(sql).toContain('tenant_contract_revision_runtime_bindings');
        expect(sql).toContain('slack_installation_intents');
        expect(sql).toContain('slack_installation_exchange_ledger');
        expect(sql).toContain('FOREIGN KEY (tenant_id, contract_id, contract_revision)');
        expect(sql).toContain('deployment_id');
        expect(sql).toContain('profile');
        expect(sql).toContain('capabilities TEXT[]');
        expect(sql).toContain('audience TEXT[]');
        expect(sql).toContain('slack_installation_intents_tenant_idx');
        expect(sql).toContain('slack_installation_exchange_ledger_tenant_idx');
    });

    it('does not persist secret bodies or model service actors as Graph persons', async () => {
        const sql = await readFile(schemaPath, 'utf8');
        expect(sql).not.toMatch(/\\b(access_token|refresh_token|client_secret|private_key|secret_value|oauth_token)\\b/i);
        expect(sql).toContain('credential_ref');
        expect(sql).toContain('service_actor');
        expect(sql).not.toMatch(/person_id|graph_person/iu);
    });
});
