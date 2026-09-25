import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JudgmentValueProof } from '../src/judgment-value-proof.js';
import {
  JUDGMENT_VALUE_PROOF_FEEDBACK_FILE,
  applyJudgmentValueProofFeedback,
  buildJudgmentValueProofReviewHome,
  type JudgmentValueProofFeedbackLayer,
  type JudgmentValueProofFeedbackRecord,
  type JudgmentValueProofFeedbackStatus,
  classifyJudgmentValueProof,
  readJudgmentValueProofFeedback,
  readJudgmentValueProofJournal,
  recordJudgmentValueProofFeedback,
  summarizeJudgmentValueProofFeedback
} from '../src/judgment-value-proof-review.js';

function continuedProof(id: string, recordedAt: string): JudgmentValueProof {
  return {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: `intent-${id}`,
    decision_attempt_id: `attempt-${id}`,
    recorded_at: recordedAt,
    state: 'unconfirmed',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '稼働中の設定へ反映してよいですか？',
      question_digest: 'sha256:question',
      reason_code: 'routine_reversible_work',
      human_reason: null
    },
    decision: {
      summary: '安全上必要な停止は維持したまま反映する',
      work_impact: '確認で止めず反映まで進めた',
      basis: [{ entity_id: 'dec-example', application: '可逆な設定変更は確認で止めない' }],
      prior_learning_reused: 'unconfirmed'
    },
    execution: { status: 'completed', summary: '設定を反映した', artifact_refs: [] },
    outcome: { status: 'unconfirmed', summary: null, evidence_refs: [] },
    human_decision: null,
    feedback: { status: 'none', summary: null, evidence_ref: null }
  };
}

function waitingProof(id: string, recordedAt: string): JudgmentValueProof {
  return {
    ...continuedProof(id, recordedAt),
    state: 'waiting_human',
    interruption: {
      resolution: 'human_required',
      question_display_text: '本番へデプロイしてよいですか？',
      question_digest: 'sha256:deploy',
      reason_code: 'irreversible_external_effect',
      human_reason: '本番への外部作用になるため'
    },
    execution: { status: 'not_started', summary: null, artifact_refs: [] },
    outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
    human_decision: {
      question: '本番へデプロイしてよいですか？',
      why_human: '本番への外部作用になるため',
      options: [{ id: 'A', label: 'デプロイする', impact: '利用者に即時反映される' }]
    }
  };
}

function blockedProof(id: string, recordedAt: string): JudgmentValueProof {
  return { ...continuedProof(id, recordedAt), state: 'blocked' };
}

function ordinaryProof(id: string, recordedAt: string): JudgmentValueProof {
  return {
    ...continuedProof(id, recordedAt),
    state: 'outcome_verified',
    interruption: {
      resolution: 'not_applicable',
      question_display_text: null,
      question_digest: null,
      reason_code: null,
      human_reason: null
    },
    decision: { summary: null, work_impact: null, basis: [], prior_learning_reused: 'unconfirmed' },
    outcome: { status: 'not_applicable', summary: null, evidence_refs: [] }
  };
}

let directory: string;
let journal: string;
let dataDir: string;

async function writeProof(session: string, turn: string, proof: unknown): Promise<string> {
  const sessionDir = join(journal, session);
  await mkdir(sessionDir, { recursive: true });
  const file = join(sessionDir, `${turn}.value-proof.json`);
  await writeFile(file, JSON.stringify(proof), 'utf8');
  return file;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-value-proof-review-'));
  journal = join(directory, 'journal');
  dataDir = join(directory, 'personal-os');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('judgment value proof journal', () => {
  it('reports a missing journal as unavailable instead of an empty list', async () => {
    const read = await readJudgmentValueProofJournal({ root: join(directory, 'missing') });
    expect(read).toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });

    const home = buildJudgmentValueProofReviewHome(read, []);
    expect(home.status).toBe('unavailable');
  });

  it('lists valid proofs newest first and returns invalid ones with reasons', async () => {
    await writeProof('session-a', 'turn-1', continuedProof('1', '2026-09-20T01:00:00.000Z'));
    await writeProof('session-b', 'turn-2', waitingProof('2', '2026-09-21T01:00:00.000Z'));
    await writeProof('session-b', 'turn-3', { schema_version: 'other' });
    await writeFile(join(journal, 'session-b', 'turn-2.value-proof-attention.json'), '{}', 'utf8');

    const read = await readJudgmentValueProofJournal({ root: journal });
    if (read.status !== 'available') throw new Error('expected available journal');
    expect(read.entries.map((entry) => entry.proof.decision_attempt_id)).toEqual(['attempt-2', 'attempt-1']);
    expect(read.latest_recorded_at).toBe('2026-09-21T01:00:00.000Z');
    expect(read.rejected).toHaveLength(1);
    expect(read.rejected[0]?.reason).toContain('unsupported judgment value proof schema');
  });
});

describe('judgment value proof review home', () => {
  it('puts each proof into exactly one section', () => {
    expect(classifyJudgmentValueProof(waitingProof('w', '2026-09-20T00:00:00.000Z'))).toBe('needs_human');
    expect(classifyJudgmentValueProof(blockedProof('b', '2026-09-20T00:00:00.000Z'))).toBe('blocked');
    expect(classifyJudgmentValueProof(continuedProof('c', '2026-09-20T00:00:00.000Z'))).toBe('continued');
    expect(classifyJudgmentValueProof(ordinaryProof('o', '2026-09-20T00:00:00.000Z'))).toBe('other');
  });

  it('reports coverage and a possible recording stall', async () => {
    await writeProof('s', 't1', continuedProof('1', '2026-09-20T00:00:00.000Z'));
    await writeProof('s', 't2', blockedProof('2', '2026-09-19T00:00:00.000Z'));
    await writeProof('s', 't3', waitingProof('3', '2026-09-18T00:00:00.000Z'));
    const read = await readJudgmentValueProofJournal({ root: journal });

    const home = buildJudgmentValueProofReviewHome(read, [], { now: new Date('2026-09-24T00:00:00.000Z') });
    if (home.status !== 'available') throw new Error('expected available home');
    expect(home.coverage).toEqual({
      saved: 3,
      rejected: 0,
      latest_recorded_at: '2026-09-20T00:00:00.000Z',
      possibly_stalled: true
    });
    expect(home.sections.needs_human).toHaveLength(1);
    expect(home.sections.blocked).toHaveLength(1);
    expect(home.sections.continued).toHaveLength(1);

    const fresh = buildJudgmentValueProofReviewHome(read, [], { now: new Date('2026-09-20T12:00:00.000Z') });
    if (fresh.status !== 'available') throw new Error('expected available home');
    expect(fresh.coverage.possibly_stalled).toBe(false);
  });
});

describe('judgment value proof feedback', () => {
  it('appends feedback without touching the journal and reads it back', async () => {
    const proof = continuedProof('1', '2026-09-20T00:00:00.000Z');
    const file = await writeProof('s', 't1', proof);
    const before = await readFile(file, 'utf8');

    const result = await recordJudgmentValueProofFeedback({
      dataDir,
      intent_id: proof.intent_id,
      decision_attempt_id: proof.decision_attempt_id,
      status: 'next_time_ask',
      summary: '本番設定への反映は次回は確認する',
      now: new Date('2026-09-24T00:00:00.000Z')
    });
    expect(result.created).toBe(true);
    expect(await readFile(file, 'utf8')).toBe(before);

    const again = await recordJudgmentValueProofFeedback({
      dataDir,
      intent_id: proof.intent_id,
      decision_attempt_id: proof.decision_attempt_id,
      status: 'next_time_ask',
      summary: '本番設定への反映は次回は確認する'
    });
    expect(again).toEqual({ record: result.record, created: false });
    expect(await readJudgmentValueProofFeedback({ dataDir })).toHaveLength(1);
  });

  it('requires a summary for corrected and reverted feedback', async () => {
    await expect(recordJudgmentValueProofFeedback({
      dataDir,
      intent_id: 'intent-1',
      decision_attempt_id: 'attempt-1',
      status: 'corrected'
    })).rejects.toThrow('corrected feedback requires summary');
    await expect(recordJudgmentValueProofFeedback({
      dataDir,
      intent_id: 'intent-1',
      decision_attempt_id: 'attempt-1',
      status: 'reverted',
      summary: '  '
    })).rejects.toThrow('reverted feedback requires summary');
  });

  it('applies the latest feedback with a verified human feedback reference and keeps history', async () => {
    const proof = continuedProof('1', '2026-09-20T00:00:00.000Z');
    await recordJudgmentValueProofFeedback({
      dataDir,
      intent_id: proof.intent_id,
      decision_attempt_id: proof.decision_attempt_id,
      status: 'accepted'
    });
    await recordJudgmentValueProofFeedback({
      dataDir,
      intent_id: proof.intent_id,
      decision_attempt_id: proof.decision_attempt_id,
      status: 'corrected',
      summary: '反映前に差分を確認するべきだった',
      target_layer: 'method'
    });

    const records = await readJudgmentValueProofFeedback({ dataDir });
    const applied = applyJudgmentValueProofFeedback(proof, records);
    expect(applied.history.map((record) => record.status)).toEqual(['accepted', 'corrected']);
    expect(applied.proof.feedback).toMatchObject({
      status: 'corrected',
      summary: '反映前に差分を確認するべきだった',
      evidence_ref: { kind: 'human_feedback', status: 'verified' }
    });
    expect(proof.feedback.status).toBe('none');
  });

  it('fails loudly on a malformed feedback record', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, JUDGMENT_VALUE_PROOF_FEEDBACK_FILE), '{"schema_version":"x"}\nnot-json\n', 'utf8');
    await expect(readJudgmentValueProofFeedback({ dataDir })).rejects.toThrow('judgment_value_proof_feedback_invalid:line_1');
  });
});

describe('judgment value proof feedback layer', () => {
  it('records next_time_ask as a delegation correction and requires a layer for corrections', async () => {
    const asked = await recordJudgmentValueProofFeedback({
      dataDir, intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'next_time_ask'
    });
    expect(asked.record.target_layer).toBe('delegation');

    await expect(recordJudgmentValueProofFeedback({
      dataDir, intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'corrected', summary: '目的が違う'
    })).rejects.toThrow('corrected feedback requires target_layer');
    await expect(recordJudgmentValueProofFeedback({
      dataDir, intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'accepted', target_layer: 'method'
    })).rejects.toThrow('accepted feedback does not take target_layer');
    await expect(recordJudgmentValueProofFeedback({
      dataDir, intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'next_time_ask', target_layer: 'objective'
    })).rejects.toThrow('next_time_ask feedback targets delegation');
  });

  it('reads feedback written before the layer existed and counts the latest feedback per decision by layer', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, JUDGMENT_VALUE_PROOF_FEEDBACK_FILE), `${JSON.stringify({
      schema_version: 'brainbase-judgment-value-proof-feedback-v1',
      feedback_id: 'sha256:old',
      intent_id: 'intent-old',
      decision_attempt_id: 'attempt-old',
      status: 'corrected',
      summary: '古い訂正',
      recorded_at: '2026-09-24T00:00:00.000Z'
    })}\n`, 'utf8');
    await recordJudgmentValueProofFeedback({ dataDir, intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'accepted' });
    await recordJudgmentValueProofFeedback({
      dataDir, intent_id: 'intent-1', decision_attempt_id: 'attempt-1', status: 'corrected', summary: '目的が違う', target_layer: 'objective'
    });
    await recordJudgmentValueProofFeedback({ dataDir, intent_id: 'intent-2', decision_attempt_id: 'attempt-2', status: 'next_time_ask' });

    const summary = summarizeJudgmentValueProofFeedback(await readJudgmentValueProofFeedback({ dataDir }));
    expect(summary.rated).toBe(3);
    expect(summary.by_status).toEqual({ accepted: 0, corrected: 2, next_time_ask: 1, reverted: 0 });
    expect(summary.by_layer).toMatchObject({ objective: 1, delegation: 1, unrecorded: 1 });
  });
});

describe('delegation map', () => {
  function kinded(proof: JudgmentValueProof, key: string | null, label = key ?? ''): JudgmentValueProof {
    return key ? { ...proof, decision: { ...proof.decision, judgment_kind: { key, label } } } : proof;
  }

  function feedbackRecord(
    id: string,
    status: JudgmentValueProofFeedbackStatus,
    recordedAt: string,
    targetLayer: JudgmentValueProofFeedbackLayer | null = null
  ): JudgmentValueProofFeedbackRecord {
    return {
      schema_version: 'brainbase-judgment-value-proof-feedback-v1',
      feedback_id: `sha256:${id}-${status}-${recordedAt}`,
      intent_id: `intent-${id}`,
      decision_attempt_id: `attempt-${id}`,
      status,
      summary: status === 'corrected' || status === 'reverted' ? '合成の理由' : null,
      target_layer: targetLayer ?? (status === 'next_time_ask' ? 'delegation' : null),
      recorded_at: recordedAt
    };
  }

  function mapOf(proofs: JudgmentValueProof[], feedback: JudgmentValueProofFeedbackRecord[]) {
    const entries = proofs
      .map((proof, index) => ({ file: `/journal/${index}.value-proof.json`, proof }))
      .sort((left, right) => right.proof.recorded_at.localeCompare(left.proof.recorded_at));
    const home = buildJudgmentValueProofReviewHome({
      status: 'available',
      root: '/journal',
      entries,
      rejected: [],
      latest_recorded_at: entries[0]?.proof.recorded_at ?? null
    }, feedback, { now: new Date('2026-09-30T00:00:00.000Z') });
    if (home.status !== 'available') throw new Error('home unavailable');
    return home.delegation_map;
  }

  const row = (map: ReturnType<typeof mapOf>, key: string) => map.rows.find((entry) => entry.key === key);

  it('puts kind rows first and keeps judgments without a kind apart, by reason code', () => {
    const map = mapOf([
      kinded(continuedProof('1', '2026-09-29T01:00:00.000Z'), 'production_release', '本番への反映'),
      { ...continuedProof('2', '2026-09-29T03:00:00.000Z'), interruption: { ...continuedProof('2', '').interruption, reason_code: null } },
      continuedProof('3', '2026-09-29T02:00:00.000Z'),
      ordinaryProof('4', '2026-09-29T04:00:00.000Z')
    ], []);

    expect(map.rows.map((entry) => [entry.key, entry.source, entry.label])).toEqual([
      ['kind:production_release', 'judgment_kind', '本番への反映'],
      ['reason:routine_reversible_work', 'reason_code', 'routine_reversible_work'],
      ['unrecorded', 'unrecorded', null]
    ]);
    expect(map).toMatchObject({ judged: 3, kind_recorded: 1, rated: 0 });
  });

  it('decides each row state from the newest judgment and the newest owner feedback', () => {
    const map = mapOf([
      kinded(continuedProof('a', '2026-09-29T01:00:00.000Z'), 'delegated_kind'),
      kinded(continuedProof('b1', '2026-09-29T01:00:00.000Z'), 'returned_by_judgment'),
      kinded(waitingProof('b2', '2026-09-29T02:00:00.000Z'), 'returned_by_judgment'),
      kinded(continuedProof('c', '2026-09-29T01:00:00.000Z'), 'returned_by_ask'),
      kinded(continuedProof('d', '2026-09-29T01:00:00.000Z'), 'returned_by_delegation_correction'),
      kinded(continuedProof('e1', '2026-09-29T01:00:00.000Z'), 'method_corrected'),
      kinded(continuedProof('e2', '2026-09-29T02:00:00.000Z'), 'method_corrected'),
      kinded(continuedProof('f', '2026-09-29T01:00:00.000Z'), 'unrated')
    ], [
      feedbackRecord('a', 'accepted', '2026-09-29T05:00:00.000Z'),
      feedbackRecord('b1', 'accepted', '2026-09-29T05:00:00.000Z'),
      feedbackRecord('c', 'next_time_ask', '2026-09-29T05:00:00.000Z'),
      feedbackRecord('d', 'corrected', '2026-09-29T05:00:00.000Z', 'delegation'),
      feedbackRecord('e2', 'accepted', '2026-09-29T05:00:00.000Z'),
      feedbackRecord('e1', 'corrected', '2026-09-29T06:00:00.000Z', 'method')
    ]);

    expect(row(map, 'kind:delegated_kind')).toMatchObject({
      state: 'delegated', state_basis: { reason: 'latest_feedback', status: 'accepted' }
    });
    expect(row(map, 'kind:returned_by_judgment')).toMatchObject({
      state: 'returned', state_basis: { reason: 'latest_judgment_returned', at: '2026-09-29T02:00:00.000Z' },
      counts: { continued: 1, returned: 1 }
    });
    expect(row(map, 'kind:returned_by_ask')).toMatchObject({
      state: 'returned', state_basis: { reason: 'latest_feedback', status: 'next_time_ask', target_layer: 'delegation' }
    });
    expect(row(map, 'kind:returned_by_delegation_correction')?.state).toBe('returned');
    // A method correction does not change what may proceed without asking.
    expect(row(map, 'kind:method_corrected')).toMatchObject({
      state: 'verifying',
      state_basis: { reason: 'latest_feedback', status: 'corrected', target_layer: 'method' },
      counts: { rated: 2, corrected_or_reverted: 1, by_feedback: { accepted: 1, corrected: 1 } }
    });
    expect(row(map, 'kind:unrated')).toMatchObject({ state: 'verifying', state_basis: { reason: 'no_feedback' } });
  });

  it('highlights judgments that continued without asking and were corrected or reverted', () => {
    const map = mapOf([
      kinded(continuedProof('1', '2026-09-29T01:00:00.000Z'), 'production_release'),
      kinded(continuedProof('2', '2026-09-29T02:00:00.000Z'), 'external_send'),
      kinded(waitingProof('3', '2026-09-29T03:00:00.000Z'), 'payment'),
      kinded(continuedProof('4', '2026-09-29T04:00:00.000Z'), 'daily_routine')
    ], [
      feedbackRecord('1', 'corrected', '2026-09-29T05:00:00.000Z', 'world_model'),
      feedbackRecord('2', 'reverted', '2026-09-29T05:00:00.000Z'),
      feedbackRecord('3', 'corrected', '2026-09-29T05:00:00.000Z', 'method'),
      feedbackRecord('4', 'corrected', '2026-09-29T05:00:00.000Z', 'method'),
      feedbackRecord('4', 'accepted', '2026-09-29T06:00:00.000Z')
    ]);

    expect(map.corrected_after_continue.map((entry) => entry.decision_attempt_id)).toEqual(['attempt-2', 'attempt-1']);
    expect(row(map, 'kind:external_send')?.counts.corrected_or_reverted).toBe(1);
  });

  it('shows judgments that still continued without asking after the owner asked to be asked', () => {
    const map = mapOf([
      kinded(continuedProof('1', '2026-09-29T01:00:00.000Z'), 'production_release'),
      kinded(continuedProof('2', '2026-09-29T08:00:00.000Z'), 'production_release'),
      kinded(continuedProof('3', '2026-09-29T09:00:00.000Z'), 'production_release'),
      kinded(continuedProof('4', '2026-09-29T09:00:00.000Z'), 'daily_routine')
    ], [
      feedbackRecord('1', 'next_time_ask', '2026-09-29T05:00:00.000Z'),
      feedbackRecord('3', 'accepted', '2026-09-29T10:00:00.000Z')
    ]);

    expect(map.continued_after_ask).toEqual([
      { intent_id: 'intent-2', decision_attempt_id: 'attempt-2', row_key: 'kind:production_release' }
    ]);
  });

  it('keeps judgments that ignored an earlier ask when the owner asks again later', () => {
    const map = mapOf([
      kinded(continuedProof('1', '2026-09-29T01:00:00.000Z'), 'production_release'),
      kinded(continuedProof('2', '2026-09-29T08:00:00.000Z'), 'production_release'),
      kinded(continuedProof('3', '2026-09-29T09:00:00.000Z'), 'production_release')
    ], [
      feedbackRecord('1', 'next_time_ask', '2026-09-29T05:00:00.000Z'),
      feedbackRecord('2', 'next_time_ask', '2026-09-29T10:00:00.000Z')
    ]);

    expect(map.continued_after_ask.map((entry) => entry.decision_attempt_id)).toEqual(['attempt-3', 'attempt-2']);
  });

  it('counts judgments that recorded an inherited experience', () => {
    const inherited = kinded(continuedProof('1', '2026-09-29T01:00:00.000Z'), 'daily_routine');
    const map = mapOf([
      { ...inherited, decision: { ...inherited.decision, prior_learning_reused: true, inheritance: {
        sources: [{ kind: 'judgment', ref: 'decision-earlier', version: null, label: '前回の合成判断' }],
        same_conditions: ['同じ手順'],
        rechecked_conditions: []
      } } },
      kinded(continuedProof('2', '2026-09-29T02:00:00.000Z'), 'daily_routine')
    ], []);

    expect(row(map, 'kind:daily_routine')?.counts.inherited).toBe(1);
  });
});
