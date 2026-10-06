import { describe, expect, it } from 'vitest';
import { projectWorldWork, summarizeWorldWork, WORLD_WORK_GAP_KINDS } from '../src/world-extension.js';
// @ts-expect-error plain browser module without type declarations
import { districtChanges, districtSnapshot, districtStage, districtStreetLots } from '../ui/world/world-placement.js';

// Fictional records in the shapes the Task API and the organization Graph return.
const NOW = new Date('2026-10-06T03:00:00.000Z');
const HOTEL = { id: 'hotel-sample-marketing', code: 'hotel-sample-marketing', name: 'Sample', summary: 'Hotel Sampleのマーケティング支援', purpose: null, aliases: ['Hotel Sample marketing'], engagement_codes: [] };
const PARENT = { id: 'prj_parent', code: 'parent-co', name: 'Parent Co', engagement_codes: ['parent-phase1'], record_ids: ['prj_parent'] };

const task = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  version: 3,
  title: `仕事 ${id}`,
  description: null,
  status: 'waiting',
  priority: 'medium',
  project_codes: [HOTEL.code],
  assignee_person_id: null,
  assignee_display_name: null,
  due_at: '2026-09-25T14:59:59.000Z',
  waiting_on: '担当者・期限の根拠が確認できないため担当決定待ち。',
  review_at: '2026-09-25T01:00:00.000Z',
  completed_at: null,
  source_refs: [],
  created_at: '2026-08-17T23:27:13.646Z',
  updated_at: '2026-09-18T08:20:16.057Z',
  web_url: `https://example.test/tasks/${id}`,
  ...fields,
});

const persons = {
  state: 'complete' as const,
  items: [
    { id: 'per_01SAMPLEYAMADA', entity_type: 'person', payload: { name: '山田 太郎' } },
    { id: 'per_owner', entity_type: 'person', payload: { name: '鈴木 一郎' } },
    { id: 'per_short', entity_type: 'person', payload: { name: '森' } },
    { id: 'per_takagi_a', entity_type: 'person', payload: { name: '髙木 健', aliases: ['高木さん'] } },
    { id: 'per_takagi_b', entity_type: 'person', payload: { name: '高木 健', aliases: ['高木さん'] } },
  ],
};

const tasks = {
  state: 'complete' as const,
  read_at: '2026-10-06T02:59:00.000Z',
  items: [
    task('t-video', { title: '動画企画の企画書作成', description: 'YK（山田）が企画書を作成する。\n\n2026-09-18監査: 実担当は山田太郎（Graph ID: per_01SAMPLEYAMADA）。ただしTask APIが当該Personをnot_foundとして拒否したため担当欄は未反映。' }),
    task('t-clean', { title: '清掃管理の比較案を持参する', purpose_label: '  清掃の運営支援 ', description: '2026-09-18監査: 比較表と持参記録は確認できなかった。完了条件: 3〜4案それぞれの範囲・概算費用・比較軸を含む資料＋ミーティングで提示した記録' }),
    task('t-renew', { title: '継続提案の設計', description: '[2026-09-18確認] 提案確定・提示・先方合意の直接証拠はない。森の資料を参照。waitingを維持し2026-09-25再確認。' }),
    task('t-fee', { title: '保守料の引き上げを打診', description: '高木さんへ保守料引き上げを打診する。' }),
    task('t-minutes', { status: 'pending', due_at: null, review_at: null, updated_at: '2026-10-03T00:00:00.000Z', source_refs: [{ type: 'meeting_minutes', minutes_url: 'https://example.test/minutes/1' }], description: '調査結果を共有する。' }),
    task('t-done', { status: 'completed', completed_at: '2026-08-23T00:00:00.000Z', assignee_person_id: 'per_owner', assignee_display_name: '鈴木 一郎', source_refs: [{ type: 'slack', url: 'https://example.test/slack/1' }] }),
    task('t-cancel', { status: 'cancelled' }),
    task('t-shared', { project_codes: [HOTEL.code, 'parent-phase1'], assignee_person_id: 'per_owner', assignee_display_name: '鈴木 一郎', review_at: '2026-10-20T00:00:00.000Z', source_refs: [{ type: 'slack', url: 'https://example.test/slack/2' }] }),
    task('t-other', { project_codes: ['parent-co'] }),
  ],
};

const decisions = {
  state: 'complete' as const,
  items: [
    { id: 'dec_policy', project_code: 'parent-co', payload: { title: 'ホテルサンプルのマーケはGoogleマップ強化を優先', decided_at: '2026-05-29T14:00:00+09:00' } },
    { id: 'dec_named', project_code: 'parent-co', payload: { title: 'Sample案件の追加要望は確認へ回す', decided_at: '2026-05-22T23:50:00+09:00' } },
    { id: 'dec_unrelated', project_code: 'parent-co', payload: { title: '経費の締めは月末', decided_at: '2026-09-01T00:00:00+09:00' } },
  ],
};

const relations = {
  state: 'complete' as const,
  items: [
    { id: 'edg_engagement', relation: 'has_engagement', direction: 'incoming', counterpart: { id: 'prj_parent', type: 'project', name: 'Parent Co' } },
    { id: 'edg_raci', relation: 'belongs_to_project', direction: 'incoming', counterpart: { id: 'rac_1', type: 'raci_assignment', name: 'decision:最終決裁' } },
  ],
};

const project = {
  owner: { person_id: 'per_owner', name: '鈴木 一郎' },
  members_state: 'unregistered' as const,
  source_decision_ids: ['dec_policy'],
  term_aliases: [{ term: 'HOTEL SAMPLE', alias: 'ホテルサンプル' }],
};

const work = () => projectWorldWork({ business: HOTEL, tasks, persons, decisions, relations, project, neighbours: [PARENT] }, { now: NOW });

describe('world work: what is recorded and what we cannot see are kept apart', () => {
  it('names a person the text gives, without recording them as the assignee', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    const site = result.sites.find((entry) => entry.task_id === 't-video')!;
    expect(site.work).toMatchObject({ status: 'waiting', label: '待ち', open: true, waiting_on: '担当者・期限の根拠が確認できないため担当決定待ち。' });
    expect(site.people).toEqual([{ person_id: 'per_01SAMPLEYAMADA', name: '山田 太郎', link: 'inferred', basis: 'text_person_id', stated_as_assignee: true }]);
    const gap = site.gaps.find((entry) => entry.kind === 'assignee_unlinked_mentioned')!;
    expect(gap.fact).toBe('本文は担当として「山田 太郎」を挙げています（人物IDつき）。担当欄は空です。');
    expect(gap.check_with).toEqual({ person_id: 'per_01SAMPLEYAMADA', name: '山田 太郎' });
    expect(gap.source).toEqual({ system: 'task_api', record_id: 't-video', fields: ['assignee_person_id', 'description'] });
    expect(gap.checked_at).toBe('2026-09-18');
    expect(site.gaps.map((entry) => entry.kind)).not.toContain('assignee_unrecorded');
  });

  it('leaves a name shared by several people undecided instead of picking one', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    const site = result.sites.find((entry) => entry.task_id === 't-fee')!;
    expect(site.people).toEqual([]);
    expect(site.ambiguous_mentions).toEqual([{ text: '高木さん', candidates: [{ person_id: 'per_takagi_a', name: '髙木 健' }, { person_id: 'per_takagi_b', name: '高木 健' }] }]);
    const gap = site.gaps.find((entry) => entry.kind === 'assignee_unlinked_mentioned')!;
    expect(gap.fact).toContain('一意に決まらない');
    expect(gap.check_with).toBeNull();
  });

  it('says an empty assignee field is not knowing who, never that nobody does the work', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    const gap = result.sites.find((entry) => entry.task_id === 't-renew')!.gaps.find((entry) => entry.kind === 'assignee_unrecorded')!;
    expect(gap.unknown).toContain('担当者がいないとは限りません');
    expect(gap.check_with).toBeNull();
    // A two-character name in the text is not taken as a person.
    expect(result.sites.find((entry) => entry.task_id === 't-renew')!.people).toEqual([]);
  });

  it('separates a stated completion condition without evidence from a task that has no source link', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    const clean = result.sites.find((entry) => entry.task_id === 't-clean')!;
    expect(clean.expected_outcome).toBe('3〜4案それぞれの範囲・概算費用・比較軸を含む資料＋ミーティングで提示した記録');
    expect(clean.gaps.map((entry) => entry.kind)).toEqual(['assignee_unrecorded', 'outcome_unlinked', 'review_overdue']);
    expect(clean.gaps.find((entry) => entry.kind === 'outcome_unlinked')!.unknown).toContain('止まっているとは限りません');
    const renew = result.sites.find((entry) => entry.task_id === 't-renew')!;
    expect(renew.gaps.map((entry) => entry.kind)).toContain('source_unlinked');
    // 「2026-09-25再確認」 is a planned re-check, not a check that was made.
    expect(renew.audit_notes).toEqual([{ date: '2026-09-18', text: '確認' }]);
    expect(renew.gaps[0]!.checked_at).toBe('2026-09-18');
  });

  it('marks a passed review date as possibly stale information, not as stopped work', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    const gap = result.sites.find((entry) => entry.task_id === 't-renew')!.gaps.find((entry) => entry.kind === 'review_overdue')!;
    expect(gap.fact).toBe('見直し予定（9/25）を過ぎています。記録の最終更新は9/18です。');
    expect(gap.unknown).toContain('古い可能性');
    // Closed work has no stale state, and a cancelled task raises no gaps.
    expect(result.sites.find((entry) => entry.task_id === 't-cancel')!.gaps).toEqual([]);
    expect(result.sites.find((entry) => entry.task_id === 't-shared')!.gaps).toEqual([]);
  });

  it('keeps only this business\'s tasks and records the ones that cross into another business', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.sites.map((entry) => entry.task_id)).not.toContain('t-other');
    expect(result.sites.find((entry) => entry.task_id === 't-shared')!.other_business_codes).toEqual(['parent-co']);
    const crossing = result.relations.find((entry) => entry.kind === 'shared_task')!;
    expect(crossing).toMatchObject({ link: 'recorded', business_code: 'parent-co', task_ids: ['t-shared'] });
  });

  it('keeps recorded, inferred and unreadable relations apart', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.relations.find((entry) => entry.kind === 'has_engagement')).toMatchObject({ link: 'recorded', business_code: 'parent-co', label: 'Parent Co が Sample を案件として持つ' });
    expect(result.relations.find((entry) => entry.kind === 'mentioned_person')).toMatchObject({ link: 'inferred', task_ids: ['t-video'] });
    expect(result.purpose).toMatchObject({ state: 'unregistered', summary: 'Hotel Sampleのマーケティング支援' });
    expect(result.purpose.policies.map((policy) => [policy.decision_id, policy.link])).toEqual([['dec_policy', 'recorded'], ['dec_named', 'inferred']]);
    expect(result.purpose.policies[1]!.basis).toContain('事業名「Sample」');
    const unreadable = projectWorldWork({ business: HOTEL, tasks, persons, relations: { state: 'failed', reason: 'HTTP 502' } }, { now: NOW });
    if (unreadable.status !== 'ok') throw new Error(unreadable.status);
    expect(unreadable.relations.filter((entry) => entry.link === 'unreadable')).toEqual([expect.objectContaining({ label: 'Graphの関係を読めませんでした', basis: 'HTTP 502' })]);
  });

  it('lists people by how they are known: recorded roles, assignee fields, and the text', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ person_id: 'per_owner', link: 'recorded', roles: expect.arrayContaining(['責任者（プロジェクトの記録）', '仕事の担当（担当欄）']) }),
      expect.objectContaining({ person_id: 'per_01SAMPLEYAMADA', link: 'inferred', task_ids: ['t-video'] }),
    ]));
    expect(result.members_state).toBe('unregistered');
  });

  it('does not match people when the people could not be read, and says so', () => {
    const result = projectWorldWork({ business: HOTEL, tasks, persons: { state: 'forbidden', reason: 'HTTP 403' } }, { now: NOW });
    if (result.status !== 'ok') throw new Error(result.status);
    const site = result.sites.find((entry) => entry.task_id === 't-video')!;
    expect(site.people).toEqual([]);
    expect(site.gaps.find((entry) => entry.kind === 'assignee_unrecorded')!.fact).toContain('照合できていません');
    expect(result.reads.persons).toEqual({ state: 'forbidden', reason: 'HTTP 403' });
  });
});

describe('world work summary: counts with the tasks behind them, and unreadable is not zero', () => {
  it('counts open work by recorded status and lists, for each gap, the open tasks that show it', () => {
    const summary = summarizeWorldWork({ businesses: [HOTEL, PARENT], tasks: { [HOTEL.code]: tasks, [PARENT.code]: { state: 'failed', reason: 'upstream_unavailable' } }, persons }, { now: NOW });
    const hotel = summary[HOTEL.code]!;
    expect(hotel).toMatchObject({ state: 'complete', open: 6, total: 8, by_status: { waiting: 5, pending: 1, completed: 1, cancelled: 1 } });
    expect(hotel.gaps).toEqual({
      assignee_unlinked_mentioned: ['t-fee', 't-video'],
      assignee_unrecorded: ['t-clean', 't-minutes', 't-renew'],
      outcome_unlinked: ['t-clean'],
      source_unlinked: ['t-fee', 't-renew', 't-video'],
      review_overdue: ['t-clean', 't-fee', 't-renew', 't-video'],
    });
    expect(hotel.needs_check).toEqual(['t-clean', 't-fee', 't-minutes', 't-renew', 't-video']);
    // The other business could not be read: a state with its reason, never zero.
    expect(summary[PARENT.code]).toEqual({ business_code: 'parent-co', state: 'failed', read_at: null, reason: 'upstream_unavailable', open: null, total: null, by_status: null, gaps: null, needs_check: null });
  });

  it('tells a real zero from not connected', () => {
    const summary = summarizeWorldWork({ businesses: [HOTEL, PARENT], tasks: { [HOTEL.code]: { state: 'complete', read_at: '2026-10-06T00:00:00.000Z', items: [] } } }, { now: NOW });
    expect(summary[HOTEL.code]).toMatchObject({ state: 'complete', open: 0, total: 0, needs_check: [] });
    expect(summary[PARENT.code]).toMatchObject({ state: 'not_connected', open: null });
    expect(WORLD_WORK_GAP_KINDS).toHaveLength(5);
  });
});

describe('world work lots stay where they are', () => {
  it('places each task on a lot by its id, oldest first, so a new task or a new state never moves an older one', () => {
    const sites = Array.from({ length: 29 }, (_, index) => ({ task_id: `task-${index}`, created_at: `2026-09-${String(1 + index).padStart(2, '0')}` }));
    const before = districtStreetLots(sites);
    const after = districtStreetLots([...sites, { task_id: 'task-new', created_at: '2026-10-05' }]);
    expect(after.rows).toBe(before.rows);
    for (const site of sites) expect(after.lots[site.task_id]).toEqual(before.lots[site.task_id]);
    expect(new Set(Object.values(before.lots).map((lot: { x: number; z: number }) => `${lot.x},${lot.z}`)).size).toBe(29);
    // Reading the same tasks in another order gives the same lots.
    expect(districtStreetLots([...sites].reverse()).lots).toEqual(before.lots);
    // Every lot faces a street: the main street (|x| = 4) or a back street (|x| = 10).
    for (const lot of Object.values(before.lots) as { x: number; facing: number }[]) {
      expect([4, 10]).toContain(Math.abs(lot.x));
      expect(lot.facing).toBe(lot.x < 0 ? 1 : -1);
    }
  });
});

describe('what the work is for decides its street', () => {
  it('carries the label the task record states, and none when it states none', () => {
    const result = work();
    if (result.status !== 'ok') throw new Error(result.status);
    expect(result.sites.find((entry) => entry.task_id === 't-clean')!.purpose_label).toBe('清掃の運営支援');
    expect(result.sites.find((entry) => entry.task_id === 't-video')!.purpose_label).toBeNull();
  });

  it('puts work with the same label in one block, the unlabelled last, and a new task moves no older one', () => {
    const sites = [
      { task_id: 'a1', created_at: '2026-08-17', purpose_label: 'Googleマップ強化' },
      { task_id: 'b1', created_at: '2026-08-10', purpose_label: '定例会議' },
      { task_id: 'a2', created_at: '2026-09-08', purpose_label: 'Googleマップ強化' },
      { task_id: 'n1', created_at: '2026-08-01', purpose_label: null },
      { task_id: 'a3', created_at: '2026-09-09', purpose_label: ' Googleマップ強化 ' },
      { task_id: 'b2', created_at: '2026-09-14', purpose_label: '定例会議' },
    ];
    const before = districtStreetLots(sites);
    // Blocks run from the hall (-z) in the order of their oldest task; the unlabelled stand last, by the gate.
    expect(before.streets.map((street: { label: string | null; count: number }) => [street.label, street.count])).toEqual([
      ['定例会議', 2],
      ['Googleマップ強化', 3],
      [null, 1],
    ]);
    for (const site of sites) {
      const street = before.streets.find((entry: { key: string }) => entry.key === before.lots[site.task_id].street);
      expect(before.lots[site.task_id].z).toBeGreaterThan(street.z_from);
      expect(before.lots[site.task_id].z).toBeLessThan(street.z_to);
    }
    expect(before.lots.b1.street).toBe(before.lots.b2.street);
    expect(before.lots.a1.street).not.toBe(before.lots.b1.street);
    // A new task with a label that already has room takes the next lot and moves nothing.
    const after = districtStreetLots([...sites, { task_id: 'a4', created_at: '2026-10-01', purpose_label: 'Googleマップ強化' }]);
    for (const site of sites) expect(after.lots[site.task_id]).toEqual(before.lots[site.task_id]);
    expect(after.lots.a4.street).toBe(before.lots.a1.street);
  });
});

describe('the town grows from evidenced outcomes and closed gaps, not from activity', () => {
  const site = (id: string, status: string, gaps: string[] = [], refs = 0, label: string | null = null) => ({
    task_id: id,
    purpose_label: label,
    work: { status, open: ['pending', 'in_progress', 'waiting'].includes(status) },
    gaps: gaps.map((kind) => ({ kind })),
    source_refs: Array.from({ length: refs }, () => ({ type: 'slack', url: 'https://example.test', label: 'x' })),
  });

  it('says it is the first visit when nothing was kept, and remembers the town without cancelled work', () => {
    const sites = [site('a', 'waiting', ['source_unlinked']), site('z', 'cancelled')];
    expect(districtChanges(null, sites, '2026-10-06T10:00:00Z')).toMatchObject({ first: true, items: [] });
    expect(districtChanges({ v: 99 }, sites, '2026-10-06T10:00:00Z').first).toBe(true);
    const snap = districtSnapshot(sites, '2026-10-06T10:00:00Z');
    expect(Object.keys(snap.sites)).toEqual(['a']);
    expect(snap.sites.a).toEqual({ s: 'waiting', g: ['source_unlinked'], l: null, e: false });
  });

  it('names what changed since the last visit, in the words of the street', () => {
    const before = districtSnapshot([
      site('built', 'in_progress', ['assignee_unrecorded']),
      site('proof', 'completed', ['source_unlinked']),
      site('start', 'pending'),
      site('hold', 'in_progress'),
      site('fix', 'waiting', ['assignee_unrecorded', 'source_unlinked', 'review_overdue']),
      site('gone', 'waiting'),
      site('stale', 'waiting'),
    ], '2026-10-05T10:00:00Z');
    const now = [
      site('built', 'completed', ['assignee_unrecorded']),
      site('proof', 'completed', [], 1),
      site('start', 'in_progress'),
      site('hold', 'waiting'),
      site('fix', 'waiting', [], 1),
      site('stale', 'waiting', ['review_overdue']),
      site('fresh', 'pending'),
    ];
    const changes = districtChanges(before, now, '2026-10-06T10:00:00Z');
    expect(changes.first).toBe(false);
    expect(changes.since).toBe('2026-10-05T10:00:00Z');
    const kinds = (id: string) => changes.items.filter((item: { task_id: string }) => item.task_id === id).map((item: { kind: string }) => item.kind).sort();
    expect(kinds('built')).toEqual(['built']);
    expect(kinds('proof')).toEqual(['evidenced', 'path_linked']);
    expect(kinds('start')).toEqual(['started']);
    expect(kinds('hold')).toEqual(['held']);
    expect(kinds('fix')).toEqual(['path_linked', 'weeds_cleared', 'worker_in']);
    expect(kinds('stale')).toEqual(['weeds_grew']);
    expect(kinds('fresh')).toEqual(['new']);
    expect(kinds('gone')).toEqual(['left']);
    expect(changes.counts).toMatchObject({ built: 1, path_linked: 2, worker_in: 1, new: 1, left: 1 });
    // Nothing that did not change is named.
    expect(districtChanges(districtSnapshot(now, 'x'), now, 'y').items).toEqual([]);
  });

  it('counts only completed work with a record of its source as a building, and stages the district by them', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => site(`p${i}`, 'completed', [], 1));
    expect(districtStage([site('a', 'completed'), site('b', 'waiting', ['source_unlinked']), site('c', 'pending')])).toMatchObject({
      key: 'vacant', label: '更地', permanent: 0, prefab: 1, open: 2, clear_open: 1, next: { label: '村', needed: 1 },
    });
    expect(districtStage(many(1)).key).toBe('village');
    expect(districtStage(many(3)).key).toBe('town');
    expect(districtStage(many(7)).key).toBe('street');
    expect(districtStage(many(15))).toMatchObject({ key: 'city', next: null });
    // Splitting work does not grow the town: completions without a record stay prefabs.
    expect(districtStage(Array.from({ length: 40 }, (_, i) => site(`q${i}`, 'completed'))).key).toBe('vacant');
  });
});
