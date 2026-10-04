import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JudgmentValueProofJournalCache } from '../src/judgment-value-proof-review.js';
import { projectWorldBusinesses, readJudgmentPlaces, readWorldBusinesses } from '../src/world-extension.js';

const valueProof = (id: string) => ({
  schema_version: 'brainbase-judgment-value-proof-v1',
  intent_id: `intent-${id}`,
  decision_attempt_id: `attempt-${id}`,
  recorded_at: '2026-10-04T00:00:00.000Z',
  state: 'unconfirmed',
  interruption: { resolution: 'continued_without_human', question_display_text: '進めてよいですか？', question_digest: 'sha256:question', reason_code: 'routine_reversible_work', human_reason: null },
  decision: { summary: '進めた', work_impact: '止めずに進めた', basis: [], prior_learning_reused: 'unconfirmed' },
  execution: { status: 'completed', summary: '進めた', artifact_refs: [] },
  outcome: { status: 'unconfirmed', summary: null, evidence_refs: [] },
  human_decision: null,
  feedback: { status: 'none', summary: null, evidence_ref: null },
});
// @ts-expect-error plain browser module without type declarations
import { groupJudgmentPlaces, placeJudgment } from '../ui/world/world-placement.js';

const record = (id: string, projectCode: string, payload: Record<string, unknown>, lifecycle = 'active') => ({
  id,
  project_code: projectCode,
  organization_id: 'acme',
  lifecycle_status: lifecycle,
  payload,
});

describe('world: businesses from the organization Graph', () => {
  it('draws active catalog projects as cities and attaches engagements by project_code', () => {
    const projection = projectWorldBusinesses([
      record('prj_atlas', 'atlas', { code: 'atlas', kind: 'internal', name: 'Atlas', purpose: '研修' }),
      record('prj_beacon', 'beacon', { code: 'beacon', kind: 'product', name: 'Beacon' }),
      record('eng_training', 'atlas', { name: '研修案件A', summary: '研修案件' }),
      record('eng_poc', 'atlas', { name: 'PoC案件B' }),
    ]);
    expect(projection.businesses.map((business) => business.code)).toEqual(['beacon', 'atlas']);
    const atlas = projection.businesses.find((business) => business.code === 'atlas');
    expect(atlas?.engagements.map((engagement) => engagement.name)).toEqual(['PoC案件B', '研修案件A']);
    expect(projection.unplaced).toEqual([]);
  });

  it('counts retired, superseded and unnamed records instead of drawing them', () => {
    const projection = projectWorldBusinesses([
      record('prj_old', 'acme-old', { code: 'acme-old', kind: 'product', name: 'Old Product' }, 'retired'),
      record('old_pilot', 'pilot', { name: 'pilot' }, 'superseded'),
      record('blank', 'acme', {}),
    ]);
    expect(projection.businesses).toEqual([]);
    expect(projection.excluded).toEqual({ inactive: 2, unnamed: 1 });
  });

  it('keeps an engagement whose business is not listed visible as unplaced, never dropping it', () => {
    const projection = projectWorldBusinesses([record('eng_orphan', 'no-such-business', { name: '行き先のない案件' })]);
    expect(projection.unplaced.map((engagement) => engagement.name)).toEqual(['行き先のない案件']);
  });

  it('reports a missing connection as a state, not as zero businesses', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bb-world-'));
    const result = await readWorldBusinesses({ home });
    expect(result.status).toBe('not_connected');
  });

  it('reports an expired token as auth_failed without leaking the token', async () => {
    const home = await mkdtemp(join(tmpdir(), 'bb-world-'));
    await mkdir(join(home, '.brainbase'));
    await writeFile(join(home, '.brainbase', 'config.json'), JSON.stringify({ server_url: 'https://graph.example' }));
    await writeFile(join(home, '.brainbase', 'tokens.json'), JSON.stringify({ access_token: 'secret-token-value' }));
    const result = await readWorldBusinesses({
      home,
      fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch,
    });
    expect(result).toMatchObject({ status: 'auth_failed', reason: 'http_401' });
    expect(JSON.stringify(result)).not.toContain('secret-token-value');
  });
});

describe('world: where a judgment stands', () => {
  const businesses = [
    { code: 'pilot', repositories: ['pilot-runtime', 'pilot'] },
    { code: 'beacon', repositories: ['beacon-app'] },
  ];

  it('places a judgment by the repository the Graph registers for a business', () => {
    expect(placeJudgment('pilot-runtime', businesses)).toMatchObject({ business: { code: 'pilot' }, basis: 'repository' });
  });

  it('places a judgment whose repository name equals a business code', () => {
    expect(placeJudgment('beacon', businesses)).toMatchObject({ business: { code: 'beacon' }, basis: 'code' });
  });

  it('keeps unrecorded and unregistered workplaces in the plaza with the reason, never guessing', () => {
    expect(placeJudgment(null, businesses)).toEqual({ business: null, reason: 'workspace_unrecorded' });
    expect(placeJudgment('notes-repo', businesses)).toEqual({ business: null, reason: 'workspace_unregistered' });
    const grouped = groupJudgmentPlaces([
      { decision_attempt_id: 'd1', workspace: 'pilot-runtime' },
      { decision_attempt_id: 'd2', workspace: 'other-repo' },
    ], businesses);
    expect(grouped.byBusiness.get('pilot')?.map((entry: { decision_attempt_id: string }) => entry.decision_attempt_id)).toEqual(['d1']);
    expect(grouped.unplaced).toEqual([{ decision_attempt_id: 'd2', workspace: 'other-repo', reason: 'workspace_unregistered' }]);
  });

  it('reads the recorded workplace of each saved judgment from the journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bb-world-journal-'));
    await mkdir(join(root, 'session-a'));
    await writeFile(join(root, 'session-a', 't1.value-proof.json'), JSON.stringify(valueProof('1')));
    await writeFile(join(root, 'session-a', 't1.turn-input.json'), JSON.stringify({ project_code: 'pilot-runtime' }));
    await writeFile(join(root, 'session-a', 't2.value-proof.json'), JSON.stringify(valueProof('2')));
    const result = await readJudgmentPlaces(root);
    expect(result.status).toBe('available');
    expect([...result.places].sort((a, b) => a.decision_attempt_id.localeCompare(b.decision_attempt_id))).toEqual([
      { decision_attempt_id: 'attempt-1', workspace: 'pilot-runtime' },
      { decision_attempt_id: 'attempt-2', workspace: null },
    ]);
  });

  it('lists only changed journal folders again, through the cache it shares with the 今日 list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bb-world-journal-cache-'));
    await mkdir(join(root, 'session-a'));
    await writeFile(join(root, 'session-a', 't1.value-proof.json'), JSON.stringify(valueProof('1')));
    // Age the folder past the settle window, as the journal cache tests do.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(join(root, 'session-a'), hourAgo, hourAgo);
    const cache = new JudgmentValueProofJournalCache();
    const original = cache.valueProofFiles.bind(cache);
    const listings: Array<readonly string[]> = [];
    cache.valueProofFiles = async (folder: string) => {
      const files = await original(folder);
      listings.push(files);
      return files;
    };
    await readJudgmentPlaces(root, { cache });
    await readJudgmentPlaces(root, { cache });
    // The unchanged folder's listing is reused, not read from disk again.
    expect(listings).toHaveLength(2);
    expect(listings[1]).toBe(listings[0]);
  });

  it('reports an unreadable journal as unavailable, not as zero judgments', async () => {
    const result = await readJudgmentPlaces(join(tmpdir(), 'bb-world-no-such-journal'));
    expect(result).toMatchObject({ status: 'unavailable', reason: 'journal_unreadable' });
  });
});
