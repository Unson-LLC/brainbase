// The model supplies a short, structured result for an opted-in judgment node.
// The Host owns the binding: only successful work events that happened before
// the result can support it, and a changed upstream result invalidates all
// downstream links.

export const JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION = 'brainbase-judgment-node-result-v1';
export const JUDGMENT_NODE_EVIDENCE_CONTRACT = 'judgment-node-evidence-v1';

const NODE_STATUSES = new Set(['supported', 'insufficient']);
const CONTROL_EVENT_KINDS = new Set([
    'control', 'route', 'evidence', 'node_evidence', 'state', 'value_proof',
    'turn_resolution', 'ignored', 'personal_answer'
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

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
    if (!isRecord(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function cleanText(value, limit, { nullable = false } = {}) {
    if (value === null && nullable) return null;
    if (typeof value !== 'string') return undefined;
    const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (!text || [...text].length > limit || SECRET_PATTERN.test(text)) return undefined;
    return text;
}

function cleanId(value, { nullable = false } = {}) {
    return cleanText(value, MAX_NODE_ID_LENGTH, { nullable });
}

function cleanStringArray(value, limit, { maxItems = MAX_ITEMS } = {}) {
    if (!Array.isArray(value) || value.length > maxItems) return undefined;
    const result = [];
    for (const entry of value) {
        const text = cleanText(entry, limit);
        if (!text || result.includes(text)) return undefined;
        result.push(text);
    }
    return result;
}

function normalizeInput(value, { includeSchemaVersion = true } = {}) {
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
    if (!nodeId || !NODE_STATUSES.has(status) || !finding || !evidenceFit
        || !unknowns || !evidenceIds || previous === undefined || !nextAction) return null;
    // An insufficient result must tell the repair loop what remains unknown.
    // Supported results may have an empty unknowns list, but the Host still
    // requires actual business evidence before accepting them.
    if (status === 'insufficient' && unknowns.length === 0) return null;
    const result = {
        ...(includeSchemaVersion ? { schema_version: JUDGMENT_NODE_EVIDENCE_SCHEMA_VERSION } : {}),
        node_id: nodeId,
        status,
        finding,
        evidence_fit: evidenceFit,
        unknowns,
        evidence_tool_use_ids: evidenceIds,
        previous_result_tool_use_id: previous,
        next_action: nextAction,
    };
    return result;
}

/**
 * Normalize the result stored in a successful node-evidence event.
 * Returns null for anything outside brainbase-judgment-node-result-v1.
 */
export function normalizeJudgmentNodeResult(value) {
    return normalizeInput(value, { includeSchemaVersion: true });
}

function normalizeNodeInput(value) {
    return normalizeInput(value, { includeSchemaVersion: false });
}

function contractNodes(receipt) {
    if (!isRecord(receipt) || !Array.isArray(receipt.active_node_definitions)) return [];
    return receipt.active_node_definitions.filter((node) => (
        isRecord(node)
        && node.execution_contract === JUDGMENT_NODE_EVIDENCE_CONTRACT
        && typeof node.id === 'string'
        && node.id.trim()
    ));
}

function eventSequence(event, fallback) {
    return Number.isSafeInteger(event?.event_sequence) ? event.event_sequence : fallback;
}

function sortEvents(events) {
    return (Array.isArray(events) ? events : [])
        .map((event, index) => ({ event, index, sequence: eventSequence(event, index) }))
        .sort((left, right) => left.sequence - right.sequence || left.index - right.index);
}

function eventId(event) {
    return typeof event?.tool_use_id === 'string' && event.tool_use_id.trim() ? event.tool_use_id : null;
}

export function isSuccessfulJudgmentEvidenceEvent(event) {
    if (!isRecord(event) || event.success !== true || !eventId(event)) return false;
    if (CONTROL_EVENT_KINDS.has(event.event_kind)) return false;
    // Known control-plane records sometimes arrive with a generic event kind.
    // Do not let a record/audit/state operation become node evidence by name.
    const toolName = typeof event.tool_name === 'string' ? event.tool_name : '';
    if (NON_BUSINESS_TOOL_PATTERN.test(toolName)) return false;
    if (/(?:^|__)(?:brainbase_projects|brainbase_admin_read|brainbase_run_receipt_inbox|brainbase_run_receipt_history|authorize_tenant_resource)$/u.test(toolName)) return false;
    if (/brainbase_(?:judgment_(?:node|audit|state|value_proof)|knowledge_(?:resolve|evidence)|personal_kg_answer)_/u.test(toolName)) return false;
    // A transport-successful search/retrieval with no usable result is an
    // attempt, not evidence. Keep this check deliberately narrow: arbitrary
    // business events without retrieval metadata remain valid provenance.
    const retrievalOutcome = event.safe_metadata?.retrieval_outcome;
    // A null outcome is used on non-retrieval business events. Exclude only
    // an explicit empty/non-result retrieval, while preserving those events
    // as valid provenance when they carry no retrieval status.
    if (retrievalOutcome !== undefined && retrievalOutcome !== null
        && retrievalOutcome !== 'result') return false;
    if (isRecord(event.safe_metadata?.retrieval_evidence)
        && event.safe_metadata.retrieval_evidence.status !== 'retrieved') return false;
    return true;
}

function isEarlierEvent(candidate, resultEvent) {
    return eventSequence(candidate, 0) < eventSequence(resultEvent, Number.MAX_SAFE_INTEGER);
}

function evidenceForResult(result, resultEvent, eventsById, { required = true } = {}) {
    if (required && result.status === 'supported' && result.evidence_tool_use_ids.length === 0) return false;
    return result.evidence_tool_use_ids.every((id) => {
        const event = eventsById.get(id);
        return event && isEarlierEvent(event, resultEvent) && isSuccessfulJudgmentEvidenceEvent(event);
    });
}

function resultRecord(result, event, sequence) {
    return {
        ...result,
        tool_use_id: eventId(event),
        event_sequence: sequence,
    };
}

function missingAction(node) {
    const instruction = cleanText(node?.instruction, MAX_TEXT_LENGTH);
    return instruction ? `実行: ${instruction}。完了後にこの段階の判断結果を記録してください。` : `実行してから ${node.id} の判断結果を記録してください。`;
}

/**
 * Check the ordered results for the opted-in nodes in a route receipt.
 *
 * Results are intentionally small and contain no tool response body. The
 * returned `results` list contains the latest record for each opted-in node,
 * enriched with its event id/sequence for downstream binding.
 */
export function evaluateJudgmentNodeEvidence(events, receipt) {
    const nodes = contractNodes(receipt);
    if (nodes.length === 0) {
        return { required: false, ready: true, status: 'not_required', next_node: null, next_action: null, results: [] };
    }

    const orderedEvents = sortEvents(events);
    const eventsById = new Map();
    for (const entry of orderedEvents) {
        const id = eventId(entry.event);
        if (id && !eventsById.has(id)) eventsById.set(id, entry.event);
    }

    // Keep every valid record in order so that a retry can be checked against
    // the immediately preceding insufficient result. The latest record wins
    // for the node's current state.
    const recordsByNode = new Map();
    for (const entry of orderedEvents) {
        if (entry.event?.event_kind !== 'node_evidence' || entry.event?.success !== true) continue;
        const normalized = normalizeJudgmentNodeResult(entry.event?.safe_metadata?.node_result);
        if (!normalized) continue;
        const node = nodes.find((candidate) => candidate.id === normalized.node_id);
        if (!node || !eventId(entry.event)) continue;
        const record = { result: normalized, event: entry.event, sequence: entry.sequence };
        const records = recordsByNode.get(normalized.node_id) ?? [];
        records.push(record);
        recordsByNode.set(normalized.node_id, records);
    }

    const latestResults = [];
    let firstProblem = null;
    let priorCurrentToolUseId = null;
    let priorCurrentNodeId = null;
    let priorCurrentSequence = null;
    for (const node of nodes) {
        const records = recordsByNode.get(node.id) ?? [];
        const latest = records.at(-1) ?? null;
        if (!latest) {
            firstProblem = {
                status: 'missing',
                node,
                next_action: missingAction(node),
            };
            break;
        }
        const normalized = latest.result;
        const latestToolUseId = eventId(latest.event);
        let valid = true;
        let status = normalized.status;
        let action = normalized.next_action;

        if (normalized.previous_result_tool_use_id !== priorCurrentToolUseId
            || (priorCurrentSequence !== null && latest.sequence <= priorCurrentSequence)) {
            valid = false;
            status = 'invalid';
            action = `前段 ${priorCurrentNodeId ?? '開始'} の最新結果に結び直してから ${node.id} を再評価してください。`;
        }
        // The problem frame establishes the question before there is necessarily
        // a business lookup to cite. Later nodes must cite actual prior work.
        const evidenceRequired = node.id !== 'problem-frame';
        if (valid && !evidenceForResult(normalized, latest.event, eventsById, { required: evidenceRequired })) {
            valid = false;
            status = 'invalid';
            action = `この段階の結論に対応する、先に実行した成功済み業務tool_use_idを記録して再評価してください。`;
        }
        const priorInsufficient = [...records].reverse().find((record) => record !== latest && record.result.status === 'insufficient');
        if (valid && priorInsufficient) {
            const priorIds = new Set(priorInsufficient.result.evidence_tool_use_ids);
            const hasNewEvidence = normalized.evidence_tool_use_ids.some((id) => {
                const evidence = eventsById.get(id);
                return !priorIds.has(id) && evidence && eventSequence(evidence, -1) > priorInsufficient.sequence
                    && isEarlierEvent(evidence, latest.event) && isSuccessfulJudgmentEvidenceEvent(evidence);
            });
            if (!hasNewEvidence) {
                valid = false;
                status = 'insufficient';
                action = `不足した根拠を追加取得して ${node.id} を再評価してください。`;
            }
        }
        if (!valid || normalized.status === 'insufficient') {
            firstProblem = { status: normalized.status === 'insufficient' ? 'insufficient' : status, node, next_action: action };
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
            results: latestResults,
        };
    }
    return {
        required: true,
        ready: true,
        status: 'ready',
        next_node: null,
        next_action: null,
        results: latestResults,
    };
}
