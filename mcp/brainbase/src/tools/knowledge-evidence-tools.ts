import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const knowledgeEvidenceTools: Tool[] = [{
  name: 'brainbase_knowledge_evidence_record',
  description: 'After Graph search/get_entity, assess whether the retrieved evidence supports this question. Record sufficient or insufficient, actual retrieved reference_ids, and a question-specific reason. The Host binds this assessment to this turn\'s real retrievals; this tool alone proves neither retrieval nor truth. Missing evidence or a failed retrieval must be insufficient, never confirmed absence. Call before the final audit read and state record.',
  inputSchema: { type: 'object', additionalProperties: false,
    properties: { status: { type: 'string', enum: ['sufficient', 'insufficient'] },
      reference_ids: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1 } },
      reason: { type: 'string', minLength: 1, maxLength: 4000 } },
    required: ['status', 'reference_ids', 'reason'] },
  annotations: { readOnlyHint: true, destructiveHint: false },
}];

export async function handleKnowledgeEvidenceToolCall(name: string, args: Record<string, unknown>) {
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
