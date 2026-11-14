import { createHash } from 'node:crypto';

import {
  normalizeJudgmentExecutionOutcome,
  type JudgmentExecutionOutcome
} from './judgment-execution-outcome.js';

/** Input boundary for a completed Host episode. Private runtime fields are ignored. */
export interface JudgmentEpisode {
  episode_id?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
  finalized_at?: unknown;
  answer_digest?: unknown;
  completion_status?: unknown;
  final_summary?: unknown;
  final_answer?: unknown;
  summary?: unknown;
  payload?: unknown;
  redaction_status?: unknown;
  execution_outcome?: unknown;
  [key: string]: unknown;
}

export interface JudgmentKnowledgeEventPayload {
  summary?: string;
  redaction_status?: 'needs_redaction';
  execution_outcome?: JudgmentExecutionOutcome;
}

export interface JudgmentKnowledgeEvent {
  schema_version: 'knowledge_event.v1';
  contract_version: 'knowledge_event.v1';
  event_id: string;
  occurred_at: string;
  captured_at: string;
  source: {
    type: 'agent_judgment' | 'codex_judgment';
    ref: string;
  };
  subject: { type: 'judgment_episode'; id: string };
  decision_authority: {
    kind: 'judgment_receipt';
    authorized: false;
    graph_promotion_allowed: false;
  };
  applicability_scope: {
    scope: 'judgment_episode';
    project_code: 'brainbase';
  };
  permission_snapshot: {
    knowledge_registration: true;
    external_action: false;
  };
  source_pointer: { uri: string };
  body_hash: string;
  parent_episode_id: string;
  semantic_state?: 'quarantined';
  payload: JudgmentKnowledgeEventPayload;
}

const MAX_SUMMARY_LENGTH = 2000;
const AUDIT_LINE = /^(?:🧠 |📚 |⚠️ |🔁 |🛠️ )/u;
const SENSITIVE_CONTENT = [
  /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+/iu,
  /\bsk-[a-z0-9_-]{8,}\b/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
];

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} is required`);
  return value;
}

function eventIdFor(episode: JudgmentEpisode): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      episode.episode_id,
      episode.session_id,
      episode.turn_id,
      episode.finalized_at,
      episode.answer_digest
    ]) as string)
    .digest('hex');
  return `kev_${digest}`;
}

/** Remove audit lines and quarantine likely secrets from a judgment answer. */
export function sanitizeJudgmentAnswer(value: unknown):
  | { sensitive: true; redaction_status: 'needs_redaction' }
  | { sensitive: false; summary: string }
  | null {
  if (typeof value !== 'string') return null;
  const summary = value
    .split(/\r?\n/u)
    .filter((line) => !AUDIT_LINE.test(line))
    .join('\n')
    .trim();
  if (!summary) return null;
  if (SENSITIVE_CONTENT.some((pattern) => pattern.test(summary))) {
    return { sensitive: true, redaction_status: 'needs_redaction' };
  }
  return { sensitive: false, summary: summary.slice(0, MAX_SUMMARY_LENGTH) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Project a completed Host episode into a non-authoritative knowledge event.
 *
 * This is a portable projection only. Organization identity, Task binding,
 * transcript storage, and delivery/outbox behavior remain adapter concerns.
 */
export function toKnowledgeEventFromJudgmentEpisode(
  episode: JudgmentEpisode | null | undefined
): JudgmentKnowledgeEvent | null {
  if (!episode || episode.completion_status !== 'complete') return null;
  const payload = isRecord(episode.payload) ? episode.payload : undefined;
  const answer = episode.final_summary || episode.final_answer || payload?.summary || episode.summary;
  const sanitized = episode.redaction_status === 'needs_redaction'
    ? { sensitive: true as const, redaction_status: 'needs_redaction' as const }
    : sanitizeJudgmentAnswer(answer);
  if (!sanitized) return null;

  const episodeId = requiredString(episode.episode_id, 'episode_id');
  const sessionId = requiredString(episode.session_id, 'session_id');
  const turnId = requiredString(episode.turn_id, 'turn_id');
  const completedAt = requiredString(episode.finalized_at, 'finalized_at');
  const bodyHash = requiredString(episode.answer_digest, 'answer_digest');

  const hasPortableOutcome = Boolean(episode.execution_outcome);
  const outcome = hasPortableOutcome
    ? normalizeJudgmentExecutionOutcome(episode.execution_outcome)
    : null;
  if (outcome && outcome.status !== 'completed') return null;
  const sourceType = outcome?.host.type === 'claude-code' ? 'agent_judgment' : 'codex_judgment';

  return {
    schema_version: 'knowledge_event.v1',
    contract_version: 'knowledge_event.v1',
    event_id: eventIdFor(episode),
    occurred_at: completedAt,
    captured_at: completedAt,
    source: {
      type: sourceType,
      ref: outcome ? `${outcome.execution_id}:${outcome.turn_id}` : `${sessionId}:${turnId}`
    },
    subject: { type: 'judgment_episode', id: episodeId },
    decision_authority: {
      kind: 'judgment_receipt',
      authorized: false,
      graph_promotion_allowed: false
    },
    applicability_scope: { scope: 'judgment_episode', project_code: 'brainbase' },
    permission_snapshot: { knowledge_registration: true, external_action: false },
    source_pointer: {
      uri: outcome
        ? `brainbase-judgment://${encodeURIComponent(outcome.host.type)}/${encodeURIComponent(outcome.execution_id)}#turn=${encodeURIComponent(outcome.turn_id)}`
        : `codex://threads/${sessionId}#turn=${turnId}`
    },
    body_hash: bodyHash,
    parent_episode_id: episodeId,
    ...(sanitized.sensitive
      ? {
        semantic_state: 'quarantined' as const,
        payload: {
          redaction_status: 'needs_redaction' as const,
          ...(outcome ? { execution_outcome: outcome } : {})
        }
      }
      : {
        payload: {
          summary: sanitized.summary,
          ...(outcome ? { execution_outcome: outcome } : {})
        }
      })
  };
}
