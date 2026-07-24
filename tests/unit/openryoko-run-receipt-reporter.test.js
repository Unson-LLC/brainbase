import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    buildOpenRyokoReceipt,
    collectOpenRyokoSessions,
    deliverOpenRyokoOutbox,
    enqueueOpenRyokoReceipt
} from '../../scripts/run-receipt/openryoko-reporter.mjs';
import { normalizeRunReceipt } from '../../server/services/run-receipt/contract.js';

function session(overrides = {}) {
    return {
        id: '546c7db4-92f0-47c7-9222-86cc72a23d7c',
        source: 'slack',
        connector: 'slack',
        status: 'idle',
        createdAt: '2026-07-24T14:42:15.546Z',
        lastActivity: '2026-07-24T14:42:26.789Z',
        lastError: null,
        project_id: 'brainbase',
        ...overrides
    };
}

describe('OpenRyoko run receipt reporter', () => {
    it('terminal sessionを本文なしのcanonical receiptへ写像する', () => {
        const receipt = buildOpenRyokoReceipt(session({
            prompt: 'must not be copied',
            transcript: 'must not be copied either'
        }));

        expect(receipt.source).toEqual({
            type: 'openryoko',
            workflow_id: 'openryoko-slack',
            name: 'openryoko-slack',
            runtime_target: 'lightsail'
        });
        expect(receipt.run.external_run_id).toBe(session().id);
        expect(receipt.run.status).toBe('success');
        expect(JSON.stringify(receipt)).not.toContain('must not be copied');
        expect(normalizeRunReceipt(receipt).source.type).toBe('openryoko');
    });

    it.each([
        ['error', 'failed', 'check_error'],
        ['interrupted', 'cancelled', 'none']
    ])('%sを%sへ写像する', (sourceStatus, status, action) => {
        const receipt = buildOpenRyokoReceipt(session({ status: sourceStatus }));
        expect(receipt.run.status).toBe(status);
        expect(receipt.run.action_required).toBe(action);
    });

    it('running sessionはreceiptを捏造しない', () => {
        expect(buildOpenRyokoReceipt(session({ status: 'running' }))).toEqual({
            kind: 'pending',
            reason: 'source_run_not_terminal'
        });
    });

    it('初回pollはbaselineだけ保存し、その後のterminal遷移だけenqueueする', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openryoko-receipt-'));
        const stateFile = path.join(root, 'state.json');
        const outboxDir = path.join(root, 'outbox');
        let current = [session({ status: 'running', lastActivity: '2026-07-24T14:42:20.000Z' })];
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => current }));

        await expect(collectOpenRyokoSessions({
            projectId: 'brainbase',
            stateFile,
            outboxDir,
            fetchImpl
        })).resolves.toMatchObject({ status: 'initialized', queued: 0 });

        current = [session()];
        await expect(collectOpenRyokoSessions({
            projectId: 'brainbase',
            stateFile,
            outboxDir,
            fetchImpl
        })).resolves.toMatchObject({ status: 'completed', queued: 1 });
        expect(fs.readdirSync(outboxDir)).toHaveLength(1);
    });

    it('durable outboxをdelivery成功後だけ削除する', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openryoko-receipt-'));
        const outboxDir = path.join(root, 'outbox');
        enqueueOpenRyokoReceipt(buildOpenRyokoReceipt(session()), { outboxDir });
        const fetchImpl = vi.fn(async () => ({ ok: true, status: 202 }));

        await expect(deliverOpenRyokoOutbox({
            outboxDir,
            endpoint: 'http://127.0.0.1:31989/api/run-receipts/ingest',
            serviceToken: 'bbsvc_public_fake_value',
            fetchImpl
        })).resolves.toMatchObject({ delivered: 1 });
        expect(fs.readdirSync(outboxDir)).toHaveLength(0);
    });
});
