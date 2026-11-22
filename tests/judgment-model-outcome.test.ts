import { describe, expect, it } from 'vitest';

import {
  buildJudgmentFrameCatalog,
  handleJudgmentFrameToolCall,
  handleJudgmentModelOutcomeToolCall,
  isAnecdotalRefutation,
  judgmentModelOutcomeDigest,
  judgmentModelOutcomeTools,
  renderJudgmentFrameCatalog,
  summarizeJudgmentModelOutcomes,
  validateJudgmentFrameRecord,
  type JudgmentFrameKind,
  type JudgmentFrameSourceRecord,
  type JudgmentModelOutcome,
  type JudgmentModelOutcomeScopeMetrics,
  type JudgmentModelOutcomeStoredRecord,
  type JudgmentModelOutcomeSummary,
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

describe('scope_metrics and structural vs anecdotal refutation separation', () => {
  it('publishes optional scope_metrics on the outcome tool schema without oneOf', () => {
    const tool = judgmentModelOutcomeTools[0];
    expect(tool.description).toContain('scope_metrics');
    expect(JSON.stringify(tool.inputSchema)).not.toContain('oneOf');
    const schema = tool.inputSchema as {
      required: string[];
      properties: {
        scope_metrics: {
          required: string[];
          properties: {
            claim_type: { enum: string[] };
            representativeness: { enum: string[] };
            sample_size: { type: string; minimum: number };
            population_size: { type: string; minimum: number };
            effect_magnitude: { type: string };
          };
        };
      };
    };
    expect(schema.required).not.toContain('scope_metrics');
    expect(schema.properties.scope_metrics.required).toEqual(['claim_type', 'representativeness']);
    expect(schema.properties.scope_metrics.properties.claim_type.enum).toEqual(['universal', 'tendency']);
    expect(schema.properties.scope_metrics.properties.representativeness.enum).toEqual([
      'census', 'representative', 'anecdotal', 'unknown',
    ]);
  });

  it('stores validated scope_metrics inside the content digest and preserves legacy digests when omitted', async () => {
    const appended: unknown[] = [];
    const deps = dependencies({ appended });
    const digest = (await catalogData(deps)).catalog_digest;
    const scopeMetrics: JudgmentModelOutcomeScopeMetrics = {
      claim_type: 'tendency',
      sample_size: 1,
      population_size: 120,
      effect_magnitude: '-12% on single day',
      representativeness: 'anecdotal',
    };
    const withScope = outcome({ scope_metrics: scopeMetrics });
    const result = await record({ ...withScope, catalog_digest: digest }, deps);
    expect(result?.status).toBe('ok');
    expect(appended).toEqual([{ ...withScope, digest: judgmentModelOutcomeDigest(withScope) }]);
    expect(judgmentModelOutcomeDigest(withScope)).not.toBe(judgmentModelOutcomeDigest(outcome()));
  });

  it('rejects malformed scope_metrics values', async () => {
    const digest = (await catalogData(dependencies())).catalog_digest;
    const invalidScopeMetrics: Array<[string, unknown]> = [
      ['non-object', 'anecdotal'],
      ['unknown field', { claim_type: 'tendency', representativeness: 'anecdotal', extra: 1 }],
      ['invalid claim_type', { claim_type: 'probabilistic', representativeness: 'anecdotal' }],
      ['invalid representativeness', { claim_type: 'tendency', representativeness: 'biased' }],
      ['zero sample_size', { claim_type: 'tendency', representativeness: 'anecdotal', sample_size: 0 }],
      ['non-integer population_size', { claim_type: 'tendency', representativeness: 'representative', population_size: 10.5 }],
      ['sample_size exceeding population_size', { claim_type: 'tendency', representativeness: 'representative', sample_size: 50, population_size: 40 }],
      ['empty effect_magnitude', { claim_type: 'tendency', representativeness: 'representative', effect_magnitude: '   ' }],
      ['credential in effect_magnitude', { claim_type: 'tendency', representativeness: 'representative', effect_magnitude: 'api_key=abcd1234efgh' }],
    ];
    for (const [label, scope_metrics] of invalidScopeMetrics) {
      const result = await record({ ...outcome(), scope_metrics, catalog_digest: digest });
      expect(result?.status, label).toBe('error');
    }
  });

  it('separates structural vs anecdotal refutations in summary, catalog rendering, and chosen_uses_refuted_model escalation', async () => {
    const catalog = buildJudgmentFrameCatalog([
      ...RECORDS.philosophy,
      ...RECORDS.objective,
      ...RECORDS.model,
    ]).catalog;

    const anecdotalTendency = stored(outcome({
      conditions: '施設B・特売日の1日のみ',
      scope_metrics: { claim_type: 'tendency', sample_size: 1, population_size: 120, representativeness: 'anecdotal' },
    }), 'out_anec_1', '2026-10-10T00:00:00.000Z');

    const unknownTendency = stored(outcome({
      conditions: '施設C・代表性未確認',
      scope_metrics: { claim_type: 'tendency', representativeness: 'unknown' },
    }), 'out_anec_2', '2026-10-11T00:00:00.000Z');

    const representativeTendency = stored(outcome({
      conditions: '全12施設・Q3代表調査',
      scope_metrics: { claim_type: 'tendency', sample_size: 60, population_size: 120, representativeness: 'representative' },
    }), 'out_struct_1', '2026-10-12T00:00:00.000Z');

    const universalAnecdotal = stored(outcome({
      model: { id: 'fnd_model_inventory_boundary', revision: '1' },
      conditions: '施設D・普遍主張に対する単発反例',
      scope_metrics: { claim_type: 'universal', sample_size: 1, representativeness: 'anecdotal' },
    }), 'out_univ_1', '2026-10-12T00:00:00.000Z');

    expect(isAnecdotalRefutation(anecdotalTendency as unknown as JudgmentModelOutcome)).toBe(true);
    // representativeness: 'unknown' stays conservatively structural so unverified refutations cannot bypass escalation.
    expect(isAnecdotalRefutation(unknownTendency as unknown as JudgmentModelOutcome)).toBe(false);
    expect(isAnecdotalRefutation(representativeTendency as unknown as JudgmentModelOutcome)).toBe(false);
    expect(isAnecdotalRefutation(universalAnecdotal as unknown as JudgmentModelOutcome)).toBe(false);
    expect(isAnecdotalRefutation(outcome())).toBe(false);

    // 1) Tendency + explicit anecdotal only: visible in summary & catalog, does NOT trigger chosen_uses_refuted_model.
    const anecdotalOnlySummaries = summarizeJudgmentModelOutcomes(
      [anecdotalTendency] as unknown as JudgmentModelOutcomeStoredRecord[],
      catalog,
    );
    expect(anecdotalOnlySummaries.get('fnd_model_cleaning_order')).toEqual({
      supports: 0,
      refutes: 1,
      structural_refutes: 0,
      anecdotal_refutes: 1,
      inconclusive: 0,
      refuted_when: [],
      anecdotal_refuted_when: ['施設B・特売日の1日のみ'],
    });

    const depsAnecdotalOnly = dependencies({ outcomes: [anecdotalTendency] });
    const anecdotalCatalog = await catalogData(depsAnecdotalOnly);
    expect(String(anecdotalCatalog.catalog)).toContain(
      '（この版の結果：支持0・構造反証0・逸話反証1・判定不能0。逸話反証の条件：施設B・特売日の1日のみ）',
    );

    const frameResultAnecdotal = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: anecdotalCatalog.catalog_digest,
      selections: [
        { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定' },
        { ref: 'fnd_objective_headroom', kind: 'objective', why: '改善余地を評価' },
        { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測' },
      ],
      options: [{
        label: '清掃順を探索する',
        uses: [
          { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: 'ok' },
          { ref: 'fnd_objective_headroom', role: 'criterion', note: 'ok' },
          { ref: 'fnd_model_cleaning_order', role: 'prediction', note: '傾向モデルとして利用' },
        ],
      }],
      chosen_option: '清掃順を探索する',
    }, depsAnecdotalOnly);
    expect(frameResultAnecdotal?.status).toBe('ok');
    expect((frameResultAnecdotal as { data: { escalations: unknown[] } }).data.escalations).toEqual([]);

    // 1b) Tendency + unknown representativeness: conservatively treated as structural and escalates chosen_uses_refuted_model.
    const unknownSummaries = summarizeJudgmentModelOutcomes(
      [unknownTendency] as unknown as JudgmentModelOutcomeStoredRecord[],
      catalog,
    );
    expect(unknownSummaries.get('fnd_model_cleaning_order')).toEqual({
      supports: 0,
      refutes: 1,
      structural_refutes: 1,
      anecdotal_refutes: 0,
      inconclusive: 0,
      refuted_when: ['施設C・代表性未確認'],
      anecdotal_refuted_when: [],
    });
    const depsUnknown = dependencies({ outcomes: [unknownTendency] });
    const unknownCatalog = await catalogData(depsUnknown);
    const frameResultUnknown = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: unknownCatalog.catalog_digest,
      selections: [
        { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定' },
        { ref: 'fnd_objective_headroom', kind: 'objective', why: '改善余地を評価' },
        { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測' },
      ],
      options: [{
        label: '清掃順を探索する',
        uses: [
          { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: 'ok' },
          { ref: 'fnd_objective_headroom', role: 'criterion', note: 'ok' },
          { ref: 'fnd_model_cleaning_order', role: 'prediction', note: '代表性未確認の反証あり' },
        ],
      }],
      chosen_option: '清掃順を探索する',
    }, depsUnknown);
    expect(frameResultUnknown?.status).toBe('ok');
    expect((frameResultUnknown as { data: { escalations: unknown[] } }).data.escalations).toEqual([
      { code: 'chosen_uses_refuted_model', refs: ['fnd_model_cleaning_order'] },
    ]);

    // 2) Mixed structural + anecdotal: both shown in catalog AND chosen_uses_refuted_model triggers.
    const depsMixed = dependencies({ outcomes: [anecdotalTendency, representativeTendency, universalAnecdotal] });
    const mixedCatalog = await catalogData(depsMixed);
    expect(String(mixedCatalog.catalog)).toContain(
      '（この版の結果：支持0・構造反証1・逸話反証1・判定不能0。構造反証の条件：全12施設・Q3代表調査。逸話反証の条件：施設B・特売日の1日のみ）',
    );
    expect(String(mixedCatalog.catalog)).toContain(
      '（この版の結果：支持0・反証1・判定不能0。反証の条件：施設D・普遍主張に対する単発反例）',
    );

    const frameResultMixed = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', {
      record_version: 'judgment-frame-record.v1',
      catalog_digest: mixedCatalog.catalog_digest,
      selections: [
        { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定' },
        { ref: 'fnd_objective_headroom', kind: 'objective', why: '改善余地を評価' },
        { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測' },
        { ref: 'fnd_model_inventory_boundary', kind: 'model', why: '在庫境界を予測' },
      ],
      options: [{
        label: '両方使う案',
        uses: [
          { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: 'ok' },
          { ref: 'fnd_objective_headroom', role: 'criterion', note: 'ok' },
          { ref: 'fnd_model_cleaning_order', role: 'prediction', note: '代表反証あり' },
          { ref: 'fnd_model_inventory_boundary', role: 'prediction', note: '普遍主張に単発反例あり' },
        ],
      }],
      chosen_option: '両方使う案',
    }, depsMixed);
    expect(frameResultMixed?.status).toBe('ok');
    expect((frameResultMixed as { data: { escalations: unknown[] } }).data.escalations).toEqual([
      { code: 'chosen_uses_refuted_model', refs: ['fnd_model_cleaning_order', 'fnd_model_inventory_boundary'] },
    ]);

    // 3) Legacy JudgmentModelOutcomeSummary shape (without optional new fields) stays type- and runtime-compatible.
    const legacySummary: JudgmentModelOutcomeSummary = {
      supports: 1,
      refutes: 1,
      inconclusive: 0,
      refuted_when: ['旧サマリ条件'],
    };
    const legacyMap = new Map<string, JudgmentModelOutcomeSummary>([['fnd_model_cleaning_order', legacySummary]]);
    expect(renderJudgmentFrameCatalog(catalog, legacyMap)).toContain('（この版の結果：支持1・反証1・判定不能0。反証の条件：旧サマリ条件）');
    const legacyValidation = validateJudgmentFrameRecord({
      record_version: 'judgment-frame-record.v1',
      catalog_digest: catalog.digest,
      selections: [
        { ref: 'phi_purpose_first', kind: 'philosophy', why: '目的を先に固定' },
        { ref: 'fnd_objective_headroom', kind: 'objective', why: '改善余地を評価' },
        { ref: 'fnd_model_cleaning_order', kind: 'model', why: '清掃順の効果を予測' },
      ],
      options: [{
        label: '旧サマリ案',
        uses: [
          { ref: 'phi_purpose_first', role: 'constraint', verdict: 'satisfied', note: 'ok' },
          { ref: 'fnd_objective_headroom', role: 'criterion', note: 'ok' },
          { ref: 'fnd_model_cleaning_order', role: 'prediction', note: '旧サマリ経由の反証' },
        ],
      }],
      chosen_option: '旧サマリ案',
    }, catalog, legacyMap);
    expect(legacyValidation.valid).toBe(true);
    expect(legacyValidation.escalations).toEqual([
      { code: 'chosen_uses_refuted_model', refs: ['fnd_model_cleaning_order'] },
    ]);
  });
});
