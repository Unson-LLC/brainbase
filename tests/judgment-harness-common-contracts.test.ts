import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  normalizeJudgmentExecutionOutcome,
  type JudgmentExecutionOutcome
} from '../src/judgment-execution-outcome.js';
import {
  evaluateJudgmentNodeEvidence,
  normalizeJudgmentNodeResult,
  type JudgmentNodeResult
} from '../src/judgment-node-evidence.js';
import {
  sanitizeJudgmentAnswer,
  toKnowledgeEventFromJudgmentEpisode
} from '../src/judgment-event-adapter.js';

const completedOutcome: JudgmentExecutionOutcome = {
  schema_version: 'judgment_execution_outcome.v1',
  host: { type: 'codex', adapter_id: 'codex-host', adapter_version: '1' },
  execution_id: 'execution-1',
  turn_id: 'turn-1',
  scope: 'host_turn',
  status: 'completed',
  stage: 'finalize',
  failure: null,
  resume_from: null,
  evidence: { state: 'confirmed', refs: ['receipt:turn-1'] }
};

const baseNodeResult = (overrides: Partial<JudgmentNodeResult> = {}): JudgmentNodeResult => ({
  schema_version: 'brainbase-judgment-node-result-v1',
  node_id: 'problem-frame',
  status: 'supported',
  finding: 'The question is bounded.',
  evidence_fit: 'The earlier inspection directly covers the question.',
  unknowns: [],
  evidence_tool_use_ids: ['work-1'],
  previous_result_tool_use_id: null,
  next_action: 'Continue to observe.',
  ...overrides
});

const node = (id: string, instruction = `Execute ${id}.`) => ({
  id,
  kind: 'judgment',
  instruction,
  required_capability_template: null,
  execution_contract: 'judgment-node-evidence-v1'
});

const receipt = (...nodes: string[]) => ({ active_node_definitions: nodes.map((id) => node(id)) });

const event = (toolUseId: string, eventSequence: number, overrides: Record<string, unknown> = {}) => ({
  event_kind: 'execution',
  success: true,
  tool_name: 'mcp__example__inspect',
  tool_use_id: toolUseId,
  event_sequence: eventSequence,
  safe_metadata: {},
  ...overrides
});

const nodeEvent = (toolUseId: string, eventSequence: number, result: JudgmentNodeResult) => event(toolUseId, eventSequence, {
  event_kind: 'node_evidence',
  tool_name: 'mcp__brainbase__brainbase_judgment_node_record',
  safe_metadata: { node_result: result }
});

describe('portable judgment harness common contracts', () => {
  it('normalizes completed and resumable execution outcomes with runtime parity', () => {
    expect(normalizeJudgmentExecutionOutcome(completedOutcome)).toEqual(completedOutcome);
    expect(() => normalizeJudgmentExecutionOutcome({
      ...completedOutcome,
      evidence: { state: 'confirmed', refs: ['/private/transcript.json'] }
    })).toThrow('evidence.refs is invalid');
    expect(() => normalizeJudgmentExecutionOutcome({
      ...completedOutcome,
      transcript_path: '/private/transcript.json'
    })).toThrow('outcome.transcript_path is not allowed');
    expect(() => normalizeJudgmentExecutionOutcome({
      ...completedOutcome,
      status: 'partial',
      stage: 'execute',
      evidence: { state: 'unconfirmed', refs: [] }
    })).toThrow('failure and resume_from are required');
    expect(normalizeJudgmentExecutionOutcome({
      ...completedOutcome,
      scope: 'external_effect',
      stage: 'readback'
    })).toMatchObject({ scope: 'external_effect', stage: 'readback' });
  });

  it('keeps node evidence exact and binds only earlier successful business events', () => {
    expect(normalizeJudgmentNodeResult(baseNodeResult())).toEqual(baseNodeResult());
    expect(normalizeJudgmentNodeResult({ ...baseNodeResult(), extra: true })).toBeNull();
    expect(normalizeJudgmentNodeResult({ ...baseNodeResult(), finding: 'token=private' })).toBeNull();
    expect(normalizeJudgmentNodeResult({ ...baseNodeResult(), status: 'insufficient', unknowns: [] })).toBeNull();

    const results = [
      baseNodeResult(),
      baseNodeResult({
        node_id: 'observe',
        previous_result_tool_use_id: 'node-problem',
        evidence_tool_use_ids: ['work-2']
      })
    ];
    expect(evaluateJudgmentNodeEvidence([
      event('work-1', 1),
      nodeEvent('node-problem', 2, results[0]),
      event('work-2', 3),
      nodeEvent('node-observe', 4, results[1])
    ], receipt('problem-frame', 'observe'))).toMatchObject({
      required: true,
      ready: true,
      status: 'ready',
      next_node: null
    });

    const control = evaluateJudgmentNodeEvidence([
      event('control', 1, { event_kind: 'evidence', tool_name: 'mcp__brainbase__brainbase_knowledge_evidence_record' }),
      nodeEvent('node-problem', 2, baseNodeResult({ evidence_tool_use_ids: ['control'] }))
    ], receipt('problem-frame'));
    expect(control).toMatchObject({ ready: false, status: 'invalid', next_node: 'problem-frame' });
  });

  it('requires fresh business evidence after an insufficient node result', () => {
    const insufficient = baseNodeResult({
      status: 'insufficient',
      finding: 'The available evidence is not enough.',
      evidence_fit: 'The inspection leaves a key uncertainty.',
      unknowns: ['Need a second inspection.'],
      next_action: 'Perform a second inspection.'
    });
    const retry = baseNodeResult({ evidence_tool_use_ids: ['work-1'] });
    expect(evaluateJudgmentNodeEvidence([
      event('work-1', 1),
      nodeEvent('first', 2, insufficient),
      nodeEvent('retry', 3, retry)
    ], receipt('problem-frame'))).toMatchObject({ ready: false, status: 'insufficient' });
    expect(evaluateJudgmentNodeEvidence([
      event('work-1', 1),
      nodeEvent('first', 2, insufficient),
      event('work-2', 3),
      nodeEvent('retry', 4, { ...retry, evidence_tool_use_ids: ['work-1', 'work-2'] })
    ], receipt('problem-frame'))).toMatchObject({ ready: true, status: 'ready' });
  });

  it('projects a completed answer without authority and quarantines secrets', () => {
    expect(sanitizeJudgmentAnswer('🧠 判断参照: audit\n本文')).toEqual({ sensitive: false, summary: '本文' });
    expect(sanitizeJudgmentAnswer('password=private-value')).toEqual({ sensitive: true, redaction_status: 'needs_redaction' });
    const event = toKnowledgeEventFromJudgmentEpisode({
      episode_id: 'episode-1',
      session_id: 'session-1',
      turn_id: 'turn-1',
      finalized_at: '2026-10-18T00:00:00.000Z',
      answer_digest: 'digest-1',
      completion_status: 'complete',
      final_answer: 'The answer',
      execution_outcome: completedOutcome
    });
    expect(event).toMatchObject({
      schema_version: 'knowledge_event.v1',
      source: { type: 'codex_judgment', ref: 'execution-1:turn-1' },
      decision_authority: { authorized: false, graph_promotion_allowed: false },
      applicability_scope: { scope: 'judgment_episode', project_code: 'brainbase' },
      payload: { summary: 'The answer' }
    });
    expect(event?.source_pointer.uri).toBe('brainbase-judgment://codex/execution-1#turn=turn-1');
    expect(toKnowledgeEventFromJudgmentEpisode({
      episode_id: 'episode-2',
      session_id: 'session-1',
      turn_id: 'turn-2',
      finalized_at: '2026-10-18T00:00:00.000Z',
      answer_digest: 'digest-2',
      completion_status: 'complete',
      final_answer: 'password=private-value'
    })).toMatchObject({ semantic_state: 'quarantined', payload: { redaction_status: 'needs_redaction' } });
    expect(toKnowledgeEventFromJudgmentEpisode({ completion_status: 'partial' })).toBeNull();
  });

  it('publishes the existing Host and the portable contracts through package exports', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    for (const name of [
      './judgment-host',
      './judgment-execution-outcome',
      './judgment-node-evidence',
      './judgment-event-adapter'
    ]) {
      expect(packageJson.exports[name]).toEqual({
        types: expect.stringMatching(/^\.\/dist\/.+\.d\.ts$/u),
        import: expect.stringMatching(/^\.\/dist\/.+\.js$/u)
      });
    }
  });
});
