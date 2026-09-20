import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrainbasePortalRouter } from '../../../server/routes/brainbase/portal-routes.js';

describe('Brainbase Portal routes', () => {
  let app;
  let configParser;
  let nocodbService;
  let infoSSOTService;

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
            status: 'active',
            criteria: [{ type: 'commit', description: 'Graph acceptance condition' }],
            source: 'common/00_stories.md',
          },
        },
      ]),
      pool: null,
    };

    app = express();
    app.use(express.json());
    app.use('/api/brainbase', createBrainbasePortalRouter({
      configParser,
      nocodbService,
      infoSSOTService,
    }));
  });

  it('Story MapはGraph storyを正本にしてNocoDB進捗を投影しない', async () => {
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
      wikiStoryCount: null,
      projectionSource: null,
    });
    expect(res.body.storyMap.stories).toHaveLength(1);
    expect(res.body.storyMap.stories[0]).toMatchObject({
      story_id: 'C1-001',
      name: 'セッション切替 [MUST]',
      source: 'graph',
      graphEntityId: 'story_c1001',
      graphProjectCode: 'unson',
      graphSource: 'common/00_stories.md',
      horizon: '',
      view: '',
      status: 'active',
      criteria: [{ type: 'commit', description: 'Graph acceptance condition' }],
      progress: null,
      nocodbStatus: null,
      assignee: null,
    });
    expect(nocodbService._fetchRecords).not.toHaveBeenCalled();
    expect(nocodbService.getProjectStats).not.toHaveBeenCalled();
    expect(res.body.direction).toEqual({ title: '', content: '', available: false });
    expect(res.body.frame).toEqual({ title: '', content: '', available: false, frames: [] });
    expect(res.body.issues).toEqual({ items: [], stats: { open: null, highImpact: null } });
    expect(res.body.tasks).toEqual({ items: [], stats: { total: null, completed: null, inProgress: null, overdue: null } });
    expect(res.body.health).toEqual({ score: null });
    expect(res.body.meta.legacyProjection).toEqual({ status: 'retired', source: 'nocodb' });
  });

  it('退役したNocoDBのValue Loopを空データと誤認させず状態を返す', async () => {
    const res = await request(app).get('/api/brainbase/portal/brainbase/value-loop');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      decision: {},
      work: {},
      ship: {},
      learn: {},
      meta: { status: 'retired', source: 'nocodb' },
    });
    expect(nocodbService._fetchRecords).not.toHaveBeenCalled();
    expect(nocodbService.getProjectStats).not.toHaveBeenCalled();
  });

  it('Graphの成功した空一覧を維持し、WikiだけのStoryを復活させない', async () => {
    infoSSOTService.listGraphEntities.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'graph',
      storyStatus: 'available',
      graphStoryCount: 0,
    });
    expect(res.body.storyMap.stories).toEqual([]);
    expect(res.body.storyMap.meta.wikiStoryCount).toBeNull();
  });

  it('Wiki退役後はGraph storyの不足フィールドを補完せず、未提供のまま返す', async () => {
    infoSSOTService.listGraphEntities.mockResolvedValueOnce([
      {
        id: 'story_c1001',
        entity_type: 'story',
        project_code: 'unson',
        payload: {
          story_id: 'C1-001',
          title: 'Canonical Graph title',
          source: 'common/00_stories.md',
        },
      },
    ]);

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.stories).toHaveLength(1);
    expect(res.body.storyMap.stories[0]).toMatchObject({
      story_id: 'C1-001',
      frame_id: '',
      name: 'Canonical Graph title',
      horizon: '',
      view: '',
      status: '',
    });
    expect(res.body.storyMap.stories[0]).not.toHaveProperty('criteria');
    expect(res.body.storyMap.meta.wikiStoryCount).toBeNull();
  });

  it('Graph取得失敗を空一覧と区別し、Story件数をunknownにする', async () => {
    infoSSOTService.listGraphEntities.mockRejectedValueOnce(new Error('Graph unavailable'));

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.stories).toEqual([]);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'unavailable',
      storyStatus: 'unavailable',
      graphStoryCount: null,
      wikiStoryCount: null,
    });
  });

  it('Graph service未構成を取得不能として返す', async () => {
    infoSSOTService.listGraphEntities = undefined;

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.stories).toEqual([]);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'unavailable',
      storyStatus: 'unavailable',
      graphStoryCount: null,
      wikiStoryCount: null,
    });
  });

  it('Graphの不正な応答形式を取得不能として返す', async () => {
    infoSSOTService.listGraphEntities.mockResolvedValueOnce({ records: [] });

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.stories).toEqual([]);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'unavailable',
      storyStatus: 'unavailable',
      graphStoryCount: null,
      wikiStoryCount: null,
    });
  });

  it('Graphの不正レコードを成功した空一覧として扱わない', async () => {
    infoSSOTService.listGraphEntities.mockResolvedValueOnce([{}]);

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.stories).toEqual([]);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'unavailable',
      storyStatus: 'unavailable',
      graphStoryCount: null,
      wikiStoryCount: null,
    });
  });

  it('有効な別プロジェクトのGraph storyだけなら確認済みの空一覧を返す', async () => {
    infoSSOTService.listGraphEntities.mockResolvedValueOnce([
      {
        id: 'story_other_project',
        entity_type: 'story',
        project_code: 'another-project',
        payload: {
          story_id: 'OTHER-001',
          title: 'Other project story',
          source: 'another-project/stories.md',
        },
      },
    ]);

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.stories).toEqual([]);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'graph',
      storyStatus: 'available',
      graphStoryCount: 0,
    });
    expect(res.body.storyMap.meta.wikiStoryCount).toBeNull();
  });

  it('明示的に別プロジェクトの不正レコードは対象Story一覧を取得不能にしない', async () => {
    infoSSOTService.listGraphEntities.mockResolvedValueOnce([
      {
        entity_type: 'story',
        project_code: 'another-project',
        payload: null,
      },
    ]);

    const res = await request(app).get('/api/brainbase/portal/brainbase');

    expect(res.status).toBe(200);
    expect(res.body.storyMap.stories).toEqual([]);
    expect(res.body.storyMap.meta).toMatchObject({
      storySource: 'graph',
      storyStatus: 'available',
      graphStoryCount: 0,
    });
  });
});
