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
  DEFAULT_JUDGMENT_EVENT_PROJECT_CODE,
  isProjectCodeAllowed,
  normalizeJudgmentEventProjectCode,
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

  it('normalizes empty and whitespace previous_result_tool_use_id to null while rejecting invalid types', () => {
    expect(normalizeJudgmentNodeResult(baseNodeResult({ previous_result_tool_use_id: null }))?.previous_result_tool_use_id)
      .toBeNull();
    expect(normalizeJudgmentNodeResult(baseNodeResult({ previous_result_tool_use_id: '' }))?.previous_result_tool_use_id)
      .toBeNull();
    expect(normalizeJudgmentNodeResult(baseNodeResult({ previous_result_tool_use_id: '   \t\n  ' }))?.previous_result_tool_use_id)
      .toBeNull();
    expect(normalizeJudgmentNodeResult(baseNodeResult({ previous_result_tool_use_id: '  node-problem  ' }))?.previous_result_tool_use_id)
      .toBe('node-problem');

    for (const invalid of [undefined, 123, false, {}, []]) {
      expect(normalizeJudgmentNodeResult({
        ...baseNodeResult(),
        previous_result_tool_use_id: invalid
      })).toBeNull();
    }

    const { previous_result_tool_use_id: _omitted, ...missingPrevId } = baseNodeResult();
    expect(normalizeJudgmentNodeResult(missingPrevId)).toBeNull();

    // First node with empty previous_result_tool_use_id evaluates as ready (null chain head)
    const firstNodeWithEmptyPrev = evaluateJudgmentNodeEvidence([
      event('work-1', 1),
      nodeEvent('node-problem', 2, baseNodeResult({ previous_result_tool_use_id: '' }))
    ], receipt('problem-frame'));
    expect(firstNodeWithEmptyPrev).toMatchObject({
      required: true,
      ready: true,
      status: 'ready',
      next_node: null
    });
    expect(firstNodeWithEmptyPrev.results[0]?.previous_result_tool_use_id).toBeNull();
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

  it('propagates episode project_code, validates format, and aligns with allowedProjectCodes', () => {
    const baseEpisode = {
      episode_id: 'episode-proj-1',
      session_id: 'session-proj-1',
      turn_id: 'turn-proj-1',
      finalized_at: '2026-11-24T00:00:00.000Z',
      answer_digest: 'digest-proj-1',
      completion_status: 'complete',
      final_answer: 'Project-scoped judgment summary.'
    };

    const defaultEvent = toKnowledgeEventFromJudgmentEpisode(baseEpisode);
    const nonBrainbaseEvent = toKnowledgeEventFromJudgmentEpisode({
      ...baseEpisode,
      project_code: '  itsaplan  '
    });
    expect(defaultEvent?.applicability_scope).toEqual({
      scope: 'judgment_episode',
      project_code: DEFAULT_JUDGMENT_EVENT_PROJECT_CODE
    });
    expect(nonBrainbaseEvent?.applicability_scope).toEqual({
      scope: 'judgment_episode',
      project_code: 'itsaplan'
    });
    // Event ID derivation stays backward-compatible regardless of project_code.
    expect(nonBrainbaseEvent?.event_id).toBe(defaultEvent?.event_id);

    // Nested episode project_code sources work when top-level project_code is missing or blank.
    expect(toKnowledgeEventFromJudgmentEpisode({
      ...baseEpisode,
      project_code: '   ',
      applicability_scope: { project_code: 'unson-lab' }
    })?.applicability_scope.project_code).toBe('unson-lab');
    expect(toKnowledgeEventFromJudgmentEpisode({
      ...baseEpisode,
      payload: { project_code: 'sales.ops_1' }
    })?.applicability_scope.project_code).toBe('sales.ops_1');
    expect(toKnowledgeEventFromJudgmentEpisode({
      ...baseEpisode,
      adoption: { request: { project_code: 'req-proj' }, receipt: { project_code: 'rec-proj' } }
    })?.applicability_scope.project_code).toBe('req-proj');
    expect(toKnowledgeEventFromJudgmentEpisode({
      ...baseEpisode,
      adoption: { receipt: { project_code: 'rec-proj' } }
    })?.applicability_scope.project_code).toBe('rec-proj');

    // Malformed project_code values fail loudly instead of silently misattributing to brainbase.
    for (const invalid of ['../escape', 'foo/bar', 'UPPERCASE', 'has space', 'a'.repeat(65), 123]) {
      expect(() => toKnowledgeEventFromJudgmentEpisode({
        ...baseEpisode,
        project_code: invalid
      })).toThrow('project_code is invalid');
    }
    expect(() => toKnowledgeEventFromJudgmentEpisode(baseEpisode, {
      fallbackProjectCode: '../bad'
    })).toThrow('fallbackProjectCode is invalid');

    // Token projectCodes allowlist alignment (mirrors downstream requireProjectAccess).
    expect(toKnowledgeEventFromJudgmentEpisode(
      { ...baseEpisode, project_code: 'itsaplan' },
      { allowedProjectCodes: ['brainbase', 'itsaplan'] }
    )?.applicability_scope.project_code).toBe('itsaplan');
    expect(toKnowledgeEventFromJudgmentEpisode(
      { ...baseEpisode, project_code: 'outside-project' },
      { allowedProjectCodes: ['brainbase', 'itsaplan'] }
    )).toBeNull();
    expect(() => toKnowledgeEventFromJudgmentEpisode(
      { ...baseEpisode, project_code: 'outside-project' },
      { allowedProjectCodes: ['brainbase', 'itsaplan'], onProjectOutOfScope: 'reject' }
    )).toThrow(expect.objectContaining({ code: 'knowledge_project_access_denied' }));

    // Missing episode.project_code falls back to brainbase; if token does not allow brainbase, skip safely.
    expect(toKnowledgeEventFromJudgmentEpisode(baseEpisode, {
      allowedProjectCodes: ['itsaplan']
    })).toBeNull();
    expect(toKnowledgeEventFromJudgmentEpisode(baseEpisode, {
      fallbackProjectCode: 'itsaplan',
      allowedProjectCodes: ['itsaplan']
    })?.applicability_scope.project_code).toBe('itsaplan');

    // Empty list and wildcards fail closed.
    expect(toKnowledgeEventFromJudgmentEpisode(
      { ...baseEpisode, project_code: 'itsaplan' },
      { allowedProjectCodes: [] }
    )).toBeNull();
    expect(normalizeJudgmentEventProjectCode('*')).toBeNull();
    expect(isProjectCodeAllowed('itsaplan', ['*'])).toBe(false);
    expect(isProjectCodeAllowed(null, ['brainbase'])).toBe(false);
    expect(isProjectCodeAllowed('itsaplan', ['brainbase', 'itsaplan'])).toBe(true);
    // Strict exact match: neither candidate nor allowlist entries are implicitly trimmed.
    expect(isProjectCodeAllowed('itsaplan', [' itsaplan '])).toBe(false);
    expect(isProjectCodeAllowed(' itsaplan ', ['itsaplan'])).toBe(false);
    expect(isProjectCodeAllowed(' itsaplan ', [' itsaplan '])).toBe(false);
  });

  it('keeps organization identity in the Org adapter while portable event fields match', () => {
    const ossEvent = toKnowledgeEventFromJudgmentEpisode({
      episode_id: 'episode-1',
      session_id: 'session-1',
      turn_id: 'turn-1',
      finalized_at: '2026-10-18T00:00:00.000Z',
      answer_digest: 'digest-1',
      completion_status: 'complete',
      final_answer: 'The answer'
    });
    if (!ossEvent) throw new Error('expected OSS event');

    const localAdapterEvent = {
      schema_version: 'knowledge_event.v1',
      contract_version: 'knowledge_event.v1',
      event_id: 'kev_da2fd4b1420f0b35fa76c8b2b8075cadaadf2cf9aed811fe46faef4378ef202c',
      occurred_at: '2026-10-18T00:00:00.000Z',
      captured_at: '2026-10-18T00:00:00.000Z',
      source: { type: 'codex_judgment', ref: 'session-1:turn-1' },
      subject: { type: 'judgment_episode', id: 'episode-1' },
      decision_authority: {
        kind: 'judgment_receipt',
        authorized: false,
        graph_promotion_allowed: false
      },
      organization_id: 'org_unson',
      applicability_scope: {
        scope: 'judgment_episode',
        project_code: 'brainbase',
        organization_id: 'org_unson'
      },
      permission_snapshot: { knowledge_registration: true, external_action: false },
      source_pointer: { uri: 'codex://threads/session-1#turn=turn-1' },
      body_hash: 'digest-1',
      parent_episode_id: 'episode-1',
      payload: { summary: 'The answer' }
    };
    const portableProjection = (value: Record<string, unknown>) => {
      const scope = value.applicability_scope as Record<string, unknown>;
      const { organization_id: _organizationId, ...portableScope } = scope;
      const { organization_id: _topLevelOrganizationId, ...portableEvent } = value;
      return { ...portableEvent, applicability_scope: portableScope };
    };

    expect(portableProjection(ossEvent as unknown as Record<string, unknown>))
      .toEqual(portableProjection(localAdapterEvent));
    expect(ossEvent).not.toHaveProperty('organization_id');
    expect(ossEvent.applicability_scope).not.toHaveProperty('organization_id');
    expect(localAdapterEvent).toMatchObject({
      organization_id: 'org_unson',
      applicability_scope: { organization_id: 'org_unson' }
    });
  });

  it('publishes the existing Host and the portable contracts through package exports', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    for (const name of [
      './judgment-host',
      './judgment-execution-outcome',
      './judgment-node-evidence',
      './judgment-project-binding',
      './judgment-event-adapter',
      './judgment-event-outbox',
      './judgment-reasoning-audit'
    ]) {
      expect(packageJson.exports[name]).toEqual({
        types: expect.stringMatching(/^\.\/dist\/.+\.d\.ts$/u),
        import: expect.stringMatching(/^\.\/dist\/.+\.js$/u)
      });
    }
  });
});
