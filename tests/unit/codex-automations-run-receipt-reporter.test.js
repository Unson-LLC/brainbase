import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    buildCodexAutomationReceipt,
    deliverCodexAutomationOutbox,
    enqueueCodexAutomationReceipt
} from '../../scripts/run-receipt/codex-automations-reporter.mjs';
import { normalizeRunReceipt } from '../../server/services/run-receipt/contract.js';

function terminalRun(overrides = {}) {
    return {
        automation_id: 'daily-brief',
        run_id: 'run-42',
        project_id: 'brainbase',
        status: 'completed',
        started_at: '2026-07-16T00:00:00.000Z',
        finished_at: '2026-07-16T00:01:00.000Z',
        evidence_refs: [{ kind: 'artifact_ref', ref: 'codex:thread/thread-42', label: 'Codex task' }],
        ...overrides
    };
}

describe('Codex Automations run receipt reporter', () => {
    it('terminal source stateをcanonical identityへ写像し本文を複製しない', () => {
        const receipt = buildCodexAutomationReceipt(terminalRun({ transcript: 'must not be copied' }));

        expect(receipt.source).toEqual({
            type: 'codex_automations',
            workflow_id: 'daily-brief',
            name: 'daily-brief'
        });
        expect(receipt.run.external_run_id).toBe('daily-brief:run-42');
        expect(receipt.run.status).toBe('success');
        expect(receipt.run.evidence_state).toBe('confirmed');
        expect(JSON.stringify(receipt)).not.toContain('must not be copied');
        expect(receipt.delivery.idempotency_key).toMatch(/^rr1_[a-f0-9]{64}$/);
        expect(normalizeRunReceipt(receipt).run.status).toBe('success');
    });

    it.each([
        ['failed', 'failed', 'check_error'],
        ['cancelled', 'cancelled', 'none'],
        ['waiting_human', 'waiting_human', 'review_run']
    ])('%sを%sへ写像する', (sourceStatus, status, action) => {
        const receipt = buildCodexAutomationReceipt(terminalRun({ status: sourceStatus }));
        expect(receipt.run.status).toBe(status);
        expect(receipt.run.action_required).toBe(action);
    });

    it('非terminal runはreceiptを捏造せずpendingを返す', () => {
        expect(buildCodexAutomationReceipt(terminalRun({ status: 'running', finished_at: undefined }))).toEqual({
            kind: 'pending',
            reason: 'source_run_not_terminal'
        });
    });

    it('run identity欠落をconnector observationとして明示する', () => {
        const receipt = buildCodexAutomationReceipt(terminalRun({
            run_id: undefined,
            observation_id: 'poll-7',
            evidence_refs: []
        }));

        expect(receipt.run.observation_kind).toBe('connector_observation');
        expect(receipt.run.external_run_id).toBe('daily-brief:observation:poll-7');
        expect(receipt.run.status).toBe('blocked');
        expect(receipt.run.evidence_state).toBe('no_data');
        expect(normalizeRunReceipt(receipt).run.observation_kind).toBe('connector_observation');
    });

    it('automation間のrun id collisionとrerun identityを分離する', () => {
        const first = buildCodexAutomationReceipt(terminalRun());
        const otherAutomation = buildCodexAutomationReceipt(terminalRun({ automation_id: 'weekly-pack' }));
        const rerun = buildCodexAutomationReceipt(terminalRun({ run_id: 'run-42-rerun-1' }));

        expect(new Set([
            first.delivery.idempotency_key,
            otherAutomation.delivery.idempotency_key,
            rerun.delivery.idempotency_key
        ])).toHaveLength(3);
    });

    it('durable outboxへatomic enqueueしbounded retry後dead-letterへ移す', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-receipt-'));
        const outboxDir = path.join(root, 'outbox');
        const deadLetterDir = path.join(root, 'dead-letter');
        const receipt = buildCodexAutomationReceipt(terminalRun());
        const queued = enqueueCodexAutomationReceipt(receipt, { outboxDir });

        expect(fs.existsSync(queued.path)).toBe(true);
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
        const result = await deliverCodexAutomationOutbox({
            outboxDir,
            deadLetterDir,
            endpoint: 'http://127.0.0.1:31989/api/run-receipts/ingest',
            serviceToken: 'bbsvc_public_fake_value',
            fetchImpl,
            maxAttempts: 2,
            now: () => new Date('2026-07-16T00:02:00.000Z')
        });

        expect(result).toMatchObject({ delivered: 0, retryable: 1, dead_lettered: 0 });
        const retryFile = fs.readdirSync(outboxDir)[0];
        const retryReceipt = JSON.parse(fs.readFileSync(path.join(outboxDir, retryFile), 'utf8'));
        expect(retryReceipt.delivery.attempt).toBe(2);

        const exhausted = await deliverCodexAutomationOutbox({
            outboxDir,
            deadLetterDir,
            endpoint: 'http://127.0.0.1:31989/api/run-receipts/ingest',
            serviceToken: 'bbsvc_public_fake_value',
            fetchImpl,
            maxAttempts: 2
        });
        expect(exhausted).toMatchObject({ delivered: 0, retryable: 0, dead_lettered: 1 });
        expect(fs.readdirSync(deadLetterDir)).toHaveLength(1);
    });

    it('missing delivery configを0件成功にせずunavailableにする', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-run-receipt-'));
        const outboxDir = path.join(root, 'outbox');
        enqueueCodexAutomationReceipt(buildCodexAutomationReceipt(terminalRun()), { outboxDir });

        await expect(deliverCodexAutomationOutbox({ outboxDir, endpoint: '', serviceToken: '' }))
            .resolves.toMatchObject({ status: 'unavailable', pending: 1 });
    });
});
