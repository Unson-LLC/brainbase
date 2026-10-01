import { describe, expect, it } from 'vitest';

import {
  JUDGMENT_FRAME_RECORD_VERSION,
  buildJudgmentFrameCatalog,
  renderJudgmentFrameCatalog,
  validateJudgmentFrameRecord,
  type JudgmentFrameSourceRecord,
} from '../src/judgment-frame.js';

const records: JudgmentFrameSourceRecord[] = [
  {
    id: 'phi_guardrails',
    entity_type: 'philosophy',
    lifecycle_status: 'active',
    payload: { display_name: '自律実行はガードレール上で回す', statement: '承認・証跡なしの無制御自動化は採らない。', status: 'active' },
  },
  {
    id: 'fnd_philosophy_phi_guardrails_v1_c1',
    entity_type: 'philosophy',
    lifecycle_status: 'active',
    payload: { title: '自律実行はガードレール上で回す', statement: '統制と両立する自律実行に価値を置く。', status: 'draft', decomposition: { sourcePin: { id: 'phi_guardrails' } } },
  },
  {
    id: 'phi_old',
    entity_type: 'philosophy',
    lifecycle_status: 'active',
    payload: { title: '古い原則', statement: '置き換え済み。', status: 'superseded_by_phi_guardrails' },
  },
  {
    id: 'fnd_objective_fewer_waits',
    entity_type: 'objective',
    lifecycle_status: 'active',
    payload: { foundation: { revision: '1', adoptionState: 'draft', desiredState: '人間の不要な承認待ちが減る。', criteria: [] } },
  },
  {
    id: 'fnd_model_wm_001',
    entity_type: 'model',
    version: 2,
    lifecycle_status: 'active',
    payload: {
      applicability_text: 'AIの出力速度が人間の判断速度を上回る場合。',
      foundation: { revision: '2', adoptionState: 'approved', validationState: 'unverified', meaning: '人間への判断集中が残ると、判断待ちが進行を制約する。' },
    },
  },
  { id: 'per_someone', entity_type: 'person', lifecycle_status: 'active', payload: {} },
  { id: 'fnd_model_empty', entity_type: 'model', lifecycle_status: 'active', payload: { foundation: {} } },
];

const { catalog, excluded } = buildJudgmentFrameCatalog(records);

function frame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_version: JUDGMENT_FRAME_RECORD_VERSION,
    catalog_digest: catalog.digest,
    selections: [
      { ref: 'phi_guardrails', kind: 'philosophy', why: '承認の境界を変える判断だから' },
      { ref: 'fnd_objective_fewer_waits', kind: 'objective', why: '承認待ちを減らすことが目的だから' },
      { ref: 'fnd_model_wm_001', kind: 'model', why: '判断待ちが進行を止める仮説で結果を予測するため' },
    ],
    options: [
      {
        label: 'アーキテクチャ変更だけ承認を戻す',
        uses: [
          { ref: 'phi_guardrails', role: 'constraint', verdict: 'satisfied', note: '本番反映と権限変更の承認は残す' },
          { ref: 'fnd_objective_fewer_waits', role: 'criterion', note: '定型PRの承認待ちが無くなる' },
          { ref: 'fnd_model_wm_001', role: 'prediction', note: '判断待ちが減り進行が速くなる' },
        ],
      },
      {
        label: '全PRの承認をやめる',
        uses: [{ ref: 'phi_guardrails', role: 'constraint', verdict: 'violated', note: '証跡のない変更が通る' }],
      },
    ],
    chosen_option: 'アーキテクチャ変更だけ承認を戻す',
    ...overrides,
  };
}

describe('判断の枠組みの一覧', () => {
  it('3種だけを載せ、置き換え済み・言い直しの草案・本文のない記録を理由付きで外す', () => {
    expect(catalog.items.map((item) => item.id)).toEqual(['phi_guardrails', 'fnd_objective_fewer_waits', 'fnd_model_wm_001']);
    expect(excluded).toEqual(expect.arrayContaining([
      { id: 'fnd_philosophy_phi_guardrails_v1_c1', reason: 'restates_source_philosophy' },
      { id: 'phi_old', reason: 'superseded' },
      { id: 'per_someone', reason: 'unsupported_type' },
      { id: 'fnd_model_empty', reason: 'missing_text' },
    ]));
  });

  it('状態は判断を止めず、ラベルとして添える', () => {
    const byId = Object.fromEntries(catalog.items.map((item) => [item.id, item]));
    expect(byId.phi_guardrails).toMatchObject({ status: 'active', text: '自律実行はガードレール上で回す：承認・証跡なしの無制御自動化は採らない。' });
    expect(byId.fnd_objective_fewer_waits).toMatchObject({ status: 'draft', revision: '1' });
    expect(byId.fnd_model_wm_001).toMatchObject({ status: 'adopted_unverified', revision: '2', applies_when: 'AIの出力速度が人間の判断速度を上回る場合。' });
  });

  it('モデルに渡す表示は、種類ごとの使い方と、IDと状態を1行ずつ示す', () => {
    const rendered = renderJudgmentFrameCatalog(catalog).split('\n');
    expect(rendered[0]).toBe(`judgment frame catalog ${catalog.digest}`);
    expect(rendered).toContain('## 哲学（constraintとして使う。verdictを付ける）');
    expect(rendered).toContain('- fnd_model_wm_001 [adopted_unverified] 人間への判断集中が残ると、判断待ちが進行を制約する。（適用：AIの出力速度が人間の判断速度を上回る場合。）');
  });

  it('同じ内容なら記録の並びが違っても同じダイジェストになる', () => {
    expect(buildJudgmentFrameCatalog([...records].reverse()).catalog.digest).toBe(catalog.digest);
    const changed = records.map((record) => record.id === 'fnd_model_wm_001'
      ? { ...record, payload: { ...record.payload, foundation: { revision: '3', adoptionState: 'approved', meaning: '変わった本文' } } }
      : record);
    expect(buildJudgmentFrameCatalog(changed).catalog.digest).not.toBe(catalog.digest);
  });
});

describe('判断の枠組みの記録の照合', () => {
  it('選んだ参照をすべて種類どおりの役割で使っていれば通る', () => {
    expect(validateJudgmentFrameRecord(frame(), catalog)).toEqual({ valid: true, issues: [], escalations: [] });
  });

  it('一覧に無い参照、別のターンの一覧、使われない選択を止める', () => {
    const result = validateJudgmentFrameRecord(frame({
      catalog_digest: 'sha256:0000',
      selections: [
        { ref: 'phi_guardrails', kind: 'philosophy', why: 'x' },
        { ref: 'fnd_objective_fewer_waits', kind: 'objective', why: 'x' },
        { ref: 'fnd_model_wm_001', kind: 'model', why: 'x' },
        { ref: 'fnd_model_invented', kind: 'model', why: 'x' },
      ],
      options: [{ label: 'A', uses: [{ ref: 'phi_guardrails', role: 'constraint', verdict: 'satisfied', note: 'x' }] }],
      chosen_option: 'A',
    }), catalog);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'frame_catalog_mismatch',
      'frame_ref_unknown',
      'frame_selection_unused',
    ]));
  });

  it('種類と役割の取り違え、判定の無い制約、選んでいない参照の使用を止める', () => {
    const result = validateJudgmentFrameRecord(frame({
      options: [{
        label: 'A',
        uses: [
          { ref: 'fnd_model_wm_001', role: 'criterion', note: 'x' },
          { ref: 'phi_guardrails', role: 'constraint', note: 'x' },
          { ref: 'phi_other', role: 'constraint', verdict: 'satisfied', note: 'x' },
          { ref: 'fnd_objective_fewer_waits', role: 'criterion', note: 'x' },
        ],
      }],
      chosen_option: 'A',
    }), catalog);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'frame_role_mismatch',
      'frame_verdict_missing',
      'frame_use_unselected',
    ]));
  });

  it('種類ごとに、選ぶか該当なしの理由を書かせる', () => {
    const result = validateJudgmentFrameRecord(frame({
      selections: [{ ref: 'phi_guardrails', kind: 'philosophy', why: 'x' }],
      none: { objective: '効く目的が無い', philosophy: '矛盾する理由' },
      options: [{ label: 'A', uses: [{ ref: 'phi_guardrails', role: 'constraint', verdict: 'satisfied', note: 'x' }] }],
      chosen_option: 'A',
    }), catalog);
    expect(result.issues.map((issue) => `${issue.code}:${issue.path}`)).toEqual([
      'frame_kind_contradiction:none.philosophy',
      'frame_kind_unaddressed:none.model',
    ]);
  });

  it('目的が無いまま選ぶときと、選んだ案が哲学に反するときは人間に戻す印を付ける', () => {
    const unanchored = validateJudgmentFrameRecord(frame({
      selections: [
        { ref: 'phi_guardrails', kind: 'philosophy', why: 'x' },
        { ref: 'fnd_model_wm_001', kind: 'model', why: 'x' },
      ],
      none: { objective: 'この判断に効く目的が一覧に無い' },
      options: [{
        label: 'A',
        uses: [
          { ref: 'phi_guardrails', role: 'constraint', verdict: 'violated', note: 'x' },
          { ref: 'fnd_model_wm_001', role: 'prediction', note: 'x' },
        ],
      }],
      chosen_option: 'A',
    }), catalog);
    expect(unanchored.valid).toBe(true);
    expect(unanchored.escalations).toEqual([
      { code: 'objective_unanchored', refs: [] },
      { code: 'chosen_violates_philosophy', refs: ['phi_guardrails'] },
    ]);
  });

  it('選んだ案が選択肢に無ければ止める', () => {
    const result = validateJudgmentFrameRecord(frame({ chosen_option: '存在しない案' }), catalog);
    expect(result.issues.map((issue) => issue.code)).toContain('frame_chosen_unknown');
  });

  it('版の違う記録は形を確かめる前に止める', () => {
    expect(validateJudgmentFrameRecord({ ...frame(), record_version: 'v0' }, catalog).issues[0].code).toBe('frame_record_invalid');
  });
});
