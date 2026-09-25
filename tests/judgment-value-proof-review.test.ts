import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JudgmentValueProof } from '../src/judgment-value-proof.js';
import {
  JUDGMENT_VALUE_PROOF_FEEDBACK_FILE,
  applyJudgmentValueProofFeedback,
  buildJudgmentValueProofReviewHome,
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
