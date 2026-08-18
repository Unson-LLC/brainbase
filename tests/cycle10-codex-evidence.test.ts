import { describe, expect, it } from 'vitest';
import { inspectCodexEvidence } from '../docs/ux-research/cycle-10-first-value-clarity/codex-evidence.mjs';

const call = (tool: string, text: string) => JSON.stringify({
  type: 'item.completed',
  item: {
    id: `call-${tool}`,
    type: 'mcp_tool_call',
    server: 'brainbase',
    tool,
    status: 'completed',
    error: null,
    result: { content: [{ type: 'text', text }] }
  }
});

describe('Cycle 10 Codex evidence', () => {
  it('accepts a concise grounded answer while keeping technical evidence in tool results', () => {
    const stdout = [
      call('resolve_entity', '{"canonicalEntityId":"person-tanaka","relationPath":["participates_in"]}'),
      call('get_context', '{"canonicalEntityId":"project-atlas","relationPath":["governs"]}'),
      call('search', '{"canonicalEntityId":"decision-principle"}'),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: '## 覚えていたこと\nAtlas導入と田中、判断基準。\n## つながったこと\n事実を接続。\n## 次にできること\n未確認を田中へ確認。' }
      })
    ].join('\n');

    expect(inspectCodexEvidence(stdout)).toMatchObject({
      actualResolveUsed: true,
      actualContextUsed: true,
      actualSearchUsed: true,
      usefulBodyPresent: true,
      conciseStructurePresent: true,
      technicalEvidenceInTools: true,
      tableAbsent: true,
      internalNarrationAbsent: true
    });
  });

  it('rejects a table-led or internally narrated answer', () => {
    const stdout = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '| ID | 値 |\n|---|---|\nskillを読み、ツールを呼びました。' }
    });
    expect(inspectCodexEvidence(stdout)).toMatchObject({
      conciseStructurePresent: false,
      tableAbsent: false,
      internalNarrationAbsent: false
    });
  });

  it('rejects Japanese skill-loading narration before the value sections', () => {
    const stdout = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: '指定のスキルを使います。\n## 覚えていたこと\nAtlas導入、田中、判断基準。\n## つながったこと\n事実。\n## 次にできること\n未確認を確認。' }
    });
    expect(inspectCodexEvidence(stdout)).toMatchObject({
      conciseStructurePresent: false,
      internalNarrationAbsent: false
    });
  });
});
