import { describe, expect, it } from 'vitest';

import {
  autonomyResolution,
  buildGraph,
  canonicalJson,
  computeRequestDigest,
  mergePolicies,
  resolveJudgmentRuntimeCore,
  sha256Hex,
  topologicallySortNodes,
  validateManifest,
  validateManifestLock,
} from '../src/judgment-runtime-resolution.js';

const autonomy = {
  runtime_escalation_reasons: [
    'irreversible_action',
    'missing_authority',
    'owner_value_choice',
    'required_input_unavailable',
    'evidenced_terminal_blocker',
  ],
};

const node = (id: string) => ({
  id,
  kind: 'common',
  instruction: `instruction:${id}`,
  required_capability_template: null,
});

const fixtureManifest = {
  schema_version: 'brainbase-judgment-runtime-v1',
  runtime_version: 'judgment-runtime-test-1',
  autonomy,
  selectors: {
    domain_order: ['general', 'knowledge', 'personal_judgment', 'engineering', 'organization', 'operations'],
    signal_order: [
      'cumulative_effect',
      'complexity_growth',
      'threshold_proposal',
      'parallel_exploration',
      'authority_boundary',
      'problem_frame_uncertain',
      'external_outcome',
    ],
    domain_dags: {
      general: 'general.v1',
      knowledge: 'general.v1',
      personal_judgment: 'general.v1',
      engineering: 'engineering.v1',
      organization: 'general.v1',
      operations: 'general.v1',
    },
    signal_dags: {
      cumulative_effect: 'general.v1',
      complexity_growth: 'general.v1',
      threshold_proposal: 'general.v1',
      parallel_exploration: 'general.v1',
      authority_boundary: 'authority.v1',
      problem_frame_uncertain: 'general.v1',
      external_outcome: 'authority.v1',
    },
    engineering_implementation_dag: 'engineering.v1',
    authority_dag: 'authority.v1',
    clarification_dag: 'clarification.v1',
  },
  semantic_matchers: {
    intents: {
      operate: ['operate'],
      implement: ['implement'],
      review: ['review'],
      diagnose: ['diagnose'],
      design: ['design'],
      investigate: ['investigate'],
      answer: ['answer'],
    },
    domains: {
      engineering: ['engineering'],
      knowledge: ['knowledge'],
      personal_judgment: ['personal_judgment'],
      organization: ['organization'],
      operations: ['operations'],
    },
    signals: {
      cumulative_effect: ['cumulative_effect'],
      complexity_growth: ['complexity_growth'],
      threshold_proposal: ['threshold_proposal'],
      parallel_exploration: ['parallel_exploration'],
      authority_boundary: ['authority_boundary'],
      problem_frame_uncertain: ['problem_frame_uncertain'],
      external_outcome: ['external_outcome'],
    },
    safety: {
      write: ['write'],
      external: ['external'],
      critical: ['critical'],
    },
    positive_commands: ['implement', 'operate'],
    follow_up: ['this'],
  },
  host_bindings: [{ adapter_id: 'test-host', adapter_version: '1', status: 'managed' }],
  policies: [],
  nodes: [
    node('entry'),
    node('reconcile'),
    node('goal'),
    node('engineering'),
    node('authority'),
    node('merge'),
    node('receipt'),
    node('clarification'),
  ],
  dags: [
    { id: 'general.v1', kind: 'domain', path: ['goal'], policy_ids: [] },
    { id: 'engineering.v1', kind: 'domain', path: ['engineering'], policy_ids: [] },
    { id: 'authority.v1', kind: 'constraint', path: ['authority'], policy_ids: [] },
    { id: 'clarification.v1', kind: 'fail_closed', path: ['clarification'], policy_ids: [] },
  ],
  composition_edges: [],
};

const resolvedInput = {
  request: 'implement engineering',
  turn_id: 'turn-1',
  project_code: null,
  conversation_context: {},
  model_interpretation: {
    intent: 'implement',
    domains: ['engineering'],
    action_kind: 'write',
    risk: 'medium',
    confidence: 'confirmed',
    signals: [],
  },
};

const approvalPolicy = {
  id: 'approval.write',
  strength: 'hard',
  priority: 10,
  scope: { type: 'global', id: 'global' },
  effect: { target: 'write', decision: 'require' },
  human_approval: { action_kinds: ['write'] },
};

describe('judgment runtime resolution core', () => {
  it('keeps canonical digest bytes stable for the golden request vector', () => {
    const request = { b: ['x', 1], a: '日本語' };
    expect(canonicalJson(request)).toBe('{"a":"日本語","b":["x",1]}');
    expect(computeRequestDigest(request)).toBe(
      'e71241a8acca423accac4a6a0343cc3ca1709f1d016d94add0b01e94f82adad0',
    );
    expect(sha256Hex(canonicalJson(request))).toBe(computeRequestDigest(request));
  });

  it('rejects malformed manifests before any runtime plan is emitted', () => {
    expect(() => validateManifest({ schema_version: 'wrong' }, {})).toThrow('judgment manifest schema is invalid');
  });

  it('rejects cycles in the selected graph', () => {
    expect(() => topologicallySortNodes(['a', 'b'], [['a', 'b'], ['b', 'a']])).toThrow(
      'active judgment graph contains a cycle',
    );
  });

  it('preserves deterministic graph ordering for the golden plan vector', () => {
    const graph = buildGraph(['engineering.v1', 'authority.v1'], fixtureManifest);
    expect(graph).toEqual({
      active_nodes: ['entry', 'reconcile', 'engineering', 'authority', 'merge', 'receipt'],
      active_edges: [
        ['entry', 'reconcile'],
        ['reconcile', 'engineering'],
        ['engineering', 'merge'],
        ['reconcile', 'authority'],
        ['authority', 'merge'],
        ['merge', 'receipt'],
      ],
    });
  });

  it('merges hard policy before soft policy and escalates matching approval policy', () => {
    const merged = mergePolicies([approvalPolicy]);
    expect(merged).toEqual({ applicable: [approvalPolicy], suppressed: [], conflict: false });
    expect(autonomyResolution('resolved', resolvedInput.model_interpretation, fixtureManifest, merged.applicable)).toEqual({
      autonomy_decision: 'escalate',
      autonomy_reason_code: 'risk_or_external',
      allowed_runtime_escalation_reasons: [],
      autonomy_policy_ids: ['approval.write'],
    });
  });

  it('does not broaden an empty authorized policy set into a manifest deny or allow', () => {
    const plan = resolveJudgmentRuntimeCore({
      input: resolvedInput,
      manifest: fixtureManifest,
      applicablePolicies: [],
    });
    expect(plan.applicable_policies).toEqual([]);
    expect(plan.autonomy_decision).toBe('continue');
    expect(plan.selected_dag_ids).toEqual(['engineering.v1', 'authority.v1']);
  });

  it('returns the golden resolved plan and preserves a classification fail-closed branch', () => {
    const plan = resolveJudgmentRuntimeCore({
      input: resolvedInput,
      manifest: fixtureManifest,
      applicablePolicies: [approvalPolicy],
    });
    expect(plan.status).toBe('resolved');
    expect(plan.active_nodes).toEqual(['entry', 'reconcile', 'engineering', 'authority', 'merge', 'receipt']);
    expect(plan.autonomy_policy_ids).toEqual(['approval.write']);
    expect(plan.autonomy_decision).toBe('escalate');

    const missingClassification = resolveJudgmentRuntimeCore({
      input: { ...resolvedInput, model_interpretation: null },
      manifest: fixtureManifest,
      applicablePolicies: [approvalPolicy],
    });
    expect(missingClassification.status).toBe('needs_classification');
    expect(missingClassification.autonomy_reason_code).toBe('classification_missing');
    expect(missingClassification.applicable_policies).toEqual([]);
  });

  it('enforces append-only lock entries and the current digest pair', () => {
    const digest = 'a'.repeat(64);
    const previous = {
      schema_version: 'brainbase-judgment-manifest-lock-v1',
      entries: [{ runtime_version: 'v1', manifest_digest: digest }],
    };
    const current = {
      schema_version: 'brainbase-judgment-manifest-lock-v1',
      entries: [
        ...previous.entries,
        { runtime_version: 'v2', manifest_digest: 'b'.repeat(64) },
      ],
    };
    expect(validateManifestLock(current, previous, {
      runtimeVersion: 'v2',
      manifestDigest: 'b'.repeat(64),
    })).toBe(true);
    expect(() => validateManifestLock({
      ...current,
      entries: [{ runtime_version: 'tampered', manifest_digest: digest }, ...current.entries.slice(1)],
    }, previous, null)).toThrow('judgment manifest lock is append-only');
  });
});
