import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  authenticateProject,
  fetchAuthenticatedJson,
  toolError,
  type AuthenticatedApiDependencies as Dependencies,
  type ToolResult,
} from './authenticated-api-tool.js';
import {
  handleKnowledgeEventToolCall,
  knowledgeEventTools,
} from './knowledge-event-tools.js';

const knowledgeResolveTool: Tool = {
  name: 'brainbase_knowledge_resolve',
  description: 'Resolve the canonical knowledge source before searching. Returns an uncertainty-preserving routing receipt; it does not claim that the source was searched.',
  inputSchema: {
    type: 'object',
    properties: {
      project_code: { type: 'string' },
      intent: { type: 'string', minLength: 1 },
      audience: { type: 'string', enum: ['personal', 'team', 'organization'] },
      content_type: { type: 'string', enum: ['canonical_fact', 'team_document', 'source_document', 'personal_knowledge', 'operational_state', 'unknown'] },
    },
    required: ['intent', 'audience', 'content_type'],
    additionalProperties: false,
  },
};

// Keep the existing export name because server.ts already treats this module as
// the complete Knowledge tool family. Resolution and candidate recording remain
// separate handlers and separate authority boundaries.
export const knowledgeResolutionTools: Tool[] = [knowledgeResolveTool, ...knowledgeEventTools];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isKnowledgeResolutionReceipt(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.resolution_id !== 'string' || typeof value.resolved_at !== 'string') return false;
  if (!Array.isArray(value.searched_scope) || typeof value.absence_confirmed !== 'boolean') return false;
  if (!Array.isArray(value.excluded_sources) || !Array.isArray(value.not_searched)) return false;
  if (typeof value.confidence !== 'number' || typeof value.rationale !== 'string') return false;
  if (value.status === 'resolved') {
    return typeof value.source_class === 'string'
      && isRecord(value.canonical_location)
      && typeof value.retrieval_capability === 'string'
      && typeof value.next_route === 'string';
  }
  if (value.status === 'unconfirmed') {
    return value.source_class === null
      && value.canonical_location === null
      && value.retrieval_capability === null
      && typeof value.next_route === 'string';
  }
  return false;
}

export async function handleKnowledgeResolutionToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: Dependencies,
): Promise<ToolResult | null> {
  if (name === 'brainbase_knowledge_event_record') {
    return handleKnowledgeEventToolCall(name, args, dependencies);
  }
  if (name !== 'brainbase_knowledge_resolve') return null;

  const context = await authenticateProject(args, dependencies);
  if ('status' in context) return context;
  const fetched = await fetchAuthenticatedJson(dependencies, context, {
    path: '/api/knowledge/resolve',
    method: 'POST',
    body: args,
  });
  if (!fetched.ok) return fetched.result;
  const { response, payload } = fetched;
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message = typeof errorPayload?.message === 'string'
      ? errorPayload.message
      : `${response.status} ${response.statusText}`.trim();
    return toolError(
      response.status >= 500 ? 'unavailable' : 'error',
      response.status >= 500 ? 'brainbase_api_unavailable' : 'brainbase_api_error',
      message,
      context.scope,
      response.status,
    );
  }
  if (!isKnowledgeResolutionReceipt(payload)) {
    return toolError(
      'error',
      'brainbase_api_response_invalid',
      'Brainbase API returned an invalid knowledge resolution receipt',
      context.scope,
      response.status,
    );
  }
  return { status: 'ok', scope: { project_codes: context.scope }, data: payload };
}
