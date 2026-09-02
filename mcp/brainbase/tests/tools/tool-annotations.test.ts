import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { __testing } from '../../src/server.js';
import { annotateToolCapabilities } from '../../src/tools/tool-annotations.js';

describe('MCP tool capability annotations', () => {
  it('classifies every published tool explicitly', () => {
    const expectedReadOnly: Record<string, boolean> = {
      get_context: true, list_entities: true, get_entity: true, list_extension_types: true,
      list_extension_entities: true, search: true, resolve_entity: true, search_wiki: true,
      get_wiki_page: true, search_personal_kg: true, brainbase_projects: true,
      brainbase_bootstrap_config: true, brainbase_admin_read: true, brainbase_run_receipt_inbox: true,
      brainbase_run_receipt_history: true, brainbase_run_receipt_diagnosis: true,
      brainbase_automation_run_detail: true, brainbase_meeting_automation_diagnosis: true,
      brainbase_onboarding_get: true, brainbase_knowledge_resolve: true,
      brainbase_get_meeting_minutes_context: true, authorize_tenant_resource: true, mesh_peers: true,
      graph_get_plan_receipt: true, graph_validate: true,
      brainbase_judgment_value_proof_record: false, brainbase_judgment_state_record: false,
      brainbase_automation_human_step_resolve: false, brainbase_onboarding_start: false,
      brainbase_onboarding_ingest: false, brainbase_onboarding_review: false,
      brainbase_onboarding_first_value: false, brainbase_knowledge_event_record: false,
      create_task: false, update_task: false, transition_task: false,
      graph_record_human_gate_receipt: false, graph_plan_mutations: false, graph_apply_plan: false,
      graph_rollback_plan: false, graph_export_snapshot: false, mesh_query: false,
    };
    assert.deepEqual(
      Object.fromEntries(__testing.tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])),
      expectedReadOnly,
    );
    for (const tool of __testing.tools) {
      assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name);
    }
  });

  it('marks representative readers as read-only and mutations as writes', () => {
    const byName = new Map(__testing.tools.map((tool) => [tool.name, tool]));
    for (const name of ['search', 'get_entity', 'brainbase_projects', 'brainbase_onboarding_get', 'mesh_peers', 'graph_get_plan_receipt', 'graph_validate']) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, name);
    }
    for (const name of ['brainbase_onboarding_review', 'brainbase_automation_human_step_resolve', 'create_task', 'update_task', 'mesh_query', 'graph_export_snapshot', 'graph_record_human_gate_receipt', 'graph_plan_mutations', 'graph_apply_plan', 'graph_rollback_plan']) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, false, name);
    }
  });

  it('fails closed when a new tool has no capability classification', () => {
    const unknown: Tool = {
      name: 'unclassified_tool',
      description: 'test only',
      inputSchema: { type: 'object', properties: {} },
    };
    assert.throws(() => annotateToolCapabilities([unknown]), /classification is missing/);
  });
});
