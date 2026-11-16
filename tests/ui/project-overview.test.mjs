import { describe, expect, it, vi } from 'vitest';
import { normalizeProjectOverview, renderProjectOverview } from '../../ui/project-overview.js';
import { buttonsNamed, collectText, findAll, section, FakeDocument } from './graph-ui-harness.mjs';

const overview = {
  about: {
    definition: '利用者が確認できるサービスの定義',
    owner: '責任者の記録',
    finalApprover: '最終決裁者の記録',
    goal: null,
    source: '正本Graph',
    asOf: '2026-10-01T09:00:00.000Z',
  },
  checks: [{ id: 'check-1', title: '仕様の正本を確認', summary: '確認理由', recordId: 'record-check-1' }],
  directMaterials: {
    state: 'partial',
    total: 3,
    note: '本文はまだ取得していません。',
    items: [{
      id: 'doc-direct-1',
      title: '直接資料',
      relation: '直接紐づく',
      source: 'Graph',
      bodyState: 'unretrieved',
      contentAsOf: '2026-09-20',
      updatedAt: '2026-10-01T08:00:00.000Z',
    }],
  },
  relatedMaterials: {
    state: 'unknown',
    items: [],
  },
};

describe('project overview projection', () => {
  it('renders the host contract in context-to-evidence order', () => {
    const openGraphEntity = vi.fn();
    const root = renderProjectOverview(new FakeDocument(), overview, {
      projectName: '案件 <script>',
      actions: { openGraphEntity },
    });

    expect(findAll(root, (node) => node.tagName === 'SECTION').map((node) => node.attributes['aria-label'])).toEqual([
      'このプロジェクトについて',
      '次に確認すること',
      '案件 <script>に直接紐づく資料',
      '関連資料',
    ]);
    expect(collectText(section(root, 'このプロジェクトについて'))).toContain('現在の目標未確認');
    expect(collectText(section(root, '案件 <script>に直接紐づく資料'))).toContain('直接資料');
    expect(collectText(section(root, '案件 <script>に直接紐づく資料'))).toContain('本文未取得');
    expect(collectText(section(root, '案件 <script>に直接紐づく資料'))).toContain('総数 3件');
    expect(collectText(section(root, '関連資料'))).toContain('未確認');
    expect(collectText(root)).toContain('案件 <script>');
    expect(findAll(root, (node) => node.tagName === 'SCRIPT')).toHaveLength(0);

    buttonsNamed(root, '直接資料')[0].dispatch('click');
    expect(openGraphEntity).toHaveBeenCalledWith('doc-direct-1');
    buttonsNamed(root, '仕様の正本を確認')[0].dispatch('click');
    expect(openGraphEntity).toHaveBeenCalledWith('record-check-1');
  });

  it('keeps an explicit confirmed empty result distinct from unknown', () => {
    const normalized = normalizeProjectOverview({
      directMaterials: { state: 'ok', total: 0, items: [] },
      relatedMaterials: { state: 'unknown', items: [] },
    });
    const root = renderProjectOverview(new FakeDocument(), normalized, { projectName: '空の例' });
    const direct = section(root, '空の例に直接紐づく資料');
    const related = section(root, '関連資料');
    expect(collectText(direct)).toContain('確認済み 0件');
    expect(collectText(direct)).toContain('確認済みの資料はありません。');
    expect(collectText(related)).toContain('未確認');
    expect(collectText(related)).not.toContain('0件');
  });

  it('does not treat a host check id as a Graph detail id', () => {
    const root = renderProjectOverview(new FakeDocument(), {
      checks: [{ id: 'missing-goal', title: '目標を確認' }],
    });

    expect(buttonsNamed(root, '目標を確認')).toHaveLength(0);
    expect(collectText(section(root, '次に確認すること'))).toContain('目標を確認');
  });

  it('does not collapse content time and record update time', () => {
    const root = renderProjectOverview(new FakeDocument(), {
      directMaterials: {
        state: 'ok',
        total: 1,
        items: [{ id: 'doc-1', title: '資料', contentAsOf: '2025-01-02T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z' }],
      },
      relatedMaterials: { state: 'ok', total: 0, items: [] },
    });
    const text = collectText(section(root, 'プロジェクトに直接紐づく資料'));
    expect(text).toContain('2025-01-02');
    expect(text).toContain('2026-02-03');
  });
});
