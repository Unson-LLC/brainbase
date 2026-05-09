import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrainbasePortalRouter } from '../../../server/routes/brainbase/portal-routes.js';

describe('Brainbase Portal routes', () => {
  let app;
  let configParser;
  let nocodbService;
  let infoSSOTService;
  let wikiService;

  beforeEach(() => {
    configParser = {
      getAll: vi.fn().mockResolvedValue({
        projects: {
          projects: [
            { id: 'brainbase', name: 'Brainbase', archived: false, nocodb: { project_id: 'base-brainbase' } },
          ],
        },
      }),
    };

    nocodbService = {
      _fetchRecords: vi.fn(async (_baseId, tableName) => {
        if (tableName === 'ストーリー') {
          return [
            {
              Id: 10,
              'Story ID': 'C1-001',
              'タイトル': 'NocoDB projection title',
              '進捗率': 42,
              'ステータス': '進行中',
              '担当者': 'Operator K',
              '期限日': '2026-06-01',
            },
          ];
        }
        if (tableName === 'スプリント') return [];
        if (tableName === 'タスク') return [];
        if (tableName === '課題') return [];
        if (tableName === 'シップ') return [];
        return [];
      }),
      getProjectStats: vi.fn().mockResolvedValue({
        completionRate: 50,
        overdue: 0,
        blocked: 0,
        averageProgress: 42,
      }),
    };

    infoSSOTService = {
      listGraphEntities: vi.fn().mockResolvedValue([
        {
          id: 'story_c1001',
          entity_type: 'story',
          project_code: 'unson',
          payload: {
            story_id: 'C1-001',
            title: 'セッション切替 [MUST]',
            source: 'common/00_stories.md',
          },
        },
      ]),
      pool: null,
    };

    wikiService = {
      getPage: vi.fn(async (_access, pagePath) => {
        if (pagePath === 'brainbase/stories.md') {
          return {
            title: 'stories.md',
            content: [
              '```yaml',
              'story_id: C1-001',
              'horizon: quarter',
              'view: user',
              'name: Wiki side story detail',
              'status: draft',
              '```',
            ].join('\n'),
          };
        }
        return { error: 'not found' };
      }),
    };

    app = express();
    app.use(express.json());
    app.use('/api/brainbase', createBrainbasePortalRouter({
      configParser,
      nocodbService,
      infoSSOTService,
      wikiService,
    }));
  });

  it('Story MapはGraph storyを正本にしてNocoDB進捗を投影する', async () => {
    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(infoSSOTService.listGraphEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'gm',
        projectCodes: expect.arrayContaining(['brainbase', 'unson']),
      }),
      { projectCode: null, entityType: 'story' },
    );
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'graph',
      graphStoryCount: 1,
      wikiStoryCount: 1,
      projectionSource: 'nocodb',
    });
    expect(res.body.storyMap.stories).toHaveLength(1);
    expect(res.body.storyMap.stories[0]).toMatchObject({
      story_id: 'C1-001',
      name: 'セッション切替 [MUST]',
      source: 'graph',
      graphEntityId: 'story_c1001',
      graphProjectCode: 'unson',
      graphSource: 'common/00_stories.md',
      horizon: 'quarter',
      view: 'user',
      progress: 42,
      nocodbStatus: '進行中',
      assignee: 'Operator K',
    });
  });

  it('Graph storyが取得できない場合は従来どおりWiki storiesへfallbackする', async () => {
    infoSSOTService.listGraphEntities.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'wiki',
      graphStoryCount: 0,
      wikiStoryCount: 1,
    });
    expect(res.body.storyMap.stories[0]).toMatchObject({
      story_id: 'C1-001',
      name: 'Wiki side story detail',
      horizon: 'quarter',
      view: 'user',
      progress: 42,
    });
  });
});
