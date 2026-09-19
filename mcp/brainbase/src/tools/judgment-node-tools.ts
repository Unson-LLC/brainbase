import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const JUDGMENT_NODE_RESULT_SCHEMA_VERSION = 'brainbase-judgment-node-result-v1' as const;
const NODE_STATUSES = ['supported', 'insufficient'] as const;
const NODE_CONTRACT = 'judgment-node-evidence-v1';
const TEXT_LIMIT = 2000;
const ID_LIMIT = 160;
const UNKNOWN_LIMIT = 800;
const MAX_ITEMS = 24;
const SECRET_PATTERN = /\b(?:api[_-]?key|password|passwd|secret|token)\s*[:=]\s*\S+|\b(?:sk-[a-z0-9_-]{8,}|ghp_[a-z0-9_]{8,}|github_pat_[a-z0-9_]{8,}|xox[a-z]-[a-z0-9-]{8,})\b/iu;

export type JudgmentNodeResultV1 = {
  schema_version: typeof JUDGMENT_NODE_RESULT_SCHEMA_VERSION;
  node_id: string;
  status: typeof NODE_STATUSES[number];
  finding: string;
  evidence_fit: string;
  unknowns: string[];
  evidence_tool_use_ids: string[];
  previous_result_tool_use_id: string | null;
  next_action: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function cleanText(value: unknown, limit: number, nullable = false): string | null | undefined {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text || [...text].length > limit || SECRET_PATTERN.test(text)) return undefined;
  return text;
}

function cleanArray(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;
  const result: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry, limit);
    if (!text || result.includes(text)) return null;
    result.push(text);
  }
  return result;
}

function normalizeResult(args: Record<string, unknown>): JudgmentNodeResultV1 | null {
  const keys = [
    'node_id', 'status', 'finding', 'evidence_fit', 'unknowns',
    'evidence_tool_use_ids', 'previous_result_tool_use_id', 'next_action',
  ] as const;
  if (!exactKeys(args, keys)) return null;
  const nodeId = cleanText(args.node_id, ID_LIMIT);
  const status = args.status;
  const finding = cleanText(args.finding, TEXT_LIMIT);
  const evidenceFit = cleanText(args.evidence_fit, TEXT_LIMIT);
  const unknowns = cleanArray(args.unknowns, UNKNOWN_LIMIT);
  const evidenceIds = cleanArray(args.evidence_tool_use_ids, ID_LIMIT);
  const previous = cleanText(args.previous_result_tool_use_id, ID_LIMIT, true);
  const nextAction = cleanText(args.next_action, TEXT_LIMIT);
  if (!nodeId || !NODE_STATUSES.includes(status as typeof NODE_STATUSES[number])
    || !finding || !evidenceFit || !unknowns || !evidenceIds || previous === undefined || !nextAction) return null;
  if (status === 'insufficient' && unknowns.length === 0) return null;
  return {
    schema_version: JUDGMENT_NODE_RESULT_SCHEMA_VERSION,
    node_id: nodeId,
    status: status as JudgmentNodeResultV1['status'],
    finding,
    evidence_fit: evidenceFit,
    unknowns,
    evidence_tool_use_ids: evidenceIds,
    previous_result_tool_use_id: previous,
    next_action: nextAction,
  };
}

export const judgmentNodeTools: Tool[] = [{
  name: 'brainbase_judgment_node_record',
  description: `Record a short result for one opted-in judgment DAG node (${NODE_CONTRACT}). Call after the node's actual work. Include only successful earlier business tool_use_id values in evidence_tool_use_ids; do not cite control, route, evidence, record, state, or raw tool output. Use status=insufficient with unknowns and a concrete next_action when the evidence is not enough. The Host binds the chain and keeps this record out of the final answer.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'node_id', 'status', 'finding', 'evidence_fit', 'unknowns',
      'evidence_tool_use_ids', 'previous_result_tool_use_id', 'next_action',
    ],
    properties: {
      node_id: { type: 'string', minLength: 1, maxLength: ID_LIMIT },
      status: { type: 'string', enum: [...NODE_STATUSES] },
      finding: { type: 'string', minLength: 1, maxLength: TEXT_LIMIT },
      evidence_fit: { type: 'string', minLength: 1, maxLength: TEXT_LIMIT },
      unknowns: { type: 'array', maxItems: MAX_ITEMS, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: UNKNOWN_LIMIT } },
      evidence_tool_use_ids: { type: 'array', maxItems: MAX_ITEMS, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: ID_LIMIT } },
      previous_result_tool_use_id: { type: ['string', 'null'], maxLength: ID_LIMIT },
      next_action: { type: 'string', minLength: 1, maxLength: TEXT_LIMIT },
    },
  },
}];

export async function handleJudgmentNodeToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: 'ok'; data: JudgmentNodeResultV1 } | { status: 'error'; error: { code: string; message: string } } | null> {
  if (name !== 'brainbase_judgment_node_record') return null;
  const normalized = normalizeResult(args);
  if (!normalized) {
    return {
      status: 'error',
      error: {
        code: 'judgment_node_result_invalid',
        message: 'Judgment node result does not match brainbase-judgment-node-result-v1',
      },
    };
  }
  return { status: 'ok', data: normalized };
}
