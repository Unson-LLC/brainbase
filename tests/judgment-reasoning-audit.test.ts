import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildJudgmentFrameCatalog,
  type JudgmentFrameCatalog,
  type JudgmentFrameRecord,
  type JudgmentFrameSourceRecord,
} from '../src/judgment-frame.js';
import {
  judgmentModelOutcomeDigest,
  parseJudgmentModelOutcomeRecords,
  type JudgmentModelOutcome,
  type JudgmentModelOutcomeStoredRecord,
} from '../src/judgment-model-outcome.js';
import {
  createJudgmentDAGEvaluationEventSet,
  createJudgmentDAGOutcomeAttachment,
  evaluateJudgmentDAGVersions,
  executeJudgmentDAG,
  replayJudgmentDAGRun,
  saveJudgmentDAGRunArtifact,
  type JudgmentDAG,
} from '../src/judgment-dag.js';
import {
  JUDGMENT_REASONING_AUDIT_SCHEMA_VERSION,
  JUDGMENT_REASONING_DISTORTION_PATTERNS,
  JUDGMENT_REASONING_DISTORTION_RUBRIC_V1,
  JUDGMENT_REASONING_DISTORTION_RUBRIC_VERSION,
  auditJudgmentReasoning,
  toJudgmentDAGDistortionObservations,
  type JudgmentReasoningAuditInput,
  type JudgmentReasoningDistortionPattern,
  type JudgmentReasoningLearningCandidate,
  type JudgmentReasoningPatternStatus,
} from '../src/judgment-reasoning-audit.js';
import type { JudgmentNodeResult } from '../src/judgment-node-evidence.js';

interface GoldenCase {
  readonly id: string;
  readonly target_pattern: JudgmentReasoningDistortionPattern;
  readonly kind: 'healthy' | 'distorted';
  readonly description: string;
  readonly input: JudgmentReasoningAuditInput;
  readonly expected: {
    readonly overall_status: 'pass' | 'warn' | 'fail';
    readonly target_status: JudgmentReasoningPatternStatus;
    readonly target_score: 0 | 0.5 | 1;
    readonly required_signals: readonly string[];
  };
}

interface GoldenFixtureFile {
  readonly schema_version: 'judgment-reasoning-distortion-cases.v1';
  readonly cases: readonly GoldenCase[];
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child);
  }
}

function makeCatalog(extraModels: readonly JudgmentFrameSourceRecord[] = []): JudgmentFrameCatalog {
  return buildJudgmentFrameCatalog([
    {
      id: 'phi_purpose_first',
      entity_type: 'philosophy',
      lifecycle_status: 'active',
      payload: {
        display_name: '目的を先に固定する',
        statement: '最適化の前に目的と守る条件を決める。',
        status: 'active',
      },
    },
    {
      id: 'obj_profit_headroom',
      entity_type: 'objective',
      lifecycle_status: 'active',
      payload: {
        foundation: {
          revision: '1',
          adoptionState: 'approved',
          desiredState: '再現性のある収益改善余地を最大化する。',
        },
      },
    },
    {
      id: 'mod_priority_cleaning',
      entity_type: 'model',
      lifecycle_status: 'active',
      payload: {
        applicability_text: '繁忙期・全施設',
        foundation: {
          revision: '2',
          validationState: 'verified',
          adoptionState: 'approved',
          meaning: '繁忙期は高価格室優先の清掃順で平均売上が改善する。',
        },
      },
    },
    ...extraModels,
  ]).catalog;
}

function makeStoredOutcome(
  id: string,
  recordedAt: string,
  outcome: Omit<JudgmentModelOutcome, 'record_version'>,
): JudgmentModelOutcomeStoredRecord {
  const full: JudgmentModelOutcome = {
    record_version: 'judgment-model-outcome.v1',
    ...outcome,
  };
  return {
    ...full,
    id,
    recorded_at: recordedAt,
    digest: judgmentModelOutcomeDigest(full),
  };
}

function makeLearningCandidate(
  id: string,
  targetModelId: string,
  revision: string,
  addressedRefutationIds?: readonly string[],
): JudgmentReasoningLearningCandidate {
  const base: JudgmentReasoningLearningCandidate = {
    version: 1,
    id,
    sourceEvaluationRef: {
      id: `eval_${id}`,
      digest: `sha256:${'a'.repeat(64)}`,
    },
    target: {
      kind: 'world_model',
      id: targetModelId,
      revision,
      digest: `sha256:${'b'.repeat(64)}`,
      foundationType: 'model',
    },
    proposedChange: {
      summary: '適用条件を限定し、反証された時間帯の前提を更新する',
    },
    grounds: ['構造的反証データにより適用範囲外での逆転を確認'],
    counterexamples: ['人員欠員時は優先順の効果が消失'],
    uncertainty: ['閑散期への一般化は未検証'],
    applicability: { scope: 'organization', id: 'org_demo' },
    createdAt: '2026-11-20T00:00:00.000Z',
    digest: `sha256:${'c'.repeat(64)}`,
    ...(addressedRefutationIds === undefined ? {} : { addressedRefutationIds }),
  };
  return base;
}

function makeVerifyNode(
  overrides: Partial<JudgmentNodeResult> = {},
): JudgmentNodeResult {
  return {
    schema_version: 'brainbase-judgment-node-result-v1',
    node_id: 'verify',
    status: 'supported',
    finding: '反証条件に対する実測データを確認した。',
    evidence_fit: '全施設ログと直接照合済み。',
    unknowns: [],
    evidence_tool_use_ids: ['tool_verify_query_1'],
    previous_result_tool_use_id: 'tool_hypothesis_1',
    next_action: '検証結果に基づき最終判断を記録する。',
    ...overrides,
  };
}

function makeHealthyFrame(catalog: JudgmentFrameCatalog): JudgmentFrameRecord {
  return {
    record_version: 'judgment-frame-record.v1',
    catalog_digest: catalog.digest,
    selections: [
      { ref: 'phi_purpose_first', kind: 'philosophy', why: '守る条件として固定する' },
      { ref: 'obj_profit_headroom', kind: 'objective', why: '評価基準として比較する' },
      { ref: 'mod_priority_cleaning', kind: 'model', why: '予測仮説として検証する' },
    ],
    options: [
      {
        label: '高価格室優先の清掃順を適用する',
        uses: [
          { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '目的制約を満たす' },
          { ref: 'obj_profit_headroom', role: 'criterion', note: '再現性ある改善を確認' },
          {
            ref: 'mod_priority_cleaning',
            role: 'prediction',
            note: '繁忙期30日集計で予測が成立',
            check: {
              falsified_if: '全12施設×30日の繁忙帯集計で平均売上が悪化する',
              status: 'held',
              evidence: '全12施設×30日ログ集計',
              balance: {
                claim_scope: 'probabilistic',
                population: '全12施設・30日（360施設日）',
                supporting_summary: '295/360施設日で売上改善',
                counter_summary: '65施設日は横ばいまたは軽微低下（人員欠員要因）',
                competing_hypotheses: [
                  {
                    hypothesis: '清掃開始時刻の前倒しだけで説明できる',
                    comparison: '開始時刻を層別固定しても高価格室優先の優位が残る',
                  },
                ],
              },
            },
          },
        ],
      },
      {
        label: '現行の固定順を維持する',
        uses: [
          { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '目的制約を満たす' },
          { ref: 'obj_profit_headroom', role: 'criterion', note: '改善余地が小さい' },
        ],
      },
    ],
    chosen_option: '高価格室優先の清掃順を適用する',
  };
}

describe('golden fixture cases (tests/fixtures/judgment-reasoning-distortion-cases.json)', () => {
  it('validates all golden cases deterministically across all 5 distortion patterns', async () => {
    const fixturePath = path.join(process.cwd(), 'tests/fixtures/judgment-reasoning-distortion-cases.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as GoldenFixtureFile;

    expect(fixture.schema_version).toBe('judgment-reasoning-distortion-cases.v1');
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
    expect(fixture.cases.length).toBeLessThanOrEqual(15);

    const uniqueIds = new Set(fixture.cases.map((entry) => entry.id));
    expect(uniqueIds.size).toBe(fixture.cases.length);

    for (const pattern of JUDGMENT_REASONING_DISTORTION_PATTERNS) {
      const patternCases = fixture.cases.filter((entry) => entry.target_pattern === pattern);
      expect(patternCases.some((entry) => entry.kind === 'healthy'), `${pattern} healthy case`).toBe(true);
      expect(patternCases.some((entry) => entry.kind === 'distorted'), `${pattern} distorted case`).toBe(true);
    }

    for (const scenario of fixture.cases) {
      if (scenario.input.outcomes && scenario.input.outcomes.length > 0) {
        const parsed = parseJudgmentModelOutcomeRecords(scenario.input.outcomes);
        expect(parsed.ok, `${scenario.id}: outcomes must have valid digests`).toBe(true);
      }

      const snapshotBefore = JSON.stringify(scenario.input);
      const first = auditJudgmentReasoning(scenario.input);
      const second = auditJudgmentReasoning(scenario.input);

      expect(JSON.stringify(scenario.input), `${scenario.id}: input must not be mutated`).toBe(snapshotBefore);
      expect(first, `${scenario.id}: audit must be deterministic`).toEqual(second);
      expectDeeplyFrozen(first);

      expect(first.schema_version, scenario.id).toBe(JUDGMENT_REASONING_AUDIT_SCHEMA_VERSION);
      expect(first.overall_status, scenario.id).toBe(scenario.expected.overall_status);
      expect(first.overall_score, scenario.id).toBeGreaterThanOrEqual(0);
      expect(first.overall_score, scenario.id).toBeLessThanOrEqual(1);

      const target = first.patterns[scenario.target_pattern];
      expect(target.pattern, scenario.id).toBe(scenario.target_pattern);
      expect(target.status, scenario.id).toBe(scenario.expected.target_status);
      expect(target.score, scenario.id).toBe(scenario.expected.target_score);

      for (const expectedSignal of scenario.expected.required_signals) {
        expect(target.signals, `${scenario.id} missing signal ${expectedSignal}`).toContain(expectedSignal);
      }
      if (scenario.expected.target_status === 'fail' || scenario.expected.target_status === 'warn') {
        expect(target.evidence_paths.length, `${scenario.id} must report evidence_paths`).toBeGreaterThan(0);
      }
    }
  });
});

describe('JUDGMENT_REASONING_DISTORTION_RUBRIC_V1', () => {
  it('exports complete, deeply frozen rubric entries aligned 1:1 with the 5 distortion patterns', () => {
    expect(JUDGMENT_REASONING_DISTORTION_RUBRIC_VERSION).toBe('judgment-reasoning-distortion-rubric.v1');
    expect(Object.keys(JUDGMENT_REASONING_DISTORTION_RUBRIC_V1)).toEqual([...JUDGMENT_REASONING_DISTORTION_PATTERNS]);
    expectDeeplyFrozen(JUDGMENT_REASONING_DISTORTION_RUBRIC_V1);

    for (const pattern of JUDGMENT_REASONING_DISTORTION_PATTERNS) {
      const entry = JUDGMENT_REASONING_DISTORTION_RUBRIC_V1[pattern];
      expect(entry.pattern).toBe(pattern);
      for (const field of [
        'title',
        'definition',
        'pass_criteria',
        'warn_criteria',
        'fail_criteria',
        'positive_anchor',
        'negative_anchor',
      ] as const) {
        expect(typeof entry[field], `${pattern}.${field}`).toBe('string');
        expect(entry[field].trim().length, `${pattern}.${field} non-empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe('pattern-level deterministic structural checks', () => {
  it('1. counterexample_scope_mismatch: distinguishes anecdotal vs representative/universal strictly via structure', () => {
    const catalog = makeCatalog();

    // Universal claim refuted by 1 anecdotal counterexample -> logically valid (PASS)
    const universalRefuted = makeHealthyFrame(catalog);
    const universalCheckFrame: JudgmentFrameRecord = {
      ...universalRefuted,
      options: [
        {
          label: '現行の固定順を維持する',
          uses: [
            { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '制約充足' },
            { ref: 'obj_profit_headroom', role: 'criterion', note: '安全側を採用' },
          ],
        },
        {
          label: '高価格室優先の清掃順を適用する',
          uses: [
            { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '制約充足' },
            { ref: 'obj_profit_headroom', role: 'criterion', note: '全称法則は破綻' },
            {
              ref: 'mod_priority_cleaning',
              role: 'prediction',
              note: '1件の反例で全称主張が棄却された',
              check: {
                falsified_if: '1施設でも売上が低下する',
                status: 'failed',
                evidence: '施設Bの実測ログ',
                balance: {
                  claim_scope: 'universal',
                  population: '全12施設',
                  supporting_summary: '11施設で成立',
                  counter_summary: '施設Bの単発事例で反証',
                  counter_representativeness: 'anecdotal',
                },
              },
            },
          ],
        },
      ],
      chosen_option: '現行の固定順を維持する',
    };
    const universalAudit = auditJudgmentReasoning({ frame: universalCheckFrame, catalog });
    expect(universalAudit.patterns.counterexample_scope_mismatch.status).toBe('pass');
    expect(universalAudit.patterns.counterexample_scope_mismatch.score).toBe(1);

    // Probabilistic claim failed with representative counter-evidence even when prose says "1件の例外" -> PASS (no regex!)
    const proseGuardFrame: JudgmentFrameRecord = {
      ...universalCheckFrame,
      options: universalCheckFrame.options.map((option, idx) => idx === 1 ? {
        ...option,
        uses: option.uses.map((use) => use.role === 'prediction' ? {
          ...use,
          check: {
            ...use.check!,
            balance: {
              ...use.check!.balance!,
              claim_scope: 'probabilistic',
              counter_summary: '単発の1件の例外に見えたが全社集計で再現',
              counter_representativeness: 'representative',
            },
          },
        } : use),
      } : option),
    };
    const proseAudit = auditJudgmentReasoning({ frame: proseGuardFrame, catalog });
    expect(proseAudit.patterns.counterexample_scope_mismatch.status).toBe('pass');

    // Probabilistic + failed + unknown representativeness -> WARN
    const unknownRepFrame: JudgmentFrameRecord = {
      ...proseGuardFrame,
      options: proseGuardFrame.options.map((option, idx) => idx === 1 ? {
        ...option,
        uses: option.uses.map((use) => use.role === 'prediction' ? {
          ...use,
          check: {
            ...use.check!,
            balance: {
              ...use.check!.balance!,
              counter_representativeness: 'unknown',
            },
          },
        } : use),
      } : option),
    };
    const unknownAudit = auditJudgmentReasoning({ frame: unknownRepFrame, catalog });
    expect(unknownAudit.patterns.counterexample_scope_mismatch.status).toBe('warn');
    expect(unknownAudit.patterns.counterexample_scope_mismatch.score).toBe(0.5);
    expect(unknownAudit.patterns.counterexample_scope_mismatch.signals).toContain('probabilistic_failed_with_unknown_representativeness');

    // Probabilistic + failed + undefined representativeness with anecdotal-only stored outcome -> WARN
    const anecdotalOutcome = makeStoredOutcome('out_anec_1', '2026-11-20T00:00:00.000Z', {
      model: { id: 'mod_priority_cleaning', revision: '2' },
      verdict: 'refutes',
      prediction: '繁忙期平均売上が改善する',
      observed: '施設Bの単日のみ低下',
      conditions: '施設B・単日特売',
      evidence_refs: [{ kind: 'artifact', ref: 'log-b', label: '施設Bログ' }],
      ruled_out: {
        measurement_error: '計測確認済み',
        execution_difference: '手順どおり',
        external_change: '外乱なし',
      },
      scope_metrics: {
        claim_type: 'tendency',
        sample_size: 1,
        population_size: 360,
        representativeness: 'anecdotal',
      },
    });
    const omittedRepFrame: JudgmentFrameRecord = {
      ...proseGuardFrame,
      options: proseGuardFrame.options.map((option, idx) => idx === 1 ? {
        ...option,
        uses: option.uses.map((use) => use.role === 'prediction' ? {
          ...use,
          check: {
            ...use.check!,
            balance: {
              claim_scope: 'probabilistic',
              population: '全12施設',
              supporting_summary: '11施設で改善',
              counter_summary: '施設Bの単日低下',
            },
          },
        } : use),
      } : option),
    };
    const omittedRepAudit = auditJudgmentReasoning({
      frame: omittedRepFrame,
      catalog,
      outcomes: [anecdotalOutcome],
    });
    expect(omittedRepAudit.patterns.counterexample_scope_mismatch.status).toBe('warn');
    expect(omittedRepAudit.patterns.counterexample_scope_mismatch.signals).toContain('probabilistic_failed_on_anecdotal_only_outcomes');
  });

  it('2. base_rate_neglect: catches partial retrieval counts and missing balance fields without false positives', () => {
    const catalog = makeCatalog();
    const healthy = makeHealthyFrame(catalog);

    // Strip balance on chosen option prediction
    const withoutBalance: JudgmentFrameRecord = {
      ...healthy,
      options: healthy.options.map((option, idx) => idx === 0 ? {
        ...option,
        uses: option.uses.map((use) => use.role === 'prediction' ? {
          ...use,
          check: {
            falsified_if: '全体集計で悪化',
            status: 'held',
            evidence: '集計ログ',
          },
        } : use),
      } : option),
    };

    // Without retrieval: warn (missing balance on held check)
    const warnAudit = auditJudgmentReasoning({ frame: withoutBalance, catalog });
    expect(warnAudit.patterns.base_rate_neglect.status).toBe('warn');
    expect(warnAudit.patterns.base_rate_neglect.score).toBe(0.5);

    // Complete retrieval with only returnedCount (no totalScopedCount): does NOT trigger partial fail
    const singleCountAudit = auditJudgmentReasoning({
      frame: withoutBalance,
      catalog,
      retrieval: [{ coverage: 'complete', returnedCount: 5 }],
    });
    expect(singleCountAudit.patterns.base_rate_neglect.status).toBe('warn');

    // Complete coverage BUT returnedCount < totalScopedCount (both present) without balance.population -> FAIL
    const truncatedAudit = auditJudgmentReasoning({
      frame: withoutBalance,
      catalog,
      retrieval: [{ coverage: 'complete', returnedCount: 5, totalScopedCount: 50 }],
    });
    expect(truncatedAudit.patterns.base_rate_neglect.status).toBe('fail');
    expect(truncatedAudit.patterns.base_rate_neglect.signals).toContain('partial_retrieval_missing_population');
    expect(truncatedAudit.patterns.base_rate_neglect.evidence_paths).toContain('retrieval[0]');

    // Same truncated retrieval WITH balance.population properly recorded -> PASS
    const mitigatedAudit = auditJudgmentReasoning({
      frame: healthy,
      catalog,
      retrieval: [{ coverage: 'partial', returnedCount: 5, totalScopedCount: 50 }],
    });
    expect(mitigatedAudit.patterns.base_rate_neglect.status).toBe('pass');
    expect(mitigatedAudit.patterns.base_rate_neglect.score).toBe(1);
  });

  it('3. layer_conflation: catches unverified unchecked model, verified unchecked warn, missing falsified_if, and role/check conflation', () => {
    const catalog = makeCatalog([
      {
        id: 'mod_unverified_beta',
        entity_type: 'model',
        lifecycle_status: 'active',
        payload: {
          applicability_text: '新規店舗',
          foundation: {
            revision: '1',
            adoptionState: 'approved',
            meaning: '新規店舗では初月割引でリピート率が上がる。',
          },
        },
      },
    ]);

    // Verified model left unchecked -> WARN
    const verifiedUnchecked = makeHealthyFrame(catalog);
    const verifiedUncheckedFrame: JudgmentFrameRecord = {
      ...verifiedUnchecked,
      options: verifiedUnchecked.options.map((opt, idx) => idx === 0 ? {
        ...opt,
        uses: opt.uses.map((u) => u.role === 'prediction' ? {
          ...u,
          check: { falsified_if: '全体集計で悪化', status: 'unchecked' },
        } : u),
      } : opt),
    };
    const warnRes = auditJudgmentReasoning({ frame: verifiedUncheckedFrame, catalog });
    expect(warnRes.patterns.layer_conflation.status).toBe('warn');
    expect(warnRes.patterns.layer_conflation.signals).toContain('chosen_verified_model_unchecked');

    // Constraint carrying check + model used as constraint + missing falsified_if -> FAIL
    const conflatedFrame = {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: catalog.digest,
      selections: [
        { ref: 'phi_purpose_first', kind: 'philosophy', why: '制約' },
        { ref: 'obj_profit_headroom', kind: 'objective', why: '基準' },
        { ref: 'mod_unverified_beta', kind: 'model', why: '仮説' },
      ],
      options: [
        {
          label: '割引を即実施',
          uses: [
            {
              ref: 'phi_purpose_first',
              role: 'constraint',
              note: 'verdict欠落かつcheck混入',
              check: { falsified_if: 'x', status: 'unchecked' },
            },
            { ref: 'obj_profit_headroom', role: 'criterion', note: '基準' },
            {
              ref: 'mod_unverified_beta',
              role: 'constraint',
              verdict: 'satisfied',
              note: '未検証モデルを制約として扱う',
            },
          ],
        },
        {
          label: '見送り',
          uses: [
            { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '制約充足' },
            { ref: 'obj_profit_headroom', role: 'criterion', note: '基準' },
            {
              ref: 'mod_unverified_beta',
              role: 'prediction',
              note: 'falsified_if空白',
              check: { falsified_if: '   ', status: 'unchecked' },
            },
          ],
        },
      ],
      chosen_option: '割引を即実施',
    } as unknown as JudgmentFrameRecord;

    const conflatedRes = auditJudgmentReasoning({ frame: conflatedFrame, catalog });
    expect(conflatedRes.patterns.layer_conflation.status).toBe('fail');
    expect(conflatedRes.patterns.layer_conflation.signals).toEqual(expect.arrayContaining([
      'role_kind_conflation',
      'check_on_non_prediction_role',
      'constraint_verdict_conflation',
      'prediction_check_missing_falsified_if',
    ]));
  });

  it('4. conclusion_lock_cherry_picking: respects applies_when scope and flags verify nodes without evidence', () => {
    // Different applies_when scope in catalog should NOT trigger unaddressed competing model when counter_summary is empty
    const diffScopeCatalog = makeCatalog([
      {
        id: 'mod_offseason_only',
        entity_type: 'model',
        lifecycle_status: 'active',
        payload: {
          applicability_text: '閑散期・単独施設',
          foundation: {
            revision: '1',
            validationState: 'verified',
            meaning: '閑散期は別戦略が有効。',
          },
        },
      },
    ]);
    const baseFrame = makeHealthyFrame(diffScopeCatalog);
    const noCounterFrame: JudgmentFrameRecord = {
      ...baseFrame,
      options: baseFrame.options.map((opt, idx) => idx === 0 ? {
        ...opt,
        uses: opt.uses.map((u) => u.role === 'prediction' ? {
          ...u,
          check: {
            falsified_if: '悪化',
            status: 'held',
            evidence: 'ログ',
          },
        } : u),
      } : opt),
    };
    const diffScopeAudit = auditJudgmentReasoning({ frame: noCounterFrame, catalog: diffScopeCatalog });
    expect(diffScopeAudit.patterns.conclusion_lock_cherry_picking.status).toBe('pass');

    // Insufficient verify node without evidence -> WARN; supported verify node without evidence -> FAIL
    const insufficientVerifyAudit = auditJudgmentReasoning({
      frame: makeHealthyFrame(diffScopeCatalog),
      catalog: diffScopeCatalog,
      nodeResults: [
        makeVerifyNode({
          node_id: 'judgment.verify',
          status: 'insufficient',
          unknowns: ['追加データ取得待ち'],
          evidence_tool_use_ids: [],
        }),
      ],
    });
    expect(insufficientVerifyAudit.patterns.conclusion_lock_cherry_picking.status).toBe('warn');
    expect(insufficientVerifyAudit.patterns.conclusion_lock_cherry_picking.signals).toContain('verify_node_insufficient_without_evidence');

    const supportedNoEvidenceAudit = auditJudgmentReasoning({
      frame: makeHealthyFrame(diffScopeCatalog),
      catalog: diffScopeCatalog,
      nodeResults: [
        makeVerifyNode({
          node_id: 'verify',
          status: 'supported',
          evidence_tool_use_ids: [],
        }),
      ],
    });
    expect(supportedNoEvidenceAudit.patterns.conclusion_lock_cherry_picking.status).toBe('fail');
    expect(supportedNoEvidenceAudit.patterns.conclusion_lock_cherry_picking.signals).toContain('verify_node_without_evidence');
  });

  it('5. local_patch_without_model_update: ignores anecdotal-only refutations for >=2 threshold and warns on partial refutation coverage', () => {
    const catalog = makeCatalog();
    const frame = makeHealthyFrame(catalog);

    // 2 anecdotal-only refutations do NOT count as 2 structural refutations
    const anecdotalOutcomes = [
      makeStoredOutcome('out_anec_1', '2026-11-18T00:00:00.000Z', {
        model: { id: 'mod_priority_cleaning', revision: '2' },
        verdict: 'refutes',
        prediction: '改善する',
        observed: '単日低下',
        conditions: '施設A・単日',
        evidence_refs: [{ kind: 'artifact', ref: 'log-1', label: 'ログ1' }],
        ruled_out: { measurement_error: 'ok', execution_difference: 'ok', external_change: 'ok' },
        scope_metrics: { claim_type: 'tendency', sample_size: 1, population_size: 100, representativeness: 'anecdotal' },
      }),
      makeStoredOutcome('out_anec_2', '2026-11-19T00:00:00.000Z', {
        model: { id: 'mod_priority_cleaning', revision: '2' },
        verdict: 'refutes',
        prediction: '改善する',
        observed: '単日低下',
        conditions: '施設B・単日',
        evidence_refs: [{ kind: 'artifact', ref: 'log-2', label: 'ログ2' }],
        ruled_out: { measurement_error: 'ok', execution_difference: 'ok', external_change: 'ok' },
        scope_metrics: { claim_type: 'tendency', sample_size: 1, population_size: 100, representativeness: 'anecdotal' },
      }),
    ];
    const anecdotalAudit = auditJudgmentReasoning({ frame, catalog, outcomes: anecdotalOutcomes });
    expect(anecdotalAudit.patterns.local_patch_without_model_update.status).toBe('pass');

    // 2 structural refutations + chosen switched away + candidate addresses only 1 of 2 -> WARN
    const structuralOutcomes = [
      makeStoredOutcome('out_struct_1', '2026-11-18T00:00:00.000Z', {
        model: { id: 'mod_priority_cleaning', revision: '2' },
        verdict: 'refutes',
        prediction: '改善する',
        observed: '全社集計で低下',
        conditions: '全12施設・10月',
        evidence_refs: [{ kind: 'query', ref: 'q-10', label: '10月集計' }],
        ruled_out: { measurement_error: 'ok', execution_difference: 'ok', external_change: 'ok' },
        scope_metrics: { claim_type: 'tendency', sample_size: 120, population_size: 120, representativeness: 'census' },
      }),
      makeStoredOutcome('out_struct_2', '2026-11-19T00:00:00.000Z', {
        model: { id: 'mod_priority_cleaning', revision: '2' },
        verdict: 'refutes',
        prediction: '改善する',
        observed: '全社集計で再低下',
        conditions: '全12施設・11月',
        evidence_refs: [{ kind: 'query', ref: 'q-11', label: '11月集計' }],
        ruled_out: { measurement_error: 'ok', execution_difference: 'ok', external_change: 'ok' },
        scope_metrics: { claim_type: 'tendency', sample_size: 120, population_size: 120, representativeness: 'census' },
      }),
    ];
    const switchedFrame: JudgmentFrameRecord = {
      ...frame,
      chosen_option: '現行の固定順を維持する',
    };
    const partialCoverageAudit = auditJudgmentReasoning({
      frame: switchedFrame,
      catalog,
      outcomes: structuralOutcomes,
      learningCandidates: [
        makeLearningCandidate('cand_partial', 'mod_priority_cleaning', '2', ['out_struct_1']),
      ],
    });
    expect(partialCoverageAudit.patterns.local_patch_without_model_update.status).toBe('warn');
    expect(partialCoverageAudit.patterns.local_patch_without_model_update.score).toBe(0.5);
    expect(partialCoverageAudit.patterns.local_patch_without_model_update.signals).toContain('learning_candidate_partial_refutation_coverage');
  });

  it('marks model-dependent patterns as not_applicable when no models, outcomes, retrieval, or candidates exist', () => {
    const catalog = buildJudgmentFrameCatalog([
      {
        id: 'phi_only',
        entity_type: 'philosophy',
        lifecycle_status: 'active',
        payload: { display_name: '誠実', statement: '事実に基づき答える。', status: 'active' },
      },
      {
        id: 'obj_only',
        entity_type: 'objective',
        lifecycle_status: 'active',
        payload: { foundation: { revision: '1', adoptionState: 'approved', desiredState: '明確に説明する。' } },
      },
    ]).catalog;

    const frame: JudgmentFrameRecord = {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: catalog.digest,
      selections: [
        { ref: 'phi_only', kind: 'philosophy', why: '制約' },
        { ref: 'obj_only', kind: 'objective', why: '目的' },
      ],
      none: { model: '該当する因果モデルがない単純な運用選択のため' },
      options: [
        {
          label: '案A',
          uses: [
            { ref: 'phi_only', role: 'constraint', verdict: 'satisfied', note: '整合' },
            { ref: 'obj_only', role: 'criterion', note: '明確' },
          ],
        },
        {
          label: '案B',
          uses: [
            { ref: 'phi_only', role: 'constraint', verdict: 'satisfied', note: '整合' },
            { ref: 'obj_only', role: 'criterion', note: 'やや冗長' },
          ],
        },
      ],
      chosen_option: '案A',
    };

    const audit = auditJudgmentReasoning({ frame, catalog });
    expect(audit.overall_status).toBe('pass');
    expect(audit.overall_score).toBe(1);
    expect(audit.patterns.counterexample_scope_mismatch.status).toBe('not_applicable');
    expect(audit.patterns.base_rate_neglect.status).toBe('not_applicable');
    expect(audit.patterns.local_patch_without_model_update.status).toBe('not_applicable');
    expect(audit.patterns.layer_conflation.status).toBe('pass');
    expect(audit.patterns.conclusion_lock_cherry_picking.status).toBe('pass');
  });
});

describe('R1 Replay Evaluation integration (evaluateJudgmentDAGVersions without modifying replay module)', () => {
  function buildEvaluationDag(version: string): JudgmentDAG {
    return {
      id: 'distortion-audit-r1-dag',
      version,
      nodes: [
        {
          id: 'observe',
          node_type: 'observation',
          layer: 'context',
          scope: { type: 'project', id: 'distortion-eval' },
          version: '1.0.0',
          description: 'collect retrieval context and population denominators',
          depends_on: [],
          input_contract: 'distortion.input.v1',
          output_contract: 'distortion.observe.v1',
          runner_type: 'deterministic',
        },
        {
          id: 'verify',
          node_type: 'judgment',
          layer: 'judgment',
          scope: { type: 'project', id: 'distortion-eval' },
          version,
          description: 'check predictions and competing hypotheses',
          depends_on: ['observe'],
          input_contract: 'distortion.observe.v1',
          output_contract: 'distortion.verify.v1',
          runner_type: 'deterministic',
        },
      ],
      edges: [
        { from: 'observe', to: 'verify', relation: 'depends_on' },
      ],
    };
  }

  it('plugs toJudgmentDAGDistortionObservations directly into createJudgmentDAGOutcomeAttachment and evaluateJudgmentDAGVersions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'brainbase-distortion-r1-'));
    temporaryRoots.push(root);

    const catalog = makeCatalog();
    const healthyFrame = makeHealthyFrame(catalog);

    // Baseline frame: single option + anecdotal failed probabilistic check + partial retrieval without population
    const distortedFrame: JudgmentFrameRecord = {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: catalog.digest,
      selections: healthyFrame.selections,
      options: [
        {
          label: '高価格室優先を即却下',
          uses: [
            { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '制約充足' },
            { ref: 'obj_profit_headroom', role: 'criterion', note: '単発反例で却下' },
            {
              ref: 'mod_priority_cleaning',
              role: 'prediction',
              note: '1件の例外でモデル否定',
              check: {
                falsified_if: '全体傾向が逆転',
                status: 'failed',
                evidence: '施設Bの単日ログ',
                balance: {
                  claim_scope: 'probabilistic',
                  population: '',
                  supporting_summary: '11施設で改善',
                  counter_summary: '施設Bの1日だけ低下',
                  counter_representativeness: 'anecdotal',
                },
              },
            },
          ],
        },
      ],
      chosen_option: '高価格室優先を即却下',
    };

    const baselineAudit = auditJudgmentReasoning({
      frame: distortedFrame,
      catalog,
      retrieval: [{ coverage: 'partial', returnedCount: 3, totalScopedCount: 30 }],
    });
    const candidateAudit = auditJudgmentReasoning({
      frame: healthyFrame,
      catalog,
      retrieval: [{ coverage: 'partial', returnedCount: 3, totalScopedCount: 30 }],
      nodeResults: [makeVerifyNode()],
    });

    expect(baselineAudit.overall_status).toBe('fail');
    expect(candidateAudit.overall_status).toBe('pass');

    // Default (run-only) observations emit exactly 6 entries (5 patterns + overall_pass)
    const runOnlyObservations = toJudgmentDAGDistortionObservations(candidateAudit);
    expect(runOnlyObservations).toHaveLength(6);
    expect(runOnlyObservations.map((obs) => obs.metric_id)).toEqual([
      'distortion.counterexample_scope_mismatch',
      'distortion.base_rate_neglect',
      'distortion.layer_conflation',
      'distortion.conclusion_lock_cherry_picking',
      'distortion.local_patch_without_model_update',
      'distortion.overall_pass',
    ]);
    expectDeeplyFrozen(runOnlyObservations);

    // Execute baseline and candidate replay on the same recorded context
    const recordedInput = { case_id: 'cleaning-order-busy-season' };
    const baselineRun = await executeJudgmentDAG({
      run_id: 'run-distortion-baseline',
      dag: buildEvaluationDag('v1'),
      input: recordedInput,
      runners: {
        deterministic: {
          version: 'runner-v1',
          run: ({ node, input }) => ({ node_id: node.id, input, mode: 'baseline' }),
        },
      },
    });
    const baselineSaved = await saveJudgmentDAGRunArtifact({ root, record: baselineRun });

    const candidateReplay = await replayJudgmentDAGRun({
      source: { artifact_id: baselineSaved.artifact_id, record: baselineRun },
      replay_run_id: 'run-distortion-candidate',
      mode: 'candidate',
      candidate_dag: buildEvaluationDag('v2'),
      runners: {
        deterministic: {
          version: 'runner-v2',
          run: ({ node, input }) => ({ node_id: node.id, input, mode: 'candidate' }),
        },
      },
    });
    const candidateSaved = await saveJudgmentDAGRunArtifact({ root, record: candidateReplay.record });

    const observationMapping = {
      nodeId: 'verify',
      patternNodeIds: {
        base_rate_neglect: 'observe',
        counterexample_scope_mismatch: 'verify',
      },
    } as const;

    const baselineOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: baselineSaved.artifact_id,
      record: baselineRun,
      observations: toJudgmentDAGDistortionObservations(baselineAudit, observationMapping),
    });
    const candidateOutcome = createJudgmentDAGOutcomeAttachment({
      run_artifact_id: candidateSaved.artifact_id,
      record: candidateReplay.record,
      observations: toJudgmentDAGDistortionObservations(candidateAudit, observationMapping),
    });

    const eventSet = createJudgmentDAGEvaluationEventSet({
      events: [
        {
          event_id: 'event-cleaning-order',
          baseline: { artifact_id: baselineSaved.artifact_id, record: baselineRun, outcome: baselineOutcome },
          candidate: { artifact_id: candidateSaved.artifact_id, record: candidateReplay.record, outcome: candidateOutcome },
        },
      ],
    });

    // 1) Overall pass/fail comparison + node_calibration on 'verify'
    const overallComparison = evaluateJudgmentDAGVersions({
      event_set: eventSet,
      criterion: {
        criterion_id: 'distortion-overall-pass',
        goal: 'eliminate reasoning distortions across all five patterns',
        metric_id: 'distortion.overall_pass',
        scoring: { kind: 'pass_fail', operator: 'eq', target: true },
      },
    });
    expect(overallComparison.overall).toEqual({
      baseline: 0,
      candidate: 1,
      delta: 1,
      event_count: 1,
    });
    expect(overallComparison.node_calibration).toEqual([
      { node_id: 'observe', status: 'no_observation', baseline: null, candidate: null, delta: null, event_count: 0 },
      { node_id: 'verify', status: 'comparable', baseline: 0, candidate: 1, delta: 1, event_count: 1 },
    ]);

    // 2) Pattern-specific numeric comparison + node_calibration on 'observe' (base_rate_neglect)
    const baseRateComparison = evaluateJudgmentDAGVersions({
      event_set: eventSet,
      criterion: {
        criterion_id: 'distortion-base-rate',
        goal: 'eliminate base rate neglect under partial retrieval',
        metric_id: 'distortion.base_rate_neglect',
        scoring: { kind: 'numeric', direction: 'higher_is_better' },
      },
    });
    expect(baseRateComparison.overall).toEqual({
      baseline: 0,
      candidate: 1,
      delta: 1,
      event_count: 1,
    });
    expect(baseRateComparison.node_calibration).toEqual([
      { node_id: 'observe', status: 'comparable', baseline: 0, candidate: 1, delta: 1, event_count: 1 },
      { node_id: 'verify', status: 'no_observation', baseline: null, candidate: null, delta: null, event_count: 0 },
    ]);

    // 3) Pattern-specific numeric comparison + node_calibration on 'verify' (counterexample_scope_mismatch)
    const scopeComparison = evaluateJudgmentDAGVersions({
      event_set: eventSet,
      criterion: {
        criterion_id: 'distortion-scope-mismatch',
        goal: 'prevent anecdotal refutation of probabilistic models',
        metric_id: 'distortion.counterexample_scope_mismatch',
        scoring: { kind: 'numeric', direction: 'higher_is_better' },
      },
    });
    expect(scopeComparison.overall).toEqual({
      baseline: 0,
      candidate: 1,
      delta: 1,
      event_count: 1,
    });
    expect(scopeComparison.node_calibration).toEqual([
      { node_id: 'observe', status: 'no_observation', baseline: null, candidate: null, delta: null, event_count: 0 },
      { node_id: 'verify', status: 'comparable', baseline: 0, candidate: 1, delta: 1, event_count: 1 },
    ]);
  });
});

describe('package export contract for ./judgment-reasoning-audit', () => {
  it('exposes ./judgment-reasoning-audit in package.json and loads built dist module cleanly', async () => {
    const root = process.cwd();
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, { types: string; import: string }>;
    };
    expect(manifest.exports['./judgment-reasoning-audit']).toEqual({
      types: './dist/judgment-reasoning-audit.d.ts',
      import: './dist/judgment-reasoning-audit.js',
    });

    const builtModule = await import(pathToFileURL(path.join(root, manifest.exports['./judgment-reasoning-audit'].import)).href);
    expect(typeof builtModule.auditJudgmentReasoning).toBe('function');
    expect(typeof builtModule.toJudgmentDAGDistortionObservations).toBe('function');
    expect(builtModule.JUDGMENT_REASONING_AUDIT_SCHEMA_VERSION).toBe('judgment-reasoning-audit.v1');
    expect(Object.keys(builtModule.JUDGMENT_REASONING_DISTORTION_RUBRIC_V1)).toHaveLength(5);
  });
});
