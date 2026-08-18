import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = path.resolve(process.cwd(), 'server/sql/multitenant-platform-schema.sql');

describe('multitenant persistence schema', () => {
    it('AC-002/005: 帰属table、FK、RLS、repository用tenant revision境界を定義する', async () => {
        const sql = await readFile(schemaPath, 'utf8');
        for (const table of [
            'brainbase_tenants', 'tenant_organizations', 'tenant_memberships', 'tenant_projects',
            'tenant_graph_entities', 'tenant_graph_relations', 'workspace_connections',
            'tenant_credential_leases',
            'tenant_contract_revisions', 'tenant_quota_decisions', 'tenant_usage_events',
            'tenant_operation_receipts', 'tenant_receipt_pricing_snapshots',
            'tenant_migrations', 'tenant_migration_quarantine', 'tenant_migration_source_rows'
        ]) {
            expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}\\b`, 'i'));
        }
        expect(sql).toContain('tenant_revision_at_write');
        expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
        expect((sql.match(/FORCE ROW LEVEL SECURITY/g) ?? [])).toHaveLength(18);
        expect(sql).toContain("current_setting('brainbase.tenant_id', true)");
        expect(sql).toContain('FOREIGN KEY (tenant_id, organization_id) REFERENCES tenant_organizations(tenant_id, organization_id)');
        expect(sql).toContain('FOREIGN KEY (tenant_id, source_entity_id) REFERENCES tenant_graph_entities(tenant_id, entity_id)');
        expect(sql).toContain('FOREIGN KEY (tenant_id, connection_id, connection_revision) REFERENCES workspace_connection_revisions(tenant_id, connection_id, connection_revision)');
        expect(sql).toContain('FOREIGN KEY (tenant_id, migration_id) REFERENCES tenant_migrations(tenant_id, migration_id)');
    });

    it('AC-104/D-005: secret本文用の通常列を持たずopaque refとrefresh revisionだけを永続化する', async () => {
        const sql = await readFile(schemaPath, 'utf8');
        expect(sql).toContain('credential_ref TEXT NOT NULL');
        expect(sql).toContain('refresh_revision BIGINT NOT NULL');
        expect(sql).toContain('lease_token_digest TEXT NOT NULL');
        expect(sql).toContain("max_uses SMALLINT NOT NULL CHECK (max_uses = 1)");
        expect(sql).toContain("expires_at <= issued_at + INTERVAL '60 seconds'");
        expect(sql).toContain('UNIQUE (tenant_id, lease_id)');
        expect(sql).not.toMatch(/\b(access_token|refresh_token|client_secret|oauth_token)\b/i);
    });

    it('D-006/AC-204: Usage、Receipt、30日claim保持、collection/outcome制約を持つ', async () => {
        const sql = await readFile(schemaPath, 'utf8');
        expect(sql).toContain("collection_state IN ('collected', 'partial', 'not_collected')");
        expect(sql).toContain("outcome IN ('succeeded', 'failed', 'cancelled', 'timed_out')");
        expect(sql).toContain("claim_state IN ('pending', 'claimed', 'succeeded', 'failed_terminal')");
        expect(sql).toContain("retain_until >= claimed_at + INTERVAL '30 days'");
        expect(sql).toContain('decision_payload JSONB NOT NULL');
        expect(sql).toContain('event_payload JSONB NOT NULL');
        expect(sql).toContain('receipt_payload JSONB NOT NULL');
        expect(sql).toContain('pricing_payload JSONB NOT NULL');
        expect(sql).toContain('sales_price_revision BIGINT NOT NULL');
        expect(sql).toContain('claim_payload JSONB NOT NULL');
        expect(sql).toContain('UNIQUE (tenant_id, contract_revision)');
        expect(sql).not.toMatch(/tenant_usage_events[\s\S]*?UNIQUE \(tenant_id, idempotency_key\)[\s\S]*?CREATE TABLE IF NOT EXISTS tenant_operation_receipts/);
    });
});
