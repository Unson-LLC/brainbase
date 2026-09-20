import { describe, expect, it } from 'vitest';

import {
    evaluateJudgmentNodeEvidence,
    normalizeJudgmentNodeResult,
} from '../../scripts/codex-hooks/judgment-node-evidence.mjs';

const baseResult = (overrides = {}) => ({
    schema_version: 'brainbase-judgment-node-result-v1',
    node_id: 'problem-frame',
    status: 'supported',
    finding: 'The question is bounded.',
    evidence_fit: 'The earlier inspection directly covers the question.',
    unknowns: [],
    evidence_tool_use_ids: ['work-1'],
    previous_result_tool_use_id: null,
    next_action: 'Continue to observe.',
    ...overrides,
});

const node = (id, instruction = `Execute ${id}.`) => ({
    id,
    kind: 'judgment',
    instruction,
    required_capability_template: null,
    execution_contract: 'judgment-node-evidence-v1',
});

const receipt = (...nodes) => ({ active_node_definitions: nodes.map((id) => node(id)) });

const event = (toolUseId, eventSequence, overrides = {}) => ({
    event_kind: 'execution',
    success: true,
    tool_name: 'mcp__example__inspect',
    tool_use_id: toolUseId,
    event_sequence: eventSequence,
    safe_metadata: {},
    ...overrides,
});

const nodeEvent = (toolUseId, eventSequence, result) => event(toolUseId, eventSequence, {
    event_kind: 'node_evidence',
    tool_name: 'mcp__brainbase__brainbase_judgment_node_record',
    safe_metadata: { node_result: result },
});

describe('judgment node evidence', () => {
    it('normalizes the exact v1 shape and rejects secrets, duplicates, and extra keys', () => {
        expect(normalizeJudgmentNodeResult(baseResult())).toEqual(baseResult());
        expect(normalizeJudgmentNodeResult({ ...baseResult(), unknowns: ['same', 'same'] })).toBeNull();
        expect(normalizeJudgmentNodeResult({ ...baseResult(), extra: true })).toBeNull();
        expect(normalizeJudgmentNodeResult({ ...baseResult(), finding: 'token=private-value' })).toBeNull();
        expect(normalizeJudgmentNodeResult({
            ...baseResult(), status: 'insufficient', unknowns: [],
        })).toBeNull();
    });

    it('keeps legacy/direct routes compatible when no node contract is opted in', () => {
        expect(evaluateJudgmentNodeEvidence([], {
            active_node_definitions: [{
                id: 'entry', kind: 'common', instruction: 'Execute entry.', required_capability_template: null,
            }],
        })).toEqual({
            required: false, ready: true, status: 'not_required', next_node: null, next_action: null, results: [],
        });
    });

    it('returns the first opted-in node and concrete action when no result exists', () => {
        const result = evaluateJudgmentNodeEvidence([], receipt('problem-frame', 'observe'));
        expect(result.required).toBe(true);
        expect(result.ready).toBe(false);
        expect(result.status).toBe('missing');
        expect(result.next_node).toBe('problem-frame');
        expect(result.next_action).toMatch(/Execute problem-frame/);
    });

    it('requires successful earlier business evidence and accepts a complete ordered chain', () => {
        const results = [
            baseResult(),
            baseResult({
                node_id: 'observe', previous_result_tool_use_id: 'node-problem',
                evidence_tool_use_ids: ['work-2'],
            }),
        ];
        const evaluation = evaluateJudgmentNodeEvidence([
            event('work-1', 1),
            nodeEvent('node-problem', 2, results[0]),
            event('work-2', 3),
            nodeEvent('node-observe', 4, results[1]),
        ], receipt('problem-frame', 'observe'));
        expect(evaluation.ready).toBe(true);
        expect(evaluation.status).toBe('ready');
        expect(evaluation.next_node).toBeNull();
        expect(evaluation.results.map((entry) => [entry.node_id, entry.tool_use_id])).toEqual([
            ['problem-frame', 'node-problem'], ['observe', 'node-observe'],
        ]);
    });

    it('allows the problem frame to be supported before any business evidence exists', () => {
        const result = evaluateJudgmentNodeEvidence([
            nodeEvent('node-problem', 1, baseResult({ evidence_tool_use_ids: [] })),
        ], receipt('problem-frame'));
        expect(result.ready).toBe(true);
        expect(result.status).toBe('ready');
    });

    it('rejects a downstream result that points to a later result in the event sequence', () => {
        const result = evaluateJudgmentNodeEvidence([
            event('work-1', 1),
            nodeEvent('node-observe', 3, baseResult({
                node_id: 'observe',
                previous_result_tool_use_id: 'node-problem',
                evidence_tool_use_ids: ['work-1'],
            })),
            nodeEvent('node-problem', 4, baseResult()),
        ], receipt('problem-frame', 'observe'));
        expect(result.ready).toBe(false);
        expect(result.status).toBe('invalid');
        expect(result.next_node).toBe('observe');
        expect(result.next_action).toMatch(/結び直して/);
    });

    it.each(['failed', 'control', 'record', 'empty-search', 'tools-search', 'clock'])('rejects %s as node evidence', (evidenceId) => {
        const result = evaluateJudgmentNodeEvidence([
            event('failed', 1, { success: false }),
            event('control', 2, { tool_name: 'mcp__codex__get_goal' }),
            event('record', 3, { event_kind: 'evidence', tool_name: 'mcp__brainbase__brainbase_knowledge_evidence_record' }),
            event('empty-search', 4, { safe_metadata: { retrieval_outcome: 'empty' } }),
            event('tools-search', 5, { tool_name: 'mcp__codex__tools_search' }),
            event('clock', 6, { tool_name: 'mcp__codex__clock' }),
            nodeEvent('node-problem', 7, baseResult({ evidence_tool_use_ids: [evidenceId] })),
        ], receipt('problem-frame'));
        expect(result.ready).toBe(false);
        expect(result.status).toBe('invalid');
        expect(result.next_node).toBe('problem-frame');
    });

    it('accepts a successful business event with a null retrieval outcome', () => {
        const result = evaluateJudgmentNodeEvidence([
            event('test-run', 1, { event_kind: 'execute', safe_metadata: { retrieval_outcome: null } }),
            nodeEvent('node-problem', 2, baseResult({ evidence_tool_use_ids: ['test-run'] })),
        ], receipt('problem-frame'));
        expect(result.ready).toBe(true);
    });

    it('invalidates a downstream result when the upstream result is replaced', () => {
        const original = baseResult();
        const replacement = baseResult({ finding: 'The question was narrowed differently.' });
        const downstream = baseResult({
            node_id: 'observe', previous_result_tool_use_id: 'node-problem-old', evidence_tool_use_ids: ['work-2'],
        });
        const result = evaluateJudgmentNodeEvidence([
            event('work-1', 1),
            nodeEvent('node-problem-old', 2, original),
            event('work-2', 3),
            nodeEvent('node-observe-old', 4, downstream),
            event('work-3', 5),
            nodeEvent('node-problem-new', 6, replacement),
        ], receipt('problem-frame', 'observe'));
        expect(result.ready).toBe(false);
        expect(result.status).toBe('invalid');
        expect(result.next_node).toBe('observe');
        expect(result.next_action).toMatch(/結び直して/);
    });

    it('requires new actual evidence after an insufficient result before supporting a retry', () => {
        const insufficient = baseResult({
            status: 'insufficient', finding: 'The available evidence is not enough.',
            evidence_fit: 'The inspection leaves a key uncertainty.', unknowns: ['Need a second inspection.'],
            evidence_tool_use_ids: ['work-1'], next_action: 'Perform a second inspection.',
        });
        const retryWithoutNewEvidence = baseResult({
            evidence_tool_use_ids: ['work-1'],
        });
        const retryWithNewEvidence = baseResult({
            evidence_tool_use_ids: ['work-1', 'work-3'],
        });
        const firstRetry = evaluateJudgmentNodeEvidence([
            event('work-1', 1),
            nodeEvent('node-insufficient', 2, insufficient),
            nodeEvent('node-retry', 3, retryWithoutNewEvidence),
        ], receipt('problem-frame'));
        expect(firstRetry.ready).toBe(false);
        expect(firstRetry.status).toBe('insufficient');
        expect(firstRetry.next_node).toBe('problem-frame');

        const secondRetry = evaluateJudgmentNodeEvidence([
            event('work-1', 1),
            nodeEvent('node-insufficient', 2, insufficient),
            event('work-3', 3),
            nodeEvent('node-retry', 4, retryWithNewEvidence),
        ], receipt('problem-frame'));
        expect(secondRetry.ready).toBe(true);
    });
    it.each(['brainbase_projects', 'brainbase_admin_read', 'brainbase_run_receipt_inbox', 'brainbase_run_receipt_history', 'authorize_tenant_resource'])('rejects control-plane retrieval %s', (name) => {
        const result = evaluateJudgmentNodeEvidence([
            event('work-1', 1, { event_kind: 'retrieve', tool_name: `mcp__brainbase__${name}`, safe_metadata: { retrieval_outcome: 'result' } }),
            nodeEvent('node-result', 2, baseResult()),
        ], receipt('problem-frame'));
        expect(result.ready).toBe(false);
        expect(result.status).toBe('invalid');
    });

    it('accepts a personal Brainbase diagnostic read without treating it as the organization control plane', () => {
        const result = evaluateJudgmentNodeEvidence([
            event('personal-health', 1, {
                event_kind: 'retrieve',
                tool_name: 'mcp__brainbase-personal__brainbase_admin_read',
                safe_metadata: { retrieval_outcome: 'result' },
            }),
            nodeEvent('node-result', 2, baseResult({ evidence_tool_use_ids: ['personal-health'] })),
        ], receipt('problem-frame'));
        expect(result.ready).toBe(true);
    });

    it.each(['brainbase', 'brainbase-unson', 'brainbase-techknight'])(
        'rejects %s admin reads as organization control-plane evidence',
        (server) => {
            const result = evaluateJudgmentNodeEvidence([
                event('organization-health', 1, {
                    event_kind: 'retrieve',
                    tool_name: `mcp__${server}__brainbase_admin_read`,
                    safe_metadata: { retrieval_outcome: 'result' },
                }),
                nodeEvent('node-result', 2, baseResult({ evidence_tool_use_ids: ['organization-health'] })),
            ], receipt('problem-frame'));
            expect(result.status).toBe('invalid');
        },
    );

    it('rejects a personal knowledge resolver receipt as business evidence', () => {
        const result = evaluateJudgmentNodeEvidence([
            event('resolver-route', 1, {
                event_kind: 'route',
                tool_name: 'mcp__brainbase-personal__brainbase_knowledge_resolve',
            }),
            nodeEvent('node-result', 2, baseResult({ evidence_tool_use_ids: ['resolver-route'] })),
        ], receipt('problem-frame'));
        expect(result.status).toBe('invalid');
    });

    it('does not advance a repeated insufficient result without fresh evidence', () => {
        const insufficient = baseResult({ status: 'insufficient', unknowns: ['Missing observation.'], next_action: 'Advance to decide.' });
        const result = evaluateJudgmentNodeEvidence([
            event('work-1', 1),
            nodeEvent('first', 2, insufficient),
            nodeEvent('retry', 3, insufficient),
        ], receipt('problem-frame'));
        expect(result.ready).toBe(false);
        expect(result.status).toBe('insufficient');
        expect(result.next_action).not.toBe('Advance to decide.');
        expect(result.next_node).toBe('problem-frame');
    });

});
