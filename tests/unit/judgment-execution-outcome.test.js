import { describe, expect, it } from 'vitest';

import { normalizeJudgmentExecutionOutcome } from '../../server/services/judgment-execution-outcome.js';

describe('portable judgment execution outcome', () => {
    it.each(['codex', 'claude-code'])('%sの完了を同じ共通契約へ正規化する', (host) => {
        expect(normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: host, adapter_id: `${host}-hooks`, adapter_version: '1' },
            execution_id: `${host}-session-1`,
            turn_id: 'turn-1',
            scope: 'external_effect',
            status: 'completed',
            stage: 'readback',
            evidence: { state: 'confirmed', refs: ['receipt:1'] }
        })).toMatchObject({
            status: 'completed',
            stage: 'readback',
            failure: null,
            resume_from: null
        });
    });

    it.each(['partial', 'failed', 'blocked', 'unknown'])('%sでは失敗理由と再開地点を必須にする', (status) => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: 'claude-code', adapter_id: 'claude-code-hooks', adapter_version: '1' },
            execution_id: 'claude-session-1',
            turn_id: 'turn-1',
            scope: 'host_turn',
            status,
            stage: 'execute',
            evidence: { state: 'unconfirmed', refs: [] }
        })).toThrow(/failure and resume_from are required/);
    });

    it('ホスト固有ログのパスを共通契約に持ち込ませない', () => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: 'codex', adapter_id: 'codex-hooks', adapter_version: '1' },
            execution_id: 'session-1',
            turn_id: 'turn-1',
            scope: 'host_turn',
            status: 'completed',
            stage: 'finalize',
            evidence: { state: 'confirmed', refs: [] },
            transcript_path: '/tmp/session.jsonl'
        })).toThrow(/transcript_path is not allowed/);
    });

    it('証拠参照にもローカル絶対パスを持ち込ませない', () => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: 'codex', adapter_id: 'codex-hooks', adapter_version: '1' },
            execution_id: 'session-1', turn_id: 'turn-1', scope: 'host_turn', status: 'completed', stage: 'finalize',
            evidence: { state: 'confirmed', refs: ['/Users/example/.codex/session.jsonl'] }
        })).toThrow(/evidence.refs is invalid/);
    });

    it.each([
        { state: 'unconfirmed', refs: ['receipt:1'] },
        { state: 'no_data', refs: [] },
        { state: 'confirmed', refs: [] }
    ])('完了を未確認の証拠で確定させない: $state', (evidence) => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: 'codex', adapter_id: 'codex-hooks', adapter_version: '1' },
            execution_id: 'session-1', turn_id: 'turn-1', scope: 'host_turn', status: 'completed', stage: 'finalize',
            evidence
        })).toThrow(/confirmed evidence refs/);
    });

    it('外部作用は受信側の読戻し前に完了としない', () => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: 'claude-code', adapter_id: 'claude-code-hooks', adapter_version: '1' },
            execution_id: 'session-1', turn_id: 'turn-1', scope: 'external_effect', status: 'completed', stage: 'deliver',
            evidence: { state: 'confirmed', refs: ['queue-receipt:1'] }
        })).toThrow(/requires readback/);
    });

    it.each(['open', 'resolve', 'execute', 'deliver', 'readback'])('Host turnはfinalize前後の途中段階を完了としない: %s', (stage) => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: 'codex', adapter_id: 'codex-hooks', adapter_version: '1' },
            execution_id: 'session-1', turn_id: 'turn-1', scope: 'host_turn', status: 'completed', stage,
            evidence: { state: 'confirmed', refs: ['journal:1'] }
        })).toThrow(/requires finalize/);
    });

    it.each(['other-agent', ''])('未登録Hostを拒否する: %s', (host) => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: host, adapter_id: 'hooks', adapter_version: '1' },
            execution_id: 'session-1', turn_id: 'turn-1', scope: 'host_turn', status: 'completed', stage: 'finalize',
            evidence: { state: 'confirmed', refs: ['journal:1'] }
        })).toThrow(/host.type/);
    });

    it.each(['   ', 'receipt:\n1', `receipt:${'x'.repeat(513)}`])('不正な証拠参照を拒否する', (reference) => {
        expect(() => normalizeJudgmentExecutionOutcome({
            schema_version: 'judgment_execution_outcome.v1',
            host: { type: 'codex', adapter_id: 'codex-hooks', adapter_version: '1' },
            execution_id: 'session-1', turn_id: 'turn-1', scope: 'host_turn', status: 'completed', stage: 'finalize',
            evidence: { state: 'confirmed', refs: [reference] }
        })).toThrow(/evidence.refs is invalid/);
    });
});
