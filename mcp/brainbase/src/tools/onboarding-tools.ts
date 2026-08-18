import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  authenticateProject,
  fetchAuthenticatedJson,
  toolError as errorResult,
  type AuthenticatedApiDependencies as Dependencies,
  type ToolResult,
} from './authenticated-api-tool.js';

const sourceMode = { type: 'string', enum: ['mcp', 'drive', 'gmail', 'local_folder', 'single_document'] } as const;
const reviewReasonMaxLength = 500;
const commonProject = { project_code: { type: 'string', description: 'Authenticated Brainbase project code' } };
const sourceReceiptSchema = {
  type: 'object',
  properties: {
    mode: sourceMode,
    collection_status: { type: 'string', enum: ['collected'] },
    source_id: { type: 'string' },
    evidence_ref: { type: 'string' },
    content_hash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    permission_snapshot: {
      type: 'object',
      properties: {
        visibility: { type: 'string' },
        collected_by: { type: 'string' },
        provider: { type: 'string' },
        connection_id: { type: 'string' },
        grant_id: { type: 'string' },
        account_id: { type: 'string' },
        folder_id: { type: 'string' },
        project_code: { type: 'string' },
        role_min: { type: 'string' },
        sensitivity: { type: 'string' },
        scope: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        roles: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        clearance: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        authorized_at: { type: 'string' },
        expires_at: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  required: ['mode', 'collection_status', 'source_id', 'evidence_ref', 'content_hash', 'permission_snapshot'],
  additionalProperties: false,
} as const;
const candidateSchema = {
  type: 'object',
  properties: {
    fact: { type: 'string' },
    observation_class: { type: 'string', enum: ['observed', 'inferred'] },
    subject_type: { type: 'string' },
    evidence_id: { type: 'string' },
  },
  required: ['fact', 'observation_class', 'subject_type', 'evidence_id'],
  additionalProperties: false,
} as const;

const secretAssignment = /(?:^|[?&#;,\s])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|api[_-]?key|private[_-]?key|client[_-]?secret|secret|password|credential|authorization|cookie)(?:%[^=:\s&#;,]*)?\s*(?:=|:)\s*[^\s&#;,]+/i;
const secretValue = /(?:^|\s)Bearer\s+[A-Za-z0-9._~+/-]+=*|\bsk-[A-Za-z0-9_-]{16,}\b/;
const uriUserinfo = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*:[^@/?#\s]+@/i;
const secretDecodeLimit = 8;
const secretFieldNames = new Set([
  'accesstoken', 'refreshtoken', 'idtoken', 'oauthtoken', 'apikey',
  'privatekey', 'clientsecret', 'secret', 'password', 'credential',
  'credentials', 'authorization', 'cookie',
]);

function decodeSecretInspectionPass(value: string): string {
  return value
    .replaceAll('+', ' ')
    .replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .trim();
}

function containsSecretLikeValue(value: unknown): boolean {
  if (typeof value === 'string') {
    let candidate = value.trim();
    for (let pass = 0; pass < secretDecodeLimit; pass += 1) {
      if (secretValue.test(candidate) || secretAssignment.test(candidate) || uriUserinfo.test(candidate)) return true;
      const decoded = decodeSecretInspectionPass(candidate);
      if (decoded === candidate) return false;
      candidate = decoded;
    }
    return true;
  }
  if (Array.isArray(value)) return value.some(containsSecretLikeValue);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return secretFieldNames.has(normalizedKey) || containsSecretLikeValue(nestedValue);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSuccessfulResponseFor(name: string, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (name === 'brainbase_onboarding_review') {
    return isRecord(payload.candidate)
      && typeof payload.candidate.id === 'string'
      && typeof payload.candidate.promotion_status === 'string'
      && (payload.graph_entity_id === null || typeof payload.graph_entity_id === 'string');
  }
  return typeof payload.id === 'string' && typeof payload.status === 'string';
}

export const onboardingTools: Tool[] = [
  {
    name: 'brainbase_onboarding_start',
    description: 'Start the 10-minute onboarding flow. Prefer an already connected MCP, Drive, Gmail, or allowlisted local folder; use single_document only as fallback.',
    inputSchema: {
      type: 'object',
      properties: { ...commonProject, value_target: { type: 'string' }, source_mode: sourceMode },
      required: ['project_code', 'value_target', 'source_mode'],
    },
  },
  {
    name: 'brainbase_onboarding_get',
    description: 'Read an onboarding run and its review-safe candidate projection.',
    inputSchema: { type: 'object', properties: { ...commonProject, run_id: { type: 'string' } }, required: ['project_code', 'run_id'] },
  },
  {
    name: 'brainbase_onboarding_ingest',
    description: 'Submit a bounded source receipt and short evidence-bound facts. Never submit connector credentials or raw source bodies.',
    inputSchema: {
      type: 'object',
      properties: { ...commonProject, run_id: { type: 'string' }, source: sourceReceiptSchema, candidates: { type: 'array', items: candidateSchema } },
      required: ['project_code', 'run_id', 'source', 'candidates'],
    },
  },
  {
    name: 'brainbase_onboarding_review',
    description: 'Approve an observed candidate for Graph promotion or reject a candidate. Inferred candidates cannot be approved.',
    inputSchema: {
      type: 'object',
      properties: { ...commonProject, run_id: { type: 'string' }, candidate_id: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'reject'] }, reason: { type: 'string', minLength: 1, maxLength: reviewReasonMaxLength } },
      required: ['project_code', 'run_id', 'candidate_id', 'decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'brainbase_onboarding_first_value',
    description: 'Record a concise Graph-grounded answer receipt using the active three-section presentation contract, or record the human useful/not_useful review. Never store the answer body.',
    inputSchema: {
      type: 'object',
      properties: {
        ...commonProject,
        run_id: { type: 'string' },
        action: { type: 'string', enum: ['record', 'review'] },
        answer_hash: { type: 'string' },
        used_graph_entity_ids: { type: 'array', items: { type: 'string' } },
        missing_context: { type: 'array', items: { type: 'string' } },
        presentation_contract_version: { type: 'string', const: 'first_value_clarity.v1' },
        presented_sections: {
          type: 'array',
          prefixItems: [
            { const: '覚えていたこと' },
            { const: 'つながったこと' },
            { const: '次にできること' },
          ],
          minItems: 3,
          maxItems: 3,
        },
        verdict: { type: 'string', enum: ['useful', 'not_useful'] },
      },
      required: ['project_code', 'run_id', 'action'],
      allOf: [
        { if: { properties: { action: { const: 'record' } } }, then: { required: ['answer_hash', 'used_graph_entity_ids', 'presentation_contract_version', 'presented_sections'] } },
        { if: { properties: { action: { const: 'review' } } }, then: { required: ['verdict'] } },
      ],
    },
  },
];

function requestFor(name: string, args: Record<string, unknown>): { path: string; method: string; body?: unknown } {
  const runId = encodeURIComponent(String(args.run_id || ''));
  if (name === 'brainbase_onboarding_start') {
    return { path: '/api/onboarding/runs', method: 'POST', body: { project_code: args.project_code, value_target: args.value_target, source_mode: args.source_mode } };
  }
  if (name === 'brainbase_onboarding_get') return { path: `/api/onboarding/runs/${runId}`, method: 'GET' };
  if (name === 'brainbase_onboarding_ingest') return { path: `/api/onboarding/runs/${runId}/sources`, method: 'POST', body: { source: args.source, candidates: args.candidates } };
  if (name === 'brainbase_onboarding_review') {
    return { path: `/api/onboarding/runs/${runId}/candidates/${encodeURIComponent(String(args.candidate_id || ''))}/review`, method: 'POST', body: { decision: args.decision, reason: args.reason } };
  }
  const reviewing = args.action === 'review';
  return {
    path: `/api/onboarding/runs/${runId}/first-value${reviewing ? '/review' : ''}`,
    method: 'POST',
    body: reviewing
      ? { verdict: args.verdict }
      : {
        answer_hash: args.answer_hash,
        used_graph_entity_ids: args.used_graph_entity_ids,
        missing_context: args.missing_context,
        presentation_contract_version: args.presentation_contract_version,
        presented_sections: args.presented_sections,
      },
  };
}

export async function handleOnboardingToolCall(name: string, args: Record<string, unknown>, dependencies: Dependencies): Promise<ToolResult | null> {
  if (!onboardingTools.some((tool) => tool.name === name)) return null;
  const context = await authenticateProject(args, dependencies, { requireProject: true });
  if ('status' in context) return context;
  const { scope } = context;
  if (name === 'brainbase_onboarding_ingest' && containsSecretLikeValue({ source: args.source, candidates: args.candidates })) {
    return errorResult('error', 'brainbase_onboarding_input_invalid', 'secret-like values are not accepted by onboarding ingest', scope);
  }
  if (name === 'brainbase_onboarding_review' && args.reason !== undefined) {
    const reason = args.reason;
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > reviewReasonMaxLength || containsSecretLikeValue(reason)) {
      return errorResult('error', 'brainbase_onboarding_input_invalid', `review reason must be 1..${reviewReasonMaxLength} characters and contain no secret-like value`, scope);
    }
  }
  if (name === 'brainbase_onboarding_first_value') {
    if (args.action === 'record' && (
      typeof args.answer_hash !== 'string'
      || !Array.isArray(args.used_graph_entity_ids)
      || args.presentation_contract_version !== 'first_value_clarity.v1'
      || !Array.isArray(args.presented_sections)
      || args.presented_sections.length !== 3
      || args.presented_sections.some((section, index) => section !== ['覚えていたこと', 'つながったこと', '次にできること'][index])
    )) {
      return errorResult('error', 'brainbase_onboarding_input_invalid', 'record requires the active first-value presentation contract', scope);
    }
    if (args.action === 'review' && !['useful', 'not_useful'].includes(String(args.verdict || ''))) {
      return errorResult('error', 'brainbase_onboarding_input_invalid', 'review requires a useful or not_useful verdict', scope);
    }
    if (!['record', 'review'].includes(String(args.action || ''))) {
      return errorResult('error', 'brainbase_onboarding_input_invalid', 'action must be record or review', scope);
    }
  }
  const fetched = await fetchAuthenticatedJson(dependencies, context, requestFor(name, args));
  if (!fetched.ok) return fetched.result;
  const { response, payload, payloadParsed } = fetched;
  const credentialBearingPayload = payloadParsed && containsSecretLikeValue(payload);
  if (!response.ok) {
    const unavailable = response.status >= 500;
    if (credentialBearingPayload) {
      return errorResult(
        unavailable ? 'unavailable' : 'error',
        unavailable ? 'brainbase_api_unavailable' : 'brainbase_api_response_invalid',
        unavailable ? 'Brainbase API is unavailable' : 'Brainbase API returned credential-bearing data',
        scope,
        response.status,
      );
    }
    const message = typeof (payload as { error?: { message?: unknown } })?.error?.message === 'string'
      ? String((payload as { error: { message: string } }).error.message)
      : `${response.status} ${response.statusText}`.trim();
    return errorResult(unavailable ? 'unavailable' : 'error', unavailable ? 'brainbase_api_unavailable' : 'brainbase_api_error', message, scope, response.status);
  }
  if (credentialBearingPayload) {
    return errorResult('error', 'brainbase_api_response_invalid', 'Brainbase API returned credential-bearing data', scope, response.status);
  }
  if (response.status !== 204 && !payloadParsed) {
    return errorResult('error', 'brainbase_api_response_invalid', 'Brainbase API returned malformed JSON', scope, response.status);
  }
  if (response.status !== 204 && !isSuccessfulResponseFor(name, payload)) {
    return errorResult('error', 'brainbase_api_response_invalid', 'Brainbase API returned an invalid onboarding response', scope, response.status);
  }
  return { status: 'ok', scope: { project_codes: scope }, data: payload };
}
