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
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_promotion_lineage');
        expect(sql).toContain('CREATE TABLE IF NOT EXISTS episode_compaction_artifacts');
        expect(sql).toMatch(/personal_knowledge_events ENABLE ROW LEVEL SECURITY/);
        expect(sql).toMatch(/personal_knowledge_events FORCE ROW LEVEL SECURITY/);
        expect(sql).toContain("current_setting('app.person_id', true)");
        expect(sql).toContain("current_setting('app.organization_id', true)");
        expect(sql).toContain('personal_knowledge_events is append-only');
    });

    it('adds organization ACL fields and transition-derived current state', () => {
        const sql = read('server/sql/personal-knowledge-schema.sql');
        const infoSsotRls = read('server/sql/info-ssot-rls.sql');

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
        expect(sql).toContain('organization_reviewed_by TEXT');
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