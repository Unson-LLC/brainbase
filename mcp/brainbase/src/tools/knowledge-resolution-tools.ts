import { decodeCompanyAuthorityResponse } from './shareable-person-profile-tools.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  authenticateProject,
  fetchAuthenticatedJson,
  toolError,
  type AuthenticatedApiDependencies,
  type ToolResult,
} from './authenticated-api-tool.js';
import {
  handleKnowledgeEventToolCall,
  knowledgeEventTools,
} from './knowledge-event-tools.js';

type Dependencies = AuthenticatedApiDependencies & {
  companyAuthorityResponse?: string;
  runtimeApiUrl?: string;
  runtimeServiceToken?: string;
};

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

const knowledgeRetrieveTool: Tool = {
  name: 'brainbase_knowledge_retrieve',
  description: 'Retrieve authorized canonical knowledge by exact id and version. Unresolved, inaccessible, stale, or unavailable references remain explicit statuses and are never treated as content.',
  inputSchema: {
    type: 'object',
    properties: {
      project_code: { type: 'string', minLength: 1 },
      refs: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1 },
            version: { type: 'string', minLength: 1 },
          },
          required: ['id', 'version'],
          additionalProperties: false,
        },
      },
    },
    required: ['project_code', 'refs'],
    additionalProperties: false,
  },
};

// Keep the existing export name because server.ts already treats this module as
// the complete Knowledge tool family. Resolution and candidate recording remain
// separate handlers and separate authority boundaries.
export const knowledgeResolutionTools: Tool[] = [knowledgeResolveTool, knowledgeRetrieveTool, ...knowledgeEventTools];

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

const RETRIEVAL_STATUSES = new Set([
  'resolved', 'insufficient', 'not_applicable', 'version_conflict', 'source_unavailable', 'not_found',
  'source_version_unknown', 'source_version_conflict', 'source_hash_conflict',
]);

function isKnowledgeRetrievalResponse(value: unknown, requestedRefs: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.project_code !== 'string'
    || !Array.isArray(value.results) || !Array.isArray(requestedRefs)
    || value.results.length !== requestedRefs.length) return false;

  const results = value.results as unknown[];
  const refs = requestedRefs as unknown[];
  return refs.every((requestedRef, index) => {
    if (!isRecord(requestedRef)
      || typeof requestedRef.id !== 'string' || requestedRef.id.length === 0
      || typeof requestedRef.version !== 'string' || requestedRef.version.length === 0) return false;
    const result = results[index];
    if (!isRecord(result)
      || result.id !== requestedRef.id
      || result.requested_version !== requestedRef.version
      || typeof result.status !== 'string'
      || !RETRIEVAL_STATUSES.has(result.status)) return false;
    if (result.status !== 'resolved') return true;
    return result.resolved_version === result.requested_version
      && typeof result.content === 'string'
      && result.content.length > 0
      && isRecord(result.source)
      && typeof result.source.kind === 'string'
      && typeof result.retrieval_receipt_id === 'string'
      && result.retrieval_receipt_id.length > 0;
  });
}

export async function handleKnowledgeResolutionToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: Dependencies,
): Promise<ToolResult | null> {
  if (name === 'brainbase_knowledge_event_record') {
    return handleKnowledgeEventToolCall(name, args, dependencies);
  }
  if (!['brainbase_knowledge_resolve', 'brainbase_knowledge_retrieve'].includes(name)) return null;
  const retrieving = name === 'brainbase_knowledge_retrieve';

  // The trusted transport envelope is never taken from model tool arguments.
  // Any supplied invalid or unsupported authority fails closed; do not fall back
  // to the static token. Both routing and retrieval are performed by the
  // authority-verifying runtime route so the signed company boundary remains
  // intact through content retrieval.
  if (dependencies.companyAuthorityResponse !== undefined) {
    const authority = decodeCompanyAuthorityResponse(dependencies.companyAuthorityResponse);
    if (!authority || !dependencies.runtimeServiceToken || !dependencies.runtimeApiUrl) {
      return toolError('error', 'brainbase_authority_invalid', 'Signed authority transport is unavailable', []);
    }
    try {
      const response = await (dependencies.fetch ?? globalThis.fetch)(
        new URL(retrieving ? '/api/v1/runtime/knowledge:retrieve' : '/api/v1/runtime/knowledge:resolve', dependencies.runtimeApiUrl), {
          method: 'POST',
          headers: { Authorization: `Bearer ${dependencies.runtimeServiceToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...args, company_authority_response: authority }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) return toolError(response.status >= 500 ? 'unavailable' : 'error',
        'brainbase_authority_rejected', 'Signed knowledge authority was rejected', [], response.status);
      const valid = retrieving
        ? isKnowledgeRetrievalResponse(payload, args.refs) && payload.project_code === args.project_code
        : isKnowledgeResolutionReceipt(payload) && typeof payload.project_code === 'string'
          && Boolean(payload.project_code)
          && (args.project_code === undefined || payload.project_code === args.project_code);
      if (!valid) {
        return toolError('error', 'brainbase_api_response_invalid',
          retrieving ? 'Invalid authority-bound knowledge retrieval response' : 'Invalid authority-bound routing receipt', []);
      }
      return { status: 'ok', scope: { project_codes: [payload.project_code] }, data: payload };
    } catch {
      return toolError('unavailable', 'brainbase_api_unavailable', 'Knowledge authority service unavailable', []);
    }
  }

  const context = await authenticateProject(args, dependencies, { requireProject: retrieving });
  if ('status' in context) return context;
  const fetched = await fetchAuthenticatedJson(dependencies, context, {
    path: retrieving ? '/api/knowledge/retrieve-principal' : '/api/knowledge/resolve',
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
  const valid = retrieving
    ? isKnowledgeRetrievalResponse(payload, args.refs)
      && (payload as Record<string, unknown>).project_code === args.project_code
    : isKnowledgeResolutionReceipt(payload);
  if (!valid) {
    return toolError(
      'error',
      'brainbase_api_response_invalid',
      retrieving
        ? 'Brainbase API returned an invalid knowledge retrieval response'
        : 'Brainbase API returned an invalid knowledge resolution receipt',
      context.scope,
      response.status,
    );
  }
  return { status: 'ok', scope: { project_codes: context.scope }, data: payload };
}
