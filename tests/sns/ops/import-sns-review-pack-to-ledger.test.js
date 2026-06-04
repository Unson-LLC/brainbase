// @ts-check
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    assertImportCreatedReviewablePosts,
    parseArgs,
    reviewPackToLedgerPayload,
    summarizeImportResult
} from '../../../scripts/import-sns-review-pack-to-ledger.js';

const root = path.resolve(import.meta.dirname, '../../..');
const cliPath = path.join(root, 'scripts/import-sns-review-pack-to-ledger.js');

function writeTempJson(value) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-review-pack-'));
    const file = path.join(dir, 'signals.json');
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
    return file;
}

function runCli(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], {
            cwd: root,
            env: { ...process.env, FORCE_COLOR: '0' }
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

function createLedgerImportServer(responseBody) {
    const requests = [];
    const server = http.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
            requests.push({
                method: request.method,
                url: request.url,
                body: body ? JSON.parse(body) : null
            });
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify(responseBody));
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('server did not expose a TCP address'));
                return;
            }
            resolve({
                baseUrl: `http://127.0.0.1:${address.port}`,
                requests,
                close: () => new Promise((closeResolve, closeReject) => {
                    server.close((error) => error ? closeReject(error) : closeResolve());
                })
            });
        });
    });
}

describe('import-sns-review-pack-to-ledger', () => {
    it('maps ohayo reviewPack posts into ledger drafts', () => {
        const payload = reviewPackToLedgerPayload({
            reviewPack: {
                date: '2026-05-13',
                posts: [{
                    slot: 'peer_quote_1',
                    time: '18:00',
                    scheduled_at: '2026-05-13T09:00:00.000Z',
                    lane: 'peer_circle',
                    topic: 'Claude Code',
                    body: 'これ、Claude Codeを会社で使う時も同じだと思ってる',
                    source_url: 'https://x.com/near/status/1',
                    persona_brain: { target_person: 'AI導入を任されたPM' },
                    algorithm_fit: { candidate_source: 'peer_circle_quote' },
                    generation_context_evidence: { policy_ref: 'generation_policy', recommended_lanes: ['peer_circle'] },
                    graph_check: { decision: 'checked_for_review' },
                    quality_gate: { decision: 'pass', persona_affect: { likely_reader_feeling: '現場に接続できる' } }
                }]
            }
        });

        expect(payload.account_handle).toBe('@AIBizNavigator');
        expect(payload.drafts).toHaveLength(1);
        expect(payload.drafts[0]).toMatchObject({
            id: 'ohayo_2026-05-13_peer_quote_1',
            date: '2026-05-13',
            slot_index: 1,
            time: '18:00',
            scheduled_at: '2026-05-13T09:00:00.000Z',
            lane: 'peer_circle',
            format: 'quote_repost_commentary',
            source_type: 'Peer Circle',
            source_url: 'https://x.com/near/status/1'
        });
        expect(payload.drafts[0].quality_gate.decision).toBe('pass');
        expect(payload.drafts[0].algorithm_fit.candidate_source).toBe('peer_circle_quote');
        expect(payload.drafts[0].generation_context_evidence.policy_ref).toBe('generation_policy');
    });

    it('parses base-url and dry-run arguments', () => {
        expect(parseArgs(['--date', '2026-05-13', '--base-url', 'http://localhost:3999', '--dry-run'])).toMatchObject({
            date: '2026-05-13',
            baseUrl: 'http://localhost:3999',
            dryRun: true
        });
    });

    it('fails before import when the review pack has no posts to put in the ledger', () => {
        expect(() => reviewPackToLedgerPayload({
            reviewPack: {
                date: '2026-05-13',
                posts: [],
                holds: [{
                    lane: 'Own Proof',
                    decision: 'dedupe hold',
                    reasons: ['duplicate_recent_body']
                }]
            }
        })).toThrow(/reviewPack\.posts is empty/u);
    });

    it('treats all-skipped ledger responses as an ohayo SNS import failure', () => {
        const summary = summarizeImportResult({
            created: [],
            updated: [],
            skipped: [
                { id: 'ohayo_2026-05-13_baseline_1', reason: 'duplicate_body', existing_post_id: 'sns_20260516_1_own_proof' },
                { id: 'ohayo_2026-05-13_baseline_2', reason: 'duplicate_body', existing_post_id: 'sns_20260515_1_own_proof' }
            ],
            summary: { review_needed: 0 }
        }, {
            importedFile: '/tmp/signals.json',
            expectedDrafts: 2
        });

        expect(summary).toMatchObject({
            imported_file: '/tmp/signals.json',
            created: 0,
            updated: 0,
            skipped: 2,
            success: false,
            skipped_reasons: { duplicate_body: 2 }
        });
        expect(() => assertImportCreatedReviewablePosts(summary)).toThrow(/no reviewable posts/u);
    });

    it('exits non-zero from the CLI when the review pack is empty', async () => {
        const file = writeTempJson({
            reviewPack: {
                date: '2026-06-04',
                posts: [],
                holds: [{
                    lane: 'Own Proof',
                    decision: 'dedupe hold',
                    reasons: ['duplicate_recent_body']
                }]
            }
        });

        const result = await runCli(['--file', file]);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('reviewPack.posts is empty');
        expect(result.stderr).toContain('duplicate_recent_body');
    });

    it('prints skipped reasons and exits non-zero from the CLI when Ledger skips every draft', async () => {
        const file = writeTempJson({
            reviewPack: {
                date: '2026-06-04',
                posts: [
                    { slot: 'baseline_1', body: '重複本文1' },
                    { slot: 'baseline_2', body: '重複本文2' }
                ]
            }
        });
        const server = await createLedgerImportServer({
            created: [],
            updated: [],
            skipped: [
                { id: 'ohayo_2026-06-04_baseline_1', reason: 'duplicate_body', existing_post_id: 'sns_20260516_1_own_proof' },
                { id: 'ohayo_2026-06-04_baseline_2', reason: 'duplicate_body', existing_post_id: 'sns_20260515_1_own_proof' }
            ],
            summary: { review_needed: 0 }
        });

        try {
            const result = await runCli(['--file', file, '--base-url', server.baseUrl]);
            const summary = JSON.parse(result.stdout);

            expect(result.status).toBe(1);
            expect(server.requests).toHaveLength(1);
            expect(server.requests[0]).toMatchObject({
                method: 'POST',
                url: '/api/sns-growth/review-pack'
            });
            expect(server.requests[0].body.drafts).toHaveLength(2);
            expect(summary).toMatchObject({
                created: 0,
                updated: 0,
                skipped: 2,
                success: false,
                skipped_reasons: { duplicate_body: 2 }
            });
            expect(summary.skipped_items[0]).toMatchObject({
                id: 'ohayo_2026-06-04_baseline_1',
                reason: 'duplicate_body'
            });
            expect(result.stderr).toContain('SNS Ledger import created no reviewable posts');
            expect(result.stderr).toContain('duplicate_body:2');
        } finally {
            await server.close();
        }
    });
});
