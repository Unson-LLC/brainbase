import { createHash } from 'node:crypto';

import { normalizeJudgmentExecutionOutcome } from '../judgment-execution-outcome.js';

function requiredString(value, field) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} is required`);
    return value;
}

function eventIdFor(episode) {
    const digest = createHash('sha256')
        .update(JSON.stringify([
            episode.episode_id,
            episode.session_id,
            episode.turn_id,
            episode.finalized_at,
            episode.answer_digest
        ]))
        .digest('hex');
    return `kev_${digest}`;
}

const MAX_SUMMARY_LENGTH = 2000;
const AUDIT_LINE = /^(?:🧠 |📚 |⚠️ |🔁 |🛠️ )/u;
const SENSITIVE_CONTENT = [
    /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+/iu,
    /\bsk-[a-z0-9_-]{8,}\b/iu,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu
];

export function sanitizeJudgmentAnswer(value) {
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

export function toKnowledgeEventFromJudgmentEpisode(episode) {
    if (!episode || episode.completion_status !== 'complete') return null;
    const answer = episode.final_summary || episode.final_answer || episode.payload?.summary || episode.summary;
    const sanitized = episode.redaction_status === 'needs_redaction'
        ? { sensitive: true, redaction_status: 'needs_redaction' }
        : sanitizeJudgmentAnswer(answer);
    if (!sanitized) return null;
    const episodeId = requiredString(episode.episode_id, 'episode_id');
    const sessionId = requiredString(episode.session_id, 'session_id');
    const turnId = requiredString(episode.turn_id, 'turn_id');
    const completedAt = requiredString(episode.finalized_at, 'finalized_at');
    const bodyHash = requiredString(episode.answer_digest, 'answer_digest');
    const organizationId = typeof episode.organization_id === 'string' && episode.organization_id.length > 0
        ? episode.organization_id
        : null;
    const hasPortableOutcome = Boolean(episode.execution_outcome);
    const outcome = hasPortableOutcome ? normalizeJudgmentExecutionOutcome(episode.execution_outcome) : null;
    if (outcome && outcome.status !== 'completed') return null;
    const sourceType = outcome?.host.type === 'claude-code' ? 'agent_judgment' : 'codex_judgment';

    return {
        schema_version: 'knowledge_event.v1',
        contract_version: 'knowledge_event.v1',
        event_id: eventIdFor(episode),
        occurred_at: completedAt,
        captured_at: completedAt,
        source: { type: sourceType, ref: outcome ? `${outcome.execution_id}:${outcome.turn_id}` : `${sessionId}:${turnId}` },
        subject: { type: 'judgment_episode', id: episodeId },
        decision_authority: {
            kind: 'judgment_receipt',
            authorized: false,
            graph_promotion_allowed: false
        },
        ...(organizationId ? { organization_id: organizationId } : {}),
        applicability_scope: {
            scope: 'judgment_episode',
            project_code: 'brainbase',
            ...(organizationId ? { organization_id: organizationId } : {})
        },
        permission_snapshot: { knowledge_registration: true, external_action: false },
        source_pointer: {
            uri: hasPortableOutcome
                ? `brainbase-judgment://${encodeURIComponent(outcome.host.type)}/${encodeURIComponent(outcome.execution_id)}#turn=${encodeURIComponent(outcome.turn_id)}`
                : `codex://threads/${sessionId}#turn=${turnId}`
        },
        body_hash: bodyHash,
        parent_episode_id: episodeId,
        ...(sanitized.sensitive ? {
            semantic_state: 'quarantined',
            payload: {
                redaction_status: 'needs_redaction',
                ...(outcome ? { execution_outcome: outcome } : {})
            }
        } : {
            payload: {
                summary: sanitized.summary,
                ...(outcome ? { execution_outcome: outcome } : {})
            }
        })
    };
}
