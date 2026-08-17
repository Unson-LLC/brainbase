import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectCodexEvidence } from '../docs/ux-research/cycle-09-id-edge-first-value/codex-evidence.mjs';

const repo = process.cwd();
const cycleDir = join(repo, 'docs/ux-research/cycle-09-id-edge-first-value');

describe('cycle-09 ID edge first-value evidence contract', () => {
  it('measures acquisition through real contextual reuse instead of command latency', async () => {
    const contract = await readFile(join(cycleDir, 'evaluation-contract.md'), 'utf8');

    expect(contract).toContain('取得開始から');
    expect(contract).toContain('実Codex');
    expect(contract).toContain('600,000ms');
    expect(contract).toContain('CLIコマンド単体の応答時間ではない');
    expect(contract).toContain('利用者が「Brainbaseはこう使える」と価値を認識');
  });

  it('requires canonical ID edges, projection distinction, and honorific resolution in the useful answer', async () => {
    const contract = await readFile(join(cycleDir, 'evaluation-contract.md'), 'utf8');
    const capture = await readFile(join(cycleDir, 'capture-journey.mjs'), 'utf8');

    for (const marker of ['resolve_entity', 'get_context', 'search', '田中さん', 'canonicalEntityId', 'relationPath', 'recordClass']) {
      expect(`${contract}\n${capture}`).toContain(marker);
    }
    expect(contract).toContain('既知Majorは0件');
  });

  it('separates local candidate evidence from published registry evidence and keeps human evidence honest', async () => {
    const capture = await readFile(join(cycleDir, 'capture-journey.mjs'), 'utf8');
    const metadata = JSON.parse(await readFile(join(cycleDir, 'cycle-metadata.json'), 'utf8')) as {
      evidence_surfaces: Record<string, string>;
      human_observation: string;
    };

    expect(capture).toContain('candidate_local_tarball');
    expect(capture).toContain('published_registry_package');
    expect(capture).toContain('human_value_recognition: \'not_collected\'');
    expect(metadata.evidence_surfaces.candidate).not.toBe(metadata.evidence_surfaces.registry);
    expect(metadata.human_observation).toBe('not_collected');
  });

  it('does not mutate the immutable cycle-08 evidence from the cycle-09 capture harness', async () => {
    const capture = await readFile(join(cycleDir, 'capture-journey.mjs'), 'utf8');

    expect(capture).not.toContain('cycle-08-persona-value-recognition');
    expect(capture).toContain('cycle-09-id-edge-first-value');
    expect(capture).toContain('refusing to overwrite an existing evidence manifest');
  });

  it('proves actual completed Brainbase MCP calls instead of matching tool names in prose', () => {
    const proseOnly = JSON.stringify({ type: 'item.completed', item: {
      id: 'answer', type: 'agent_message',
      text: 'resolve_entity get_context search Atlas導入 田中 判断基準 未確認 canonicalEntityId relationPath recordClass'
    } });
    expect(inspectCodexEvidence(proseOnly)).toMatchObject({
      actualResolveUsed: false, actualContextUsed: false, actualSearchUsed: false
    });

    const lines = [
      completedCall('resolve', 'resolve_entity', '{"mentions":[{"canonicalEntityId":"person-tanaka"}]}'),
      completedCall('context', 'get_context', '{"projects":[{"id":"project-atlas"}]}'),
      completedCall('search', 'search', '{"results":[{"canonicalEntityId":"decision-principle","recordClass":"canonical","relationPath":["edge-1"],"relation":"governs"}]}'),
      JSON.stringify({ type: 'item.completed', item: {
        id: 'answer', type: 'agent_message',
        text: 'Atlas導入について田中さんへ判断基準を確認する。未確認事項を分け、canonicalEntityId person-tanaka、relationPath edge-1、recordClassにより正規エンティティと投影を区別した。'
      } })
    ].join('\n');
    expect(inspectCodexEvidence(lines)).toMatchObject({
      actualResolveUsed: true, actualContextUsed: true, actualSearchUsed: true,
      usefulBodyPresent: true, canonicalIdEvidencePresent: true,
      relationEvidencePresent: true, projectionBoundaryPresent: true,
      toolCalls: [
        { item_id: 'resolve', tool: 'resolve_entity' },
        { item_id: 'context', tool: 'get_context' },
        { item_id: 'search', tool: 'search' }
      ]
    });
  });

  it('freezes a portable candidate manifest without leaking a temporary local path', async () => {
    const manifestText = await readFile(join(cycleDir, 'candidate-corpus/manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as { package_spec: string; candidate_journey_passed: boolean };

    expect(manifest.package_spec).toBe('<candidate-local-tarball>');
    expect(manifestText).not.toContain('/var/folders/');
    expect(await readFile(join(cycleDir, 'candidate-corpus/journey-01-install.json'), 'utf8'))
      .not.toContain('/var/folders/');
    expect(manifest.candidate_journey_passed).toBe(true);
  });

  it('records 32 independent synthetic personas recognizing reusable value with no remaining known Major', async () => {
    const results = JSON.parse(await readFile(join(cycleDir, 'candidate-persona-results/summary.json'), 'utf8')) as {
      totals: Record<string, number>;
      synthetic_value_converged: boolean;
      human_observation: string;
      results: Array<Record<string, unknown>>;
    };
    const metadata = JSON.parse(await readFile(join(cycleDir, 'cycle-metadata.json'), 'utf8')) as {
      status: string;
      journey_duration_ms: number;
      persona_results: string;
      synthetic_value_converged: boolean;
      registry_value_recognition: string;
    };
    const expectedIds = [1, 2, 3, 4].flatMap((group) =>
      Array.from({ length: 8 }, (_, index) => `P-${group}0${index + 1}`)
    );
    const roles = results.results.reduce<Record<string, number>>((counts, result) => {
      const role = String(result.role);
      counts[role] = (counts[role] ?? 0) + 1;
      return counts;
    }, {});

    expect(results.results.map((result) => result.persona_id).sort()).toEqual(expectedIds.sort());
    expect(roles).toEqual({
      first_time_individual: 8,
      team_operator: 8,
      ontology_steward: 8,
      recovery_user: 8
    });
    for (const result of results.results) {
      expect(result).toMatchObject({
        status: 'recognized',
        value_moment_ref: 'candidate-corpus/journey-05-real-codex-id-edge.json:item_8',
        reuse_intent: 'yes',
        journey_duration_ms: 51069,
        within_budget: true,
        missing_condition: null,
        known_major_unresolved_count: 0,
        new_major_count: 0
      });
      expect(String(result.value_reason).length).toBeGreaterThan(20);
      expect(String(result.counterfactual_without_product).length).toBeGreaterThan(20);
    }
    expect(results.totals).toEqual({
      personas: 32,
      recognized: 32,
      reuse_yes: 32,
      within_budget: 32,
      known_major_unresolved: 0,
      new_major_count: 0
    });
    expect(results.synthetic_value_converged).toBe(true);
    expect(results.human_observation).toBe('not_collected');
    expect(metadata).toMatchObject({
      status: 'candidate_converged',
      journey_duration_ms: 51069,
      persona_results: 'candidate-persona-results/summary.json',
      synthetic_value_converged: true,
      registry_value_recognition: 'not_collected'
    });
    expect(metadata.journey_duration_ms).toBeLessThanOrEqual(600000);
  });
});

function completedCall(id: string, tool: string, text: string): string {
  return JSON.stringify({ type: 'item.completed', item: {
    id, type: 'mcp_tool_call', server: 'brainbase', tool, arguments: {},
    result: { content: [{ type: 'text', text }] }, error: null, status: 'completed'
  } });
}
