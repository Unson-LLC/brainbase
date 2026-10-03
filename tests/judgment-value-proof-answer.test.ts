import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JudgmentValueProof } from '../src/judgment-value-proof.js';
import {
  JUDGMENT_VALUE_PROOF_ANSWER_FILE,
  JudgmentValueProofAnswerConflictError,
  buildJudgmentValueProofReviewHome,
  readJudgmentValueProofAnswers,
  readJudgmentValueProofJournal,
  recordJudgmentValueProofAnswer
} from '../src/judgment-value-proof-review.js';

function waitingProof(id: string): JudgmentValueProof {
  return {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: `intent-${id}`,
    decision_attempt_id: `attempt-${id}`,
    recorded_at: '2026-09-14T07:14:00.000Z',
    state: 'waiting_human',
    interruption: {
      resolution: 'human_required',
      question_display_text: '本番へデプロイしてよいですか？',
      question_digest: 'sha256:deploy',
      reason_code: 'irreversible_action',
      human_reason: '本番への外部作用になるため'
    },
    decision: {
      summary: '本番へ反映する前に所有者の承認を取る',
      work_impact: '承認まで反映を止める',
      basis: [],
      prior_learning_reused: 'unconfirmed'
    },
    execution: { status: 'not_started', summary: null, artifact_refs: [] },
    outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
    human_decision: {
      question: '本番へデプロイしてよいですか？',
      why_human: '本番への外部作用になるため',
      options: [
        { id: 'deploy', label: '本番へ反映する（推奨）', impact: '利用者に即時反映される' },
        { id: 'keep_local', label: '反映を保留する', impact: '変更はローカルに残る' }
      ]
    },
    feedback: { status: 'none', summary: null, evidence_ref: null }
  };
}

function continuedProof(id: string): JudgmentValueProof {
  return {
    ...waitingProof(id),
    state: 'unconfirmed',
    interruption: {
      resolution: 'continued_without_human',
      question_display_text: '稼働中の設定へ反映してよいですか？',
      question_digest: 'sha256:question',
      reason_code: 'routine_reversible_work',
      human_reason: null
    },
    execution: { status: 'completed', summary: '設定を反映した', artifact_refs: [] },
    human_decision: null
  };
}

let directory: string;
let dataDir: string;
let journal: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-value-proof-answer-'));
  dataDir = join(directory, 'personal-os');
  journal = join(directory, 'journal');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function answerLines(): Promise<string[]> {
  return (await readFile(join(dataDir, JUDGMENT_VALUE_PROOF_ANSWER_FILE), 'utf8')).split('\n').filter(Boolean);
}

describe('recording an answer to a judgment returned to the owner', () => {
  it('records the chosen option once, bound to the question text, without resuming work', async () => {
    const proof = waitingProof('1');
    const { record, created } = await recordJudgmentValueProofAnswer({
      dataDir, proof, kind: 'select', selected_option_id: 'deploy', confirmed: true, now: new Date('2026-10-04T07:00:00.000Z')
    });

    expect(created).toBe(true);
    expect(record).toMatchObject({
      schema_version: 'brainbase-judgment-value-proof-answer-v1',
      intent_id: 'intent-1',
      decision_attempt_id: 'attempt-1',
      kind: 'select',
      selected_option_id: 'deploy',
      selected_option_label: '本番へ反映する（推奨）',
      owner_confirmation: 'local_web_confirmed',
      resume: 'not_started',
      recorded_at: '2026-10-04T07:00:00.000Z'
    });
    expect(record.question_sha256).toBe(`sha256:${createHash('sha256').update('本番へデプロイしてよいですか？').digest('hex')}`);
    expect(record.answer_id).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(await readJudgmentValueProofAnswers({ dataDir })).toEqual([record]);
  });

  it('returns the same record when the same answer is sent again', async () => {
    const proof = waitingProof('1');
    const first = await recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'deploy', confirmed: true });
    const again = await recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'deploy', confirmed: true });

    expect(again).toEqual({ record: first.record, created: false });
    expect(await answerLines()).toHaveLength(1);
  });

  it('refuses a different answer to an already answered judgment instead of overwriting it', async () => {
    const proof = waitingProof('1');
    const first = await recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'deploy', confirmed: true });

    const attempt = recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'keep_local', confirmed: true });
    await expect(attempt).rejects.toBeInstanceOf(JudgmentValueProofAnswerConflictError);
    await expect(attempt).rejects.toMatchObject({ existing: first.record });
    expect(await answerLines()).toHaveLength(1);
  });

  it('records 「どれも選ばない」 as a reject without an option', async () => {
    const { record } = await recordJudgmentValueProofAnswer({ dataDir, proof: waitingProof('1'), kind: 'reject', confirmed: true });
    expect(record).toMatchObject({ kind: 'reject', selected_option_id: null, selected_option_label: null });
  });

  it('rejects answers to judgments that were not returned to the owner, unknown options and unconfirmed sends', async () => {
    const proof = waitingProof('1');
    await expect(recordJudgmentValueProofAnswer({ dataDir, proof: continuedProof('2'), kind: 'reject', confirmed: true }))
      .rejects.toThrow('judgment is not waiting for the owner');
    await expect(recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'other', confirmed: true }))
      .rejects.toThrow('selected_option_id is not an option of this question');
    await expect(recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', confirmed: true }))
      .rejects.toThrow('select answer requires selected_option_id');
    await expect(recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'reject', selected_option_id: 'deploy', confirmed: true }))
      .rejects.toThrow('reject answer does not take selected_option_id');
    await expect(recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'deploy', confirmed: false }))
      .rejects.toThrow('answer requires explicit confirmation');
    await expect(recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'later' as never, confirmed: true }))
      .rejects.toThrow('unsupported answer kind');
    expect(await readJudgmentValueProofAnswers({ dataDir })).toEqual([]);
  });

  it('keeps one answer per judgment when two different answers race', async () => {
    const proof = waitingProof('1');
    const results = await Promise.allSettled([
      recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'deploy', confirmed: true }),
      recordJudgmentValueProofAnswer({ dataDir, proof, kind: 'select', selected_option_id: 'keep_local', confirmed: true })
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(JudgmentValueProofAnswerConflictError);
    expect(await answerLines()).toHaveLength(1);
  });

  it('clears a lock left by a stopped write, but does not record while another write holds a fresh lock', async () => {
    await mkdir(dataDir, { recursive: true });
    const lock = join(dataDir, `${JUDGMENT_VALUE_PROOF_ANSWER_FILE}.lock`);
    await writeFile(lock, 'held', 'utf8');
    await expect(recordJudgmentValueProofAnswer({
      dataDir, proof: waitingProof('1'), kind: 'reject', confirmed: true, lockTimeoutMs: 100
    })).rejects.toThrow('judgment_value_proof_answer_lock_busy');
    expect(await readJudgmentValueProofAnswers({ dataDir })).toEqual([]);

    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    const { created } = await recordJudgmentValueProofAnswer({
      dataDir, proof: waitingProof('1'), kind: 'reject', confirmed: true, lockTimeoutMs: 100
    });
    expect(created).toBe(true);
  });

  it('reports a corrupt answer file instead of treating it as no answers', async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, JUDGMENT_VALUE_PROOF_ANSWER_FILE), 'not-json\n', 'utf8');
    await expect(readJudgmentValueProofAnswers({ dataDir })).rejects.toThrow('judgment_value_proof_answer_corrupt:line_1');

    await writeFile(join(dataDir, JUDGMENT_VALUE_PROOF_ANSWER_FILE), `${JSON.stringify({ schema_version: 'x' })}\n`, 'utf8');
    await expect(readJudgmentValueProofAnswers({ dataDir })).rejects.toThrow('judgment_value_proof_answer_invalid:line_1');
  });

  it('shows the recorded answer on the judgment it answers and leaves the judgment record untouched', async () => {
    await mkdir(join(journal, 'session-a'), { recursive: true });
    const proofFile = join(journal, 'session-a', 'turn-1.value-proof.json');
    const proofText = JSON.stringify(waitingProof('1'));
    await writeFile(proofFile, proofText, 'utf8');
    await writeFile(join(journal, 'session-a', 'turn-2.value-proof.json'), JSON.stringify(waitingProof('2')), 'utf8');

    const { record } = await recordJudgmentValueProofAnswer({ dataDir, proof: waitingProof('1'), kind: 'select', selected_option_id: 'deploy', confirmed: true });
    const home = buildJudgmentValueProofReviewHome(
      await readJudgmentValueProofJournal({ root: journal }),
      [],
      { answers: await readJudgmentValueProofAnswers({ dataDir }) }
    );
    if (home.status !== 'available') throw new Error('expected available home');

    const byAttempt = new Map(home.sections.needs_human.map((item) => [item.proof.decision_attempt_id, item]));
    expect(byAttempt.get('attempt-1')?.answer).toEqual(record);
    expect(byAttempt.get('attempt-2')?.answer).toBeNull();
    expect(await readFile(proofFile, 'utf8')).toBe(proofText);
  });
});
