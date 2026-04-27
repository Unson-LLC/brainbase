import { describe, expect, it, vi } from 'vitest';

import {
  buildGraphRequestHeaders,
  checkVibeProGraphSsot,
  normalizeGraphRecords,
} from '../../scripts/vibepro-graph-ssot-check.mjs';

describe('vibepro-graph-ssot-check', () => {
  it('Graph APIのrecords/entities両形式を正規化する', () => {
    expect(normalizeGraphRecords({ records: [{ id: 'frm_vibepro', payload: {} }] }, 'frame')).toEqual([
      expect.objectContaining({ entity_id: 'frm_vibepro', entity_type: 'frame', payload: {} }),
    ]);
    expect(normalizeGraphRecords({ entities: [{ entity_id: 'dec_1', entity_type: 'decision', payload: {} }] }, 'decision')).toEqual([
      expect.objectContaining({ entity_id: 'dec_1', entity_type: 'decision', payload: {} }),
    ]);
  });

  it('Graph API tokenとbrainbase権限ヘッダーを組み立てる', () => {
    expect(buildGraphRequestHeaders('token-1')).toMatchObject({
      Authorization: 'Bearer token-1',
      'x-brainbase-role': 'gm',
      'x-brainbase-projects': 'brainbase',
    });
  });

  it('VibeProに必要なGraph SSOT entityとphilosophy contextを検証する', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const parsedUrl = new URL(url);
      const type = parsedUrl.searchParams.get('type');

      if (parsedUrl.pathname === '/api/info/context') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            philosophy_context: {
              prompt_block: 'Brainbase Philosophy Context\nScope: automation',
            },
          }),
        };
      }

      const recordsByType = {
        frame: [
          {
            id: 'frm_vibepro',
            payload: {
              code: 'frm_vibepro',
              name: 'VibePro operating philosophy',
            },
          },
        ],
        glossary_term: [
          { id: 'term_1', payload: { term: '本番化ギャップ捕捉率' } },
          { id: 'term_2', payload: { term: '本番化ギャップ的中率' } },
          { id: 'term_3', payload: { term: 'ゲート違反流出率' } },
          { id: 'term_4', payload: { term: '開発DAG合致率' } },
          { id: 'term_5', payload: { term: '証跡欠落率' } },
          { id: 'term_6', payload: { term: 'ゲート前進違反率' } },
          { id: 'term_7', payload: { term: '残リスク回収率' } },
          { id: 'term_8', payload: { term: 'Story-to-Ship閉鎖率' } },
        ],
        decision: [
          {
            id: 'dec_vibepro_ai_self_evaluation_metrics_japanese_ssot',
            payload: {
              title: 'VibePro AI self-evaluation metrics Japanese SSOT',
            },
          },
        ],
      };

      return {
        ok: true,
        status: 200,
        json: async () => ({ records: recordsByType[type] ?? [] }),
      };
    });

    const result = await checkVibeProGraphSsot({
      baseUrl: 'https://bb.unson.jp',
      token: 'token-1',
      fetchImpl,
    });

    expect(result.status).toBe('passed');
    expect(result.checks.map((check) => check.id)).toEqual([
      'graph.philosophy_context.automation',
      'graph.frame.frm_vibepro',
      'graph.glossary.self_evaluation_metrics_japanese',
      'graph.decision.vibepro_metrics_ssot',
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
