import { describe, expect, it } from 'vitest';

import {
    ExternalRunnerContractError,
    validateExternalRunnerEnvelope
} from '../../../server/services/external-runner/contract-schema.js';

function makeAgentReportPayload(overrides = {}) {
    return {
        contract_version: 'external_runner.v0',
        runner: {
            type: 'agent_report',
            external_run_id: 'ceo-review-2026-07',
            agent_id: 'agent/ceo'
        },
        run: {
            id: 'wfr_agent_ceo_2026-07',
            project_id: 'brainbase',
            role_agent_id: 'agent_ceo',
            status: 'waiting_human'
        },
        loop_control: {
            owner_id: 'sato_keigo',
            cost_owner_id: 'sato_keigo',
            approval_owner_id: 'sato_keigo',
            stop_conditions: ['human_review_required']
        },
        context_sources: [{
            source_type: 'agent_report',
            source_ref: 'agent/ceo:2026-07'
        }],
        rounds: [{
            round_id: 'round-1',
            status: 'completed',
            evidence_refs: ['agent_report://ceo/2026-07']
        }],
        human_steps: [{
            id: 'hs_agent_ceo_2026-07',
            step_key: 'review_agent_report',
            status: 'pending',
            required_by: 'sato_keigo',
            approval_reason: 'CEOレビュー完了: モード=Growth, 来月アクション3件'
        }],
        outputs: [{
            id: 'out_agent_ceo_2026-07',
            output_type: 'report_markdown',
            preview: '先頭240字...',
            payload: { markdown: '# CEOレビュー\n\n本文...' }
        }],
        ...overrides
    };
}

describe('validateExternalRunnerEnvelope', () => {
    it('runner.type=agent_report_かつcloudflare要件なし_正常に受理される', () => {
        const payload = makeAgentReportPayload();
        const result = validateExternalRunnerEnvelope(payload);
        expect(result.runner.type).toBe('agent_report');
        expect(result.runner.trace_ref).toBeUndefined();
    });

    it('runner.type=agent_report_かつrunner_cloudflareが未指定でもtrace_refを要求しない', () => {
        const payload = makeAgentReportPayload({
            runner: {
                type: 'agent_report',
                external_run_id: 'cso-review-2026-07',
                agent_id: 'agent/cso'
                // cloudflare フィールドなし
            }
        });
        expect(() => validateExternalRunnerEnvelope(payload)).not.toThrow();
    });

    it('runner.type=cloudflare_かつtrace_refなし_ExternalRunnerContractErrorが投げられる', () => {
        const payload = makeAgentReportPayload({
            runner: {
                type: 'cloudflare_computer',
                external_run_id: 'cloudflare-run-001',
                agent_id: 'sales-agent'
                // cloudflare.trace_ref なし → cloudflare固有要件のためエラーになるはず
            }
        });
        expect(() => validateExternalRunnerEnvelope(payload)).toThrow(ExternalRunnerContractError);
    });

    it('runner_type未知_ExternalRunnerContractErrorが投げられる', () => {
        const payload = makeAgentReportPayload({
            runner: {
                type: 'unknown_runner_type',
                external_run_id: 'x-1',
                agent_id: 'agent/x'
            }
        });
        expect(() => validateExternalRunnerEnvelope(payload)).toThrow(ExternalRunnerContractError);
    });

    it('run_status_waiting_human_かつhuman_stepsが空_ExternalRunnerContractErrorが投げられる', () => {
        const payload = makeAgentReportPayload({ human_steps: [] });
        expect(() => validateExternalRunnerEnvelope(payload)).toThrow(ExternalRunnerContractError);
    });
});
