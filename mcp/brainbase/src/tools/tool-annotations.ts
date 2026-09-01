import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const READ_ONLY_TOOL_NAMES = new Set([
  'get_context',
  'list_entities',
  'get_entity',
  'list_extension_types',
  'list_extension_entities',
  'search',
  'resolve_entity',
  'search_wiki',
  'get_wiki_page',
  'search_personal_kg',
  'brainbase_projects',
  'brainbase_bootstrap_config',
  'brainbase_admin_read',
  'brainbase_run_receipt_inbox',
  'brainbase_run_receipt_history',
  'brainbase_run_receipt_diagnosis',
  'brainbase_automation_run_detail',
  'brainbase_meeting_automation_diagnosis',
  'brainbase_onboarding_get',
  'brainbase_knowledge_resolve',
  'brainbase_get_meeting_minutes_context',
  'authorize_tenant_resource',
  'mesh_query',
  'mesh_peers',
  'graph_export_snapshot',
  'graph_get_plan_receipt',
  'graph_validate',
]);

const WRITE_TOOL_NAMES = new Set([
  'brainbase_judgment_value_proof_record',
  'brainbase_judgment_state_record',
  'brainbase_automation_human_step_resolve',
  'brainbase_onboarding_start',
  'brainbase_onboarding_ingest',
  'brainbase_onboarding_review',
  'brainbase_onboarding_first_value',
  'brainbase_knowledge_event_record',
  'create_task',
  'update_task',
  'transition_task',
  'graph_record_human_gate_receipt',
  'graph_plan_mutations',
  'graph_apply_plan',
  'graph_rollback_plan',
]);

export function annotateToolCapabilities(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    const readOnly = READ_ONLY_TOOL_NAMES.has(tool.name);
    if (!readOnly && !WRITE_TOOL_NAMES.has(tool.name)) {
      throw new Error(`MCP tool capability classification is missing for ${tool.name}`);
    }
    return {
      ...tool,
      annotations: {
        ...tool.annotations,
        readOnlyHint: readOnly,
      },
    };
  });
}
