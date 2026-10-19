/**
 * Portable evidence-chain contract for judgment nodes.
 *
 * The Host owns event binding and decides which events count as business
 * evidence.  This module only validates the small node result and evaluates
 * ordered references; it never reads a transcript, Task, or private store.
 */

export const JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION = 'brainbase-judgment-node-result-v1' as const;
export const JUDGMENT_NODE_EVIDENCE_CONTRACT = 'judgment-node-evidence-v1' as const;

export type JudgmentNodeStatus = 'supported' | 'insufficient';
export type JudgmentNodeEvaluationStatus =
  | 'not_required'
  | 'host_unsupported'
  | 'missing'
  | 'invalid'
  | 'insufficient'
  | 'ready';

export interface JudgmentNodeResult {
  schema_version: typeof JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION;
  node_id: string;
  status: JudgmentNodeStatus;
  finding: string;
  evidence_fit: string;
  unknowns: string[];
  evidence_tool_use_ids: string[];
  previous_result_tool_use_id: string | null;
  next_action: string;
}

export interface JudgmentNodeDefinition {
  id: string;
  instruction?: unknown;
  execution_contract?: unknown;
  [key: string]: unknown;
}

export type JudgmentNodeResultRecord = Omit<JudgmentNodeResult, 'status'> & {
  status: JudgmentNodeStatus | 'invalid';
  tool_use_id: string | null;
  event_sequence: number;
};

export interface JudgmentNodeEvidenceEvaluation {
  required: boolean;
  ready: boolean;
  status: JudgmentNodeEvaluationStatus;
  next_node: string | null;
  next_action: string | null;
  results: JudgmentNodeResultRecord[];
  unsupported_node_ids?: string[];
}

type UnknownRecord = Record<string, unknown>;

const NODE_STATUSES = new Set<JudgmentNodeStatus>(['supported', 'insufficient']);
const CONTROL_EVENT_KINDS = new Set([
  'control', 'route', 'evidence', 'node_evidence', 'state', 'value_proof',
  'turn_resolution', 'ignored', 'personal_answer', 'frame_catalog', 'frame_read', 'frame'
]);
const NON_BUSINESS_TOOL_PATTERN = /(?:^|__)(?:get_goal|update_goal|create_goal|search_tools|tools_search|tool_search|list_tools|list_mcp_resources|list_mcp_resource_templates|curr_time|current_time|get_time|clock|sleep)$/u;
const MAX_NODE_ID_LENGTH = 160;
const MAX_TEXT_LENGTH = 2000;
const MAX_UNKNOWN_LENGTH = 800;
const MAX_ITEMS = 24;
const SECRET_PATTERN = /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+|\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,})\b/iu;

const INPUT_KEYS = Object.freeze([
  'node_id', 'status', 'finding', 'evidence_fit', 'unknowns',
  'evidence_tool_use_ids', 'previous_result_tool_use_id', 'next_action'
]);
const RESULT_KEYS = Object.freeze(['schema_version', ...INPUT_KEYS]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is UnknownRecord {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function cleanText(value: unknown, limit: number, { nullable = false }: { nullable?: boolean } = {}): string | null | undefined {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || [...text].length > limit || SECRET_PATTERN.test(text)) return undefined;
  return text;
}

function cleanId(value: unknown, options: { nullable?: boolean } = {}): string | null | undefined {
  return cleanText(value, MAX_NODE_ID_LENGTH, options);
}

function cleanStringArray(value: unknown, limit: number, { maxItems = MAX_ITEMS }: { maxItems?: number } = {}): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const result: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry, limit);
    if (typeof text !== 'string' || result.includes(text)) return undefined;
    result.push(text);
  }
  return result;
}

type JudgmentNodeResultWithoutSchema = Omit<JudgmentNodeResult, 'schema_version'>;

function normalizeInput(value: unknown, options: { includeSchemaVersion: true }): JudgmentNodeResult | null;
function normalizeInput(value: unknown, options: { includeSchemaVersion: false }): JudgmentNodeResultWithoutSchema | null;
function normalizeInput(
  value: unknown,
  { includeSchemaVersion = true }: { includeSchemaVersion?: boolean } = {}
): JudgmentNodeResult | JudgmentNodeResultWithoutSchema | null {
  const expectedKeys = includeSchemaVersion ? RESULT_KEYS : INPUT_KEYS;
  if (!exactKeys(value, expectedKeys)) return null;
  if (includeSchemaVersion && value.schema_version !== JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION) return null;
  const nodeId = cleanId(value.node_id);
  const status = value.status;
  const finding = cleanText(value.finding, MAX_TEXT_LENGTH);
  const evidenceFit = cleanText(value.evidence_fit, MAX_TEXT_LENGTH);
  const unknowns = cleanStringArray(value.unknowns, MAX_UNKNOWN_LENGTH);
  const evidenceIds = cleanStringArray(value.evidence_tool_use_ids, MAX_NODE_ID_LENGTH);
  const previous = cleanId(value.previous_result_tool_use_id, { nullable: true });
  const nextAction = cleanText(value.next_action, MAX_TEXT_LENGTH);
  if (
    typeof nodeId !== 'string'
    || !NODE_STATUSES.has(status as JudgmentNodeStatus)
    || typeof finding !== 'string'
    || typeof evidenceFit !== 'string'
    || !unknowns
    || !evidenceIds
    || previous === undefined
    || typeof nextAction !== 'string'
  ) return null;
  if (status === 'insufficient' && unknowns.length === 0) return null;
  const base = {
    node_id: nodeId,
    status: status as JudgmentNodeStatus,
    finding,
    evidence_fit: evidenceFit,
    unknowns,
    evidence_tool_use_ids: evidenceIds,
    previous_result_tool_use_id: previous as string | null,
    next_action: nextAction
  };
  return includeSchemaVersion
    ? { schema_version: JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION, ...base }
    : base;
}

/** Normalize a result stored in a successful node-evidence event. */
export function normalizeJudgmentNodeResult(value: unknown): JudgmentNodeResult | null {
  return normalizeInput(value, { includeSchemaVersion: true });
}

function contractNodes(receipt: unknown): JudgmentNodeDefinition[] {
  if (!isRecord(receipt) || !Array.isArray(receipt.active_node_definitions)) return [];
  return receipt.active_node_definitions.filter((node): node is JudgmentNodeDefinition => (
    isRecord(node)
    && node.execution_contract === JUDGMENT_NODE_EVIDENCE_CONTRACT
    && typeof node.id === 'string'
    && node.id.trim().length > 0
  ));
}

/** Return opted-in node ids in the order their results must be chained. */
export function judgmentNodeEvidenceNodeIds(receipt: unknown): string[] {
  return contractNodes(receipt).map((node) => node.id);
}

function eventSequence(event: unknown, fallback: number): number {
  const record = isRecord(event) ? event : null;
  return record && Number.isSafeInteger(record.event_sequence) ? record.event_sequence as number : fallback;
}

interface EventEntry {
  event: unknown;
  index: number;
  sequence: number;
}

function sortEvents(events: unknown): EventEntry[] {
  return (Array.isArray(events) ? events : [])
    .map((event, index) => ({ event, index, sequence: eventSequence(event, index) }))
    .sort((left, right) => left.sequence - right.sequence || left.index - right.index);
}

function eventId(event: unknown): string | null {
  const record = isRecord(event) ? event : null;
  return typeof record?.tool_use_id === 'string' && record.tool_use_id.trim() ? record.tool_use_id : null;
}

/** Return whether an event is usable business evidence for a node. */
export function isSuccessfulJudgmentEvidenceEvent(event: unknown): boolean {
  if (!isRecord(event) || event.success !== true || !eventId(event)) return false;
  if (CONTROL_EVENT_KINDS.has(event.event_kind as string)) return false;
  const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
  if (NON_BUSINESS_TOOL_PATTERN.test(toolName)) return false;
  if (
    /(?:^|__)(?:brainbase_projects|brainbase_admin_read|brainbase_run_receipt_inbox|brainbase_run_receipt_history|authorize_tenant_resource)$/u.test(toolName)
    && !/^mcp__brainbase(?:-|_)personal__brainbase_admin_read$/u.test(toolName)
  ) return false;
  if (/brainbase_(?:judgment_(?:node|audit|state|value_proof|frame)|knowledge_(?:resolve|evidence)|personal_kg_answer)(?:_|$)/u.test(toolName)) {
    return false;
  }
  const safeMetadata = isRecord(event.safe_metadata) ? event.safe_metadata : undefined;
  const retrievalOutcome = safeMetadata?.retrieval_outcome;
  if (retrievalOutcome !== undefined && retrievalOutcome !== null && retrievalOutcome !== 'result') return false;
  if (
    isRecord(safeMetadata?.retrieval_evidence)
    && safeMetadata.retrieval_evidence.status !== 'retrieved'
  ) return false;
  return true;
}

function isEarlierEvent(candidate: unknown, resultEvent: unknown): boolean {
  return eventSequence(candidate, 0) < eventSequence(resultEvent, Number.MAX_SAFE_INTEGER);
}

function evidenceForResult(
  result: JudgmentNodeResult,
  resultEvent: unknown,
  eventsById: Map<string, UnknownRecord>,
  { required = true }: { required?: boolean } = {}
): boolean {
  if (required && result.status === 'supported' && result.evidence_tool_use_ids.length === 0) return false;
  return result.evidence_tool_use_ids.every((id) => {
    const event = eventsById.get(id);
    return Boolean(event && isEarlierEvent(event, resultEvent) && isSuccessfulJudgmentEvidenceEvent(event));
  });
}

function resultRecord(
  result: Omit<JudgmentNodeResult, 'status'> & { status: JudgmentNodeStatus | 'invalid' },
  event: unknown,
  sequence: number
): JudgmentNodeResultRecord {
  return {
    ...result,
    tool_use_id: eventId(event),
    event_sequence: sequence
  };
}

function missingAction(node: JudgmentNodeDefinition): string {
  const instruction = cleanText(node.instruction, MAX_TEXT_LENGTH);
  return typeof instruction === 'string'
    ? `実行: ${instruction}。完了後にこの段階の判断結果を記録してください。`
    : `実行してから ${node.id} の判断結果を記録してください。`;
}

interface NodeRecord {
  result: JudgmentNodeResult;
  event: unknown;
  sequence: number;
}

/**
 * Evaluate the ordered result chain for a route receipt.
 *
 * Returned result entries contain only the normalized node result and its
 * binding event id/sequence; event response bodies stay outside this module.
 */
export function evaluateJudgmentNodeEvidence(
  events: unknown,
  receipt: unknown,
  { hostSupported = true }: { hostSupported?: boolean } = {}
): JudgmentNodeEvidenceEvaluation {
  const nodes = contractNodes(receipt);
  if (nodes.length === 0) {
    return { required: false, ready: true, status: 'not_required', next_node: null, next_action: null, results: [] };
  }
  if (!hostSupported) {
    return {
      required: false,
      ready: true,
      status: 'host_unsupported',
      next_node: null,
      next_action: null,
      results: [],
      unsupported_node_ids: nodes.map((node) => node.id)
    };
  }

  const orderedEvents = sortEvents(events);
  const eventsById = new Map<string, UnknownRecord>();
  for (const entry of orderedEvents) {
    const id = eventId(entry.event);
    if (id && isRecord(entry.event) && !eventsById.has(id)) eventsById.set(id, entry.event);
  }

  const recordsByNode = new Map<string, NodeRecord[]>();
  for (const entry of orderedEvents) {
    if (!isRecord(entry.event)) continue;
    if (entry.event.event_kind !== 'node_evidence' || entry.event.success !== true) continue;
    const safeMetadata = isRecord(entry.event.safe_metadata) ? entry.event.safe_metadata : undefined;
    const normalized = normalizeJudgmentNodeResult(safeMetadata?.node_result);
    if (!normalized) continue;
    const node = nodes.find((candidate) => candidate.id === normalized.node_id);
    if (!node || !eventId(entry.event)) continue;
    const record: NodeRecord = { result: normalized, event: entry.event, sequence: entry.sequence };
    const records = recordsByNode.get(normalized.node_id) ?? [];
    records.push(record);
    recordsByNode.set(normalized.node_id, records);
  }

  const latestResults: JudgmentNodeResultRecord[] = [];
  let firstProblem: { status: 'missing' | 'invalid' | 'insufficient'; node: JudgmentNodeDefinition; next_action: string } | null = null;
  let priorCurrentToolUseId: string | null = null;
  let priorCurrentNodeId: string | null = null;
  let priorCurrentSequence: number | null = null;
  for (const node of nodes) {
    const records = recordsByNode.get(node.id) ?? [];
    const latest = records.at(-1) ?? null;
    if (!latest) {
      firstProblem = { status: 'missing', node, next_action: missingAction(node) };
      break;
    }

    const normalized = latest.result;
    const latestToolUseId = eventId(latest.event);
    let valid = true;
    let status: JudgmentNodeStatus | 'invalid' = normalized.status;
    let action = normalized.next_action;
    if (
      normalized.previous_result_tool_use_id !== priorCurrentToolUseId
      || (priorCurrentSequence !== null && latest.sequence <= priorCurrentSequence)
    ) {
      valid = false;
      status = 'invalid';
      action = `前段 ${priorCurrentNodeId ?? '開始'} の最新結果に結び直してから ${node.id} を再評価してください。`;
    }

    const evidenceRequired = node.id !== 'problem-frame';
    if (valid && !evidenceForResult(normalized, latest.event, eventsById, { required: evidenceRequired })) {
      valid = false;
      status = 'invalid';
      action = 'この段階の結論に対応する、先に実行した成功済み業務tool_use_idを記録して再評価してください。';
    }

    const priorInsufficient = [...records].reverse().find((record) => record !== latest && record.result.status === 'insufficient');
    if (valid && priorInsufficient) {
      const priorIds = new Set(priorInsufficient.result.evidence_tool_use_ids);
      const hasNewEvidence = normalized.evidence_tool_use_ids.some((id) => {
        const evidence = eventsById.get(id);
        return Boolean(
          !priorIds.has(id)
          && evidence
          && eventSequence(evidence, -1) > priorInsufficient.sequence
          && isEarlierEvent(evidence, latest.event)
          && isSuccessfulJudgmentEvidenceEvent(evidence)
        );
      });
      if (!hasNewEvidence) {
        valid = false;
        status = 'insufficient';
        action = `不足した根拠を追加取得して ${node.id} を再評価してください。`;
      }
    }

    if (!valid || normalized.status === 'insufficient') {
      firstProblem = {
        status: normalized.status === 'insufficient'
          ? 'insufficient'
          : status === 'insufficient' ? 'insufficient' : 'invalid',
        node,
        next_action: action
      };
    }
    latestResults.push(resultRecord({ ...normalized, status }, latest.event, latest.sequence));
    if (firstProblem) break;
    priorCurrentToolUseId = latestToolUseId;
    priorCurrentNodeId = node.id;
    priorCurrentSequence = latest.sequence;
  }

  if (firstProblem) {
    return {
      required: true,
      ready: false,
      status: firstProblem.status,
      next_node: firstProblem.node.id,
      next_action: firstProblem.next_action,
      results: latestResults
    };
  }
  return { required: true, ready: true, status: 'ready', next_node: null, next_action: null, results: latestResults };
}
