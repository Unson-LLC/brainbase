import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const rls = readFileSync(resolve(root, 'server/sql/info-ssot-rls.sql'), 'utf8');
const indexes = readFileSync(resolve(root, 'server/sql/info-ssot-graph-indexes.sql'), 'utf8');
const apply = readFileSync(resolve(root, 'scripts/info-ssot-apply.sh'), 'utf8');
const listSql = readFileSync(resolve(root, 'server/services/info-ssot-service.js'), 'utf8');

function functionBody(name) {
  const start = rls.indexOf(`FUNCTION public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = rls.indexOf('$body$;', start);
  expect(end).toBeGreaterThan(start);
  return rls.slice(start, end);
}

describe('graph entity RLS migration', () => {
  it('keeps app_foundation_row_visible inlineable and puts membership only in the policy', () => {
    const body = functionBody('app_foundation_row_visible');
    expect(body).toContain('COST 1');
    expect(body).not.toMatch(/\bROWS\b/);
    expect(body).not.toMatch(/\bEXISTS\b/);
    expect(body).toContain('public.app_current_role_rank()');
    expect(body).toContain('public.app_clearance()');
    expect(body).not.toMatch(/SET search_path/i);
    expect(rls).not.toMatch(/\bLEAKPROOF\b/i);
    expect(rls).not.toMatch(/\bROWS\b/);
    const policy = rls.slice(rls.indexOf('CREATE POLICY info_graph_entities_select'));
    expect(policy).toContain('public.projects');
    expect(policy).toContain('public.graph_edges');
    expect(policy).toContain("rel_type = 'member_of'");
    expect(policy).toContain("lifecycle_status = 'active'");
    expect(policy.match(/CREATE POLICY/g)).toHaveLength(1);
    expect(listSql).not.toContain('app_foundation_row_visible');
    expect(listSql).not.toContain('member_of');
    for (const name of ['app_role_rank', 'app_setting_array', 'app_current_role_rank', 'app_project_codes', 'app_clearance']) {
      const helper = functionBody(name);
      expect(helper).toContain('COST 1');
      expect(helper).not.toMatch(/\bROWS\b/);
      expect(helper).not.toMatch(/SET search_path/i);
      expect(helper).not.toMatch(/\bEXISTS\b/);
    }
  });

  it('creates the list indexes concurrently and analyzes both tables outside that transaction', () => {
    expect(indexes).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS graph_entities_updated_at_desc_idx');
    expect(indexes).toContain('ON public.graph_entities (updated_at DESC)');
    expect(indexes).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS graph_edges_member_of_active_from_id_idx');
    expect(indexes).toContain('ON public.graph_edges (from_id)');
    expect(indexes).toContain("rel_type = 'member_of'");
    expect(indexes).toContain("lifecycle_status = 'active'");
    expect(indexes).not.toMatch(/\bBEGIN\b/);
    expect(apply).toContain('ANALYZE public.graph_entities; ANALYZE public.graph_edges;');
    const indexCommand = apply.split('\n').find((line) => line.includes('-f "$INDEX_SQL"'));
    const rlsCommand = apply.split('\n').find((line) => line.includes('-f "$RLS_SQL"'));
    expect(indexCommand).toBeTruthy();
    expect(rlsCommand).toContain('--single-transaction');
    expect(indexCommand).not.toContain('--single-transaction');
    expect(apply.indexOf('-f "$INDEX_SQL"')).toBeLessThan(apply.indexOf('-f "$RLS_SQL"'));
    expect(apply.indexOf('-f "$RLS_SQL"')).toBeLessThan(apply.indexOf('ANALYZE public.graph_entities'));
  });
});
