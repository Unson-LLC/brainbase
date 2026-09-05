import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('personal and organization knowledge schema', () => {
    it('owns immutable personal events, transitions, promotion requests, and lineage', () => {
        const sql = read('server/sql/personal-knowledge-schema.sql');

        expect(sql).toContain('CREATE TABLE IF NOT EXISTS personal_knowledge_events');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS personal_knowledge_event_transitions');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_event_transitions');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_promotion_requests');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_promotion_authority_uses');
        expect(sql).toContain('idempotency_key TEXT NOT NULL UNIQUE');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_promotion_lineage');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS episode_compaction_artifacts');
        expect(sql).toMatch(/personal_knowledge_events ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/personal_knowledge_events FORCE ROW LEVEL SECURITY/);
        expect(sql).toContain("current_setting('app.person_id', true)");
        expect(sql).toContain("current_setting('app.actor_person_id', true)");
        expect(sql).toContain("current_setting('app.organization_id', true)");
        expect(sql).toContain('personal_knowledge_events is append-only');
    });

    it('adds organization ACL fields and transition-derived current state', () => {
        const sql = read('server/sql/personal-knowledge-schema.sql');
        const infoSsotRls = read('server/sql/info-ssot-rls.sql');
        const edgeScopeFunction = infoSsotRls.match(
            /CREATE OR REPLACE FUNCTION app_graph_edge_scope_visible\([\s\S]*?\n(?:\$\$;|\s*\$function\$;)/
        )?.[0] || '';
        const edgeSelectPolicy = infoSsotRls.match(
            /CREATE POLICY info_graph_edges_select[\s\S]*?(?=\n\nDROP POLICY IF EXISTS info_graph_edges_insert)/
        )?.[0] || '';
        expect(infoSsotRls).toContain('app_graph_edge_scope_visible');
        expect(infoSsotRls).toContain('app_graph_entity_organization_id');
        expect(infoSsotRls).toContain("edge_rel_type = 'governs'");
        expect(infoSsotRls).toContain("edge_payload->>'cross_tenant' = 'true'");
        expect(infoSsotRls).toContain('COUNT(DISTINCT membership_project.organization_id) = 1');
        expect(infoSsotRls).toContain("membership.rel_type = 'member_of'");
        expect(infoSsotRls).toContain('target_project.code = ANY(app_project_codes())');
        expect(edgeScopeFunction).toContain('app_graph_entity_organization_id(source_entity.id) IS NULL');
        expect(edgeScopeFunction).toContain('app_graph_entity_organization_id(target_entity.id) IS NULL');
        expect(edgeScopeFunction).toContain('IS DISTINCT FROM app_graph_entity_organization_id(target_entity.id)');
        expect(edgeScopeFunction).not.toContain("current_setting('app.graph_maintenance_mode', true) = 'true'");
        expect(edgeScopeFunction).not.toMatch(/app_current_role_rank\(\) >= app_role_rank\('gm'\)/);
        expect(edgeScopeFunction).toContain('SECURITY DEFINER');
        expect(edgeScopeFunction).toContain('SET search_path FROM CURRENT');
        expect(infoSsotRls).toMatch(/CREATE POLICY info_graph_edges_select[\s\S]*current_setting\('app\.graph_maintenance_mode', true\) = 'true'/);
        expect(infoSsotRls).toMatch(/CREATE POLICY info_graph_edges_select[\s\S]*app_project_codes\(\)[\s\S]*graph_maintenance_mode[\s\S]*rel_type = 'member_of'/);
        expect(edgeSelectPolicy).toMatch(/current_setting\('app\.graph_maintenance_mode', true\) = 'true'[\s\S]*AND rel_type = 'member_of'[\s\S]*AND lifecycle_status = 'active'[\s\S]*\)[\s\S]*OR[\s\S]*\([\s\S]*app_current_role_rank\(\) >= app_role_rank\(role_min\)[\s\S]*AND sensitivity = ANY\(app_clearance\(\)\)/);
        expect(infoSsotRls).toMatch(/CREATE POLICY info_graph_edges_update[\s\S]*USING[\s\S]*current_setting\('app\.graph_maintenance_mode', true\) = 'true'[\s\S]*WITH CHECK/);
        const edgeInsertPolicy = infoSsotRls.match(
            /CREATE POLICY info_graph_edges_insert[\s\S]*?(?=\n\nDROP POLICY IF EXISTS info_graph_edges_update)/
        )?.[0] || '';
        const edgeUpdatePolicy = infoSsotRls.match(
            /CREATE POLICY info_graph_edges_update[\s\S]*$/
        )?.[0] || '';
        expect(edgeInsertPolicy).not.toMatch(/app_graph_edge_source_project_matches\([\s\S]*?OR current_setting\('app\.graph_maintenance_mode'/);
        expect(edgeUpdatePolicy).toMatch(/USING \([\s\S]*?app_graph_edge_source_project_matches\([\s\S]*?OR current_setting\('app\.graph_maintenance_mode', true\) = 'true'[\s\S]*?WITH CHECK \([\s\S]*?app_graph_edge_source_project_matches\(/);
        expect(infoSsotRls.match(/CREATE OR REPLACE FUNCTION app_setting_array\([\s\S]*?\n(?:\$\$;|\s*\$function\$;)/)?.[0])
            .not.toContain('COALESCE((');

        expect(sql).toContain('ADD COLUMN IF NOT EXISTS organization_id');
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS sensitivity');
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS role_min');
        expect(sql).toContain('ADD COLUMN IF NOT EXISTS venue');
        expect(sql).toContain('CREATE OR REPLACE VIEW knowledge_event_current WITH (security_invoker = true)');
        expect(sql).toMatch(/CREATE POLICY organization_transition_scope[\s\S]*EXISTS \([\s\S]*FROM knowledge_events event/);
        expect(sql).toMatch(/episode_compaction_artifacts[\s\S]*sensitivity TEXT NOT NULL/);
        expect(sql).toMatch(/episode_compaction_artifacts[\s\S]*role_min TEXT NOT NULL/);
        expect(sql).toMatch(/episode_compaction_scope[\s\S]*app_role_rank[\s\S]*app_sensitivity_rank/);
        expect(infoSsotRls).toMatch(/CREATE OR REPLACE FUNCTION app_role_rank\(role text\)/i);
        expect(sql).toMatch(/CREATE OR REPLACE FUNCTION app_role_rank\(role TEXT\)/);
        expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION app_role_rank\(value TEXT\)/);
    });

    it('enables and forces owner-scoped RLS on candidate queue and history', () => {
        const sql = read('server/sql/candidate-store-schema.sql');

        expect(sql).toContain('ADD COLUMN IF NOT EXISTS organization_id');
        expect(sql).toMatch(/memory_candidates ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/memory_candidates FORCE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/promotion_audit_events ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/promotion_audit_events FORCE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/candidate_scan_blocks ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/candidate_scan_blocks FORCE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/candidate_scan_blocks[\s\S]*owner_person_id TEXT NOT NULL/);
        expect(sql).toMatch(/candidate_scan_blocks[\s\S]*organization_id TEXT NOT NULL/);
    });

    it('separates owner consent from organization review and requires a distinct GM reviewer', () => {
        const sql = read('server/sql/personal-knowledge-two-stage-promotion.sql');

        expect(sql).toContain('owner_decided_by TEXT');
        expect(sql).toContain('owner_decision_revision BIGINT NOT NULL DEFAULT 0');
        expect(sql).toContain('organization_reviewed_by TEXT');
        expect(sql).toContain('organization_review_revision BIGINT NOT NULL DEFAULT 0');
        expect(sql).toMatch(/status = 'pending_owner_approval' AND owner_decision_revision = 0/);
        expect(sql).toMatch(/status IN \('org_accepted', 'org_rejected'\)[\s\S]*organization_review_revision = 1/);
        expect(sql).toContain("'pending_owner_approval'");
        expect(sql).toContain("'owner_rejected'");
        expect(sql).toContain("'pending_org_review'");
        expect(sql).toContain("'org_accepted'");
        expect(sql).toContain("'org_rejected'");
        expect(sql).toMatch(/pending_owner_approval'[\s\S]*pending_org_review/);
        expect(sql).toMatch(/pending_org_review'[\s\S]*org_accepted[\s\S]*org_rejected/);
        expect(sql).toMatch(/owner_person_id <> app_person_id_required\(\)/);
        expect(sql).toMatch(/app_role_rank\(current_setting\('app.role', true\)\) >= app_role_rank\('gm'\)/);
        expect(sql).toMatch(/status IN \('pending_org_review', 'org_accepted', 'org_rejected'\)/);
    });

    it('uses optimistic CAS for each two-stage decision revision', () => {
        const repository = read('server/services/personal-knowledge/two-stage-promotion-repository.js');

        expect(repository).toMatch(/owner_decision_revision = owner_decision_revision \+ 1[\s\S]*owner_decision_revision = \$6/);
        expect(repository).toMatch(/organization_review_revision = organization_review_revision \+ 1[\s\S]*organization_review_revision = \$9/);
        expect(read('server/services/personal-knowledge/pg-personal-knowledge-repository.js'))
            .toMatch(/knowledge_promotion_requests WHERE request_id = \$1 LIMIT 1 FOR UPDATE/);
    });

    it('requires normalized hashes, both receipts, Knowledge Event, and Graph readback for new acceptance', () => {
        const sql = read('server/sql/personal-knowledge-two-stage-promotion.sql');

        expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_promotion_authority_uses');
        expect(sql).toContain('idempotency_key TEXT NOT NULL UNIQUE');
        expect(sql).toMatch(/knowledge_promotion_authority_uses ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/knowledge_promotion_authority_uses FORCE ROW LEVEL SECURITY/);
        expect(sql).toContain('actor_person_id = app_actor_person_id_required()');
        expect(sql).toContain('normalization_contract_version TEXT');
        expect(sql).toContain('normalized_payload JSONB');
        expect(sql).toContain('normalized_payload_hash TEXT');
        expect(sql).toContain('normalized_by_person_id TEXT');
        expect(sql).toContain('owner_consent_receipt_id TEXT');
        expect(sql).toContain('organization_review_receipt_id TEXT');
        expect(sql).toContain('graph_entity_id TEXT');
        expect(sql).toContain("normalized_payload->>'schema_version' = 'personal_knowledge_normalized.v1'");
        expect(sql).toContain("normalized_payload_hash ~ '^sha256:[a-f0-9]{64}$'");
        expect(sql).toContain("status = 'pending_owner_approval'");
        expect(sql).toContain("WHERE status = 'pending_org_review'");
        expect(sql).toContain('knowledge_promotion_owner_consent_evidence_check');
        expect(sql).toMatch(/status <> 'org_accepted'[\s\S]*organization_event_id IS NOT NULL[\s\S]*graph_entity_id IS NOT NULL/);
    });

    it('grandfathers only pre-M1-C rows and blocks new legacy or mutable evidence', () => {
        const sql = read('server/sql/personal-knowledge-two-stage-promotion.sql');

        expect(sql).toContain('legacy_without_normalized_evidence BOOLEAN NOT NULL DEFAULT FALSE');
        expect(sql).toMatch(/UPDATE knowledge_promotion_requests[\s\S]*legacy_without_normalized_evidence = TRUE[\s\S]*status = 'org_accepted'/);
        expect(sql).toContain('New promotion rows cannot opt into legacy evidence bypass');
        expect(sql).toContain('Promotion rows cannot opt into legacy evidence bypass');
        expect(sql).toContain('Normalized promotion evidence is immutable; create a new promotion request');
        expect(sql).toMatch(/CREATE TRIGGER knowledge_promotion_evidence_guard[\s\S]*BEFORE INSERT OR UPDATE/);
    });

    it('keeps the private Personal event FK owner-readable and reviewer-insert-only', () => {
        const sql = read('server/sql/personal-knowledge-two-stage-promotion.sql');

        expect(sql).toMatch(/knowledge_promotion_lineage ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/CREATE POLICY personal_lineage_owner_read[\s\S]*FOR SELECT/);
        expect(sql).toMatch(/CREATE POLICY personal_lineage_reviewer_insert[\s\S]*FOR INSERT/);
        expect(sql).not.toMatch(/CREATE POLICY personal_lineage_reviewer_read/);
        expect(sql).toMatch(/request\.personal_event_id = knowledge_promotion_lineage\.personal_event_id/);
        expect(sql).toMatch(/request\.organization_event_id = knowledge_promotion_lineage\.organization_event_id/);
        expect(sql).toMatch(/request\.normalized_payload_hash = knowledge_promotion_lineage\.sanitization->>'normalized_payload_hash'/);
        expect(sql).toMatch(/request\.owner_consent_receipt_id = knowledge_promotion_lineage\.sanitization->>'owner_consent_receipt_id'/);
        expect(sql).toMatch(/request\.organization_review_receipt_id = knowledge_promotion_lineage\.sanitization->>'organization_review_receipt_id'/);
    });

    it('registers both Personal KG migrations under the same deployment unit', () => {
        const source = read('scripts/migrate-m5a-production-schema.js');
        expect(source).toContain("{ id: 'personal-knowledge', path: 'server/sql/personal-knowledge-schema.sql' }");
        expect(source).toContain("{ id: 'personal-knowledge', path: 'server/sql/personal-knowledge-two-stage-promotion.sql' }");
    });

    it('does not rewrite immutable organization events when the migration is replayed', () => {
        const sql = read('server/sql/personal-knowledge-schema.sql');

        expect(sql).toMatch(
            /UPDATE knowledge_events\s+SET organization_id = COALESCE\([\s\S]*?\)\s+WHERE organization_id IS NULL;/
        );
    });
});
