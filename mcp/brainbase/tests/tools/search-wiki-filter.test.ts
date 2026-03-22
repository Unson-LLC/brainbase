/**
 * search_wiki project_id filter test
 * STR-001: Wiki検索結果にページのproject_idフィルタを追加
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { filterWikiPages } from '../../src/tools/wiki-search.js';

const samplePages = [
  { path: 'projects/brainbase/setup', title: 'Setup Guide', project_id: 'brainbase' },
  { path: 'projects/brainbase/api', title: 'API Reference', project_id: 'brainbase' },
  { path: 'projects/salestailor/strategy', title: 'Sales Strategy', project_id: 'salestailor' },
  { path: '_common/glossary', title: 'Glossary', project_id: null },
];

describe('filterWikiPages', () => {
  it('query のみ指定時_全プロジェクトから検索結果が返される', () => {
    const result = filterWikiPages(samplePages, 'guide');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'projects/brainbase/setup');
  });

  it('query + project_id 指定時_該当プロジェクトのページのみ返される', () => {
    const result = filterWikiPages(samplePages, 'strategy', 'salestailor');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].project_id, 'salestailor');
  });

  it('project_id 指定時_他プロジェクトのページは除外される', () => {
    const result = filterWikiPages(samplePages, 'a', 'brainbase');
    // 'a' matches 'API Reference' (brainbase) and 'Sales Strategy' (salestailor)
    // but project_id filter should exclude salestailor
    assert.ok(result.every(p => p.project_id === 'brainbase'));
  });

  it('存在しない project_id 指定時_空配列が返される', () => {
    const result = filterWikiPages(samplePages, 'setup', 'nonexistent');
    assert.strictEqual(result.length, 0);
  });

  it('project_id 未指定時_既存動作と同じ（後方互換）', () => {
    const withoutFilter = filterWikiPages(samplePages, 'a');
    const withUndefined = filterWikiPages(samplePages, 'a', undefined);
    assert.deepStrictEqual(withoutFilter, withUndefined);
  });
});
