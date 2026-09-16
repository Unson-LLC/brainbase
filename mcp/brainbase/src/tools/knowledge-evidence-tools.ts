import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const knowledgeEvidenceTools: Tool[] = [{
  name: 'brainbase_knowledge_evidence_record',
  description: 'After the latest knowledge route and Graph search/get_entity or brainbase_get_shareable_person_profile (use disclosure.target_person_id and only the disclosed fields), assess whether the retrieved evidence supports this question. Record sufficient or insufficient, actual retrieved reference_ids, and a question-specific reason. The Host binds this assessment to this turn\'s real retrievals; this tool alone proves neither retrieval nor truth. Missing evidence or a failed retrieval must be insufficient, never confirmed absence. Call before the final audit read and state record.',
  inputSchema: { type: 'object', additionalProperties: false,
    properties: { status: { type: 'string', enum: ['sufficient', 'insufficient'] },
      reference_ids: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1 } },
      reason: { type: 'string', minLength: 1, maxLength: 4000 } },
    required: ['status', 'reference_ids', 'reason'] },
  annotations: { readOnlyHint: true, destructiveHint: false },
}, {
  name: 'brainbase_personal_kg_answer_record',
  description: 'After search_personal_kg, record the model semantic judgment for the exact Ore Nara Reply question. resolved means the cited Personal KG records directly answer the question; ambiguous, no_answer, conflicting, stale, and unavailable must never be used as the owner answer. This records judgment only; the Host binds it to the real search, question digest, and later execution.',
  inputSchema: { type: 'object', additionalProperties: false,
    properties: {
      question_digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      status: { type: 'string', enum: ['resolved', 'ambiguous', 'no_answer', 'conflicting', 'stale', 'unavailable'] },
      reference_ids: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1 } },
      answer: { type: ['string', 'null'], maxLength: 4000 },
      reason: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    required: ['question_digest', 'status', 'reference_ids', 'answer', 'reason'] },
  annotations: { readOnlyHint: true, destructiveHint: false },
}];

export async function handleKnowledgeEvidenceToolCall(name: string, args: Record<string, unknown>) {
  if (name === 'brainbase_personal_kg_answer_record') {
    const resolved = args.status === 'resolved';
    if (Object.keys(args).sort().join(',') !== 'answer,question_digest,reason,reference_ids,status'
      || typeof args.question_digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(args.question_digest)
      || !['resolved', 'ambiguous', 'no_answer', 'conflicting', 'stale', 'unavailable'].includes(String(args.status))
      || typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 4000
      || !Array.isArray(args.reference_ids) || args.reference_ids.length > 100
      || !args.reference_ids.every((id) => typeof id === 'string' && id.trim())
      || new Set(args.reference_ids).size !== args.reference_ids.length
      || (resolved && (!args.reference_ids.length || typeof args.answer !== 'string' || !args.answer.trim()))
      || (!resolved && args.answer !== null)) {
      return { status: 'error', error: { code: 'personal_kg_answer_invalid', message: 'Bind a semantic answer status to the exact question and cited Personal KG records.' } };
    }
    return { status: 'ok', data: { schema_version: 'brainbase-personal-kg-answer-v1', ...args } };
  }
  if (name !== 'brainbase_knowledge_evidence_record') return null;
  if (Object.keys(args).sort().join(',') !== 'reason,reference_ids,status'
    || !['sufficient', 'insufficient'].includes(String(args.status))
    || typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 4000
    || !Array.isArray(args.reference_ids) || args.reference_ids.length > 100
    || !args.reference_ids.every((id) => typeof id === 'string' && id.trim())
    || new Set(args.reference_ids).size !== args.reference_ids.length
    || (args.status === 'sufficient' && !args.reference_ids.length)) {
    return { status: 'error', error: { code: 'knowledge_evidence_invalid', message: 'Provide an assessment, actual reference IDs, and a question-specific reason.' } };
  }
  return { status: 'ok', data: { schema_version: 'brainbase-knowledge-evidence-assessment-v1', ...args } };
}
