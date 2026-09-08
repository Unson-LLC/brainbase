import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildKnowledgeOwnerAudit,
  buildKnowledgeToolContent,
} from '../../src/tools/knowledge-owner-audit.js';
import { __testing as serverTesting } from '../../src/server.js';

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

  it('audits public structured retrievals and distinguishes confirmed empty results', () => {
    assert.equal(
      buildKnowledgeOwnerAudit(
        'brainbase_projects',
        {},
        JSON.stringify({ status: 'ok', data: { projects: [], count: 0 } }),
      )?.display_line,
      '📚 Brainbase取得: Brainbaseから「プロジェクト一覧」を取得 → 該当なし（不在確定ではない）',
    );
    assert.equal(
      buildKnowledgeOwnerAudit(
        'brainbase_onboarding_get',
        { run_id: 'run-204' },
        JSON.stringify({ status: 'ok', data: null }),
      )?.outcome,
      '該当なし（不在確定ではない）',
    );
    assert.equal(
      buildKnowledgeOwnerAudit(
        'graph_validate',
        { project_code: 'brainbase' },
        JSON.stringify({ status: 'ok', data: { valid: true } }),
      )?.outcome,
      '結果を取得',
    );
  });

  it('does not claim successful retrieval for structured failures', () => {
    for (const status of ['error', 'unavailable', 'partial', 'failed', 'failure', 'unknown']) {
      const result = JSON.stringify({
        status,
        error: { code: `brainbase_api_${status}` },
      });

      assert.equal(
        buildKnowledgeOwnerAudit('brainbase_onboarding_get', { run_id: 'run-failed' }, result),
        null,
      );
      const content = serverTesting.buildToolResponseContent(
        'brainbase_onboarding_get',
        { run_id: 'run-failed' },
        result,
      );
      assert.deepStrictEqual(content, [{ type: 'text', text: result }]);
      assert.doesNotMatch(JSON.stringify(content), /結果を取得 ✓/u);
    }
  });

  it('does not claim successful retrieval for partial meeting context', () => {
    const result = JSON.stringify({
      status: 'partial',
      receipt: {
        receipt_id: 'receipt-partial',
        status: 'partial',
      },
    });

    assert.equal(
      buildKnowledgeOwnerAudit(
        'brainbase_get_meeting_minutes_context',
        { run_id: 'run-partial' },
        result,
      ),
      null,
    );
    const content = serverTesting.buildToolResponseContent(
      'brainbase_get_meeting_minutes_context',
      { run_id: 'run-partial' },
      result,
    );
    assert.deepStrictEqual(content, [{ type: 'text', text: result }]);
    assert.doesNotMatch(JSON.stringify(content), /結果を取得 ✓/u);
  });

  it('appends machine-readable audit metadata without instructing the model to reproduce owner output', () => {
    const audit = buildKnowledgeOwnerAudit('search', { query: '公開方針' }, '1 result');

    assert.deepStrictEqual(buildKnowledgeToolContent('1 result', audit), [
      { type: 'text', text: '1 result' },
      {
        type: 'text',
        text: '<!-- brainbase-knowledge-owner-audit:{"schema_version":"brainbase-knowledge-owner-audit-v1","operation":"検索","outcome":"結果を取得"} -->',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(buildKnowledgeToolContent('1 result', audit)), /reproduce|user-facing assistant message/u);
    assert.deepStrictEqual(buildKnowledgeToolContent('Graph route', null), [
      { type: 'text', text: 'Graph route' },
    ]);
  });

  it('wraps a public structured retrieval in the MCP content envelope consumed by the Host', () => {
    const content = serverTesting.buildToolResponseContent(
      'brainbase_onboarding_get',
      { run_id: 'run-204' },
      JSON.stringify({ status: 'ok', data: null }),
    );
    assert.equal(content.length, 2);
    assert.equal(content[0]?.text, '{"status":"ok","data":null}');
    assert.equal(
      content[1]?.text,
      '<!-- brainbase-knowledge-owner-audit:{"schema_version":"brainbase-knowledge-owner-audit-v1","operation":"取得","outcome":"該当なし（不在確定ではない）"} -->',
    );
  });
});
