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
    id: 'phi_guardrails', entity_type: 'philosophy', lifecycle_status: 'active',
    payload: { display_name: '自律実行はガードレール上で回す', statement: '承認・証跡なしの無制御自動化は採らない。', status: 'active' },
  }],
  objective: [{
    id: 'fnd_objective_fewer_waits', entity_type: 'objective', lifecycle_status: 'active',
    payload: { foundation: { revision: '1', adoptionState: 'draft', desiredState: '人間の不要な承認待ちが減る。' } },
  }],
  model: [{
    id: 'fnd_model_wm_001', entity_type: 'model', lifecycle_status: 'active',
    payload: { foundation: { revision: '2', adoptionState: 'approved', meaning: '判断待ちが進行を制約する。' } },
  }],
};

function dependencies(records = RECORDS, requested: Array<[JudgmentFrameKind, number]> = []): JudgmentFrameToolDependencies {
  return {
    loadRecords: async (kind, limit) => {
      requested.push([kind, limit]);
      return { status: 'ok', records: records[kind] };
    },
  };
}

async function catalogDigest(): Promise<string> {
  const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, dependencies());
  return (result as { data: { catalog_digest: string } }).data.catalog_digest;
}

async function frame(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return {
    record_version: 'judgment-frame-record.v1',
    catalog_digest: await catalogDigest(),
    selections: [
      { ref: 'phi_guardrails', kind: 'philosophy', why: '承認の境界を変える判断だから' },
      { ref: 'fnd_objective_fewer_waits', kind: 'objective', why: '承認待ちを減らすのが目的だから' },
      { ref: 'fnd_model_wm_001', kind: 'model', why: '判断待ちの仮説で結果を予測するため' },
    ],
    options: [{
      label: 'アーキテクチャ変更だけ承認を戻す',
      uses: [
        { ref: 'phi_guardrails', role: 'constraint', verdict: 'satisfied', note: '本番反映と権限変更の承認は残す' },
        { ref: 'fnd_objective_fewer_waits', role: 'criterion', note: '定型PRの承認待ちが無くなる' },
        { ref: 'fnd_model_wm_001', role: 'prediction', note: '進行が速くなる' },
      ],
    }],
    chosen_option: 'アーキテクチャ変更だけ承認を戻す',
    ...overrides,
  };
}

describe('判断の枠組みのMCPツール', () => {
  it('2つのツールを読み取りとして公開し、記録の入力定義にoneOfを使わない', () => {
    expect(judgmentFrameTools.map((tool) => tool.name)).toEqual(['brainbase_judgment_frame_catalog', 'brainbase_judgment_frame_record']);
    expect(judgmentFrameTools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    // Codex renders only oneOf variants into the model-facing type (Unson-LLC/brainbase#622).
    expect(JSON.stringify(judgmentFrameTools[1].inputSchema)).not.toContain('oneOf');
  });

  it('3種を上限付きで読み、ダイジェスト付きの一覧を返す', async () => {
    const requested: Array<[JudgmentFrameKind, number]> = [];
    const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, dependencies(RECORDS, requested));
    expect(result).toMatchObject({
      status: 'ok',
      data: {
        schema_version: 'brainbase-judgment-frame-catalog-v1',
        counts: { philosophy: 1, objective: 1, model: 1 },
        excluded_count: 0,
      },
    });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.catalog_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(String(data.catalog)).toContain('- fnd_model_wm_001 [adopted_unverified] 判断待ちが進行を制約する。');
    expect(requested).toEqual([['philosophy', 500], ['objective', 500], ['model', 500]]);
  });

  it('上限いっぱいの応答は欠けている恐れがあるので一覧を作らない', async () => {
    const full = Array.from({ length: 500 }, (_, index) => ({ ...RECORDS.model[0], id: `fnd_model_${index}` }));
    const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, dependencies({ ...RECORDS, model: full }));
    expect(result).toMatchObject({ status: 'error', error: { code: 'judgment_frame_catalog_truncated' } });
  });

  it('Graphを読めなければ空の一覧ではなく、読み取り側の失敗をそのまま返す', async () => {
    const unavailable = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, {
      loadRecords: async () => ({ status: 'unavailable', code: 'brainbase_api_unavailable', message: 'down' }),
    });
    expect(unavailable).toMatchObject({ status: 'unavailable', error: { code: 'brainbase_api_unavailable' } });
    const thrown = await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', {}, {
      loadRecords: async () => { throw new Error('socket hang up'); },
    });
    expect(thrown).toMatchObject({ status: 'unavailable', error: { code: 'judgment_frame_catalog_unavailable' } });
  });

  it('一覧から選び、種類どおりに使った記録を受け付ける', async () => {
    const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', await frame(), dependencies());
    expect(result).toEqual({
      status: 'ok',
      data: {
        schema_version: 'brainbase-judgment-frame-v1',
        catalog_digest: await catalogDigest(),
        selections: [
          { ref: 'phi_guardrails', kind: 'philosophy' },
          { ref: 'fnd_objective_fewer_waits', kind: 'objective' },
          { ref: 'fnd_model_wm_001', kind: 'model' },
        ],
        option_count: 1,
        chosen_option: 'アーキテクチャ変更だけ承認を戻す',
        escalations: [],
      },
    });
  });

  it('一覧に無い参照と変わった一覧を拒否し、今の一覧のダイジェストを返す', async () => {
    const result = await handleJudgmentFrameToolCall('brainbase_judgment_frame_record', await frame({
      catalog_digest: `sha256:${'0'.repeat(64)}`,
      selections: [{ ref: 'fnd_model_invented', kind: 'model', why: '作った参照' }],
    }), dependencies());
    expect(result).toMatchObject({ status: 'error', error: { code: 'judgment_frame_invalid' } });
    const details = (result as { error: { details: { issues: Array<{ code: string }>; current_catalog_digest: string } } }).error.details;
    expect(details.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['frame_catalog_mismatch', 'frame_ref_unknown']));
    expect(details.current_catalog_digest).toBe(await catalogDigest());
  });

  it('一覧の取得は引数を受け付けず、ほかのツール名には応答しない', async () => {
    expect(await handleJudgmentFrameToolCall('brainbase_judgment_frame_catalog', { project_code: 'x' }, dependencies()))
      .toMatchObject({ status: 'error', error: { code: 'judgment_frame_catalog_input_invalid' } });
    expect(await handleJudgmentFrameToolCall('search', {}, dependencies())).toBeNull();
  });
});
