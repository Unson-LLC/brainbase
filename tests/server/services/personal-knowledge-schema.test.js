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

    it('registers the formal migration', () => {
        const source = read('scripts/migrate-m5a-production-schema.js');
        expect(source).toContain("{ id: 'personal-knowledge', path: 'server/sql/personal-knowledge-schema.sql' }");
    });
});
