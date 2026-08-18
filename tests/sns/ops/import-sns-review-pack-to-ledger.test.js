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
    resolveSnsTenantBoundary,
    reviewPackToLedgerPayload,
    summarizeImportResult
} from '../../../scripts/import-sns-review-pack-to-ledger.js';

const root = path.resolve(import.meta.dirname, '../../..');
const cliPath = path.join(root, 'scripts/import-sns-review-pack-to-ledger.js');
const tenantEnv = {
    BRAINBASE_SNS_SERVICE_TOKEN: 'bbsvc_test_review_pack_importer',
    BRAINBASE_SNS_TENANT_ID: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    BRAINBASE_SNS_TENANT_REVISION: '7',
    BRAINBASE_SNS_RESOURCE_OBJECT_TYPE: 'project',
    BRAINBASE_SNS_RESOURCE_ID: 'project_sns'
};

function writeTempJson(value) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-review-pack-'));
    const file = path.join(dir, 'signals.json');
    fs.writeFileSync(file, JSON.stringify(value), 'utf8');
    return file;
}

function runCli(args, envOverrides = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], {
            cwd: root,
            env: { ...process.env, FORCE_COLOR: '0', ...tenantEnv, ...envOverrides }
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
                headers: request.headers,
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
    it('AC-005 requires canonical runtime tenant binding for the production import path', () => {
        expect(resolveSnsTenantBoundary(tenantEnv)).toEqual({
            tenant_context: {
                tenant: {
                    tenant_id: tenantEnv.BRAINBASE_SNS_TENANT_ID,
                    tenant_revision: tenantEnv.BRAINBASE_SNS_TENANT_REVISION
                }
            },
            resource_ref: {
                object_type: tenantEnv.BRAINBASE_SNS_RESOURCE_OBJECT_TYPE,
                resource_id: tenantEnv.BRAINBASE_SNS_RESOURCE_ID
            }
        });
        expect(() => resolveSnsTenantBoundary({
            ...tenantEnv,
            BRAINBASE_SNS_TENANT_ID: ''
        })).toThrow(/BRAINBASE_SNS_TENANT_ID/u);
    });

    it('maps ohayo reviewPack posts into ledger drafts', () => {
        const tenantBoundary = resolveSnsTenantBoundary(tenantEnv);
        const payload = reviewPackToLedgerPayload({
            reviewPack: {
                date: '2026-07-28',
                posts: [{
                    slot: 'lifelog_1',
                    lane: 'work_log',
                    format: 'first_person_lifelog',
                    body: '今日はXの方針を全部見直した。自分の記録を残す形にした。',
                    generation_context_evidence: { policy_ref: 'generation_policy' },
                    graph_check: { scope: 'personal_experience', decision: 'source_attached' },
                    quality_gate: { decision: 'pass', check_type: 'lifelog_integrity' },
                    lifelog_check: {
                        source_id: 'lifelog_work_1',
                        source_system: 'personal_kg',
                        first_person_evidence: true,
                        evidence_ids: [{ uri: 'brainbase:test:lifelog_work_1' }]
                    }
                }]
            }
        }, { tenantBoundary, requireTenantBoundary: true });

        expect(payload.account_handle).toBe('@AIBizNavigator');
        expect(payload.drafts).toHaveLength(1);
        expect(payload.drafts[0]).toMatchObject({
            id: 'ohayo_2026-07-28_lifelog_1',
            date: '2026-07-28',
            slot_index: 1,
            lane: 'work_log',
            format: 'first_person_lifelog',
            source_type: 'Personal KG',
            source_url: null
        });
        expect(payload.drafts[0].quality_gate.decision).toBe('pass');
        expect(payload.drafts[0].lifelog_check.source_id).toBe('lifelog_work_1');
        expect(payload.drafts[0].derived_from).toEqual(['lifelog_work_1']);
        expect(payload.drafts[0].generation_context_evidence.policy_ref).toBe('generation_policy');
        expect(payload.drafts[0].tenant_boundary).toEqual(tenantBoundary);
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

    it('AC-005 sends service auth and canonical tenant headers, then fails loudly when Ledger skips every draft', async () => {
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
                url: '/api/sns-growth/review-pack',
                headers: {
                    authorization: `Bearer ${tenantEnv.BRAINBASE_SNS_SERVICE_TOKEN}`,
                    'brainbase-tenant-context': Buffer.from(JSON.stringify({
                        tenant: {
                            tenant_id: tenantEnv.BRAINBASE_SNS_TENANT_ID,
                            tenant_revision: tenantEnv.BRAINBASE_SNS_TENANT_REVISION
                        }
                    }), 'utf8').toString('base64url'),
                    'brainbase-resource-ref': Buffer.from(JSON.stringify({
                        object_type: tenantEnv.BRAINBASE_SNS_RESOURCE_OBJECT_TYPE,
                        resource_id: tenantEnv.BRAINBASE_SNS_RESOURCE_ID
                    }), 'utf8').toString('base64url')
                }
            });
            expect(JSON.stringify(server.requests[0].body)).not.toContain(tenantEnv.BRAINBASE_SNS_SERVICE_TOKEN);
            expect(server.requests[0].body.drafts).toHaveLength(2);
            expect(server.requests[0].body.drafts[0].tenant_boundary).toEqual({
                tenant_context: {
                    tenant: {
                        tenant_id: tenantEnv.BRAINBASE_SNS_TENANT_ID,
                        tenant_revision: tenantEnv.BRAINBASE_SNS_TENANT_REVISION
                    }
                },
                resource_ref: {
                    object_type: tenantEnv.BRAINBASE_SNS_RESOURCE_OBJECT_TYPE,
                    resource_id: tenantEnv.BRAINBASE_SNS_RESOURCE_ID
                }
            });
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

    it('fails before HTTP import when the runtime tenant binding is absent', async () => {
        const file = writeTempJson({
            reviewPack: {
                date: '2026-06-04',
                posts: [{ slot: 'baseline_1', body: '境界なしでは送信しない' }]
            }
        });
        const server = await createLedgerImportServer({ created: [], updated: [], skipped: [] });

        try {
            const result = await runCli(['--file', file, '--base-url', server.baseUrl], {
                BRAINBASE_SNS_TENANT_ID: ''
            });

            expect(result.status).toBe(1);
            expect(result.stdout).toBe('');
            expect(result.stderr).toContain('BRAINBASE_SNS_TENANT_ID');
            expect(server.requests).toEqual([]);
        } finally {
            await server.close();
        }
    });

    it('AC-005 fails before HTTP import when the service token is absent without disclosing a token', async () => {
        const file = writeTempJson({
            reviewPack: {
                date: '2026-06-04',
                posts: [{ slot: 'baseline_1', body: '認証なしでは送信しない' }]
            }
        });
        const server = await createLedgerImportServer({ created: [], updated: [], skipped: [] });

        try {
            const result = await runCli(['--file', file, '--base-url', server.baseUrl], {
                BRAINBASE_SNS_SERVICE_TOKEN: ''
            });

            expect(result.status).toBe(1);
            expect(result.stdout).toBe('');
            expect(result.stderr).toContain('BRAINBASE_SNS_SERVICE_TOKEN');
            expect(server.requests).toEqual([]);
        } finally {
            await server.close();
        }
    });
});
