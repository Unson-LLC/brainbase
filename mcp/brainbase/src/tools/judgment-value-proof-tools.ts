import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type JudgmentValueProofInputV1 = {
  schema_version: 'brainbase-judgment-value-proof-input-v1';
  interruption: {
    resolution: 'continued_without_human' | 'human_required';
    question_display_text: string | null;
    reason_code: string | null;
  };
  decision: {
    summary: string | null;
    work_impact: string | null;
    basis: Array<{ entity_id: string; application: string }>;
  };
  execution: {
    summary: string | null;
    artifact_refs: Array<{ kind: string; ref: string; label?: string }>;
  };
  outcome: {
    status: 'outcome_verified' | 'unconfirmed' | 'not_applicable';
    summary: string | null;
    evidence_refs: Array<{
      kind: 'tool_event' | 'artifact' | 'canonical_readback';
      tool_use_id: string;
      subject_ref: string;
      label: string;
    }>;
  };
  human_decision: null | {
    question: string;
    why_human: string;
    options: Array<{ id: string; label: string; impact: string }>;
  };
  feedback_requested: boolean;
};

const TEXT_LIMITS = Object.freeze({
  question: 240,
  summary: 500,
  basis: 500,
  id: 160,
  ref: 800,
  label: 200,
  impact: 500,
});
const MAX_ITEMS = 12;
const SECRET_PATTERN = /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+|\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,})\b/iu;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function cleanText(value: unknown, limit: number, nullable = false): string | null | undefined {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || Array.from(text).length > limit || SECRET_PATTERN.test(text)) return undefined;
  return text;
}

function optionalLabel(value: unknown): string | undefined | null {
  if (value === undefined) return null;
  return cleanText(value, TEXT_LIMITS.label) ?? undefined;
}

function parseBasis(value: unknown): JudgmentValueProofInputV1['decision']['basis'] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const result: JudgmentValueProofInputV1['decision']['basis'] = [];
  for (const item of value) {
    const entry = record(item);
    if (!entry || !exactKeys(entry, ['entity_id', 'application'])) return null;
    const entityId = cleanText(entry.entity_id, TEXT_LIMITS.id);
    const application = cleanText(entry.application, TEXT_LIMITS.basis);
    if (!entityId || !application) return null;
    result.push({ entity_id: entityId, application });
  }
  return result;
}

function parseArtifacts(value: unknown): JudgmentValueProofInputV1['execution']['artifact_refs'] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const result: JudgmentValueProofInputV1['execution']['artifact_refs'] = [];
  for (const item of value) {
    const entry = record(item);
    if (!entry || !['kind,ref', 'kind,label,ref'].includes(Object.keys(entry).sort().join(','))) return null;
    const kind = cleanText(entry.kind, TEXT_LIMITS.id);
    const ref = cleanText(entry.ref, TEXT_LIMITS.ref);
    const label = optionalLabel(entry.label);
    if (!kind || !ref || label === undefined) return null;
    result.push({ kind, ref, ...(label ? { label } : {}) });
  }
  return result;
}

function parseEvidence(value: unknown): JudgmentValueProofInputV1['outcome']['evidence_refs'] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const result: JudgmentValueProofInputV1['outcome']['evidence_refs'] = [];
  for (const item of value) {
    const entry = record(item);
    if (!entry || !exactKeys(entry, ['kind', 'tool_use_id', 'subject_ref', 'label'])) return null;
    if (!['tool_event', 'artifact', 'canonical_readback'].includes(String(entry.kind))) return null;
    const toolUseId = cleanText(entry.tool_use_id, TEXT_LIMITS.id);
    const subjectRef = cleanText(entry.subject_ref, TEXT_LIMITS.ref);
    const label = cleanText(entry.label, TEXT_LIMITS.label);
    if (!toolUseId || !subjectRef || !label) return null;
    result.push({
      kind: entry.kind as JudgmentValueProofInputV1['outcome']['evidence_refs'][number]['kind'],
      tool_use_id: toolUseId,
      subject_ref: subjectRef,
      label,
    });
  }
  return result;
}

function parseHumanDecision(value: unknown): JudgmentValueProofInputV1['human_decision'] | undefined {
  if (value === null) return null;
  const decision = record(value);
  if (!decision || !exactKeys(decision, ['question', 'why_human', 'options'])) return undefined;
  const question = cleanText(decision.question, TEXT_LIMITS.summary);
  const whyHuman = cleanText(decision.why_human, TEXT_LIMITS.summary);
  if (!question || !whyHuman || !Array.isArray(decision.options)
    || decision.options.length === 0 || decision.options.length > MAX_ITEMS) {
    return undefined;
  }
  const options: NonNullable<JudgmentValueProofInputV1['human_decision']>['options'] = [];
  for (const item of decision.options) {
    const option = record(item);
    if (!option || !exactKeys(option, ['id', 'label', 'impact'])) return undefined;
    const id = cleanText(option.id, TEXT_LIMITS.id);
    const label = cleanText(option.label, TEXT_LIMITS.label);
    const impact = cleanText(option.impact, TEXT_LIMITS.impact);
    if (!id || !label || !impact) return undefined;
    options.push({ id, label, impact });
  }
  return { question, why_human: whyHuman, options };
}

export function normalizeJudgmentValueProofInput(args: Record<string, unknown>): JudgmentValueProofInputV1 | null {
  if (!exactKeys(args, [
    'interruption', 'decision', 'execution', 'outcome', 'human_decision', 'feedback_requested',
  ])) return null;

  const interruption = record(args.interruption);
  const decision = record(args.decision);
  const execution = record(args.execution);
  const outcome = record(args.outcome);
  if (!interruption || !decision || !execution || !outcome
    || !exactKeys(interruption, ['resolution', 'question_display_text', 'reason_code'])
    || !exactKeys(decision, ['summary', 'work_impact', 'basis'])
    || !exactKeys(execution, ['summary', 'artifact_refs'])
    || !exactKeys(outcome, ['status', 'summary', 'evidence_refs'])
    || typeof args.feedback_requested !== 'boolean') return null;

  if (!['continued_without_human', 'human_required'].includes(String(interruption.resolution))
    || !['outcome_verified', 'unconfirmed', 'not_applicable'].includes(String(outcome.status))) return null;

  const questionDisplayText = cleanText(interruption.question_display_text, TEXT_LIMITS.question, true);
  const reasonCode = cleanText(interruption.reason_code, TEXT_LIMITS.id, true);
  const decisionSummary = cleanText(decision.summary, TEXT_LIMITS.summary, true);
  const workImpact = cleanText(decision.work_impact, TEXT_LIMITS.summary, true);
  const executionSummary = cleanText(execution.summary, TEXT_LIMITS.summary, true);
  const outcomeSummary = cleanText(outcome.summary, TEXT_LIMITS.summary, true);
  const basis = parseBasis(decision.basis);
  const artifactRefs = parseArtifacts(execution.artifact_refs);
  const evidenceRefs = parseEvidence(outcome.evidence_refs);
  const humanDecision = parseHumanDecision(args.human_decision);
  if (questionDisplayText === undefined || reasonCode === undefined || decisionSummary === undefined
    || workImpact === undefined || executionSummary === undefined || outcomeSummary === undefined
    || !basis || !artifactRefs || !evidenceRefs || humanDecision === undefined) return null;

  const resolution = interruption.resolution as JudgmentValueProofInputV1['interruption']['resolution'];
  const outcomeStatus = outcome.status as JudgmentValueProofInputV1['outcome']['status'];
  if (resolution === 'continued_without_human' && (!questionDisplayText || !decisionSummary)) return null;
  if (resolution === 'human_required' && !humanDecision) return null;
  if (resolution !== 'human_required' && humanDecision !== null) return null;
  if (outcomeStatus === 'outcome_verified' && (!outcomeSummary || evidenceRefs.length === 0)) return null;

  return {
    schema_version: 'brainbase-judgment-value-proof-input-v1',
    interruption: {
      resolution,
      question_display_text: questionDisplayText,
      reason_code: reasonCode,
    },
    decision: {
      summary: decisionSummary,
      work_impact: workImpact,
      basis,
    },
    execution: {
      summary: executionSummary,
      artifact_refs: artifactRefs,
    },
    outcome: {
      status: outcomeStatus,
      summary: outcomeSummary,
      evidence_refs: evidenceRefs,
    },
    human_decision: humanDecision,
    feedback_requested: args.feedback_requested,
  };
}

export const judgmentValueProofTools: Tool[] = [{
  name: 'brainbase_judgment_value_proof_record',
  description: 'Record a compact human-facing proof only when Brainbase resolved a real choice, avoided a user interruption, or a real human decision is required. Call after execution/verification and before brainbase_judgment_state_record; the state record must remain the final tool call. Do not include raw tool responses, secrets, or internal logs.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['interruption', 'decision', 'execution', 'outcome', 'human_decision', 'feedback_requested'],
    properties: {
      interruption: {
        type: 'object', additionalProperties: false,
        required: ['resolution', 'question_display_text', 'reason_code'],
        properties: {
          resolution: { type: 'string', enum: ['continued_without_human', 'human_required'] },
          question_display_text: { type: ['string', 'null'], maxLength: TEXT_LIMITS.question },
          reason_code: { type: ['string', 'null'], maxLength: TEXT_LIMITS.id },
        },
      },
      decision: {
        type: 'object', additionalProperties: false,
        required: ['summary', 'work_impact', 'basis'],
        properties: {
          summary: { type: ['string', 'null'], maxLength: TEXT_LIMITS.summary },
          work_impact: { type: ['string', 'null'], maxLength: TEXT_LIMITS.summary },
          basis: {
            type: 'array', maxItems: MAX_ITEMS,
            items: {
              type: 'object', additionalProperties: false,
              required: ['entity_id', 'application'],
              properties: {
                entity_id: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.id },
                application: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.basis },
              },
            },
          },
        },
      },
      execution: {
        type: 'object', additionalProperties: false,
        required: ['summary', 'artifact_refs'],
        properties: {
          summary: { type: ['string', 'null'], maxLength: TEXT_LIMITS.summary },
          artifact_refs: {
            type: 'array', maxItems: MAX_ITEMS,
            items: {
              type: 'object', additionalProperties: false,
              required: ['kind', 'ref'],
              properties: {
                kind: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.id },
                ref: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.ref },
                label: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.label },
              },
            },
          },
        },
      },
      outcome: {
        type: 'object', additionalProperties: false,
        required: ['status', 'summary', 'evidence_refs'],
        properties: {
          status: { type: 'string', enum: ['outcome_verified', 'unconfirmed', 'not_applicable'] },
          summary: { type: ['string', 'null'], maxLength: TEXT_LIMITS.summary },
          evidence_refs: {
            type: 'array', maxItems: MAX_ITEMS,
            items: {
              type: 'object', additionalProperties: false,
              required: ['kind', 'tool_use_id', 'subject_ref', 'label'],
              properties: {
                kind: { type: 'string', enum: ['tool_event', 'artifact', 'canonical_readback'] },
                tool_use_id: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.id },
                subject_ref: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.ref },
                label: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.label },
              },
            },
          },
        },
      },
      human_decision: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object', additionalProperties: false,
            required: ['question', 'why_human', 'options'],
            properties: {
              question: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.summary },
              why_human: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.summary },
              options: {
                type: 'array', minItems: 1, maxItems: MAX_ITEMS,
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['id', 'label', 'impact'],
                  properties: {
                    id: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.id },
                    label: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.label },
                    impact: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.impact },
                  },
                },
              },
            },
          },
        ],
      },
      feedback_requested: { type: 'boolean' },
    },
  },
}];

export async function handleJudgmentValueProofToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: 'ok'; data: JudgmentValueProofInputV1 } | { status: 'error'; error: { code: string; message: string } } | null> {
  if (name !== 'brainbase_judgment_value_proof_record') return null;
  const normalized = normalizeJudgmentValueProofInput(args);
  if (!normalized) {
    return {
      status: 'error',
      error: {
        code: 'judgment_value_proof_invalid',
        message: 'Judgment value proof does not match brainbase-judgment-value-proof-input-v1',
      },
    };
  }
  return { status: 'ok', data: normalized };
}
