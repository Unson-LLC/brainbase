import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JudgmentValueProofJournalCache } from '../src/judgment-value-proof-review.js';
import { projectWorldFromGraph, readJudgmentPlaces, readWorldBusinesses, readWorldVocabulary, resolveWorldVocabulary } from '../src/world-extension.js';

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

const project = (id: string, name: string, metadata: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  id, type: 'project' as const, name, metadata, ...extra,
});

describe('world: businesses from any Graph', () => {
  it('draws top-level projects as cities and their sub-projects (at any depth) as districts', () => {
    const projection = projectWorldFromGraph({ entities: [
      project('prj_atlas', 'Atlas', { code: 'atlas', kind: 'internal', goal: '研修' }),
      project('prj_beacon', 'Beacon', { kind: 'product', repositories: ['beacon-app'] }),
      project('eng_training', '研修案件A', { parent_project_id: 'prj_atlas', parent_project_code: 'atlas' }),
      project('eng_poc', 'PoC案件B', { parent_project_id: 'eng_training' }),
      { id: 'per_owner', type: 'person' as const, name: '本人' },
    ] });
    expect(projection.businesses.map((business) => business.code)).toEqual(['atlas', 'prj_beacon']);
    const atlas = projection.businesses.find((business) => business.code === 'atlas');
    expect(atlas?.engagements.map((engagement) => engagement.name)).toEqual(['PoC案件B', '研修案件A']);
    expect(atlas?.purpose).toBe('研修');
    expect(projection.businesses.find((business) => business.id === 'prj_beacon')?.repositories).toEqual(['beacon-app']);
    expect(projection.unplaced).toEqual([]);
  });

  it('keeps a project whose declared parent is not in the Graph visible as unplaced, never dropping it', () => {
    const projection = projectWorldFromGraph({ entities: [project('eng_orphan', '行き先のない案件', { parent_project_code: 'no-such-business' })] });
    expect(projection.businesses).toEqual([]);
    expect(projection.unplaced.map((engagement) => engagement.name)).toEqual(['行き先のない案件']);
  });

  it('counts projects past their end instead of drawing them, and draws an unclassified project as a city', () => {
    const projection = projectWorldFromGraph({ entities: [
      project('prj_old', 'Old', { kind: 'product' }, { validTo: '2026-01-01T00:00:00.000Z' }),
      project('prj_plain', 'Plain'),
    ] }, new Date('2026-10-04T00:00:00.000Z'));
    expect(projection.excluded).toEqual({ inactive: 1 });
    expect(projection.businesses.map((business) => [business.name, business.kind])).toEqual([['Plain', null]]);
  });

  it('names kinds in the host vocabulary order, then the Graph\'s own kinds under their value, then 分類なし', () => {
    const businesses = projectWorldFromGraph({ entities: [
      project('a', 'A', { kind: 'client' }),
      project('b', 'B', { kind: 'lab' }),
      project('c', 'C'),
      project('d', 'D', { kind: 'product' }),
    ] }).businesses;
    const vocabulary = resolveWorldVocabulary({
      kinds: { product: { label: 'プロダクト', form: 'tower', color: '#123456' }, client: { label: '顧客案件', form: 'hall' } },
      statuses: { not_converted: { label: '案件化せず', phase: 'finished' }, active: { label: '稼働中' } },
    }, businesses);
    expect(vocabulary.kinds.map((kind) => [kind.key, kind.label, kind.form, kind.configured])).toEqual([
      ['product', 'プロダクト', 'tower', true],
      ['client', '顧客案件', 'hall', true],
      ['lab', 'lab', 'office', false],
      [null, '分類なし', 'office', false],
    ]);
    expect(vocabulary.kinds[0]!.color).toBe('#123456');
    const statuses = Object.fromEntries(vocabulary.statuses.map((status) => [status.key, [status.label, status.phase]]));
    expect(statuses.not_converted).toEqual(['案件化せず', 'finished']);
    expect(statuses.active).toEqual(['稼働中', 'active']);
    expect(statuses.completed).toEqual(['完了', 'finished']);
  });

  it('names a kind by the organization\'s term first, then the vocabulary file, then its value, and says where the name came from', () => {
    const businesses = projectWorldFromGraph({ entities: [
      project('a', 'A', { kind: 'product' }),
      project('b', 'B', { kind: 'client' }),
      project('c', 'C', { kind: 'lab' }),
    ] }).businesses;
    const terms = [
      { id: 'gls_p', field: 'project.kind', value: 'product', label: 'プロダクト', definition: '自社の提供物' },
      { id: 'gls_s', field: 'project.status', value: 'product', label: '別の欄', definition: null },
    ];
    const vocabulary = resolveWorldVocabulary({ kinds: { product: { label: '製品', form: 'tower' }, client: { label: '顧客案件', form: 'hall' } } }, businesses, terms);
    expect(vocabulary.kinds.map((kind) => [kind.key, kind.label, kind.label_source, kind.definition, kind.form])).toEqual([
      ['product', 'プロダクト', 'graph', '自社の提供物', 'tower'],
      ['client', '顧客案件', 'config', null, 'hall'],
      ['lab', 'lab', 'value', null, 'office'],
    ]);
    expect(vocabulary.terms).toBe('read');
    expect(resolveWorldVocabulary(undefined, businesses, null).terms).toBe('unavailable');
    expect(resolveWorldVocabulary(undefined, businesses).terms).toBe('none');
  });

  it('keeps drawing when the organization\'s terms cannot be read', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'bb-world-'));
    const result = await readWorldBusinesses({
      dataDir,
      organizationGraph: {
        server: 'https://graph.example',
        read: async () => { throw new Error('not used'); },
        readGraphFile: async () => ({ entities: [project('prj_a', 'A', { kind: 'product' })] }) as never,
        readVocabularyTerms: async () => { throw new Error('glossary down'); },
      },
    });
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.vocabulary.terms).toBe('unavailable');
    expect(result.status === 'ok' && result.vocabulary.kinds.map((kind) => kind.label)).toEqual(['product']);
  });

  it('draws with the Graph\'s own words when no vocabulary is given', () => {
    const businesses = projectWorldFromGraph({ entities: [project('a', 'A', { kind: 'product' })] }).businesses;
    expect(resolveWorldVocabulary(undefined, businesses).kinds.map((kind) => [kind.key, kind.label])).toEqual([['product', 'product']]);
  });

  it('refuses a vocabulary file with an unknown building, phase or color instead of ignoring it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bb-world-vocab-'));
    const write = async (name: string, body: unknown) => {
      const path = join(dir, name);
      await writeFile(path, JSON.stringify(body));
      return path;
    };
    await expect(readWorldVocabulary(await write('form.json', { kinds: { product: { form: 'castle' } } }))).rejects.toThrow(/unknown form/u);
    await expect(readWorldVocabulary(await write('phase.json', { statuses: { done: { phase: 'gone' } } }))).rejects.toThrow(/unknown phase/u);
    await expect(readWorldVocabulary(await write('color.json', { kinds: { product: { color: 'blue' } } }))).rejects.toThrow(/invalid color/u);
    await expect(readWorldVocabulary(await write('ok.json', { kinds: { product: { label: 'プロダクト', form: 'tower' } } }))).resolves.toEqual({ kinds: { product: { label: 'プロダクト', form: 'tower' } }, statuses: {} });
  });

  it('reads the organization Graph when the host reads it, and a missing local Graph as a state, not zero businesses', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'bb-world-'));
    const organization = await readWorldBusinesses({
      dataDir,
      organizationGraph: {
        server: 'https://graph.example',
        read: async () => { throw new Error('not used'); },
        readGraphFile: async () => ({ entities: [project('prj_a', 'A', { kind: 'product' })] }) as never,
      },
    });
    expect(organization).toMatchObject({ status: 'ok', source: { authority: 'organization_graph', server: 'https://graph.example' } });
    expect(organization.status === 'ok' && organization.businesses.map((business) => business.name)).toEqual(['A']);
    const withoutRecords = await readWorldBusinesses({ dataDir, organizationGraph: { server: 'https://graph.example', read: async () => { throw new Error('not used'); } } });
    expect(withoutRecords).toMatchObject({ status: 'unavailable', reason: 'organization_graph_records_unavailable' });
    expect(await readWorldBusinesses({ dataDir })).toMatchObject({ status: 'not_initialized' });
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
