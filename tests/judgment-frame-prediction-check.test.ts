import { describe, expect, it } from 'vitest';

import {
  handleJudgmentFrameToolCall,
  judgmentFrameTools,
  type JudgmentFrameKind,
  type JudgmentFrameSourceRecord,
  type JudgmentFrameToolDependencies,
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
