import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
    RunReceiptContractError,
    createRunReceiptIdentity,
    normalizeRunReceipt
} from '../../../server/services/run-receipt/contract.js';

function idempotencyKey(projectId, sourceType, externalRunId) {
    const digest = createHash('sha256')
        .update(JSON.stringify([projectId, sourceType, externalRunId]))
        .digest('hex');
    return `rr1_${digest}`;
}

function makeReceipt(overrides = {}) {
    const source = {
        type: 'mana',
        workflow_id: 'mana:lambda:daily-secretary',
        runtime_target: 'lambda',
        ...(overrides.source || {})
    };
    const run = {
        project_id: 'brainbase',
        external_run_id: 'mana:lambda:daily-secretary:run:1',
        status: 'success',
        evidence_state: 'confirmed',
        started_at: '2026-07-15T09:00:00+09:00',
        finished_at: '2026-07-15T09:02:00+09:00',
        metrics: { processed: 12, dry_run: false, skipped: null },
        evidence_refs: [{ kind: 'log_ref', ref: 'cloudwatch:log-stream/example' }],
        ...(overrides.run || {})
    };
    const delivery = {
        idempotency_key: idempotencyKey(run.project_id, source.type, run.external_run_id),
        attempt: 1,
        sent_at: '2026-07-15T09:02:03+09:00',
        ...(overrides.delivery || {})
    };
    return {
        contract_version: 'run_receipt.v1',
        source,
        run,
        delivery,
        ...Object.fromEntries(Object.entries(overrides)
            .filter(([key]) => !['source', 'run', 'delivery'].includes(key)))
    };
}

describe('normalizeRunReceipt', () => {
    it.each([
        ['contract_version', ['contract_version']],
        ['source.type', ['source', 'type']],
        ['source.workflow_id', ['source', 'workflow_id']],
        ['run.project_id', ['run', 'project_id']],
        ['run.external_run_id', ['run', 'external_run_id']],
        ['run.status', ['run', 'status']],
        ['run.evidence_state', ['run', 'evidence_state']]
    ])('必須項目%s欠落_永続化可能な契約として受理しない', (_name, path) => {
        const receipt = makeReceipt();
        const parent = path.slice(0, -1).reduce((value, key) => value[key], receipt);
        delete parent[path.at(-1)];

        expect(() => normalizeRunReceipt(receipt)).toThrow(RunReceiptContractError);
    });

    it('有効なreceipt_決定的identityとWMC投影を返す', () => {
        const normalized = normalizeRunReceipt(makeReceipt());

        expect(normalized.identity).toEqual(createRunReceiptIdentity({
            projectId: 'brainbase',
            sourceType: 'mana',
            externalRunId: 'mana:lambda:daily-secretary:run:1',
            sourceWorkflowId: 'mana:lambda:daily-secretary'
        }));
        expect(normalized.projection).toMatchObject({
            status: 'success',
            closure_state: 'closed',
            action_required: 'none',
            human_waiting: false
        });
        expect(normalized.immutable.run.observation_kind).toBe('source_run');
        expect(normalized.payload_digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it.each(['mana', 'codex_automations', 'github_actions', 'salestailor', 'openryoko'])(
        'source.type=%s_共通契約で正規化する',
        (sourceType) => {
            const externalRunId = `${sourceType}:run:1`;
            const normalized = normalizeRunReceipt(makeReceipt({
                source: { type: sourceType, workflow_id: `${sourceType}:workflow` },
                run: { external_run_id: externalRunId }
            }));

            expect(normalized.immutable.source.type).toBe(sourceType);
            expect(normalized.immutable.run.external_run_id).toBe(externalRunId);
            expect(normalized.identity.run_id).toMatch(/^run_receipt_/);
        }
    );

    it('同じexternal_run_idでもprojectまたはsourceが違う_identityは分離される', () => {
        const baseline = normalizeRunReceipt(makeReceipt()).identity.run_id;
        const otherProject = normalizeRunReceipt(makeReceipt({
            run: { project_id: 'salestailor' }
        })).identity.run_id;
        const otherSource = normalizeRunReceipt(makeReceipt({
            source: { type: 'github_actions' }
        })).identity.run_id;

        expect(new Set([baseline, otherProject, otherSource])).toHaveLength(3);
    });

    it('deliveryのみ変更かつmetrics/evidence順序変更_同じpayload_digestになる', () => {
        const original = makeReceipt({
            run: {
                metrics: { beta: 2, alpha: 1 },
                evidence_refs: [
                    { kind: 'log_ref', ref: 'cloudwatch:log-stream/z' },
                    { kind: 'artifact_ref', ref: 's3:bucket/a' }
                ]
            }
        });
        const retry = makeReceipt({
            run: {
                metrics: { alpha: 1, beta: 2 },
                evidence_refs: [
                    { kind: 'artifact_ref', ref: 's3:bucket/a' },
                    { kind: 'log_ref', ref: 'cloudwatch:log-stream/z' }
                ]
            },
            delivery: { attempt: 9, sent_at: '2026-07-15T10:00:00Z' }
        });

        expect(normalizeRunReceipt(retry).payload_digest)
            .toBe(normalizeRunReceipt(original).payload_digest);
    });

    it.each([
        ['unsupported source', { source: { type: 'unknown' } }],
        ['unsupported status', { run: { status: 'running' } }],
        ['confirmed without evidence', { run: { evidence_state: 'confirmed', evidence_refs: [] } }],
        ['failed without action', { run: { status: 'failed', evidence_state: 'no_data', evidence_refs: [] } }],
        ['nested metrics', { run: { metrics: { processed: { value: 12 } } } }],
        ['non finite metrics', { run: { metrics: { processed: Number.POSITIVE_INFINITY } } }],
        ['finished before started', { run: { finished_at: '2026-07-15T08:59:00+09:00' } }],
        ['http evidence', { run: { evidence_refs: [{ kind: 'url', ref: 'http://example.com/log' }] } }],
        ['credentialed opaque HTTPS ref', { run: { evidence_refs: [{ kind: 'log_ref', ref: 'https://user:password@example.invalid/log' }] } }],
        ['credentialed opaque source ref', { run: { evidence_refs: [{ kind: 'artifact_ref', ref: 'cloudwatch:user:password@example.invalid/log' }] } }],
        ['oversized summary', { run: { summary: 'x'.repeat(501) } }],
        ['multiline blocker', { run: { blocker_reason: 'line1\nline2' } }]
    ])('%s_契約エラーになる', (_name, overrides) => {
        expect(() => normalizeRunReceipt(makeReceipt(overrides))).toThrow(RunReceiptContractError);
    });

    it.each([
        [
            'started_atとfinished_atの両方がない',
            (receipt) => {
                delete receipt.run.started_at;
                delete receipt.run.finished_at;
            },
            'missing_timestamp'
        ],
        [
            'delivery.idempotency_keyがない',
            (receipt) => {
                delete receipt.delivery.idempotency_key;
            },
            'missing_string'
        ],
        [
            'started_atがRFC3339でない',
            (receipt) => {
                receipt.run.started_at = '2026-07-15 09:00:00';
            },
            'invalid_timestamp'
        ],
        [
            'finished_atがRFC3339でない',
            (receipt) => {
                receipt.run.finished_at = 'not-a-timestamp';
            },
            'invalid_timestamp'
        ],
        [
            'blockedなのにblocker_reasonも非none action_requiredもない',
            (receipt) => {
                receipt.run.status = 'blocked';
                receipt.run.evidence_state = 'no_data';
                receipt.run.evidence_refs = [];
            },
            'missing_failure_action'
        ]
    ])('%s_専用契約エラーになる', (_name, mutate, code) => {
        const receipt = makeReceipt();
        mutate(receipt);

        expect(() => normalizeRunReceipt(receipt))
            .toThrowError(expect.objectContaining({ code }));
    });

    it('opaque evidence refのsource-owned colonはcredentialでなければ保持する', () => {
        const normalized = normalizeRunReceipt(makeReceipt({
            run: {
                evidence_refs: [
                    { kind: 'log_ref', ref: 'cloudwatch:log-group:log-stream/example' },
                    { kind: 'artifact_ref', ref: 's3:bucket/path:with:colon' }
                ]
            }
        }));

        expect(normalized.immutable.run.evidence_refs).toEqual([
            { kind: 'artifact_ref', ref: 's3:bucket/path:with:colon' },
            { kind: 'log_ref', ref: 'cloudwatch:log-group:log-stream/example' }
        ]);
    });

    it.each([
        { run: { metadata: { raw_log: 'secret' } } },
        { source: { nested: [{ customerText: 'customer prose' }] } },
        { delivery: { payload: { ok: true } } },
        { run: { metrics: { transcript_count: 1 } } }
    ])('禁止キーが深い階層やmetric名にある_契約エラーになる', (overrides) => {
        expect(() => normalizeRunReceipt(makeReceipt(overrides))).toThrow(RunReceiptContractError);
    });

    it('idempotency_keyがcanonical tupleと不一致_契約エラーになる', () => {
        expect(() => normalizeRunReceipt(makeReceipt({
            delivery: { idempotency_key: `rr1_${'0'.repeat(64)}` }
        }))).toThrowError(expect.objectContaining({ code: 'invalid_idempotency_key' }));
    });

    it('connector_observation不変条件を満たさない_契約エラーになる', () => {
        expect(() => normalizeRunReceipt(makeReceipt({
            run: {
                observation_kind: 'connector_observation',
                status: 'success',
                evidence_state: 'confirmed'
            }
        }))).toThrowError(expect.objectContaining({ code: 'invalid_connector_observation' }));
    });

    it('connector_observation予約workflow IDを通常source runとして送る_契約エラーになる', () => {
        expect(() => normalizeRunReceipt(makeReceipt({
            source: {
                workflow_id: '__connector_observation__'
            }
        }))).toThrowError(expect.objectContaining({ code: 'invalid_connector_observation' }));
    });

    it('有効なconnector_observation_通常source runと区別した正規化値を返す', () => {
        const normalized = normalizeRunReceipt(makeReceipt({
            source: {
                workflow_id: '__connector_observation__'
            },
            run: {
                observation_kind: 'connector_observation',
                status: 'blocked',
                evidence_state: 'unconfirmed',
                evidence_refs: [],
                blocker_reason: 'source run identity unavailable',
                action_required: 'check_error'
            }
        }));

        expect(normalized.immutable.run.observation_kind).toBe('connector_observation');
    });

    it.each([
        'none',
        'check_error',
        'resolve_blocker',
        'review_run',
        'retry_run',
        'reauthorize',
        'contact_owner'
    ])('action_required=%s_契約値として保持される', (actionRequired) => {
        const normalized = normalizeRunReceipt(makeReceipt({
            run: { action_required: actionRequired }
        }));

        expect(normalized.immutable.run.action_required).toBe(actionRequired);
        expect(normalized.projection.action_required).toBe(actionRequired === 'none' ? 'none' : actionRequired);
    });

    it('未知のaction_required_専用契約エラーになる', () => {
        expect(() => normalizeRunReceipt(makeReceipt({
            run: { action_required: 'restart_everything' }
        }))).toThrowError(expect.objectContaining({ code: 'unsupported_action_required' }));
    });

    it.each([
        ['failed', 'failed', 'needs_action', 'check_error'],
        ['blocked', 'needs_action', 'needs_action', 'resolve_blocker'],
        ['waiting_human', 'waiting_human', 'open', 'review_run'],
        ['cancelled', 'cancelled', 'closed', 'none']
    ])('%s_WMC statusへ投影する', (sourceStatus, status, closureState, actionRequired) => {
        const run = {
            status: sourceStatus,
            evidence_state: 'no_data',
            evidence_refs: []
        };
        if (sourceStatus === 'failed' || sourceStatus === 'blocked') {
            run.blocker_reason = 'source reported a blocker';
        }
        const normalized = normalizeRunReceipt(makeReceipt({ run }));
        expect(normalized.projection).toMatchObject({
            status,
            closure_state: closureState,
            action_required: actionRequired
        });
    });
});
