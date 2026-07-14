import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createManaCaptureRouter } from '../../../server/routes/brainbase/mana-capture-routes.js';

describe('mana capture routes', () => {
  const originalManaUrl = process.env.MANA_LAMBDA_URL;
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
  const originalOpenAiCompatibleApiKey = process.env.LLM_OPENAI_COMPATIBLE_API_KEY;
  let fetchMock;
  let app;

  beforeEach(() => {
    process.env.MANA_LAMBDA_URL = 'https://mana.example.com/';
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ reply: 'ok', timestamp: '2026-05-22T00:00:00.000Z' }),
    }));
    global.fetch = fetchMock;

    app = express();
    app.use(express.json());
    app.use('/api/brainbase/mana', createManaCaptureRouter());
  });

  afterEach(() => {
    process.env.MANA_LAMBDA_URL = originalManaUrl;
    if (originalOpenRouterApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
    if (originalOpenAiCompatibleApiKey === undefined) delete process.env.LLM_OPENAI_COMPATIBLE_API_KEY;
    else process.env.LLM_OPENAI_COMPATIBLE_API_KEY = originalOpenAiCompatibleApiKey;
    vi.restoreAllMocks();
  });

  it('POST /chat builds exactly one Mana Lambda api/chat path with trailing-slash base URL', async () => {
    const res = await request(app)
      .post('/api/brainbase/mana/chat')
      .send({ message: ' hello ', userId: 'u1', projectId: 'brainbase' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'ok', timestamp: '2026-05-22T00:00:00.000Z' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://mana.example.com/api/chat');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: 'hello',
      userId: 'u1',
      projectId: 'brainbase',
    });
  });

  it('POST /chat builds exactly one Mana Lambda api/chat path without trailing-slash base URL', async () => {
    process.env.MANA_LAMBDA_URL = 'https://mana.example.com';
    app = express();
    app.use(express.json());
    app.use('/api/brainbase/mana', createManaCaptureRouter());

    await request(app)
      .post('/api/brainbase/mana/chat')
      .send({ message: 'hello' })
      .expect(200);

    expect(fetchMock.mock.calls[0][0]).toBe('https://mana.example.com/api/chat');
  });

  it('POST /chat rejects an empty message before calling Mana Lambda', async () => {
    const res = await request(app)
      .post('/api/brainbase/mana/chat')
      .send({ message: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'message is required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POST /chat preserves 503 fallback semantics for non-ok Mana Lambda responses', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    });

    const res = await request(app)
      .post('/api/brainbase/mana/chat')
      .send({ message: 'hello' });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      error: 'AI response unavailable',
      reply: 'ごめん、今ちょっと考えがまとまらない。もう一回言ってくれる？',
    });
  });

  it('POST /chat preserves 503 fallback semantics when Mana Lambda fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const res = await request(app)
      .post('/api/brainbase/mana/chat')
      .send({ message: 'hello' });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      error: 'AI response unavailable',
      reply: 'ごめん、今ちょっと考えがまとまらない。もう一回言ってくれる？',
    });
  });

  it('POST /capture extracts metadata through the Bedrock client without OpenRouter fallback', async () => {
    process.env.OPENROUTER_API_KEY = 'must-not-be-used';
    process.env.LLM_OPENAI_COMPATIBLE_API_KEY = 'must-not-be-used';
    const bedrockClient = {
      send: vi.fn(async (command) => {
        const payload = JSON.parse(command.input.body);
        expect(payload.system).toContain('顧客オンボーディングの詰まりを整理する');
        expect(payload.messages).toEqual([]);
        return {
          body: new TextEncoder().encode(JSON.stringify({
            content: [{ text: '{"title":"オンボーディング整理","category":"task"}' }]
          }))
        };
      })
    };
    const canonicalTaskService = {
      createManaCapture: vi.fn(async input => ({
        id: 'ct1.opaque.signature',
        version: 1,
        status: 'pending',
        title: input.title,
        source_refs: [{ type: 'mana_capture', capture_id: input.capture_id }]
      }))
    };
    const sessionGuard = (req, _res, next) => {
      req.authSource = 'cookie';
      req.auth = { sub: 'sato_keigo' };
      req.access = { personId: 'sato_keigo', role: 'ceo', projectCodes: ['brainbase'], clearance: ['internal'] };
      next();
    };
    app = express();
    app.use(express.json());
    app.use('/api/brainbase/mana', createManaCaptureRouter({ bedrockClient, canonicalTaskService, sessionGuard }));

    const res = await request(app)
      .post('/api/brainbase/mana/capture')
      .send({ capture_id: 'capture-1', content: '顧客オンボーディングの詰まりを整理する', type: 'issue' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'オンボーディング整理',
      type: 'task',
      content: '顧客オンボーディングの詰まりを整理する',
      taskId: 'ct1.opaque.signature',
      version: 1
    });
    expect(bedrockClient.send).toHaveBeenCalledTimes(1);
    expect(canonicalTaskService.createManaCapture).toHaveBeenCalledWith(expect.objectContaining({
      capture_id: 'capture-1',
      content: '顧客オンボーディングの詰まりを整理する'
    }), expect.objectContaining({
      principal: { type: 'person', id: 'sato_keigo' },
      authSource: 'session'
    }));
  });

  it('POST /capture rejects missing capture_id before calling the Task store', async () => {
    const canonicalTaskService = { createManaCapture: vi.fn() };
    const sessionGuard = (req, _res, next) => {
      req.authSource = 'cookie';
      req.access = { personId: 'sato_keigo' };
      next();
    };
    app = express();
    app.use(express.json());
    app.use('/api/brainbase/mana', createManaCaptureRouter({ canonicalTaskService, sessionGuard }));

    await request(app)
      .post('/api/brainbase/mana/capture')
      .send({ content: '確認する' })
      .expect(422);

    expect(canonicalTaskService.createManaCapture).not.toHaveBeenCalled();
  });

  it('POST /capture does not return a local id when the canonical store is unavailable', async () => {
    const error = Object.assign(new Error('Canonical Task store is unavailable'), {
      code: 'task_store_unavailable', status: 503
    });
    const canonicalTaskService = { createManaCapture: vi.fn(async () => { throw error; }) };
    const sessionGuard = (req, _res, next) => {
      req.authSource = 'cookie';
      req.access = { personId: 'sato_keigo' };
      next();
    };
    app = express();
    app.use(express.json());
    app.use('/api/brainbase/mana', createManaCaptureRouter({ canonicalTaskService, sessionGuard }));

    const res = await request(app)
      .post('/api/brainbase/mana/capture')
      .send({ capture_id: 'capture-2', content: '確認する' });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'task_store_unavailable' });
    expect(res.body.id).toBeUndefined();
  });

  it('GET /captures follows canonical Task cursors before filtering Mana captures', async () => {
    const canonicalTaskService = {
      listTasks: vi.fn()
        .mockResolvedValueOnce({
          items: [{ id: 'ct1.normal', source_refs: [{ type: 'brainbase_web' }] }],
          next_cursor: 'cursor-2'
        })
        .mockResolvedValueOnce({
          items: [{
            id: 'ct1.capture', version: 2, status: 'pending', title: '次ページの記録',
            assignee_person_id: 'sato_keigo', created_at: '2026-07-14T00:00:00.000Z',
            source_refs: [{ type: 'mana_capture', capture_type: 'task', content: '確認する', project: 'brainbase' }]
          }],
          next_cursor: null
        })
    };
    const sessionGuard = (req, _res, next) => {
      req.authSource = 'cookie';
      req.access = { personId: 'sato_keigo' };
      next();
    };
    app = express();
    app.use(express.json());
    app.use('/api/brainbase/mana', createManaCaptureRouter({ canonicalTaskService, sessionGuard }));

    const res = await request(app).get('/api/brainbase/mana/captures');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 1, items: [{ taskId: 'ct1.capture', content: '確認する' }] });
    expect(canonicalTaskService.listTasks.mock.calls).toEqual([
      [{ limit: 50 }, expect.any(Object)],
      [{ limit: 50, cursor: 'cursor-2' }, expect.any(Object)]
    ]);
  });
});
