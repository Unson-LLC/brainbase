import { describe, expect, it, vi } from 'vitest';

// The world's modules import the kit by the path they are served at (two levels below it); here that
// path is the repository root, so it is pointed at the kit itself.
vi.mock('../../workspace-kit.js', () => import('../../ui/workspace-kit.js'));
import { projectWorldWork } from '../../src/world-extension.js';
import { workCityBlocks, workPickBlock, workSignText, workSiteBlocks } from '../../ui/world/world-work-rail.js';
import { FakeDocument, collectText, findAll, visibleText } from './graph-ui-harness.mjs';

const doc = new FakeDocument();
const NOW = new Date('2026-10-06T03:00:00.000Z');
const business = { id: 'hotel-sample', code: 'hotel-sample', name: 'Sample', summary: 'Hotel Sampleの支援', purpose: null };
const work = projectWorldWork({
  business,
  tasks: {
    state: 'complete',
    read_at: '2026-10-06T02:59:00.000Z',
    items: [
      { id: 't-video', title: '動画企画の企画書作成', status: 'waiting', waiting_on: '担当決定待ち', project_codes: ['hotel-sample'], assignee_person_id: null, source_refs: [], review_at: '2026-09-25T01:00:00.000Z', updated_at: '2026-09-18T08:00:00.000Z', created_at: '2026-08-17T00:00:00.000Z', description: '2026-09-18監査: 実担当は山田太郎（Graph ID: per_yamada）。' },
      { id: 't-done', title: '定例を開く', status: 'completed', project_codes: ['hotel-sample'], assignee_person_id: 'per_yamada', assignee_display_name: '山田 太郎', source_refs: [{ type: 'slack', url: 'https://example.test/1' }] },
    ],
  },
  persons: { state: 'complete', items: [{ id: 'per_yamada', payload: { name: '山田 太郎' } }] },
  decisions: { state: 'failed', reason: 'HTTP 502' },
  relations: { state: 'complete', items: [] },
  project: { members_state: 'unregistered' },
}, { now: NOW });

const titles = (blocks) => blocks.map((block) => block.attributes['aria-label']);

describe('world work rail: facts, then what cannot be seen, then people, then sources', () => {
  it('orders a city\'s blocks and lets a gap kind be picked', () => {
    const picked = [];
    const blocks = workCityBlocks(doc, { business, work, onSelectGap: (kind) => picked.push(kind) });
    expect(titles(blocks)).toEqual(['目的と方針', '仕事（記録上の状態）未完了 1件', '把握できていないこと（未完了1件のうち1件）', '人と関係', '出典と時点']);
    const text = blocks.map(visibleText).join('\n');
    expect(text).toContain('目的の欄は未登録です');
    expect(text).toContain('決定を読めなかったため、方針は分かりません。');
    expect(text).toContain('1件：「担当決定待ち」');
    expect(text).toContain('仕事が止まっていることは意味しません');
    expect(text).toContain('メンバーは未登録です');
    const gapButtons = findAll(blocks[2], (node) => node.tagName === 'BUTTON');
    expect(gapButtons.map((button) => button.textContent)).toEqual(['担当欄に未接続（本文に人物あり） 1件', '出典リンクなし 1件', '見直し予定を過ぎた（古い情報の可能性） 1件']);
    gapButtons[0].dispatch('click');
    expect(picked).toEqual(['assignee_unlinked_mentioned']);
  });

  it('never shows unreadable or unconnected work as zero', () => {
    const unreadable = workCityBlocks(doc, { business, work: { status: 'unavailable', reason: 'HTTP 502' }, onReload: () => {} }).map(collectText).join('');
    expect(unreadable).toContain('仕事の記録を読めません（HTTP 502）。仕事が0件という意味ではありません。');
    const notConnected = workCityBlocks(doc, { business, work: { status: 'not_connected', reason: 'task_store_not_connected' } }).map(collectText).join('');
    expect(notConnected).toContain('タスクの正本に接続していない');
    expect(workSignText({ state: 'failed' })).toBe('仕事を読めない');
    expect(workSignText({ state: 'not_connected' })).toBeNull();
    expect(workSignText({ state: 'complete', needs_check: [] })).toBeNull();
    expect(workSignText({ state: 'complete', needs_check: ['a', 'b'] })).toBe('要確認 2');
    // Read only in part: never a city without a sign.
    expect(workSignText({ state: 'partial', needs_check: [] })).toBe('一部だけ読めた');
    expect(workSignText({ state: 'partial', needs_check: ['a'] })).toBe('要確認 1（一部だけ読めた）');
  });

  it('says a real zero is a real zero, with its time', () => {
    const empty = projectWorldWork({ business, tasks: { state: 'complete', read_at: '2026-10-06T02:59:00.000Z', items: [] } }, { now: NOW });
    const text = workCityBlocks(doc, { business, work: empty }).map(collectText).join('');
    expect(text).toContain('この事業の仕事は0件です（10/6 11:59に読んだ実際の0件）。');
  });

  it('opens a site with its fact, what is unknown, its source and time, and what to check next', () => {
    const site = work.sites.find((entry) => entry.task_id === 't-video');
    const blocks = workSiteBlocks(doc, { business, site, readAt: work.reads.tasks.read_at, taskHref: (entry) => `?screen=tasks&task=${entry.task_id}` });
    const text = blocks.map(visibleText).join('\n');
    expect(text).toContain('分かっている事実本文は担当として「山田 太郎」を挙げています（人物IDつき）。担当欄は空です。');
    expect(text).toContain('出典と確認時点タスクの記録の assignee_person_id・description（10/6 11:59に読み込み）。確認時点：9/18（本文の確認メモ）');
    expect(text).toContain('次に確認すること担当欄に山田 太郎を接続できるか');
    expect(text).toContain('確認先山田 太郎');
    expect(text).toContain('山田 太郎本文が担当として記載（人物IDつき）・担当欄には未接続');
    const link = findAll(blocks.at(-2), (node) => node.tagName === 'A')[0];
    expect(link.attributes.href).toBe('?screen=tasks&task=t-video');
    // The original text is there, behind a disclosure.
    expect(blocks.map(collectText).join('')).toContain('2026-09-18監査');
    const withoutHost = workSiteBlocks(doc, { business, site, readAt: null }).map(collectText).join('');
    expect(withoutHost).toContain('この画面からは直せません');
  });

  it('lists the tasks behind a count to pick from', () => {
    const picked = [];
    const block = workPickBlock(doc, { title: '出典リンクなし 1件', sites: work.sites.filter((site) => site.work.open), onSelectSite: (id) => picked.push(id) });
    findAll(block, (node) => node.tagName === 'BUTTON')[0].dispatch('click');
    expect(picked).toEqual(['t-video']);
    expect(collectText(block)).toContain('記録上：待ち・断絶3種');
  });
});

describe('world work rail: a partial or failed read is said in words', () => {
  it('names a permission boundary and a failed read instead of counting zero', () => {
    const partial = projectWorldWork({ business, tasks: { state: 'partial', reason: 'codes_not_permitted', read_at: '2026-10-06T02:59:00.000Z', items: [] } }, { now: NOW });
    expect(workCityBlocks(doc, { business, work: partial }).map(collectText).join('')).toContain('一部だけ読めた（10/6 11:59）。案件の一部は、あなたのタスクの権限の範囲外のため読んでいません');
    const failed = projectWorldWork({ business, tasks: { state: 'failed', reason: 'upstream_timeout' } }, { now: NOW });
    const text = workCityBlocks(doc, { business, work: failed }).map(collectText).join('');
    expect(text).toContain('仕事の記録を読めなかった（時間内に応答がありませんでした）。仕事が0件という意味ではありません。');
    expect(text).not.toContain('未完了 null');
  });
});

describe('world work rail: zero read in part is not a real zero', () => {
  it('says the zero covers only what could be read', () => {
    const partial = projectWorldWork({ business, tasks: { state: 'partial', reason: 'codes_not_permitted', read_at: '2026-10-06T02:59:00.000Z', items: [] } }, { now: NOW });
    const text = workCityBlocks(doc, { business, work: partial }).map(collectText).join('');
    expect(text).toContain('読めた範囲では0件です。案件の一部は、あなたのタスクの権限の範囲外のため読んでいません。読めていない分は0件とは限りません。');
    expect(text).not.toContain('実際の0件');
  });
});

describe('world district legend: what each phenomenon means, and what means nothing', () => {
  it('names every gap as a street phenomenon and says the walkers and smoke come from no record', async () => {
    const { DISTRICT_LEGEND } = await import('../../ui/world/world-district.js');
    const text = DISTRICT_LEGEND.map(([, line]) => line).join('\n');
    for (const phrase of ['誰もいない現場＝担当の記録なし', '柵の外の人（破線の輪）＝本文にだけ名前がある', '通りへの道が無い＝出典リンクなし', '図面の看板だけ＝成果物の記録が未接続', '雑草と色あせ＝見直し予定を過ぎた']) {
      expect(text).toContain(phrase);
    }
    expect(DISTRICT_LEGEND.at(-1)[1]).toBe('通りを歩く人と煙＝街の雰囲気（記録とは関係しません）');
  });
});
