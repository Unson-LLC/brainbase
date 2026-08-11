import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildKnowledgeOwnerAudit,
  buildKnowledgeToolContent,
} from '../../src/tools/knowledge-owner-audit.js';

describe('knowledge owner audit', () => {
  it('records an actual Graph search with its real query', () => {
    assert.deepStrictEqual(
      buildKnowledgeOwnerAudit('search', { query: 'Judgment Resolver' }, '# Search Results (2 found)'),
      {
        schema_version: 'brainbase-knowledge-owner-audit-v1',
        source: 'Graph',
        operation: '検索',
        query: 'Judgment Resolver',
        outcome: '結果を取得',
        display_line: '📚 Brainbase検索: Graphで「Judgment Resolver」を検索 → 結果を取得 ✓',
      }
    );
  });

  it('does not count knowledge routing as an actual search', () => {
    assert.deepStrictEqual(
      buildKnowledgeOwnerAudit('brainbase_knowledge_resolve', { intent: 'find a decision' }, '{}'),
      null
    );
  });

  it('reports a completed no-result search without claiming absence', () => {
    assert.deepStrictEqual(
      buildKnowledgeOwnerAudit('search_personal_kg', { query: 'unknown principle' }, 'No personal KG entries found'),
      {
        schema_version: 'brainbase-knowledge-owner-audit-v1',
        source: 'Personal KG',
        operation: '検索',
        query: 'unknown principle',
        outcome: '該当なし（不在確定ではない）',
        display_line: '📚 Brainbase検索: Personal KGで「unknown principle」を検索 → 該当なし（不在確定ではない）',
      }
    );
    assert.equal(
      buildKnowledgeOwnerAudit('list_entities', { type: 'decision' }, '# decision entities (0)\n\n')?.outcome,
      '該当なし（不在確定ではない）',
    );
    assert.equal(
      buildKnowledgeOwnerAudit('resolve_entity', { query: 'unknown' }, '{"candidates":[]}')?.outcome,
      '該当なし（不在確定ではない）',
    );
  });

  it('records retrieval tools separately from searches', () => {
    assert.deepStrictEqual(
      buildKnowledgeOwnerAudit('get_entity', { type: 'decision', id: 'dec-123' }, '## Decision'),
      {
        schema_version: 'brainbase-knowledge-owner-audit-v1',
        source: 'Graph',
        operation: '取得',
        query: 'decision/dec-123',
        outcome: '結果を取得',
        display_line: '📚 Brainbase取得: Graphから「decision/dec-123」を取得 → 結果を取得 ✓',
      }
    );
    assert.equal(
      buildKnowledgeOwnerAudit('list_extension_entities', { type: 'contact' }, '# contacts')?.operation,
      '取得',
    );
    assert.equal(
      buildKnowledgeOwnerAudit('list_extension_entities', { type: 'contact', query: '佐藤' }, '# contacts')?.operation,
      '検索',
    );
  });

  it('appends exactly one audit block only when an actual retrieval ran', () => {
    const audit = buildKnowledgeOwnerAudit('search', { query: '公開方針' }, '1 result');

    assert.deepStrictEqual(buildKnowledgeToolContent('1 result', audit), [
      { type: 'text', text: '1 result' },
      {
        type: 'text',
        text: [
          'Brainbase retrieval audit: reproduce the next line exactly once in the next user-facing assistant message.',
          'Do not merge it with the turn-level Judgment audit and do not repeat it without another tool call.',
          '📚 Brainbase検索: Graphで「公開方針」を検索 → 結果を取得 ✓',
        ].join('\n'),
      },
    ]);
    assert.deepStrictEqual(buildKnowledgeToolContent('Graph route', null), [
      { type: 'text', text: 'Graph route' },
    ]);
  });
});
