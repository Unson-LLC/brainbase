// @ts-check
import { spawn } from 'node:child_process';
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
    BRAINBASE_SNS_CONNECTION_ID: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
    BRAINBASE_SNS_CONNECTION_REVISION: '3',
    BRAINBASE_SNS_SERVICE_PRINCIPAL_ID: 'svc_sns_review_pack_importer',
    BRAINBASE_SNS_CHANNEL_ID: 'C0123456789',
    BRAINBASE_SNS_RESOURCE_OBJECT_TYPE: 'project',
    BRAINBASE_SNS_RESOURCE_ID: 'project_sns'
};

function runCli(args, envOverrides = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], {
            cwd: root,
            env: { NODE_ENV: 'test', FORCE_COLOR: '0', ...tenantEnv, ...envOverrides }
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

    it('exits non-zero before reading the review pack or contacting runtime when retired', async () => {
        const result = await runCli([
            '--file', path.join(root, 'tests/fixtures/does-not-exist/review-pack.json'),
            '--base-url', 'http://127.0.0.1:9'
        ]);

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('SNS_CLI_RETIRED');
        expect(result.stderr).toContain('SNS操作は実行していません');
    });
});
