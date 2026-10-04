import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JudgmentValueProof } from '../src/judgment-value-proof.js';
import {
  JudgmentValueProofJournalCache,
  readJudgmentValueProofJournal,
  type JudgmentValueProofJournalRead
} from '../src/judgment-value-proof-review.js';

// Counts folder listings while keeping the real file system behavior.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

function continuedProof(id: string): JudgmentValueProof {
  return {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: `intent-${id}`,
    decision_attempt_id: `attempt-${id}`,
    recorded_at: '2026-09-14T07:14:00.000Z',
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
      basis: [],
      prior_learning_reused: 'unconfirmed'
    },
    execution: { status: 'completed', summary: '設定を反映した', artifact_refs: [] },
    outcome: { status: 'unconfirmed', summary: null, evidence_refs: [] },
    human_decision: null,
    feedback: { status: 'none', summary: null, evidence_ref: null }
  };
}

function waitingProof(id: string): JudgmentValueProof {
  return {
    ...continuedProof(id),
    state: 'waiting_human',
    interruption: {
      resolution: 'human_required',
      question_display_text: '本番へデプロイしてよいですか？',
      question_digest: 'sha256:deploy',
      reason_code: 'irreversible_action',
      human_reason: '本番への外部作用になるため'
    },
    execution: { status: 'not_started', summary: null, artifact_refs: [] },
    outcome: { status: 'not_applicable', summary: null, evidence_refs: [] },
    human_decision: {
      question: '本番へデプロイしてよいですか？',
      why_human: '本番への外部作用になるため',
      options: [{ id: 'deploy', label: '本番へ反映する', impact: '利用者に即時反映される' }]
    }
  };
}

let directory: string;
let journal: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'brainbase-value-proof-journal-cache-'));
  journal = join(directory, 'journal');
  vi.mocked(readdir).mockClear();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function listings(folder: string): number {
  return vi.mocked(readdir).mock.calls.filter(([path]) => path === folder).length;
}

async function writeProof(folder: string, turn: string, proof: unknown): Promise<string> {
  await mkdir(folder, { recursive: true });
  const file = join(folder, `${turn}.value-proof.json`);
  await writeFile(file, JSON.stringify(proof), 'utf8');
  return file;
}

async function writeFinal(folder: string, turn: string, finalizedAt: string): Promise<void> {
  await writeFile(
    join(folder, `${turn}.final.json`),
    JSON.stringify({ schema_version: 'brainbase-judgment-episode-final-v2', finalized_at: finalizedAt }),
    'utf8'
  );
}

/** Dates the folder's last change an hour back, like a conversation that has been quiet for a while. */
async function quiet(folder: string): Promise<void> {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  await utimes(folder, hourAgo, hourAgo);
}

async function read(cache: JudgmentValueProofJournalCache): Promise<Extract<JudgmentValueProofJournalRead, { status: 'available' }>> {
  const result = await readJudgmentValueProofJournal({ root: journal, cache });
  if (result.status !== 'available') throw new Error(`expected available journal: ${result.reason}`);
  return result;
}

async function attempts(cache: JudgmentValueProofJournalCache): Promise<string[]> {
  return (await read(cache)).entries.map((entry) => entry.proof.decision_attempt_id).sort();
}

describe('reading the judgment journal with a remembered folder listing', () => {
  it('lists a conversation folder again only after it changes', async () => {
    const folder = join(journal, 'session-a');
    await writeProof(folder, 'turn-1', continuedProof('1'));
    await quiet(folder);
    const cache = new JudgmentValueProofJournalCache();

    expect(await attempts(cache)).toEqual(['attempt-1']);
    expect(await attempts(cache)).toEqual(['attempt-1']);
    expect(listings(folder)).toBe(1);

    await writeProof(folder, 'turn-2', continuedProof('2'));
    expect(await attempts(cache)).toEqual(['attempt-1', 'attempt-2']);
    expect(listings(folder)).toBe(2);
  });

  it('finds proofs in new and recreated folders and drops removed ones', async () => {
    const kept = join(journal, 'session-kept');
    const replaced = join(journal, 'session-replaced');
    await writeProof(kept, 'turn', continuedProof('kept'));
    await writeProof(replaced, 'turn', continuedProof('old'));
    await quiet(kept);
    await quiet(replaced);
    const cache = new JudgmentValueProofJournalCache();
    expect(await attempts(cache)).toEqual(['attempt-kept', 'attempt-old']);

    await rm(replaced, { recursive: true });
    await writeProof(replaced, 'turn', continuedProof('new'));
    await quiet(replaced);
    await writeProof(join(journal, 'session-added'), 'turn', continuedProof('added'));
    expect(await attempts(cache)).toEqual(['attempt-added', 'attempt-kept', 'attempt-new']);

    await rm(replaced, { recursive: true });
    expect(await attempts(cache)).toEqual(['attempt-added', 'attempt-kept']);
    expect(listings(kept)).toBe(1);
  });

  it('reads every proof again, so a proof broken or repaired in place is seen at once', async () => {
    const folder = join(journal, 'session-a');
    const file = await writeProof(folder, 'turn', continuedProof('1'));
    await quiet(folder);
    const cache = new JudgmentValueProofJournalCache();
    expect(await attempts(cache)).toEqual(['attempt-1']);

    await writeFile(file, '{broken', 'utf8');
    const broken = await read(cache);
    expect(broken.entries).toEqual([]);
    expect(broken.rejected).toEqual([{ file, reason: expect.any(String) }]);
    expect(broken.latest_recorded_at).toBeNull();

    await writeFile(file, JSON.stringify(continuedProof('1')), 'utf8');
    expect(await attempts(cache)).toEqual(['attempt-1']);
    expect(listings(folder)).toBe(1);
  });

  it('marks a waiting judgment as soon as a later turn of its conversation is finalized', async () => {
    const waiting = join(journal, 'session-waiting');
    const quietFolder = join(journal, 'session-quiet');
    await writeProof(waiting, 'turn-1', waitingProof('w'));
    await writeFinal(waiting, 'turn-1', '2026-09-14T07:14:37.000Z');
    await writeProof(quietFolder, 'turn', continuedProof('q'));
    await quiet(waiting);
    await quiet(quietFolder);
    const cache = new JudgmentValueProofJournalCache();
    const movedOn = async () => (await read(cache)).entries
      .find((entry) => entry.proof.decision_attempt_id === 'attempt-w')?.conversation_moved_on_at;

    expect(await movedOn()).toBeNull();
    await writeFinal(waiting, 'turn-2', '2026-09-14T07:32:24.000Z');
    expect(await movedOn()).toBe('2026-09-14T07:32:24.000Z');
    expect(listings(quietFolder)).toBe(1);
  });

  it('reports a journal that disappeared after a remembered read as unavailable', async () => {
    await writeProof(join(journal, 'session-a'), 'turn', continuedProof('1'));
    const cache = new JudgmentValueProofJournalCache();
    expect(await attempts(cache)).toEqual(['attempt-1']);

    await rm(journal, { recursive: true });
    expect(await readJudgmentValueProofJournal({ root: journal, cache }))
      .toMatchObject({ status: 'unavailable', reason: 'judgment_journal_not_found' });
  });

  // Permission checks do not apply to root, so the folder would stay listable.
  it.skipIf(process.getuid?.() === 0)('fails instead of reusing the remembered listing when a folder can no longer be listed', async () => {
    const folder = join(journal, 'session-a');
    await writeProof(folder, 'turn', continuedProof('1'));
    await quiet(folder);
    const cache = new JudgmentValueProofJournalCache();
    expect(await attempts(cache)).toEqual(['attempt-1']);

    await chmod(folder, 0o000);
    try {
      await expect(readJudgmentValueProofJournal({ root: journal, cache })).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      await chmod(folder, 0o700);
    }
  });

  it('lists a folder again while its last change is too recent to trust its timestamps', async () => {
    const folder = join(journal, 'session-a');
    await writeProof(folder, 'turn', continuedProof('1'));
    const cache = new JudgmentValueProofJournalCache();

    await read(cache);
    await read(cache);
    expect(listings(folder)).toBe(2);

    await quiet(folder);
    await read(cache);
    await read(cache);
    expect(listings(folder)).toBe(3);
  });
});
