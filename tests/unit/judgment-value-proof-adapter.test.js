import { describe, expect, it } from 'vitest';

import {
  buildJudgmentValueProofProjection,
  extractJudgmentValueProofInput,
  judgmentValueProofDigest,
  latestJudgmentValueProofEvent,
  projectJudgmentValueProofCompanionAttention,
  renderJudgmentValueProofAttentionSurface,
  renderJudgmentValueProofSurface,
} from '../../server/services/routine-runtime/judgment-value-proof-adapter.js';

function valueProofInput(overrides = {}) {
  return {
    schema_version: 'brainbase-judgment-value-proof-input-v1',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '既存文書を更新するか、新規文書を作るか',
      reason_code: 'routine_reversible_work',
    },
    decision: {
      summary: '既存SSOTを最小更新する',
      work_impact: '確認で止めずPR作成まで進めた',
      basis: [{
        entity_id: 'dec_example',
        application: '正本が存在する場合は重複する文書を増やさない',
      }],
    },
    execution: {
      summary: '既存文書を更新しPRを作成した',
      artifact_refs: [{ kind: 'pull_request', ref: 'github://pull/142', label: 'PR #142' }],
    },
    outcome: {
      status: 'outcome_verified',
      summary: 'PRを読み戻し、テスト成功を確認した',
      evidence_refs: [
        {
          kind: 'tool_event',
          tool_use_id: 'execution-1',
          subject_ref: 'github://pull/142',
          label: 'PR作成',
        },
        {
          kind: 'canonical_readback',
          tool_use_id: 'readback-1',
          subject_ref: 'github://pull/142',
          label: 'PR読み戻し',
        },
      ],
    },
    human_decision: null,
    feedback_requested: false,
    ...overrides,
  };
}

function valueProofEvent(input = valueProofInput()) {
  return {
    event_kind: 'value_proof',
    success: true,
    tool_use_id: 'value-proof-1',
    safe_metadata: { value_proof: input },
  };
}

function interruptionCandidate(overrides = {}) {
  return {
    resolution: 'continued_without_human',
    question_display_text: '既存文書を更新するか、新規文書を作るか',
    question_digest: null,
    reason_code: 'routine_in_scope',
    source: 'autonomy_continuation',
    ...overrides,
  };
}

describe('judgment value proof organization adapter', () => {
  it('extracts the strict MCP response and ignores unrelated records', () => {
    const input = valueProofInput();
    expect(extractJudgmentValueProofInput({
      status: 'ok',
      data: input,
    })).toEqual(input);
    expect(extractJudgmentValueProofInput({ status: 'ok', data: { foo: 'bar' } })).toBeNull();
    expect(extractJudgmentValueProofInput({
      status: 'ok',
      data: valueProofInput({
        outcome: {
          status: 'outcome_verified',
          summary: '契約外の証拠種別を使った',
          evidence_refs: [{ kind: 'test', tool_use_id: 'test-1', label: '対象テスト' }],
        },
      }),
    })).toBeNull();
  });

  it('extracts a strict value proof from a Claude content block array', () => {
    const input = valueProofInput({
      interruption: {
        resolution: 'human_required',
        question_display_text: '本番へ公開してよいか',
        reason_code: 'owner_value_choice',
      },
      decision: { summary: null, work_impact: null, basis: [] },
      execution: { summary: null, artifact_refs: [] },
      outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
      human_decision: {
        question: '本番へ公開してよいか',
        why_human: '外部公開は本人判断が必要なため',
        options: [{ id: 'yes', label: '公開する', impact: '外部へ公開される' }],
      },
    });
    expect(extractJudgmentValueProofInput([{
      type: 'text',
      text: JSON.stringify({ status: 'ok', data: input }),
    }])).toEqual(input);
    expect(extractJudgmentValueProofInput([{
      type: 'text',
      text: JSON.stringify({ status: 'ok', data: { ...input, feedback_requested: 'yes' } }),
    }])).toBeNull();
  });

  it('builds a portable verified projection only when referenced execution evidence exists', () => {
    const event = { ...valueProofEvent(), event_sequence: 2 };
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'turn-ref',
      valueProofEvent: event,
      events: [
        { tool_use_id: 'execution-1', success: true, event_kind: 'execution', event_sequence: 0, input_digest: 'c'.repeat(64), response_digest: 'd'.repeat(64), safe_metadata: { artifact_refs: ['github://pull/142'] } },
        { tool_use_id: 'readback-1', success: true, event_kind: 'search', event_sequence: 1, query_excerpt: 'github://pull/142', input_digest: 'a'.repeat(64), response_digest: 'b'.repeat(64), safe_metadata: { subject_ref: 'github://pull/142', retrieval_outcome: 'result' } },
        event,
      ],
      interruptionCandidate: interruptionCandidate(),
      stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof).toMatchObject({
      schema_version: 'brainbase-judgment-value-proof-v1',
      intent_id: 'intent_turn-ref',
      state: 'outcome_verified',
      outcome: { status: 'outcome_verified' },
      feedback: { status: 'none' },
    });
    expect(proof.decision_attempt_id).toMatch(/^decision_[0-9a-f]{64}$/u);
    expect(buildJudgmentValueProofProjection({
      turnRef: 'turn-ref',
      valueProofEvent: event,
      events: [
        { tool_use_id: 'execution-1', success: true, event_kind: 'execution', event_sequence: 0, input_digest: 'c'.repeat(64), response_digest: 'd'.repeat(64), safe_metadata: { artifact_refs: ['github://pull/142'] } },
        { tool_use_id: 'readback-1', success: true, event_kind: 'search', event_sequence: 1, query_excerpt: 'github://pull/142', input_digest: 'a'.repeat(64), response_digest: 'b'.repeat(64), safe_metadata: { subject_ref: 'github://pull/142', retrieval_outcome: 'result' } },
        event,
      ],
      interruptionCandidate: interruptionCandidate(),
      stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    }).decision_attempt_id).toBe(proof.decision_attempt_id);
    expect(judgmentValueProofDigest(proof)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const surface = renderJudgmentValueProofSurface(proof);
    expect(surface).toMatch(/^Brainbase判断レシート\n結果:/u);
    expect(surface).toContain('聞かずに進めた確認: 既存文書を更新するか、新規文書を作るか');
    expect(surface).toContain('実行範囲: 既存文書を更新しPRを作成した');
    expect(surface).not.toContain('dec_example');
    expect(projectJudgmentValueProofCompanionAttention(proof)).toBeNull();
  });

  it('renders companion attention as an actionable user-facing warning', () => {
    expect(renderJudgmentValueProofAttentionSurface({
      title: '実行結果を確認できていません',
      summary: '既存文書を更新した',
      suggested_actions: ['正本を読み戻す', '結果未確認のまま保持'],
    })).toBe([
      '要確認: 実行結果を確認できていません',
      '内容: 既存文書を更新した',
      '次の対応: 正本を読み戻す / 結果未確認のまま保持',
    ].join('\n'));
  });

  it('downgrades a claimed verified outcome to unconfirmed when evidence is absent', () => {
    const event = valueProofEvent();
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'turn-ref',
      valueProofEvent: event,
      events: [event],
      interruptionCandidate: interruptionCandidate(),
      stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof.outcome.status).toBe('unconfirmed');
    expect(proof.state).toBe('unconfirmed');
    const surface = renderJudgmentValueProofSurface(proof);
    expect(surface).toMatch(/^Brainbase判断結果（確認待ち）\n/u);
    expect(surface).toContain('状態: 結果未確認');
    expect(surface).not.toContain('Brainbase判断レシート');
    expect(projectJudgmentValueProofCompanionAttention(proof)?.kind).toBe('outcome_unconfirmed');
  });

  it('does not verify a claimed artifact from canonical readback alone', () => {
    const input = valueProofInput({
      outcome: {
        status: 'outcome_verified',
        summary: '取得だけで更新を自己申告した',
        evidence_refs: [{
          kind: 'canonical_readback', tool_use_id: 'readback-1',
          subject_ref: 'github://pull/142', label: 'PR読み戻し',
        }],
      },
    });
    const event = { ...valueProofEvent(input), event_sequence: 2 };
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'readback-only', valueProofEvent: event,
      events: [{
        tool_use_id: 'readback-1', success: true, event_kind: 'retrieve', event_sequence: 1,
        query_excerpt: 'github://pull/142', input_digest: 'a'.repeat(64), response_digest: 'b'.repeat(64),
        safe_metadata: { subject_ref: 'github://pull/142', retrieval_outcome: 'result' },
      }, event],
      interruptionCandidate: interruptionCandidate(), stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof.outcome.status).toBe('unconfirmed');
    expect(proof.state).toBe('unconfirmed');
  });

  it('does not verify a claimed artifact when the execution event names another artifact', () => {
    const event = { ...valueProofEvent(), event_sequence: 3 };
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'execution-mismatch', valueProofEvent: event,
      events: [
        { tool_use_id: 'execution-1', success: true, event_kind: 'execution', event_sequence: 1, input_digest: 'c'.repeat(64), response_digest: 'd'.repeat(64), safe_metadata: { artifact_refs: ['github://pull/999'] } },
        { tool_use_id: 'readback-1', success: true, event_kind: 'retrieve', event_sequence: 2, query_excerpt: 'github://pull/142', input_digest: 'a'.repeat(64), response_digest: 'b'.repeat(64), safe_metadata: { subject_ref: 'github://pull/142', retrieval_outcome: 'result' } },
        event,
      ],
      interruptionCandidate: interruptionCandidate(), stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof.outcome.status).toBe('unconfirmed');
    expect(proof.state).toBe('unconfirmed');
  });

  it('requires execution and a later readback for every claimed artifact', () => {
    const input = valueProofInput({
      execution: {
        summary: '文書とPRを更新した',
        artifact_refs: [
          { kind: 'document', ref: 'repo://docs/concept.md', label: 'concept.md' },
          { kind: 'pull_request', ref: 'github://pull/142', label: 'PR #142' },
        ],
      },
      outcome: {
        status: 'outcome_verified',
        summary: '両方を確認したと主張した',
        evidence_refs: [
          { kind: 'tool_event', tool_use_id: 'execution-doc', subject_ref: 'repo://docs/concept.md', label: '文書更新' },
          { kind: 'canonical_readback', tool_use_id: 'readback-doc', subject_ref: 'repo://docs/concept.md', label: '文書読戻し' },
          { kind: 'tool_event', tool_use_id: 'execution-pr', subject_ref: 'github://pull/142', label: 'PR作成' },
          { kind: 'canonical_readback', tool_use_id: 'readback-pr', subject_ref: 'github://pull/142', label: 'PR読戻し' },
        ],
      },
    });
    const event = { ...valueProofEvent(input), event_sequence: 4 };
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'multi-artifact-partial', valueProofEvent: event,
      events: [
        { tool_use_id: 'execution-doc', success: true, event_kind: 'execution', event_sequence: 0, input_digest: '1'.repeat(64), response_digest: '2'.repeat(64), safe_metadata: { artifact_refs: ['repo://docs/concept.md'] } },
        { tool_use_id: 'readback-doc', success: true, event_kind: 'retrieve', event_sequence: 1, query_excerpt: 'repo://docs/concept.md', input_digest: '3'.repeat(64), response_digest: '4'.repeat(64), safe_metadata: { subject_ref: 'repo://docs/concept.md', retrieval_outcome: 'result' } },
        { tool_use_id: 'execution-pr', success: true, event_kind: 'execution', event_sequence: 2, input_digest: '5'.repeat(64), response_digest: '6'.repeat(64), safe_metadata: { artifact_refs: ['github://pull/142'] } },
        { tool_use_id: 'readback-pr', success: true, event_kind: 'retrieve', event_sequence: 3, query_excerpt: 'github://pull/142', input_digest: '7'.repeat(64), response_digest: '8'.repeat(64), safe_metadata: { subject_ref: 'github://pull/142', retrieval_outcome: 'no_result' } },
        event,
      ],
      interruptionCandidate: interruptionCandidate(), stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof.outcome.status).toBe('unconfirmed');
    expect(proof.state).toBe('unconfirmed');
    expect(proof.outcome.evidence_refs.map(({ status }) => status))
      .toEqual(['verified', 'verified', 'verified', 'unconfirmed']);
  });

  it('does not treat a readback before execution as verification of the changed artifact', () => {
    const event = { ...valueProofEvent(), event_sequence: 3 };
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'stale-readback', valueProofEvent: event,
      events: [
        { tool_use_id: 'readback-1', success: true, event_kind: 'retrieve', event_sequence: 1, query_excerpt: 'github://pull/142', input_digest: 'a'.repeat(64), response_digest: 'b'.repeat(64), safe_metadata: { subject_ref: 'github://pull/142', retrieval_outcome: 'result' } },
        { tool_use_id: 'execution-1', success: true, event_kind: 'execution', event_sequence: 2, input_digest: 'c'.repeat(64), response_digest: 'd'.repeat(64), safe_metadata: { artifact_refs: ['github://pull/142'] } },
        event,
      ],
      interruptionCandidate: interruptionCandidate(), stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof.outcome.status).toBe('unconfirmed');
    expect(proof.state).toBe('unconfirmed');
  });

  it('does not let an unrelated successful write certify a canonical readback outcome', () => {
    const event = { ...valueProofEvent(), event_sequence: 2 };
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'unrelated-write',
      valueProofEvent: event,
      events: [
        { tool_use_id: 'readback-1', success: true, event_kind: 'execution', event_sequence: 1 },
        event,
      ],
      interruptionCandidate: interruptionCandidate(),
      stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof.outcome.status).toBe('unconfirmed');
    expect(proof.state).toBe('unconfirmed');
  });

  it('does not let an unrelated successful retrieve certify another artifact outcome', () => {
    const event = { ...valueProofEvent(), event_sequence: 2 };
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'unrelated-retrieve',
      valueProofEvent: event,
      events: [
        {
          tool_use_id: 'readback-1', success: true, event_kind: 'retrieve', event_sequence: 1,
          query_excerpt: 'graph://customer/unrelated', input_digest: 'a'.repeat(64), response_digest: 'b'.repeat(64),
        },
        event,
      ],
      interruptionCandidate: interruptionCandidate(),
      stopState: { status: 'completed' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(proof.outcome.status).toBe('unconfirmed');
    expect(proof.state).toBe('unconfirmed');
  });

  it('does not treat no-result or transport-only retrievals as verified readbacks', () => {
    const event = { ...valueProofEvent(), event_sequence: 2 };
    for (const retrievalOutcome of ['no_result', null]) {
      const proof = buildJudgmentValueProofProjection({
        turnRef: `retrieval-${retrievalOutcome ?? 'transport-only'}`,
        valueProofEvent: event,
        events: [{
          tool_use_id: 'readback-1', success: true, event_kind: 'retrieve', event_sequence: 1,
          query_excerpt: 'github://pull/142', input_digest: 'a'.repeat(64), response_digest: 'b'.repeat(64),
          safe_metadata: { subject_ref: 'github://pull/142', retrieval_outcome: retrievalOutcome },
        }, event],
        interruptionCandidate: interruptionCandidate(), stopState: { status: 'completed' },
        finalizedAt: '2026-09-01T00:00:00.000Z',
      });
      expect(proof.outcome.status).toBe('unconfirmed');
      expect(proof.state).toBe('unconfirmed');
    }
  });

  it('renders a real human decision with reason and impact instead of a generic question', () => {
    const input = valueProofInput({
      interruption: {
        resolution: 'human_required',
        question_display_text: '契約上限をいくらにするか',
        reason_code: 'material_commitment',
      },
      decision: { summary: null, work_impact: null, basis: [] },
      execution: { summary: null, artifact_refs: [] },
      outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
      human_decision: {
        question: '契約上限をいくらにするか',
        why_human: '外部への金銭的コミットメントになるため',
        options: [
          { id: 'A', label: '30万円', impact: '利益率を守れるが受注可能性が下がる' },
          { id: 'B', label: '50万円', impact: '受注可能性は上がるが初月赤字の可能性がある' },
        ],
      },
    });
    const event = valueProofEvent(input);
    const proof = buildJudgmentValueProofProjection({
      turnRef: 'turn-ref',
      valueProofEvent: event,
      events: [event],
      interruptionCandidate: interruptionCandidate({
        resolution: 'human_required',
        question_display_text: '契約上限をいくらにするか',
        reason_code: 'owner_value_choice',
        source: 'waiting_human_answer',
      }),
      stopState: { status: 'waiting_human' },
      finalizedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(renderJudgmentValueProofSurface(proof)).toContain('AIで決めない理由');
    expect(renderJudgmentValueProofSurface(proof)).toContain('影響: 利益率を守れるが受注可能性が下がる');
    const attention = projectJudgmentValueProofCompanionAttention(proof);
    expect(attention?.kind).toBe('human_decision');
    expect(renderJudgmentValueProofAttentionSurface(attention)).toBeNull();
  });

  it('ignores failed attempts but rejects multiple successful value proof events', () => {
    const failed = { ...valueProofEvent(), success: false };
    const latest = { ...valueProofEvent(), tool_use_id: 'value-proof-2' };
    expect(latestJudgmentValueProofEvent([failed, latest])).toBe(latest);
    expect(() => latestJudgmentValueProofEvent([valueProofEvent(), latest]))
      .toThrow('judgment_value_proof_multiple');
  });

  it('rejects confirmation-savings claims that are not bound to the Host interruption candidate', () => {
    const event = valueProofEvent();
    expect(() => buildJudgmentValueProofProjection({
      turnRef: 'unbound', valueProofEvent: event, events: [event],
      stopState: { status: 'completed' }, finalizedAt: '2026-09-01T00:00:00.000Z',
      interruptionCandidate: null,
    })).toThrow('judgment_value_proof_interruption_unbound');
    expect(() => buildJudgmentValueProofProjection({
      turnRef: 'mismatch', valueProofEvent: event, events: [event],
      stopState: { status: 'completed' }, finalizedAt: '2026-09-01T00:00:00.000Z',
      interruptionCandidate: interruptionCandidate({ question_display_text: '別の質問' }),
    })).toThrow('judgment_value_proof_interruption_mismatch');
  });

  it('rejects self, state, and future events as outcome evidence', () => {
    const selfInput = valueProofInput({
      outcome: {
        status: 'outcome_verified',
        summary: '誤って自己証明しようとした',
        evidence_refs: [{ kind: 'canonical_readback', tool_use_id: 'value-proof-1', subject_ref: 'github://pull/142', label: '自己参照' }],
      },
    });
    const selfEvent = { ...valueProofEvent(selfInput), event_sequence: 2 };
    const stateEvent = { event_kind: 'state', success: true, tool_use_id: 'state-1', event_sequence: 1 };
    const selfProof = buildJudgmentValueProofProjection({
      turnRef: 'self', valueProofEvent: selfEvent, events: [stateEvent, selfEvent],
      stopState: { status: 'completed' }, finalizedAt: '2026-09-01T00:00:00.000Z',
      interruptionCandidate: interruptionCandidate(),
    });
    expect(selfProof.outcome.status).toBe('unconfirmed');

    const futureInput = valueProofInput({
      outcome: {
        status: 'outcome_verified',
        summary: '未来のイベントで証明しようとした',
        evidence_refs: [{ kind: 'canonical_readback', tool_use_id: 'future-1', subject_ref: 'github://pull/142', label: '未来参照' }],
      },
    });
    const futureProofEvent = { ...valueProofEvent(futureInput), event_sequence: 2 };
    const futureEvent = { event_kind: 'execution', success: true, tool_use_id: 'future-1', event_sequence: 3 };
    const futureProof = buildJudgmentValueProofProjection({
      turnRef: 'future', valueProofEvent: futureProofEvent, events: [futureProofEvent, futureEvent],
      stopState: { status: 'completed' }, finalizedAt: '2026-09-01T00:00:00.000Z',
      interruptionCandidate: interruptionCandidate(),
    });
    expect(futureProof.outcome.status).toBe('unconfirmed');
  });
});
