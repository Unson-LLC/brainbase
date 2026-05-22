import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createManaCaptureRouter } from '../../../server/routes/brainbase/mana-capture-routes.js';

describe('mana capture routes', () => {
  const originalManaUrl = process.env.MANA_LAMBDA_URL;
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
});
