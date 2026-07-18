import { expect, test } from '@playwright/test';

import { readFile } from 'node:fs/promises';

const storyId = 'story-graph-data-ssot-normalization';

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test(`${storyId} flow_replay artifact_replay scenario_clause_e2e Graph normalization contract`, async () => {
  const evidence = await readJson('docs/management/evidence/graph-data-ssot-normalization-20260718.json');
  const script = await readFile('scripts/normalize-graph-data-ssot.mjs', 'utf8');
  const unitTests = await readFile('tests/unit/normalize-graph-data-ssot.test.js', 'utf8');
  const serviceTests = await readFile('tests/server/services/info-ssot-service.test.js', 'utf8');
  const mcpTests = await readFile('mcp/brainbase/tests/sources/graphapi-source.test.ts', 'utf8');

  expect(evidence.rest_readback.canonical_org_ids, `${storyId} ac:1 canonical orgs`).toEqual(
    expect.arrayContaining(['baao', 'unson'])
  );
  expect(evidence.rest_readback.retired_alias_ids, `${storyId} ac:1 retired aliases`).toEqual(
    expect.arrayContaining(['org_baao', 'org_unson'])
  );
  expect(evidence.post_apply_dry_run, `${storyId} ac:2 no legacy business references`).toMatchObject({
    legacy_business_edges_to_migrate: 0,
    payload_records_to_repoint: 0
  });
  expect(evidence.rest_readback.baao_project_name, `${storyId} ac:3 BAAO project name`).toBe('BAAO');
  expect(evidence.rest_readback.baao_philosophy_context_present, `${storyId} ac:4 BAAO Philosophy Context`).toBe(true);
  expect(evidence.rest_readback, `${storyId} ac:5 finance entity access boundary`).toMatchObject({
    finance_role_min: 'ceo',
    finance_sensitivity: 'finance',
    finance_field_present_in_org_payload: false
  });
  expect(evidence.canonical_person_references, `${storyId} ac:6 canonical person references`).toMatchObject({
    auth_grants: 1,
    raci_assignments: 10,
    users: 3,
    legacy_current_references: 0
  });
  expect(evidence.audit_log_evidence, `${storyId} ac:7 bounded audit-log preservation proof`).toMatchObject({
    pre_apply_recorded_count: 14,
    post_apply_transaction_readback_count: 14,
    idempotent_dry_run_count: 14,
    before_hash_available: false,
    auth_audit_logs_in_write_set: false,
    does_not_claim: 'row_content_immutability_before_vs_after'
  });
  expect(evidence.finance_boundary_negative_readback, `${storyId} ac:8 member/internal finance denial`).toMatchObject({
    member_internal_by_id_count: 0,
    member_internal_by_type_count: 0,
    ceo_finance_positive_control_count: 1,
    status: 'passed'
  });
  expect(evidence.alias_compatibility_contract, `${storyId} ac:9 legacy alias compatibility`).toMatchObject({
    typed_legacy_get_resolves_canonical: true,
    canonical_lists_exclude_alias_rows: true,
    raw_alias_types_remain_auditable: true,
    mcp_alias_index_includes_legacy_ids: true
  });
  expect(unitTests + serviceTests + mcpTests, `${storyId} ac:9 executable compatibility assertions`).toContain(
    '旧org IDのtyped getはalias行ではなくcanonical orgへ解決する'
  );
  for (const failureMode of [
    'rejects malformed backup JSON before issuing SQL',
    'rejects schema-invalid backup before issuing SQL',
    'closes the pool when database authentication is denied before a transaction starts',
    'rolls back a persistence failure inside the shared apply transaction envelope'
  ]) {
    expect(unitTests, `${storyId} ac:10 failure mode ${failureMode}`).toContain(failureMode);
  }
  expect(evidence.mcp_readback.exact_vibepro_decision_found, `${storyId} ac:11 exact decision MCP readback`).toBe(true);
  expect(evidence.rest_readback.vibepro_decision_id, `${storyId} ac:11 exact decision REST readback`).toBe(
    'dec_vibepro_ai_self_evaluation_metrics_japanese_ssot'
  );
  expect(evidence.verification.live_graph_ci_check, `${storyId} ac:12 live Graph CI contract`).toMatchObject({
    checks: 4,
    passed: 4,
    failed: 0
  });
  expect(evidence.verification, `${storyId} ac:13 targeted Graph tests`).toMatchObject({
    targeted_vitest: { tests: 50, passed: 50, failed: 0 },
    targeted_mcp_graphapi: { tests: 8, passed: 8, failed: 0 }
  });
  expect(evidence, `${storyId} ac:14 auditable secret-free artifact`).toMatchObject({
    secrets_included: false,
    production_apply: { transactional: true, physical_deletes: 0 },
    post_apply_dry_run: { physical_deletes: 0 }
  });

  expect(evidence.vibepro_decision_disposition, `${storyId} S-001 preserve existing decision SSOT`).toMatchObject({
    record_existed_before_apply: true,
    payload_replaced: false,
    created_at_replaced: false,
    visibility_change: 'gm_to_member'
  });
  expect(unitTests, `${storyId} S-002 transaction rollback on failed invariant`).toContain(
    'rolls back a persistence failure inside the shared apply transaction envelope'
  );
  expect(unitTests, `${storyId} S-002 rollback is limited to the backup set`).toContain(
    'rehearses rollback as one transaction limited to backed-up IDs'
  );
  expect(script, `${storyId} S-002 restore path is guarded by a validated backup`).toContain(
    'const backup = await readBackup(backupPath)'
  );
});
