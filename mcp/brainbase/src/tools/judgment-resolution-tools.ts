import { createHash, createHmac } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  authenticateProject,
  fetchAuthenticatedJson,
  toolError,
  type AuthenticatedApiDependencies,
  type ToolResult,
} from './authenticated-api-tool.js';

const INTENTS = ['answer', 'investigate', 'diagnose', 'design', 'implement', 'review', 'operate'] as const;
const DOMAINS = ['general', 'knowledge', 'personal_judgment', 'engineering', 'organization', 'operations'] as const;
const ACTIONS = ['none', 'read', 'write', 'external'] as const;
const RISKS = ['low', 'medium', 'high', 'critical'] as const;
const CONFIDENCES = ['confirmed', 'inferred', 'unknown'] as const;
const SIGNALS = ['cumulative_effect', 'complexity_growth', 'threshold_proposal', 'parallel_exploration', 'authority_boundary', 'problem_frame_uncertain', 'external_outcome'] as const;
const CONTENT_TYPES = ['canonical_fact', 'team_document', 'source_document', 'personal_knowledge', 'operational_state', 'unknown'] as const;

export type JudgmentResolutionDependencies = AuthenticatedApiDependencies & {
  bindingSecret: string;
  adapterId: string;
  adapterVersion: string;
  now?: () => Date;
};

export type TurnInput = {
  request: string;
  turn_id: string;
  project_code?: string;
  conversation_context: Record<string, unknown>;
};

export type ModelInterpretation = {
  intent: typeof INTENTS[number];
  domains: Array<typeof DOMAINS[number]>;
  action_kind: typeof ACTIONS[number];
  risk: typeof RISKS[number];
  confidence: typeof CONFIDENCES[number];
  signals: Array<typeof SIGNALS[number]>;
};

export type TurnContract = Record<string, unknown> & {
  turn_id: string;
  request_digest: string;
  required_capabilities: Array<Record<string, unknown>>;
};

export type ToolEvidence = {
  tool_name: string;
  tool_use_id: string;
  success: boolean;
  satisfies: string[];
};

export type CompletionReceipt = {
  turn_id: string;
  event_count: number;
  event_set_digest: string;
};

const classificationSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    domains: { type: 'array', items: { type: 'string', enum: DOMAINS }, minItems: 1, uniqueItems: true },
    action_kind: { type: 'string', enum: ACTIONS },
    risk: { type: 'string', enum: RISKS },
    confidence: { type: 'string', enum: CONFIDENCES },
    signals: { type: 'array', items: { type: 'string', enum: SIGNALS }, uniqueItems: true },
  },
  required: ['intent', 'domains', 'action_kind', 'risk', 'confidence', 'signals'],
  additionalProperties: false,
} as const;

export const judgmentResolutionTools: Tool[] = [{
  name: 'brainbase_resolve_turn',
  description: 'Resolve the current turn contract after the model has interpreted the user request. Call exactly once before other work; pass the Hook-provided turn_input unchanged and add only model_interpretation.',
  inputSchema: {
    type: 'object',
    properties: {
      turn_input: { type: 'object' },
      model_interpretation: classificationSchema,
    },
    required: ['turn_input', 'model_interpretation'],
    additionalProperties: false,
  },
}];

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0) as number);
  const b = Array.from(right, (value) => value.codePointAt(0) as number);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(compareCodePoints).map((key) => {
      if (record[key] === undefined) throw new TypeError('canonical JSON does not support undefined');
      return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function computeJudgmentRequestDigest(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex');
}

export function createJudgmentBindingHeaders(
  args: Record<string, unknown>,
  binding: { bindingSecret: string; adapterId: string; adapterVersion: string; issuedAt: string },
): Record<string, string> {
  const turnId = typeof args.turn_id === 'string' ? args.turn_id : '';
  const requestDigest = computeJudgmentRequestDigest(args);
  const payload = canonicalJson([
    'brainbase-judgment-binding-v1', binding.adapterId, binding.adapterVersion,
    turnId, binding.issuedAt, requestDigest,
  ]);
  return {
    'x-brainbase-judgment-adapter': binding.adapterId,
    'x-brainbase-judgment-version': binding.adapterVersion,
    'x-brainbase-judgment-issued-at': binding.issuedAt,
    'x-brainbase-judgment-request-digest': requestDigest,
    'x-brainbase-judgment-signature': createHmac('sha256', binding.bindingSecret).update(payload).digest('hex'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown, { nonEmpty = false, unique = false } = {}): value is string[] {
  return Array.isArray(value)
    && (!nonEmpty || value.length > 0)
    && value.every(isNonEmptyString)
    && (!unique || new Set(value).size === value.length);
}

function ordered(values: string[], order: readonly string[]): string[] {
  return [...values].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

function isClassification(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['intent', 'domains', 'action_kind', 'risk', 'confidence', 'signals'])) return false;
  const domains = value.domains;
  return INTENTS.includes(value.intent as typeof INTENTS[number])
    && isStringArray(domains, { nonEmpty: true, unique: true })
    && domains.every((domain) => DOMAINS.includes(domain as typeof DOMAINS[number]))
    && (!domains.includes('general') || domains.length === 1)
    && ACTIONS.includes(value.action_kind as typeof ACTIONS[number])
    && RISKS.includes(value.risk as typeof RISKS[number])
    && CONFIDENCES.includes(value.confidence as typeof CONFIDENCES[number])
    && isStringArray(value.signals, { unique: true })
    && value.signals.every((signal) => SIGNALS.includes(signal as typeof SIGNALS[number]));
}

function isClassificationEvidence(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['source', 'source_turn_ids', 'matcher_ids'])
    && ['current_request', 'prior_receipt', 'prior_message', 'resolver'].includes(String(value.source))
    && isStringArray(value.source_turn_ids, { unique: true })
    && isStringArray(value.matcher_ids, { unique: true });
}

function isPolicy(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id', 'version', 'priority', 'strength', 'scope', 'visibility', 'owner_person_id',
    'evidence_requirement', 'effect', 'instruction',
  ])) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.version) || !Number.isInteger(value.priority)) return false;
  if (!['hard', 'soft'].includes(String(value.strength)) || !['organization', 'owner'].includes(String(value.visibility))) return false;
  if (value.owner_person_id !== null && !isNonEmptyString(value.owner_person_id)) return false;
  if (!isNonEmptyString(value.evidence_requirement) || !isNonEmptyString(value.instruction)) return false;
  if (!isRecord(value.scope) || !hasOnlyKeys(value.scope, ['type', 'id']) || !['global', 'organization', 'project', 'owner'].includes(String(value.scope.type))) return false;
  if (value.scope.type === 'global' ? value.scope.id !== null : !isNonEmptyString(value.scope.id)) return false;
  if (!isRecord(value.effect) || !hasOnlyKeys(value.effect, ['decision', 'target']) || !['require', 'forbid', 'prefer'].includes(String(value.effect.decision)) || !isNonEmptyString(value.effect.target)) return false;
  return value.strength === 'hard' ? ['require', 'forbid'].includes(String(value.effect.decision)) : value.effect.decision === 'prefer';
}

function isSuppressedPolicy(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['policy_id', 'suppressed_by_policy_id', 'reason'])
    && isNonEmptyString(value.policy_id)
    && isNonEmptyString(value.suppressed_by_policy_id)
    && ['lower_priority', 'lower_specificity', 'hard_over_soft'].includes(String(value.reason));
}

function isRequiredCapability(value: unknown, projectCode: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['capability', 'status', 'input', 'receipt_required'])) return false;
  if (value.capability !== 'knowledge.resolve' || value.status !== 'required' || value.receipt_required !== true || !isRecord(value.input)) return false;
  if (!hasOnlyKeys(value.input, ['intent', 'audience', 'content_type', 'project_code'])) return false;
  return value.input.intent === 'lookup'
    && ['personal', 'team', 'organization'].includes(String(value.input.audience))
    && CONTENT_TYPES.includes(value.input.content_type as typeof CONTENT_TYPES[number])
    && isNonEmptyString(value.input.project_code)
    && value.input.project_code === projectCode;
}

function isActiveNodeDefinition(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['id', 'kind', 'instruction', 'required_capability_template'])
    && isNonEmptyString(value.id)
    && ['common', 'judgment', 'capability', 'constraint', 'fail_closed'].includes(String(value.kind))
    && isNonEmptyString(value.instruction)
    && (value.required_capability_template === null || isNonEmptyString(value.required_capability_template))
    && (value.kind !== 'capability' || isNonEmptyString(value.required_capability_template));
}

function isAcyclic(nodes: string[], edges: string[][]): boolean {
  const indegree = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const [from, to] of edges) {
    if (!indegree.has(from) || !indegree.has(to)) return false;
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    outgoing.get(from)?.push(to);
  }
  const queue = nodes.filter((node) => indegree.get(node) === 0);
  let consumed = 0;
  while (queue.length > 0) {
    const node = queue.shift() as string;
    consumed += 1;
    for (const target of outgoing.get(node) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return consumed === nodes.length;
}

function isJudgmentReceipt(
  value: unknown,
  expected: { args: Record<string, unknown>; requestDigest: string; adapterId: string; adapterVersion: string },
): value is Record<string, unknown> {
  const fields = [
    'resolution_id', 'resolved_at', 'turn_id', 'request_digest', 'context_digest', 'status', 'runtime_version',
    'autonomy_decision', 'autonomy_reason_code', 'allowed_runtime_escalation_reasons',
    'manifest_digest', 'host_binding', 'project_code', 'classification', 'classification_evidence',
    'classification_assurance', 'reconciliation_reasons', 'selected_dag_ids', 'applicable_policies',
    'suppressed_policies', 'required_capabilities', 'active_nodes', 'active_edges', 'active_node_definitions',
    'unresolved', 'rationale', 'plan_digest',
  ];
  if (!isRecord(value) || !hasOnlyKeys(value, fields)) return false;
  if (!isNonEmptyString(value.resolution_id) || !isNonEmptyString(value.turn_id) || value.turn_id !== expected.args.turn_id) return false;
  if (typeof value.resolved_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.resolved_at)) return false;
  const resolvedAt = new Date(value.resolved_at);
  if (Number.isNaN(resolvedAt.valueOf()) || resolvedAt.toISOString() !== value.resolved_at) return false;
  if (value.request_digest !== expected.requestDigest || !/^[a-f0-9]{64}$/.test(String(value.request_digest))) return false;
  const expectedContextDigest = expected.args.conversation_context === undefined
    ? null
    : createHash('sha256').update(canonicalJson(expected.args.conversation_context)).digest('hex');
  if (value.context_digest !== expectedContextDigest) return false;
  if (!['resolved', 'needs_classification', 'needs_policy_resolution'].includes(String(value.status))) return false;
  if (!['continue', 'escalate'].includes(String(value.autonomy_decision))) return false;
  if (!['routine_in_scope', 'classification_missing', 'policy_conflict', 'risk_or_external'].includes(String(value.autonomy_reason_code))) return false;
  if (!isStringArray(value.allowed_runtime_escalation_reasons, { unique: true })) return false;
  if (!isNonEmptyString(value.runtime_version) || !/^[a-f0-9]{64}$/.test(String(value.manifest_digest)) || !/^[a-f0-9]{64}$/.test(String(value.plan_digest))) return false;
  if (!isRecord(value.host_binding) || !hasOnlyKeys(value.host_binding, ['adapter_id', 'adapter_version', 'status', 'enforcement_level'])) return false;
  if (value.host_binding.status !== 'managed' || value.host_binding.enforcement_level !== 'host_contract'
    || value.host_binding.adapter_id !== expected.adapterId || value.host_binding.adapter_version !== expected.adapterVersion) return false;
  if (value.project_code !== (expected.args.project_code ?? null)) return false;
  if (value.classification !== null && !isClassification(value.classification)) return false;
  const expectedReason = value.status === 'needs_classification'
    ? 'classification_missing'
    : value.status === 'needs_policy_resolution'
      ? 'policy_conflict'
      : ['high', 'critical'].includes(String((value.classification as Record<string, unknown>)?.risk))
        || (value.classification as Record<string, unknown>)?.action_kind === 'external'
        ? 'risk_or_external'
        : 'routine_in_scope';
  const expectedDecision = expectedReason === 'routine_in_scope' ? 'continue' : 'escalate';
  const expectedRuntimeReasons = expectedDecision === 'continue'
    ? ['irreversible_action', 'missing_authority', 'owner_value_choice', 'required_input_unavailable', 'evidenced_terminal_blocker']
    : [];
  if (value.autonomy_decision !== expectedDecision
    || value.autonomy_reason_code !== expectedReason
    || canonicalJson(value.allowed_runtime_escalation_reasons) !== canonicalJson(expectedRuntimeReasons)) return false;
  if (!isClassificationEvidence(value.classification_evidence)) return false;
  if (!['verified', 'bounded', 'unknown'].includes(String(value.classification_assurance))) return false;
  if (!isStringArray(value.reconciliation_reasons, { unique: true }) || !isStringArray(value.selected_dag_ids, { nonEmpty: true, unique: true })) return false;
  if (!Array.isArray(value.applicable_policies) || !value.applicable_policies.every(isPolicy)) return false;
  if (!Array.isArray(value.suppressed_policies) || !value.suppressed_policies.every(isSuppressedPolicy)) return false;
  if (!Array.isArray(value.required_capabilities)
    || !value.required_capabilities.every((capability) => isRequiredCapability(capability, value.project_code))) return false;
  if (!isStringArray(value.active_nodes, { nonEmpty: true, unique: true })) return false;
  if (!Array.isArray(value.active_node_definitions) || !value.active_node_definitions.every(isActiveNodeDefinition)) return false;
  if (value.active_node_definitions.length !== value.active_nodes.length
    || value.active_node_definitions.some((node, index) => (node as Record<string, unknown>).id !== (value.active_nodes as string[])[index])) return false;
  if (!Array.isArray(value.active_edges) || !value.active_edges.every((edge) => Array.isArray(edge) && edge.length === 2 && edge.every(isNonEmptyString))) return false;
  if (!isAcyclic(value.active_nodes, value.active_edges as string[][])) return false;
  if (!isStringArray(value.unresolved, { unique: true }) || !isStringArray(value.rationale, { nonEmpty: true })) return false;
  if (value.status === 'resolved' && (value.classification === null || value.unresolved.length !== 0)) return false;
  // The server reports why classification is still open (for example
  // model_interpretation_missing on the bootstrap call, or
  // conversation_referent_missing) and mirrors those reasons into unresolved.
  if (value.status === 'needs_classification' && (value.classification !== null || value.classification_assurance !== 'unknown'
    || value.unresolved.length === 0 || canonicalJson(value.unresolved) !== canonicalJson(value.reconciliation_reasons))) return false;
  if (value.status === 'needs_policy_resolution' && (value.classification === null || canonicalJson(value.unresolved) !== canonicalJson(['policy_conflict']))) return false;
  const planValue = { ...value };
  delete planValue.resolution_id;
  delete planValue.resolved_at;
  delete planValue.request_digest;
  delete planValue.plan_digest;
  return createHash('sha256').update(canonicalJson(planValue)).digest('hex') === value.plan_digest;
}

export async function resolveJudgmentBeforeModel(
  args: Record<string, unknown>,
  dependencies: JudgmentResolutionDependencies,
): Promise<ToolResult> {
  // project_code is judgment context, not action authority. Authentication still
  // supplies the access scope used when the server selects visible policies.
  const context = await authenticateProject({}, dependencies);
  if ('status' in context) return context;
  if (!dependencies.bindingSecret) {
    return toolError('unavailable', 'brainbase_judgment_binding_unavailable', 'Brainbase judgment host binding secret is not configured', context.scope);
  }
  const issuedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const headers = createJudgmentBindingHeaders(args, {
    bindingSecret: dependencies.bindingSecret,
    adapterId: dependencies.adapterId,
    adapterVersion: dependencies.adapterVersion,
    issuedAt,
  });
  const fetched = await fetchAuthenticatedJson(dependencies, context, {
    path: '/api/judgment/resolve', method: 'POST', body: args, headers,
  });
  if (!fetched.ok) return fetched.result;
  const { response, payload } = fetched;
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const code = typeof errorPayload?.code === 'string' ? errorPayload.code : null;
    const message = typeof errorPayload?.message === 'string' ? errorPayload.message : `${response.status} ${response.statusText}`.trim();
    return toolError(
      response.status >= 500 ? 'unavailable' : 'error',
      response.status >= 500 ? 'brainbase_api_unavailable' : code ?? 'brainbase_api_error',
      message, context.scope, response.status,
    );
  }
  if (!isJudgmentReceipt(payload, {
    args,
    requestDigest: headers['x-brainbase-judgment-request-digest'],
    adapterId: dependencies.adapterId,
    adapterVersion: dependencies.adapterVersion,
  })) {
    return toolError('error', 'brainbase_api_response_invalid', 'Brainbase API returned an invalid judgment resolution receipt', context.scope, response.status);
  }
  return { status: 'ok', scope: { project_codes: context.scope }, data: payload };
}

/** Dispatch the model-callable turn resolver and the temporary internal compatibility name. */
export async function handleJudgmentResolutionToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: JudgmentResolutionDependencies,
): Promise<ToolResult | null> {
  if (name === 'brainbase_resolve_turn') {
    if (!isRecord(args.turn_input) || !isRecord(args.model_interpretation)) {
      return toolError('error', 'judgment_resolution_input_invalid', 'turn_input and model_interpretation are required', []);
    }
    return resolveJudgmentBeforeModel({
      ...args.turn_input,
      model_interpretation: args.model_interpretation,
    }, dependencies);
  }
  if (name !== 'brainbase_judgment_resolve_internal') return null;
  return resolveJudgmentBeforeModel(args, dependencies);
}
