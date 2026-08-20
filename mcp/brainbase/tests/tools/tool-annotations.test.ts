import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { __testing } from '../../src/server.js';
import { annotateToolCapabilities } from '../../src/tools/tool-annotations.js';

describe('MCP tool capability annotations', () => {
  it('classifies every published tool explicitly', () => {
    assert.ok(__testing.tools.length > 0);
    for (const tool of __testing.tools) {
      assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name);
    }
  });

  it('marks representative readers as read-only and mutations as writes', () => {
    const byName = new Map(__testing.tools.map((tool) => [tool.name, tool]));
    for (const name of ['search', 'get_entity', 'brainbase_projects', 'brainbase_onboarding_get', 'mesh_peers', 'graph_export_snapshot', 'graph_get_plan_receipt', 'graph_validate']) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, name);
    }
    for (const name of ['brainbase_onboarding_review', 'brainbase_automation_human_step_resolve', 'create_task', 'update_task', 'graph_plan_mutations', 'graph_apply_plan', 'graph_rollback_plan']) {
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
