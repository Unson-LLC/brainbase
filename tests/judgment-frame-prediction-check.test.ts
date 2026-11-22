import { describe, expect, it } from 'vitest';

import {
  handleJudgmentFrameToolCall,
  judgmentFrameTools,
  judgmentModelOutcomeDigest,
  type JudgmentFrameKind,
  type JudgmentFrameSourceRecord,
  type JudgmentFrameToolDependencies,
  type JudgmentModelOutcome,
} from '../src/judgment-frame.js';

const RECORDS: Record<JudgmentFrameKind, JudgmentFrameSourceRecord[]> = {
  philosophy: [{
    id: 'phi_purpose_first', entity_type: 'philosophy', lifecycle_status: 'active',
    payload: { display_name: '目的を先に固定する', statement: '最適化の前に目的と守る条件を決める。', status: 'active' },
  }],
  objective: [{
    id: 'fnd_objective_headroom', entity_type: 'objective', lifecycle_status: 'active',
    payload: { foundation: { revision: '1', adoptionState: 'draft', desiredState: '改善余地の上限を先に示す。' } },
  }],
  model: [{
    id: 'fnd_model_cleaning_order', entity_type: 'model', lifecycle_status: 'active',
    payload: { foundation: { revision: '2', adoptionState: 'draft', meaning: '繁忙時は高価格室から清掃すると売上が増える。' } },
  }],
};

const dependencies: JudgmentFrameToolDependencies = {
  loadRecords: async (kind) => ({ status: 'ok', records: RECORDS[kind] }),
};

async function record(check?: unknown, role = 'prediction') {
  const catalog = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, dependencies);
  const digest = (catalog as { data: { catalog_digest: string } }).data.catalog_digest;
  return handleJudgmentFrameToolCall('brainbase_judgment_frame_record', {
    record_version: 'judgment-frame-record.v1',
    catalog_digest: digest,
    selections: [
      { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定するため' },
      { ref: 'fnd_objective_headroom', kind: 'objective', why: '上限を先に出すため' },
      { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測するため' },
    ],
    options: [{
      label: '清掃順を探索する',
      uses: [
        {
          ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '目的は固定した',
          ...(role === 'constraint' && check !== undefined ? { check } : {}),
        },
        { ref: 'fnd_objective_headroom', role: 'criterion', note: '上限を比べる' },
        {
          ref: 'fnd_model_cleaning_order', role: 'prediction', note: '清掃順で復帰が早まる',
          ...(role === 'prediction' && check !== undefined ? { check } : {}),
        },
      ],
    }],
    chosen_option: '清掃順を探索する',
  }, dependencies);
}

describe('prediction checks in the judgment frame (ADR-014)', () => {
  it('publishes the check on prediction uses', () => {
    const tool = judgmentFrameTools.find((candidate) => candidate.name === 'brainbase_judgment_frame_record');
    const use = (tool?.inputSchema as { properties: { options: { items: { properties: { uses: { items: { properties: Record<string, { required?: string[] }> } } } } } } })
      .properties.options.items.properties.uses.items.properties;
    expect(use.check.required).toEqual(['falsified_if', 'status']);
  });

  it('returns the choice to a human when the chosen option relies on a prediction that failed against data', async () => {
    const result = await record({ falsified_if: '在庫に余裕がある時間が大半なら効果は出ない', status: 'failed', evidence: '境界ごとの時間配分' });
    expect(result?.status).toBe('ok');
    const data = (result as { data: { escalations: unknown[]; prediction_checks: unknown } }).data;
    expect(data.escalations).toEqual([{ code: 'chosen_relies_on_failed_prediction', refs: ['fnd_model_cleaning_order'] }]);
    expect(data.prediction_checks).toEqual({ held: 0, failed: 1, unchecked: 0 });
  });

  it('counts held and unchecked predictions without escalating them', async () => {
    const held = await record({ falsified_if: 'x', status: 'held', evidence: 'query' });
    expect((held as { data: { escalations: unknown[]; prediction_checks: unknown } }).data).toMatchObject({ escalations: [], prediction_checks: { held: 1, failed: 0, unchecked: 0 } });
    const none = await record();
    expect((none as { data: { prediction_checks: unknown } }).data.prediction_checks).toEqual({ held: 0, failed: 0, unchecked: 1 });
    const unchecked = await record({ falsified_if: 'x', status: 'unchecked' });
    expect((unchecked as { data: { prediction_checks: unknown } }).data.prediction_checks).toEqual({ held: 0, failed: 0, unchecked: 1 });
  });

  it('rejects malformed checks and checks on uses other than predictions', async () => {
    for (const [label, check, role] of [
      ['held without evidence', { falsified_if: 'x', status: 'held' }, 'prediction'],
      ['unknown status', { falsified_if: 'x', status: 'maybe' }, 'prediction'],
      ['empty condition', { falsified_if: '', status: 'unchecked' }, 'prediction'],
      ['extra field', { falsified_if: 'x', status: 'unchecked', score: 1 }, 'prediction'],
      ['credential', { falsified_if: 'x', status: 'held', evidence: 'api_key=abcd1234efgh' }, 'prediction'],
      ['on a constraint', { falsified_if: 'x', status: 'unchecked' }, 'constraint'],
    ] as const) {
      const result = await record(check, role);
      expect(result?.status, label).toBe('error');
      expect(JSON.stringify(result), label).toContain('frame_check_invalid');
    }
  });
});

describe('prediction check balance and scope escalations (anti-cherry-picking)', () => {
  it('publishes optional balance on check schema without oneOf or breaking existing required keys', () => {
    const tool = judgmentFrameTools.find((candidate) => candidate.name === 'brainbase_judgment_frame_record');
    expect(tool?.description).toContain('check.balance');
    expect(JSON.stringify(tool?.inputSchema)).not.toContain('oneOf');
    const checkSchema = (tool?.inputSchema as {
      properties: {
        options: {
          items: {
            properties: {
              uses: {
                items: {
                  properties: {
                    check: {
                      required: string[];
                      properties: {
                        balance: {
                          required: string[];
                          properties: Record<string, unknown>;
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    }).properties.options.items.properties.uses.items.properties.check;
    expect(checkSchema.required).toEqual(['falsified_if', 'status']);
    expect(checkSchema.properties.balance.required).toEqual([
      'claim_scope', 'population', 'supporting_summary', 'counter_summary',
    ]);
    expect(Object.keys(checkSchema.properties.balance.properties).sort()).toEqual([
      'claim_scope', 'competing_hypotheses', 'counter_representativeness', 'counter_summary', 'population', 'supporting_summary',
    ]);
  });

  it('accepts balanced checks with competing_hypotheses and does not escalate well-scoped evidence', async () => {
    const heldBalanced = await record({
      falsified_if: '繁忙期30日間の全施設データで高価格室優先が平均復帰時刻を悪化させる',
      status: 'held',
      evidence: '全12施設×30日のログ集計',
      balance: {
        claim_scope: 'probabilistic',
        population: '全12施設・直近30日間の繁忙帯（360施設日）',
        supporting_summary: '295/360施設日で売上が平均+4.2%改善',
        counter_summary: '単発例外が1施設日で発生したが、人員欠員という外乱によるもので傾向は維持',
        competing_hypotheses: [
          {
            hypothesis: '清掃開始時刻の前倒しだけで同等の効果が出る',
            ref: 'fnd_model_start_time',
            comparison: '開始時刻を固定した比較でも高価格室優先の優位が残った',
          },
          {
            hypothesis: '平日と週末の構成差による見かけの差',
            comparison: '週末のみで層別しても同方向の差を確認',
          },
        ],
      },
    });
    expect(heldBalanced?.status).toBe('ok');
    expect((heldBalanced as { data: { escalations: unknown[] } }).data.escalations).toEqual([]);

    const withoutBalance = await record({
      falsified_if: 'x',
      status: 'held',
      evidence: 'query',
    });
    expect((withoutBalance as { data: { digest: string } }).data.digest).not.toBe(
      (heldBalanced as { data: { digest: string } }).data.digest,
    );

    const uncheckedWithBalance = await record({
      falsified_if: '繁忙期データで悪化',
      status: 'unchecked',
      balance: {
        claim_scope: 'probabilistic',
        population: '',
        supporting_summary: '',
        counter_summary: '',
      },
    });
    expect(uncheckedWithBalance?.status).toBe('ok');
    expect((uncheckedWithBalance as { data: { escalations: unknown[] } }).data.escalations).toEqual([]);
  });

  it('escalates prediction_unbalanced_evidence when balance is missing population or counter/supporting summary', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['held with empty counter_summary', {
        falsified_if: '在庫余裕が大半',
        status: 'held',
        evidence: 'query-1',
        balance: {
          claim_scope: 'probabilistic',
          population: '全12施設・30日',
          supporting_summary: '10施設で改善',
          counter_summary: '   ',
        },
      }],
      ['held with empty population', {
        falsified_if: '在庫余裕が大半',
        status: 'held',
        evidence: 'query-2',
        balance: {
          claim_scope: 'universal',
          population: '',
          supporting_summary: '対象施設で改善',
          counter_summary: '反例探索したが該当なし',
        },
      }],
      ['held with empty supporting_summary', {
        falsified_if: '在庫余裕が大半',
        status: 'held',
        evidence: 'query-3',
        balance: {
          claim_scope: 'bounded_case',
          population: '施設Aの9月実績',
          supporting_summary: '',
          counter_summary: '反例なし',
        },
      }],
      ['failed probabilistic with empty supporting_summary', {
        falsified_if: '過半数で逆転',
        status: 'failed',
        evidence: '全社集計',
        balance: {
          claim_scope: 'probabilistic',
          population: '全30施設',
          supporting_summary: '',
          counter_summary: '20施設で逆転',
        },
      }],
      ['failed with empty population', {
        falsified_if: '反例あり',
        status: 'failed',
        evidence: '施設Bの記録',
        balance: {
          claim_scope: 'universal',
          population: '  ',
          supporting_summary: '他は未調査',
          counter_summary: '施設Bで反例を確認',
        },
      }],
    ];
    for (const [label, check] of cases) {
      const result = await record(check);
      expect(result?.status, label).toBe('ok');
      const escalations = (result as { data: { escalations: Array<{ code: string; refs: string[] }> } }).data.escalations;
      expect(escalations, label).toContainEqual({
        code: 'prediction_unbalanced_evidence',
        refs: ['fnd_model_cleaning_order'],
      });
    }
  });

  it('escalates prediction_scope_mismatch purely on structural counter_representativeness: anecdotal (chosen and rejected options)', async () => {
    // 1) Chosen option: probabilistic + failed + counter_representativeness: 'anecdotal' -> escalates regardless of prose.
    const chosenAnecdotal = await record({
      falsified_if: '全体傾向として効果が逆転する',
      status: 'failed',
      evidence: 'Full cohort audit, N=1200 (mentioned as background)',
      balance: {
        claim_scope: 'probabilistic',
        population: '全12施設・30日',
        supporting_summary: '11施設では従来どおり改善',
        counter_summary: '施設Bの単発事例のみ',
        counter_representativeness: 'anecdotal',
      },
    });
    expect(chosenAnecdotal?.status).toBe('ok');
    expect((chosenAnecdotal as { data: { escalations: unknown[] } }).data.escalations).toEqual([
      { code: 'chosen_relies_on_failed_prediction', refs: ['fnd_model_cleaning_order'] },
      { code: 'prediction_scope_mismatch', refs: ['fnd_model_cleaning_order'] },
    ]);

    // 2) Rejected alternative option: catches cherry-picked rejection of an alternative option without triggering chosen_relies_on_failed_prediction.
    const catalog = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, dependencies);
    const digest = (catalog as { data: { catalog_digest: string } }).data.catalog_digest;
    const rejectedAnecdotal = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: digest,
      selections: [
        { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定するため' },
        { ref: 'fnd_objective_headroom', kind: 'objective', why: '上限を先に出すため' },
        { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測するため' },
      ],
      options: [
        {
          label: '現行維持',
          uses: [
            { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '目的は固定した' },
            { ref: 'fnd_objective_headroom', role: 'criterion', note: '現状の上限を維持' },
          ],
        },
        {
          label: '清掃順を探索する',
          uses: [
            { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '目的は固定した' },
            { ref: 'fnd_objective_headroom', role: 'criterion', note: '改善余地を検証' },
            {
              ref: 'fnd_model_cleaning_order',
              role: 'prediction',
              note: '単発反例を理由に不採用とする',
              check: {
                falsified_if: '全体傾向が不成立',
                status: 'failed',
                evidence: '施設Bの単日ログ',
                balance: {
                  claim_scope: 'probabilistic',
                  population: '全12施設・30日',
                  supporting_summary: '既存運用では改善傾向あり',
                  counter_summary: '施設Bの1日だけ悪化',
                  counter_representativeness: 'anecdotal',
                },
              },
            },
          ],
        },
      ],
      chosen_option: '現行維持',
    }, dependencies);

    expect(rejectedAnecdotal?.status).toBe('ok');
    expect((rejectedAnecdotal as { data: { escalations: unknown[] } }).data.escalations).toEqual([
      { code: 'prediction_scope_mismatch', refs: ['fnd_model_cleaning_order'] },
    ]);
  });

  it('never triggers prediction_scope_mismatch from free-text wording when counter_representativeness is omitted, census, representative, or unknown, or for non-probabilistic/non-failed checks', async () => {
    const anecdotalOutcome: JudgmentModelOutcome = {
      record_version: 'judgment-model-outcome.v1',
      model: { id: 'fnd_model_cleaning_order', revision: '2' },
      verdict: 'refutes',
      prediction: '高価格室優先で売上が増える',
      observed: '施設Bの1日だけ遅れた',
      conditions: '施設B・特売日のみ',
      evidence_refs: [{ kind: 'artifact', ref: 'log-b.md', label: '施設Bの単日ログ' }],
      ruled_out: {
        measurement_error: '時刻一致を確認',
        execution_difference: '手順どおり実施',
        external_change: '需要変化なし',
      },
      scope_metrics: {
        claim_type: 'tendency',
        sample_size: 1,
        population_size: 120,
        representativeness: 'anecdotal',
      },
    };
    const depsWithAnecdotalOutcome: JudgmentFrameToolDependencies = {
      loadRecords: async (kind) => ({ status: 'ok', records: RECORDS[kind] }),
      loadModelOutcomes: async () => ({
        status: 'ok',
        records: [{
          ...anecdotalOutcome,
          id: 'out_anecdotal_1',
          recorded_at: '2026-10-10T00:00:00.000Z',
          digest: judgmentModelOutcomeDigest(anecdotalOutcome),
        }],
      }),
    };

    const nonMismatchCases: Array<[string, Record<string, unknown>]> = [
      ['omitted counter_representativeness with isolated case + no cohort prose', {
        falsified_if: 'Full cohort shows no positive effect',
        status: 'failed',
        evidence: 'Case log',
        balance: {
          claim_scope: 'probabilistic',
          population: 'All 1200 cases',
          supporting_summary: 'Pilot study found a positive effect',
          counter_summary: 'One isolated case only (n=1); no cohort audit was performed.',
        },
      }],
      ['omitted counter_representativeness with planned cohort audit prose', {
        falsified_if: 'Full cohort shows no positive effect',
        status: 'failed',
        evidence: 'Case log',
        balance: {
          claim_scope: 'probabilistic',
          population: 'All 1200 cases',
          supporting_summary: 'Pilot study found a positive effect',
          counter_summary: 'Single exception observed; cohort audit is planned for next month.',
        },
      }],
      ['omitted counter_representativeness with full cohort audit (UNS-4551)', {
        falsified_if: 'Full cohort audit shows no positive effect',
        status: 'failed',
        evidence: 'Full cohort audit, N=1200',
        balance: {
          claim_scope: 'probabilistic',
          population: 'All 1200 cases',
          supporting_summary: 'Pilot study found a positive effect',
          counter_summary: 'One isolated case prompted the audit, then the full cohort of 1200 independently showed no effect.',
        },
      }],
      ['explicit census representativeness', {
        falsified_if: 'effect fails across population',
        status: 'failed',
        evidence: 'Full cohort audit, N=1200',
        balance: {
          claim_scope: 'probabilistic',
          population: 'All 1200 cases',
          supporting_summary: 'Pilot study positive',
          counter_summary: 'isolated case mentioned',
          counter_representativeness: 'census',
        },
      }],
      ['explicit representative representativeness', {
        falsified_if: 'effect fails across population',
        status: 'failed',
        evidence: 'Representative sample',
        balance: {
          claim_scope: 'probabilistic',
          population: 'All 1200 cases',
          supporting_summary: 'Pilot study positive',
          counter_summary: 'isolated case mentioned',
          counter_representativeness: 'representative',
        },
      }],
      ['explicit unknown representativeness with anecdotal prose', {
        falsified_if: 'effect fails across population',
        status: 'failed',
        evidence: 'Case log',
        balance: {
          claim_scope: 'probabilistic',
          population: 'All 1200 cases',
          supporting_summary: 'Pilot study positive',
          counter_summary: 'One isolated case only (n=1)',
          counter_representativeness: 'unknown',
        },
      }],
      ['universal claim with anecdotal counter_representativeness', {
        falsified_if: '1件でも例外が出れば普遍主張は偽',
        status: 'failed',
        evidence: '施設Bの検証ログ',
        balance: {
          claim_scope: 'universal',
          population: '全施設・繁忙帯',
          supporting_summary: '',
          counter_summary: '単発例外: 施設Bで反例1件を確認',
          counter_representativeness: 'anecdotal',
        },
      }],
      ['bounded_case claim with anecdotal counter_representativeness', {
        falsified_if: '対象案件で不成立',
        status: 'failed',
        evidence: '対象案件の検証ログ',
        balance: {
          claim_scope: 'bounded_case',
          population: '施設A・9月第2週',
          supporting_summary: '初日のみ一致',
          counter_summary: '対象ケース全体では不成立',
          counter_representativeness: 'anecdotal',
        },
      }],
      ['probabilistic held check with anecdotal counter_representativeness', {
        falsified_if: '過半数で悪化',
        status: 'held',
        evidence: '全12施設集計',
        balance: {
          claim_scope: 'probabilistic',
          population: '全12施設・30日',
          supporting_summary: '11施設で改善',
          counter_summary: '単発例外1件のみ',
          counter_representativeness: 'anecdotal',
        },
      }],
    ];

    const catalog = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, depsWithAnecdotalOutcome);
    const digest = (catalog as { data: { catalog_digest: string } }).data.catalog_digest;
    for (const [label, check] of nonMismatchCases) {
      const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', {
        record_version: 'judgment-frame-record.v1',
        catalog_digest: digest,
        selections: [
          { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定するため' },
          { ref: 'fnd_objective_headroom', kind: 'objective', why: '上限を先に出すため' },
          { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測するため' },
        ],
        options: [{
          label: '清掃順を探索する',
          uses: [
            { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '目的は固定した' },
            { ref: 'fnd_objective_headroom', role: 'criterion', note: '上限を比べる' },
            { ref: 'fnd_model_cleaning_order', role: 'prediction', note: '予測を確認', check },
          ],
        }],
        chosen_option: '清掃順を探索する',
      }, depsWithAnecdotalOutcome);
      expect(result?.status, label).toBe('ok');
      const escalations = (result as { data: { escalations: Array<{ code: string; refs: string[] }> } }).data.escalations;
      expect(escalations.map((e) => e.code), label).not.toContain('prediction_scope_mismatch');
      expect(escalations.map((e) => e.code), label).not.toContain('prediction_unbalanced_evidence');
    }
  });

  it('rejects structurally malformed balance objects including on unchecked checks', async () => {
    const validBalance = {
      claim_scope: 'probabilistic',
      population: '全12施設',
      supporting_summary: '10施設で改善',
      counter_summary: '2施設で変化なし',
    };
    const malformedCases: Array<[string, Record<string, unknown>]> = [
      ['unknown balance field', { falsified_if: 'x', status: 'unchecked', balance: { ...validBalance, extra: 1 } }],
      ['invalid claim_scope', { falsified_if: 'x', status: 'unchecked', balance: { ...validBalance, claim_scope: 'always' } }],
      ['invalid counter_representativeness', { falsified_if: 'x', status: 'unchecked', balance: { ...validBalance, counter_representativeness: 'biased' } }],
      ['non-string population', { falsified_if: 'x', status: 'unchecked', balance: { ...validBalance, population: 123 } }],
      ['credential in counter_summary', { falsified_if: 'x', status: 'held', evidence: 'q', balance: { ...validBalance, counter_summary: 'Bearer secret_token_123456' } }],
      ['control char in supporting_summary', { falsified_if: 'x', status: 'held', evidence: 'q', balance: { ...validBalance, supporting_summary: 'line1\nline2' } }],
      ['competing_hypotheses not array', { falsified_if: 'x', status: 'unchecked', balance: { ...validBalance, competing_hypotheses: {} } }],
      ['competing_hypotheses unknown key', {
        falsified_if: 'x', status: 'unchecked',
        balance: { ...validBalance, competing_hypotheses: [{ hypothesis: 'h', comparison: 'c', extra: true }] },
      }],
      ['competing_hypotheses empty comparison', {
        falsified_if: 'x', status: 'unchecked',
        balance: { ...validBalance, competing_hypotheses: [{ hypothesis: 'h', comparison: '   ' }] },
      }],
      ['competing_hypotheses empty ref', {
        falsified_if: 'x', status: 'unchecked',
        balance: { ...validBalance, competing_hypotheses: [{ hypothesis: 'h', ref: '', comparison: 'c' }] },
      }],
      ['competing_hypotheses credential', {
        falsified_if: 'x', status: 'unchecked',
        balance: { ...validBalance, competing_hypotheses: [{ hypothesis: 'h', comparison: 'api_key=abcd1234efgh' }] },
      }],
      ['falsified_if credential on unchecked', { falsified_if: 'api_key=abcd1234efgh', status: 'unchecked' }],
    ];
    for (const [label, check] of malformedCases) {
      const result = await record(check);
      expect(result?.status, label).toBe('error');
      expect(JSON.stringify(result), label).toContain('frame_check_invalid');
    }
  });
});
