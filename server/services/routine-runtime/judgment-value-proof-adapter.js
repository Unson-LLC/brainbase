import { createHash } from 'node:crypto';
import {
  projectJudgmentValueProofAttention,
  renderJudgmentHumanDecisionRequest,
  renderJudgmentValueProofCompletion,
  validateJudgmentValueProof,
} from '@unson/brainbase-mcp/judgment-value-proof';

const INPUT_SCHEMA = 'brainbase-judgment-value-proof-input-v1';
const EVIDENCE_KINDS = new Set(['tool_event', 'artifact', 'canonical_readback']);
const OUTCOME_STATUSES = new Set(['outcome_verified', 'unconfirmed', 'not_applicable']);
const RESOLUTIONS = new Set(['continued_without_human', 'human_required']);
const MAX_ITEMS = 12;
const SECRET_PATTERN = /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+|\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,})\b/iu;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function validText(value, limit, nullable = false) {
  if (value === null && nullable) return true;
  return typeof value === 'string'
    && value.trim().length > 0
    && Array.from(value).length <= limit
    && !SECRET_PATTERN.test(value);
}

function validList(value, validator) {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(validator);
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isJsonContainerText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.startsWith('{') || text.startsWith('[');
}

function nestedRecords(value, depth = 0) {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => nestedRecords(entry, depth + 1));
  }
  if (isJsonContainerText(value)) {
    try { return nestedRecords(JSON.parse(value), depth + 1); } catch { return []; }
  }
  const item = record(value);
  if (!item) return [];
  const direct = [item];
  for (const key of ['Ok', 'data', 'structuredContent', 'result', 'receipt']) {
    if (record(item[key])) direct.push(...nestedRecords(item[key], depth + 1));
  }
  if (Array.isArray(item.content)) {
    for (const block of item.content) {
      const text = record(block)?.text;
      if (!isJsonContainerText(text)) continue;
      try { direct.push(...nestedRecords(JSON.parse(text), depth + 1)); } catch {}
    }
  }
  if (isJsonContainerText(item.text)) {
    try { direct.push(...nestedRecords(JSON.parse(item.text), depth + 1)); } catch {}
  }
  return direct;
}

function validInput(value) {
  const input = record(value);
  if (!input || input.schema_version !== INPUT_SCHEMA || !exactKeys(input, [
    'schema_version', 'interruption', 'decision', 'execution', 'outcome',
    'human_decision', 'feedback_requested',
  ]) || typeof input.feedback_requested !== 'boolean') return null;
  const { interruption, decision, execution, outcome, human_decision: humanDecision } = input;
  if (!exactKeys(interruption, ['resolution', 'question_display_text', 'reason_code'])
    || !RESOLUTIONS.has(interruption.resolution)
    || !validText(interruption.question_display_text, 240, true)
    || !validText(interruption.reason_code, 160, true)
    || !exactKeys(decision, ['summary', 'work_impact', 'basis'])
    || !validText(decision.summary, 500, true)
    || !validText(decision.work_impact, 500, true)
    || !validList(decision.basis, (entry) => exactKeys(entry, ['entity_id', 'application'])
      && validText(entry.entity_id, 160) && validText(entry.application, 500))
    || !exactKeys(execution, ['summary', 'artifact_refs'])
    || !validText(execution.summary, 500, true)
    || !validList(execution.artifact_refs, (entry) => {
      const artifact = record(entry);
      return artifact && exactKeys(artifact, artifact.label === undefined
        ? ['kind', 'ref'] : ['kind', 'ref', 'label'])
        && validText(artifact.kind, 160) && validText(artifact.ref, 800)
        && (artifact.label === undefined || validText(artifact.label, 200));
    })
    || !exactKeys(outcome, ['status', 'summary', 'evidence_refs'])
    || !OUTCOME_STATUSES.has(outcome.status)
    || !validText(outcome.summary, 500, true)
    || !validList(outcome.evidence_refs, (entry) => exactKeys(entry, ['kind', 'tool_use_id', 'subject_ref', 'label'])
      && EVIDENCE_KINDS.has(entry.kind)
      && validText(entry.tool_use_id, 160) && validText(entry.subject_ref, 800)
      && validText(entry.label, 200))) return null;
  if (interruption.resolution === 'continued_without_human'
    && (!interruption.question_display_text || !decision.summary || humanDecision !== null)) return null;
  if (interruption.resolution === 'continued_without_human'
    && outcome.status === 'not_applicable') return null;
  if (outcome.status === 'outcome_verified'
    && (!outcome.summary || outcome.evidence_refs.length === 0)) return null;
  if (interruption.resolution === 'human_required') {
    if (!exactKeys(humanDecision, ['question', 'why_human', 'options'])
      || !validText(humanDecision.question, 500)
      || !validText(humanDecision.why_human, 500)
      || !validList(humanDecision.options, (entry) => exactKeys(entry, ['id', 'label', 'impact'])
        && validText(entry.id, 160) && validText(entry.label, 200) && validText(entry.impact, 500))
      || humanDecision.options.length === 0) return null;
  } else if (humanDecision !== null) return null;
  return input;
}

export function extractJudgmentValueProofInput(response) {
  for (const item of nestedRecords(response)) {
    const input = validInput(item);
    if (input) return input;
  }
  return null;
}

export function latestJudgmentValueProofEvent(events) {
  if (!Array.isArray(events)) return null;
  const successful = events.filter((event) => (
    event?.event_kind === 'value_proof'
    && event.success === true
    && validInput(event.safe_metadata?.value_proof)
  ));
  if (successful.length > 1) throw new Error('judgment_value_proof_multiple');
  return successful[0] ?? null;
}

function verifiedEvidence(input, events, valueProofEvent) {
  const byToolUseId = new Map(events.map((event) => [event.tool_use_id, event]));
  const valueProofSequence = Number.isSafeInteger(valueProofEvent?.event_sequence)
    ? valueProofEvent.event_sequence
    : null;
  return input.outcome.evidence_refs.map((evidence) => {
    const source = byToolUseId.get(evidence.tool_use_id);
    const sourceSequence = Number.isSafeInteger(source?.event_sequence) ? source.event_sequence : null;
    const artifactBound = input.execution.artifact_refs.some((artifact) => (
      artifact.ref === evidence.subject_ref
    ));
    const digestBound = /^[0-9a-f]{64}$/u.test(String(source?.input_digest ?? ''))
      && /^[0-9a-f]{64}$/u.test(String(source?.response_digest ?? ''));
    const retrievalBound = source?.query_excerpt === evidence.subject_ref
      && source?.safe_metadata?.subject_ref === evidence.subject_ref
      && source?.safe_metadata?.retrieval_outcome === 'result'
      && digestBound;
    const executionBound = ['execution', 'write'].includes(source?.event_kind)
      && Array.isArray(source?.safe_metadata?.artifact_refs)
      && source.safe_metadata.artifact_refs.includes(evidence.subject_ref)
      && digestBound;
    const evidenceBound = evidence.kind === 'canonical_readback'
      ? ['search', 'retrieve'].includes(source?.event_kind) && retrievalBound
      : evidence.kind === 'tool_event'
        ? executionBound
        : false;
    const eligible = source?.success === true
      && artifactBound
      && evidenceBound
      && !['state', 'value_proof'].includes(source.event_kind)
      && (valueProofSequence === null || (sourceSequence !== null && sourceSequence < valueProofSequence));
    return {
      kind: evidence.kind,
      ref: source && digestBound
        ? `judgment-tool-event:sha256:${sha256(canonicalJson({
          tool_use_id: evidence.tool_use_id,
          input_digest: source.input_digest,
          response_digest: source.response_digest,
          subject_ref: evidence.subject_ref,
        }))}`
        : `judgment-tool-event:sha256:${sha256(evidence.tool_use_id)}`,
      status: eligible ? 'verified' : 'unconfirmed',
      label: evidence.label,
    };
  });
}

function executionStatus(stopState) {
  if (stopState?.status === 'completed') return 'completed';
  if (stopState?.status === 'waiting_human') return 'not_started';
  if (stopState?.status === 'pending') return 'executing';
  return 'blocked';
}

function verifiedInterruptionCandidate(input, candidate, stopState) {
  const source = record(candidate);
  if (!source) throw new Error('judgment_value_proof_interruption_unbound');
  const resolution = input.interruption.resolution;
  if (source.resolution !== resolution) {
    throw new Error('judgment_value_proof_interruption_mismatch');
  }
  const sourceQuestion = typeof source.question_display_text === 'string'
    ? source.question_display_text.trim()
    : '';
  const inputQuestion = typeof input.interruption.question_display_text === 'string'
    ? input.interruption.question_display_text.trim()
    : '';
  if (!sourceQuestion || sourceQuestion !== inputQuestion) {
    throw new Error('judgment_value_proof_interruption_mismatch');
  }
  if (source.question_digest && source.question_digest !== `sha256:${sha256(sourceQuestion)}`) {
    throw new Error('judgment_value_proof_interruption_digest_mismatch');
  }
  if (resolution === 'human_required') {
    if (stopState?.status !== 'waiting_human'
      || input.human_decision?.question.trim() !== sourceQuestion) {
      throw new Error('judgment_value_proof_human_decision_mismatch');
    }
  }
  return {
    resolution,
    question_display_text: sourceQuestion,
    question_digest: `sha256:${sha256(sourceQuestion)}`,
    reason_code: typeof source.reason_code === 'string' ? source.reason_code : null,
  };
}

export function buildJudgmentValueProofProjection({
  turnRef,
  valueProofEvent,
  events,
  stopState,
  finalizedAt,
  interruptionCandidate,
}) {
  const input = validInput(valueProofEvent?.safe_metadata?.value_proof);
  if (!input) return null;
  const interruption = verifiedInterruptionCandidate(input, interruptionCandidate, stopState);
  const evidenceRefs = verifiedEvidence(input, events, valueProofEvent);
  const requestedOutcomeStatus = input.outcome.status;
  const eventSequenceByToolUseId = new Map(events.map((event) => [
    event?.tool_use_id,
    Number.isSafeInteger(event?.event_sequence) ? event.event_sequence : null,
  ]));
  const everyArtifactHasExecutionAndReadback = input.execution.artifact_refs.length > 0
    && input.execution.artifact_refs.every((artifact) => {
      const refs = input.outcome.evidence_refs
        .map((evidence, index) => ({ evidence, projected: evidenceRefs[index] }))
        .filter(({ evidence, projected }) => (
          evidence.subject_ref === artifact.ref && projected?.status === 'verified'
        ));
      const executions = refs.filter(({ evidence }) => evidence.kind === 'tool_event');
      const readbacks = refs.filter(({ evidence }) => evidence.kind === 'canonical_readback');
      return executions.some(({ evidence: executionEvidence }) => {
        const executionSequence = eventSequenceByToolUseId.get(executionEvidence.tool_use_id);
        return Number.isSafeInteger(executionSequence) && readbacks.some(({ evidence: readbackEvidence }) => {
          const readbackSequence = eventSequenceByToolUseId.get(readbackEvidence.tool_use_id);
          return Number.isSafeInteger(readbackSequence) && executionSequence < readbackSequence;
        });
      });
    });
  const outcomeStatus = requestedOutcomeStatus === 'outcome_verified'
    && evidenceRefs.length > 0
    && evidenceRefs.every((evidence) => evidence.status === 'verified')
    && everyArtifactHasExecutionAndReadback
    ? 'outcome_verified'
    : requestedOutcomeStatus === 'not_applicable'
      ? 'not_applicable'
      : 'unconfirmed';
  const execution = executionStatus(stopState);
  const resolution = interruption.resolution;
  const state = resolution === 'human_required'
    ? 'waiting_human'
    : execution === 'completed'
      ? outcomeStatus === 'outcome_verified' ? 'outcome_verified' : 'unconfirmed'
      : execution === 'executing' ? 'executing' : 'blocked';
  const proof = {
    schema_version: 'brainbase-judgment-value-proof-v1',
    intent_id: `intent_${turnRef}`,
    decision_attempt_id: `decision_${sha256(valueProofEvent.tool_use_id)}`,
    recorded_at: finalizedAt,
    state,
    interruption: {
      resolution,
      question_display_text: interruption.question_display_text,
      question_digest: interruption.question_digest,
      reason_code: interruption.reason_code,
      human_reason: input.human_decision?.why_human ?? null,
    },
    decision: {
      summary: input.decision.summary,
      work_impact: input.decision.work_impact,
      basis: input.decision.basis,
      prior_learning_reused: 'unconfirmed',
    },
    execution: {
      status: execution,
      summary: input.execution.summary,
      artifact_refs: input.execution.artifact_refs,
    },
    outcome: {
      status: outcomeStatus,
      summary: input.outcome.summary,
      evidence_refs: evidenceRefs,
    },
    human_decision: input.human_decision,
    feedback: {
      status: input.feedback_requested ? 'pending' : 'none',
      summary: null,
      evidence_ref: null,
    },
  };
  return validateJudgmentValueProof(proof);
}

export function judgmentValueProofDigest(proof) {
  return `sha256:${sha256(canonicalJson(validateJudgmentValueProof(proof)))}`;
}

export function renderJudgmentValueProofSurface(proof) {
  if (!proof) return null;
  const surface = proof.interruption.resolution === 'human_required'
    ? renderJudgmentHumanDecisionRequest(proof)
    : renderJudgmentValueProofCompletion(proof);
  if (!surface || proof.interruption.resolution !== 'continued_without_human') return surface;
  const lines = surface.split('\n');
  if (proof.state === 'unconfirmed') {
    lines[0] = 'Brainbase判断結果（確認待ち）';
  }
  const correctionIndex = lines.findIndex((line) => line.startsWith('修正する場合:'));
  const insertionIndex = correctionIndex >= 0 ? correctionIndex : lines.length;
  lines.splice(
    insertionIndex,
    0,
    `聞かずに進めた確認: ${proof.interruption.question_display_text}`,
    `実行範囲: ${proof.execution.summary ?? '記録なし'}`,
  );
  return lines.join('\n');
}

export function renderJudgmentValueProofAttentionSurface(attention) {
  if (!attention) return null;
  // The human-decision surface already contains the question, reason, options,
  // and their impacts. Keep the immutable attention artifact for audit/replay,
  // but do not render a second, less detailed copy to the user.
  if (attention.kind === 'human_decision') return null;
  return [
    `要確認: ${attention.title}`,
    `内容: ${attention.summary}`,
    ...(attention.suggested_actions.length > 0
      ? [`次の対応: ${attention.suggested_actions.join(' / ')}`]
      : []),
  ].join('\n');
}

export function projectJudgmentValueProofCompanionAttention(proof) {
  return proof ? projectJudgmentValueProofAttention(proof) : null;
}
