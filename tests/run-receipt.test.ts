import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
    RunReceiptContractError,
    createRunReceiptIdentity,
    normalizeRunReceipt
} from '../src/run-receipt.js';

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

    it('replayのoriginal failureとseparate caseに同じ証拠だけを指定した場合は閉鎖しない', () => {
        const sharedFailureEvidence = { kind: 'artifact_ref', ref: 's3:meeting/replay-failure.json' };
        const receipt = makeReceipt({
            run: {
                judgment_trace: {
                    schema_version: 'meeting_judgment_trace.v1',
                    dag: { id: 'meeting-minutes', version: '2026-09-16' },
                    nodes: [{
                        id: 'glossary_lookup',
                        status: 'completed',
                        evidence_refs: [{ kind: 'log_ref', ref: 'cloudwatch:meeting/judgment' }]
                    }],
                    glossary: { coverage: 'confirmed', term_refs: [], unresolved_count: 0 },
                    quality: {
                        status: 'confirmed',
                        evidence_refs: [{ kind: 'log_ref', ref: 'cloudwatch:meeting/judgment' }],
                        issue_codes: []
                    },
                    corrections: [],
                    replay: {
                        status: 'confirmed',
                        evidence_refs: [{ kind: 'log_ref', ref: 'cloudwatch:meeting/replay' }],
                        verified_run_ids: ['meeting-replay-1'],
                        changed_version_refs: [{ kind: 'artifact_ref', ref: 's3:meeting/judgment-v2.json' }],
                        original_failure_refs: [sharedFailureEvidence],
                        separate_case_refs: [sharedFailureEvidence]
                    }
                }
            }
        });

        expect(() => normalizeRunReceipt(receipt)).toThrowError(expect.objectContaining({
            code: 'missing_replay_evidence'
        }));
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

    it('OpenClawの完全なcron task run IDとjob ID一致を受理する', () => {
        const jobId = 'd3c43b77-4c09-4b95-8f7f-fc44e83b68dd';
        const taskRunId = `cron:${jobId}:1790643194897:a8126ee9-08f9-432a-8423-289ec678a41c`;
        const normalized = normalizeRunReceipt(makeReceipt({
            source: { type: 'openclaw', workflow_id: jobId },
            run: { external_run_id: taskRunId }
        }));
        expect(normalized.run.external_run_id).toBe(taskRunId);
    });

    it.each([
        ['session IDだけ', 'agent:main:session', 'd3c43b77-4c09-4b95-8f7f-fc44e83b68dd'],
        ['短縮したtask run ID', 'cron:job-1:1790643194897:run-1', 'job-1'],
        ['別jobのtask run ID', 'cron:d3c43b77-4c09-4b95-8f7f-fc44e83b68dd:1790643194897:a8126ee9-08f9-432a-8423-289ec678a41c', 'dd303385-e978-4736-aae9-8e6b72460afd']
    ])('OpenClawの%sを拒否する', (_label, externalRunId, workflowId) => {
        expect(() => normalizeRunReceipt(makeReceipt({
            source: { type: 'openclaw', workflow_id: workflowId },
            run: { external_run_id: externalRunId }
        }))).toThrowError(expect.objectContaining({ code: 'invalid_openclaw_run_identity' }));
    });

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

function makeOrcaCollectorReceipt() {
    return {
        contract_version: 'run_receipt.v1',
        source: {
            type: 'orca',
            workflow_id: 'agent_test_01',
            name: 'ノヴ｜インフラ',
            runtime_target: 'unson-lightsail-orca-01:ci'
        },
        run: {
            project_id: 'unson',
            external_run_id: 'orca:agent_test_01:20261128T0340Z',
            status: 'success',
            evidence_state: 'confirmed',
            started_at: '2026-11-28T03:40:00.000Z',
            finished_at: '2026-11-28T03:40:20.056Z',
            summary: 'Orca bot ci 5m snapshot: status=success, active_workers=0, needs_you=0, open_items=4, stalled=false, cost_usd_24h=unavailable',
            action_required: 'none',
            metrics: {
                active_workers: 0,
                needs_you_count: 0,
                open_items_count: 4,
                stalled: false,
                stall_age_sec: null,
                heartbeat_age_sec: 774,
                cost_usd_24h: null,
                cost_is_estimated: null,
                tokens_input_24h: null,
                tokens_output_24h: null
            },
            evidence_refs: [
                { kind: 'artifact_ref', ref: 'orca-snapshot:unson-lightsail-orca-01/ci/20261128T0340Z', label: 'Orca 5m bot snapshot' },
                { kind: 'log_ref', ref: 'orca-collector:unson-lightsail-orca-01/ci/20261128T0340Z', label: 'Orca 5m collector run' }
            ]
        },
        delivery: {
            idempotency_key: idempotencyKey('unson', 'orca', 'orca:agent_test_01:20261128T0340Z'),
            attempt: 1,
            sent_at: '2026-11-28T03:40:20.056Z'
        }
    };
}

describe('Orca run receipts', () => {
    it('accepts the PR-1C collector payload and deduplicates delivery retries', () => {
        const receipt = makeOrcaCollectorReceipt();
        const normalized = normalizeRunReceipt(receipt);
        expect(normalized.immutable).toEqual({
            contract_version: receipt.contract_version,
            source: receipt.source,
            run: { ...receipt.run, observation_kind: 'source_run' }
        });
        expect(normalized.identity.idempotency_key).toBe(receipt.delivery.idempotency_key);

        const retry = normalizeRunReceipt({
            ...receipt,
            delivery: { ...receipt.delivery, attempt: 2, sent_at: '2026-11-28T03:41:00Z' }
        });
        expect(retry.identity).toEqual(normalized.identity);
        expect(retry.payload_digest).toBe(normalized.payload_digest);
    });

    it('accepts the collector failure shape with finished_at and blocker_reason', () => {
        const { started_at, ...run } = makeOrcaCollectorReceipt().run;
        const receipt = makeOrcaCollectorReceipt();
        expect(normalizeRunReceipt({
            ...receipt,
            run: { ...run, status: 'blocked', blocker_reason: 'worker stalled', action_required: 'resolve_blocker' }
        }).run.blocker_reason).toBe('worker stalled');
    });

    it.each([1.25, 0, null])('preserves cost %s and optional Orca fields', (cost) => {
        const receipt = makeOrcaCollectorReceipt();
        const fields = {
            cost_basis: 'run_estimated',
            observed_at: '2024-02-29T23:59:59.123+09:00',
            stall_reason: 'x'.repeat(300)
        };
        const metrics = {
            ...receipt.run.metrics,
            cost_usd: cost,
            cost_usd_24h: cost,
            staleness_threshold_sec: cost === null ? null : 1800
        };
        const normalized = normalizeRunReceipt({
            ...receipt,
            run: { ...receipt.run, ...fields, metrics }
        });
        expect(normalized.immutable.run).toMatchObject({ ...fields, metrics });
        const baseline = normalizeRunReceipt(receipt);
        expect(normalized.identity).toEqual(baseline.identity);
        expect(normalized.payload_digest).not.toBe(baseline.payload_digest);
    });

    it.each(['cost_usd', 'cost_usd_24h'].flatMap((key) =>
        [-0.01, NaN, Infinity, false, '1'].map((value) => [key, value] as const)
    ))('rejects %s=%s', (key, value) => {
        const receipt = makeOrcaCollectorReceipt();
        expect(() => normalizeRunReceipt({
            ...receipt,
            run: { ...receipt.run, metrics: { ...receipt.run.metrics, [key]: value } }
        })).toThrowError(expect.objectContaining({
            code: 'invalid_orca_cost', details: { path: `run.metrics.${key}` }
        }));
    });

    it.each([0, -1, 1.5, '1800', false, Infinity])('rejects staleness threshold %s', (value) => {
        const receipt = makeOrcaCollectorReceipt();
        expect(() => normalizeRunReceipt({
            ...receipt,
            run: { ...receipt.run, metrics: { ...receipt.run.metrics, staleness_threshold_sec: value } }
        })).toThrowError(expect.objectContaining({ code: 'invalid_orca_staleness_threshold' }));
    });

    it.each([
        ['cost_basis', 'measured', 'unsupported_orca_cost_basis'],
        ['cost_basis', null, 'unsupported_orca_cost_basis'],
        ['observed_at', '2026-11-28', 'invalid_timestamp'],
        ['observed_at', '2026-11-28T03:40:00', 'invalid_timestamp'],
        ['observed_at', '2026-02-29T03:40:00Z', 'invalid_timestamp'],
        ['observed_at', '2026-11-28T24:00:00Z', 'invalid_timestamp'],
        ['observed_at', null, 'invalid_timestamp'],
        ['stall_reason', 'line1\nline2', 'invalid_string'],
        ['stall_reason', 'a\u0085b', 'invalid_string'],
        ['stall_reason', 'a\u2028b', 'invalid_string'],
        ['stall_reason', 'a\u0000b', 'invalid_string'],
        ['stall_reason', 'x'.repeat(301), 'string_too_long'],
        ['stall_reason', null, 'missing_string'],
        ['evidence_refs', [], 'missing_confirmed_evidence'],
        ['metrics', { raw_count: 1 }, 'forbidden_metric_name'],
        ['metrics', { active_workers: '0' }, 'invalid_metric_value'],
        ['unexpected', true, 'unknown_field']
    ])('validates run.%s with %s', (field, value, code) => {
        const receipt = makeOrcaCollectorReceipt();
        expect(() => normalizeRunReceipt({
            ...receipt,
            run: { ...receipt.run, [field]: value }
        })).toThrowError(expect.objectContaining({ code }));
    });

    it('rejects a mismatched idempotency key', () => {
        const receipt = makeOrcaCollectorReceipt();
        receipt.delivery.idempotency_key = idempotencyKey('unson', 'mana', receipt.run.external_run_id);
        expect(() => normalizeRunReceipt(receipt))
            .toThrowError(expect.objectContaining({ code: 'invalid_idempotency_key' }));
    });

    it.each(['observed_at', 'cost_basis', 'stall_reason'])('rejects run.%s on non-Orca sources', (field) => {
        expect(() => normalizeRunReceipt(makeReceipt({ run: { [field]: null } })))
            .toThrowError(expect.objectContaining({ code: 'unknown_field', details: { path: `run.${field}` } }));
    });

    it('keeps the common numeric metric rules for non-Orca sources', () => {
        const metrics = { cost_usd: -1, cost_usd_24h: false, staleness_threshold_sec: 0.5 };
        expect(normalizeRunReceipt(makeReceipt({ run: { metrics } })).run.metrics).toEqual(metrics);
    });
});
