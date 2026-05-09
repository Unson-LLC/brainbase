import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createInboxRouter } from '../../../server/routes/inbox.js';

describe('inbox routes', () => {
    let app;
    let inboxParser;

    beforeEach(() => {
        inboxParser = {
            getPendingItems: vi.fn(async () => []),
            getPendingCount: vi.fn(async () => 0),
            appendItem: vi.fn(async (payload) => ({ id: 'INBOX-DAILY-1', status: 'pending', ...payload })),
            markAsDone: vi.fn(async () => true),
            markAllAsDone: vi.fn(async () => true)
        };
        app = express();
        app.use(express.json());
        app.use('/api/inbox', createInboxRouter(inboxParser));
    });

    it('POST /api/inbox creates a pending inbox item', async () => {
        const res = await request(app)
            .post('/api/inbox')
            .send({
                title: 'Slack返信ドラフト',
                message: 'draft_onlyで確認する',
                instruction: {
                    intent: 'slack_reply_draft',
                    safety: { draft_only: true, dry_run: true }
                }
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(inboxParser.appendItem).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Slack返信ドラフト',
            message: 'draft_onlyで確認する',
            instruction: expect.objectContaining({
                intent: 'slack_reply_draft'
            })
        }));
    });

    it('POST /api/inbox rejects empty payload', async () => {
        const res = await request(app).post('/api/inbox').send({});

        expect(res.status).toBe(400);
        expect(inboxParser.appendItem).not.toHaveBeenCalled();
    });
});
