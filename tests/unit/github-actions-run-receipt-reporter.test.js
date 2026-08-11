import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    buildGitHubActionsReceipt,
    reportGitHubActionsRun
} from '../../.github/actions/run-receipt-reporter/index.mjs';
import { normalizeRunReceipt } from '../../server/services/run-receipt/contract.js';

function run(overrides = {}) {
    return {
        repository_id: '1001',
        repository: 'unson/brainbase',
        workflow_id: '2002',
        workflow_name: 'CI',
        run_id: '3003',
        run_attempt: '1',
        project_id: 'brainbase',
        conclusion: 'success',
        started_at: '2026-07-16T00:00:00.000Z',
        finished_at: '2026-07-16T00:03:00.000Z',
        ...overrides
    };
}

describe('GitHub Actions run receipt reporter', () => {
    it('reusable step fixtureがalways実行とauthoritative job.statusを固定する', () => {
        const fixturePath = path.resolve(
            process.cwd(),
            'tests/fixtures/run-receipt/github-actions-reporter-step.yml'
        );
        const fixture = fs.readFileSync(fixturePath, 'utf8');

        expect(fixture).toContain('if: ${{ always() }}');
        expect(fixture).toContain('uses: ./.github/actions/run-receipt-reporter');
        expect(fixture).toContain('conclusion: ${{ job.status }}');
        expect(fixture).toContain('http://127.0.0.1:31989/api/run-receipts/ingest');
        expect(fixture).not.toMatch(/https:\/\/(?!github\.com)/);
    });

    it('repository workflow run attemptをcanonical identityへ固定する', () => {
        const receipt = buildGitHubActionsReceipt(run());

        expect(receipt.source.workflow_id).toBe('github:1001:workflow:2002');
        expect(receipt.run.external_run_id).toBe('github:1001:run:3003:attempt:1');
        expect(receipt.run.status).toBe('success');
        expect(receipt.run.evidence_refs).toEqual([{
            kind: 'url',
            ref: 'https://github.com/unson/brainbase/actions/runs/3003/attempts/1',
            label: 'GitHub Actions run'
        }]);
        expect(normalizeRunReceipt(receipt).run.status).toBe('success');
    });

    it.each([
        ['failure', 'failed', 'check_error'],
        ['timed_out', 'failed', 'check_error'],
        ['cancelled', 'cancelled', 'none'],
        ['action_required', 'waiting_human', 'review_run']
    ])('%s conclusionを%sへ写像する', (conclusion, status, action) => {
        const receipt = buildGitHubActionsReceipt(run({ conclusion }));
        expect(receipt.run.status).toBe(status);
        expect(receipt.run.action_required).toBe(action);
    });

    it('repository collisionとrerun attemptを別identityにする', () => {
        const first = buildGitHubActionsReceipt(run());
        const otherRepository = buildGitHubActionsReceipt(run({ repository_id: '1002' }));
        const rerun = buildGitHubActionsReceipt(run({ run_attempt: '2' }));

        expect(new Set([
            first.delivery.idempotency_key,
            otherRepository.delivery.idempotency_key,
            rerun.delivery.idempotency_key
        ])).toHaveLength(3);
    });

    it('secretless forkをdelivery unavailableとしてreceipt artifactへ残す', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gha-run-receipt-'));
        const result = await reportGitHubActionsRun(run(), {
            endpoint: 'http://127.0.0.1:31989/api/run-receipts/ingest',
            serviceToken: '',
            tempDir,
            fetchImpl: vi.fn()
        });

        expect(result.status).toBe('unavailable');
        expect(result.reason).toBe('missing_service_token');
        expect(fs.existsSync(result.artifact_path)).toBe(true);
        expect(JSON.parse(fs.readFileSync(result.artifact_path, 'utf8')).run.status).toBe('success');
    });

    it('localhost fake endpointへbounded retryしdelivery attemptを更新する', async () => {
        const bodies = [];
        const fetchImpl = vi.fn(async (_url, init) => {
            bodies.push(JSON.parse(init.body));
            return { ok: bodies.length === 2, status: bodies.length === 2 ? 201 : 503 };
        });

        const result = await reportGitHubActionsRun(run(), {
            endpoint: 'http://127.0.0.1:31989/api/run-receipts/ingest',
            serviceToken: 'bbsvc_public_fake_value',
            fetchImpl,
            maxAttempts: 2,
            sleep: async () => {},
            now: () => new Date('2026-07-16T00:04:00.000Z')
        });

        expect(result.status).toBe('delivered');
        expect(bodies.map((body) => body.delivery.attempt)).toEqual([1, 2]);
        expect(bodies[1].delivery.sent_at).toBe('2026-07-16T00:04:00.000Z');
    });
});
