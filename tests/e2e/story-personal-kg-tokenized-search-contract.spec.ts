import { expect, test } from '@playwright/test';
import express from 'express';
import request from 'supertest';
import { createLearningRouter } from '../../server/routes/learning.js';
import { PgCandidateRepository } from '../../server/services/candidate-store/candidate-repository.js';
import { LearningService } from '../../server/services/learning-service.js';

class ScriptedPool {
  calls: Array<{ sql: string; params: unknown[] }> = [];
  responses: Array<{ rows: Array<Record<string, unknown>> }> = [];

  constructor(responses: Array<{ rows: Array<Record<string, unknown>> }> = []) {
    this.responses = responses;
  }

  async query(sql: string, params: unknown[] = []) {
    this.calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (sql.includes('CREATE TABLE') || sql.includes('ALTER TABLE') || sql.includes('CREATE INDEX')) {
      return { rows: [], rowCount: 0 };
    }
    if (!sql.includes('SELECT id, cognitive_type, body')) {
      return { rows: [] };
    }
    return this.responses.shift() ?? { rows: [] };
  }

  searchCall() {
    return this.calls.find((call) => call.sql.includes('SELECT id, cognitive_type, body'));
  }
}

test('story-personal-kg-tokenized-search ac:1 ac:2 C-001 C-002 S-001 compound query matches all token fallback without exact phrase', async () => {
  const pool = new ScriptedPool([{
    rows: [{
      id: 'mem_ai_management',
      cognitive_type: 'claim',
      body: 'AI駆動経営は、フレーム・ストーリー・イベントの3層で会社の世界観、時間軸、記録を扱う。判断、Ship、実行、計測のバリューループでは、人間の判断がボトルネックになるためShipを経営進捗KPIにする。',
      confidence: 0.95,
      source_system: 'cross-project-minutes-personal-kg-seed',
      created_at: new Date('2026-05-16T00:00:00.000Z')
    }]
  }]);
  const service = new LearningService({
    pool,
    candidateRepository: new PgCandidateRepository({ pool })
  });

  const results = await service.searchPersonalKgCandidates({
    query: 'AI駆動経営 判断 Ship',
    limit: 5
  }, {
    access: {
      personId: 'sato_keigo',
      organizationId: 'org_unson'
    }
  });

  const search = pool.searchCall();
  expect(search?.sql, 'ac:2 compound query SQL includes exact phrase OR all-token fallback').toContain("OR (body ILIKE $3 ESCAPE '\\' AND body ILIKE $4 ESCAPE '\\' AND body ILIKE $5 ESCAPE '\\')");
  expect(search?.params, 'S-001 exact phrase plus token patterns are bound in order').toEqual([
    'sato_keigo',
    '%AI駆動経営 判断 Ship%',
    '%AI駆動経営%',
    '%判断%',
    '%Ship%',
    5
  ]);
  expect(results[0], 'ac:1 compound Personal KG query returns the matching candidate instead of false absence').toMatchObject({
    id: 'mem_ai_management',
    cognitive_type: 'claim',
    body: expect.stringContaining('AI駆動経営')
  });
});

test('story-personal-kg-tokenized-search ac:3 ac:4 ac:5 C-003 C-004 S-002 single token preserves filters and does not broaden to OR', async () => {
  const pool = new ScriptedPool([{ rows: [] }]);
  const service = new LearningService({
    pool,
    candidateRepository: new PgCandidateRepository({ pool })
  });

  await service.searchPersonalKgCandidates({
    query: '判断',
    cognitiveTypes: ['claim', 'insight'],
    limit: 3
  }, {
    access: {
      personId: 'sato_keigo',
      organizationId: 'org_unson'
    }
  });

  const search = pool.searchCall();
  expect(search?.sql, 'ac:3 single-token query has no token fallback OR branch').not.toContain('OR (');
  expect(search?.sql, 'ac:5 owner/redaction/rejected filters remain in the read path').toContain("owner_person_id = $1 AND semantic_state = 'active' AND visibility IN ('owner', 'private') AND redaction_status = 'none' AND promotion_status <> 'rejected'");
  expect(search?.sql, 'ac:4 cognitive_type filter placeholder follows phrase parameter').toContain('cognitive_type = ANY($3::text[])');
  expect(search?.sql, 'ac:4 limit placeholder follows cognitive_type filter').toContain('LIMIT $4');
  expect(search?.params).toEqual([
    'sato_keigo',
    '%判断%',
    ['claim', 'insight'],
    3
  ]);
});

test('story-personal-kg-tokenized-search C-004 rejects an unauthenticated search instead of using a default owner', async () => {
  const pool = new ScriptedPool();
  const service = new LearningService({
    pool,
    candidateRepository: new PgCandidateRepository({ pool })
  });

  await expect(service.searchPersonalKgCandidates({ query: '判断' }))
    .rejects.toMatchObject({
      message: 'personal_knowledge_identity_required',
      status: 403
    });
  expect(pool.searchCall()).toBeUndefined();
});

test('story-personal-kg-tokenized-search ac:6 C-005 S-003 learning API route preserves compound query response contract', async () => {
  const service = {
    searchPersonalKgCandidates: async (options: unknown) => ([{
      id: 'mem_route',
      cognitive_type: 'claim',
      body: `route:${JSON.stringify(options)}`,
      confidence: 0.9,
      source_system: 'test',
      created_at: '2026-05-16T00:00:00.000Z'
    }])
  };
  const app = express();
  app.use((req, _res, next) => {
    req.access = {
      personId: 'sato_keigo',
      organizationId: 'org_unson',
      actorPersonId: 'sato_keigo',
      projectCodes: ['brainbase']
    };
    req.personalKnowledgeAccess = req.access;
    next();
  });
  app.use('/api/learning', createLearningRouter(service));

  const response = await request(app)
    .get('/api/learning/memory-candidates/search')
    .query({ q: 'AI駆動経営 判断 Ship', cognitive_type: 'claim,insight', limit: '5' })
    .expect(200);

  expect(response.body, 'ac:6 direct learning API response shape remains { candidates }').toMatchObject({
    candidates: [{
      id: 'mem_route',
      cognitive_type: 'claim'
    }]
  });
  expect(response.body.candidates[0].body, 'C-005 raw compound query and filters are forwarded to Personal KG search').toContain('"query":"AI駆動経営 判断 Ship"');
  expect(response.body.candidates[0].body).toContain('"cognitiveTypes":["claim","insight"]');
  expect(response.body.candidates[0].body).toContain('"limit":"5"');
});
