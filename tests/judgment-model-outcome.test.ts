import { describe, expect, it } from 'vitest';

import {
  handleJudgmentFrameToolCall,
  handleJudgmentModelOutcomeToolCall,
  judgmentModelOutcomeDigest,
  judgmentModelOutcomeTools,
  type JudgmentFrameKind,
  type JudgmentFrameSourceRecord,
  type JudgmentModelOutcome,
  type JudgmentModelOutcomeToolDependencies,
} from '../src/judgment-frame.js';

const RECORDS: Record<JudgmentFrameKind, JudgmentFrameSourceRecord[]> = {
  philosophy: [{
    id: 'phi_purpose_first', entity_type: 'philosophy', lifecycle_status: 'active',
    payload: { display_name: '目的を先に固定する', statement: '最適化の前に目的と守る条件を決める。', status: 'active' },
  }],
  objective: [{
    id: 'fnd_objective_headroom', entity_type: 'objective', lifecycle_status: 'active',
    payload: { foundation: { revision: '1', adoptionState: 'draft', desiredState: '改善余地の上限と実現可能な改善を分けて示す。' } },
  }],
  model: [{
    id: 'fnd_model_cleaning_order', entity_type: 'model', lifecycle_status: 'active',
    payload: { foundation: { revision: '2', adoptionState: 'draft', meaning: '繁忙時は高価格室から清掃すると売上が増える。' } },
  }, {
    id: 'fnd_model_inventory_boundary', entity_type: 'model', lifecycle_status: 'active',
    payload: { foundation: { revision: '1', adoptionState: 'draft', meaning: '販売可能在庫が需要を下回る時間だけ、清掃の速さが売上を変える。' } },
  }],
};

type Stored = Record<string, unknown>;

function outcome(overrides: Partial<JudgmentModelOutcome> = {}): JudgmentModelOutcome {
  return {
    record_version: 'judgment-model-outcome.v1',
    model: { id: 'fnd_model_cleaning_order', revision: '2' },
    verdict: 'refutes',
    prediction: '清掃順を高価格室優先に変えると、翌週の客室復帰が早まる。',
    observed: '前倒しより他室の遅延が大きく、差し引きで復帰が遅れた。',
    conditions: '架空の施設A・平日昼・販売可能在庫に余裕がある時間帯',
    evidence_refs: [{ kind: 'artifact', ref: 'replay-result.md', label: '連続再生の結果' }],
    ruled_out: {
      measurement_error: '記録時刻の再現は現行維持で不一致0だった',
      execution_difference: '同じ固定方策を同じ入力で再生し、指示数も記録した',
      external_change: '比較は同じ期間・同じ需要の再生で、外部条件は共通',
    },
    ...overrides,
  };
}

function stored(value: JudgmentModelOutcome, id: string, recordedAt: string): Stored {
  return { ...value, id, recorded_at: recordedAt, digest: judgmentModelOutcomeDigest(value) };
}

function dependencies(options: {
  outcomes?: Stored[] | null;
  appended?: unknown[];
  append?: JudgmentModelOutcomeToolDependencies['appendModelOutcome'];
} = {}): JudgmentModelOutcomeToolDependencies {
  const outcomes = options.outcomes === undefined ? [] : options.outcomes;
  return {
    loadRecords: async (kind) => ({ status: 'ok', records: RECORDS[kind] }),
    loadModelOutcomes: async () => (outcomes === null
      ? { status: 'unavailable', code: 'store_down', message: 'store is down' }
      : { status: 'ok', records: outcomes }),
    appendModelOutcome: options.append ?? (async (record) => {
      options.appended?.push(record);
      return { status: 'ok', id: 'out_1', recorded_at: '2026-10-09T09:00:00.000Z' };
    }),
  };
}

async function catalogData(deps: Parameters<typeof handleJudgmentFrameToolCall>[2]) {
  const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, deps);
  expect(result?.status).toBe('ok');
  return (result as { data: Record<string, unknown> }).data;
}

async function record(args: Record<string, unknown>, deps = dependencies()) {
  return handleJudgmentModelOutcomeToolCall('brainbase_judgment_model_outcome_record', args, deps);
}

describe('judgment model outcome record (ADR-014 F6)', () => {
  it('publishes the opt-in tool separately with the refutation alternatives', () => {
    expect(judgmentModelOutcomeTools.map((tool) => tool.name)).toEqual(['brainbase_judgment_model_outcome_record']);
    const schema = judgmentModelOutcomeTools[0].inputSchema as { properties: { ruled_out: { required: string[] } } };
    expect(schema.properties.ruled_out.required).toEqual(['measurement_error', 'execution_difference', 'external_change']);
  });

  it('stores a validated refutation with its content digest and leaves the model untouched', async () => {
    const appended: unknown[] = [];
    const deps = dependencies({ appended });
    const digest = (await catalogData(deps)).catalog_digest;
    const result = await record({ ...outcome(), catalog_digest: digest }, deps);
    expect(result).toEqual({
      status: 'ok',
      data: {
        schema_version: 'brainbase-judgment-model-outcome-v1',
        id: 'out_1',
        recorded_at: '2026-10-09T09:00:00.000Z',
        model: { id: 'fnd_model_cleaning_order', revision: '2' },
        verdict: 'refutes',
        digest: judgmentModelOutcomeDigest(outcome()),
      },
    });
    expect(appended).toEqual([{ ...outcome(), digest: judgmentModelOutcomeDigest(outcome()) }]);
    expect(appended[0]).not.toHaveProperty('catalog_digest');
    expect(RECORDS.model[0].payload).toEqual({ foundation: { revision: '2', adoptionState: 'draft', meaning: '繁忙時は高価格室から清掃すると売上が増える。' } });
  });

  it('does not record a prediction gap as a refutation without ruling out the alternatives', async () => {
    const digest = (await catalogData(dependencies())).catalog_digest;
    const { ruled_out: _omitted, ...withoutRuledOut } = outcome();
    const result = await record({ ...withoutRuledOut, catalog_digest: digest });
    expect(result?.status).toBe('error');
    const codes = (result as { error: { details: { issues: Array<{ code: string; path: string }> } } }).error.details.issues;
    expect(codes.filter((entry) => entry.code === 'outcome_ruled_out_missing').map((entry) => entry.path)).toEqual([
      'ruled_out.measurement_error', 'ruled_out.execution_difference', 'ruled_out.external_change',
    ]);
  });

  it('rejects ruled_out on support and missing evidence', async () => {
    const digest = (await catalogData(dependencies())).catalog_digest;
    const supports = await record({ ...outcome({ verdict: 'supports' }), catalog_digest: digest });
    expect(JSON.stringify(supports)).toContain('outcome_ruled_out_unexpected');
    const noEvidence = await record({ ...outcome({ evidence_refs: [] }), catalog_digest: digest });
    expect(JSON.stringify(noEvidence)).toContain('outcome_evidence_missing');
  });

  it('accepts only a world model at its current revision from the current catalog', async () => {
    const digest = (await catalogData(dependencies())).catalog_digest;
    const stale = await record({ ...outcome(), catalog_digest: `sha256:${'0'.repeat(64)}` });
    expect(JSON.stringify(stale)).toContain('outcome_catalog_mismatch');
    const oldRevision = await record({ ...outcome({ model: { id: 'fnd_model_cleaning_order', revision: '1' } }), catalog_digest: digest });
    expect(JSON.stringify(oldRevision)).toContain('outcome_revision_mismatch');
    const philosophy = await record({ ...outcome({ model: { id: 'phi_purpose_first', revision: '1' } }), catalog_digest: digest });
    expect(JSON.stringify(philosophy)).toContain('outcome_not_model');
    const unknown = await record({ ...outcome({ model: { id: 'fnd_model_missing', revision: '1' } }), catalog_digest: digest });
    expect(JSON.stringify(unknown)).toContain('outcome_model_unknown');
  });

  it('rejects credential-like text and surfaces storage failures', async () => {
    const digest = (await catalogData(dependencies())).catalog_digest;
    const secret = await record({ ...outcome({ observed: 'api_key=abcd1234efgh' }), catalog_digest: digest });
    expect(JSON.stringify(secret)).toContain('outcome_text_unsafe');
    const failing = dependencies({ append: async () => ({ status: 'error', code: 'forbidden', message: 'no grant' }) });
    const failed = await record({ ...outcome(), catalog_digest: digest }, failing);
    expect(failed).toEqual({ status: 'error', error: { code: 'forbidden', message: 'no grant' } });
  });
});

describe('catalog and escalation with stored outcomes', () => {
  const refutation = stored(outcome(), 'out_1', '2026-10-08T00:00:00.000Z');
  const olderRevision = stored(outcome({ model: { id: 'fnd_model_cleaning_order', revision: '1' }, conditions: '旧版の条件' }), 'out_0', '2026-10-01T00:00:00.000Z');
  const support = stored(outcome({
    model: { id: 'fnd_model_inventory_boundary', revision: '1' },
    verdict: 'supports',
    ruled_out: undefined,
    prediction: '在庫に余裕がある時間が大半なら、清掃順の効果はほぼ0。',
    observed: '満室かつ清掃待ちの時間はごく一部だった。',
  }), 'out_2', '2026-10-09T00:00:00.000Z');

  it('annotates world models at their current revision without changing the digest', async () => {
    const plain = await catalogData({ loadRecords: async (kind) => ({ status: 'ok', records: RECORDS[kind] }) });
    const annotated = await catalogData(dependencies({ outcomes: [refutation, olderRevision, support] }));
    expect(annotated.catalog_digest).toBe(plain.catalog_digest);
    expect(plain).not.toHaveProperty('models_with_outcomes');
    expect(annotated.models_with_outcomes).toBe(2);
    const catalog = String(annotated.catalog);
    expect(catalog).toContain('fnd_model_cleaning_order [draft] 繁忙時は高価格室から清掃すると売上が増える。（この版の結果：支持0・反証1・判定不能0。反証の条件：架空の施設A・平日昼・販売可能在庫に余裕がある時間帯）');
    expect(catalog).toContain('fnd_model_inventory_boundary [draft] 販売可能在庫が需要を下回る時間だけ、清掃の速さが売上を変える。（この版の結果：支持1・反証0・判定不能0）');
    expect(catalog).not.toContain('旧版の条件');
  });

  async function frame(deps: Parameters<typeof handleJudgmentFrameToolCall>[2], chosenUsesRefuted: boolean) {
    const digest = (await catalogData(deps)).catalog_digest;
    const uses = (model: string) => [
      { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: '目的を先に置く' },
      { ref: 'fnd_objective_headroom', role: 'criterion', note: '上限を先に出す' },
      { ref: model, role: 'prediction', note: '効果を予測する' },
    ];
    const args = {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: digest,
      selections: [
        { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定するため' },
        { ref: 'fnd_objective_headroom', kind: 'objective', why: '改善余地を判定するため' },
        { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測するため' },
        { ref: 'fnd_model_inventory_boundary', kind: 'model', why: '効く時間帯を予測するため' },
      ],
      options: [
        { label: '清掃順を探索する', uses: uses('fnd_model_cleaning_order') },
        { label: '在庫の境界で時間を分ける', uses: uses('fnd_model_inventory_boundary') },
      ],
      chosen_option: chosenUsesRefuted ? '清掃順を探索する' : '在庫の境界で時間を分ける',
    };
    const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', args, deps);
    expect(result?.status).toBe('ok');
    return (result as { data: { escalations: unknown[] } }).data.escalations;
  }

  it('returns the choice to a human when the chosen option predicts with a refuted model', async () => {
    const deps = dependencies({ outcomes: [refutation, support] });
    expect(await frame(deps, true)).toEqual([{ code: 'chosen_uses_refuted_model', refs: ['fnd_model_cleaning_order'] }]);
    expect(await frame(deps, false)).toEqual([]);
  });

  it('keeps earlier behavior for hosts without outcome storage and ignores older revisions', async () => {
    expect(await frame({ loadRecords: async (kind) => ({ status: 'ok', records: RECORDS[kind] }) }, true)).toEqual([]);
    expect(await frame(dependencies({ outcomes: [olderRevision] }), true)).toEqual([]);
  });

  it('fails loudly on a tampered or unreadable outcome store', async () => {
    const tampered = { ...refutation, observed: '改ざん後の結果' };
    const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, dependencies({ outcomes: [tampered] }));
    expect(result).toMatchObject({ status: 'error', error: { code: 'judgment_model_outcomes_invalid' } });
    const down = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, dependencies({ outcomes: null }));
    expect(down).toEqual({ status: 'unavailable', error: { code: 'store_down', message: 'store is down' } });
  });
});
