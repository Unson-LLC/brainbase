// @ts-nocheck
// Stage3a migration exception: the mechanically extracted legacy helper body
// remains unchecked internally. The public adapter contract is declared and
// strict-checked in judgment-runtime-resolution.public.d.ts instead of using
// this exception to weaken the normalized input/output boundary.
/**
 * Pure judgment runtime resolver core.
 *
 * This module is intentionally free of filesystem, transport, authentication,
 * tenant, Host binding, policy authorization, TaskGraph persistence, and
 * receipt I/O. Callers must validate and authorize those inputs in an adapter,
 * then pass only the normalized request and already-applicable policies here.
 * The implementation is kept behaviorally aligned with the former Unson
 * service so the Host can opt into it without changing live behavior.
 */
import {
    JudgmentResolutionError,
    canonicalJson,
    computeRequestDigest,
    sha256Hex
} from './judgment-resolution-contract.js';

export { JudgmentResolutionError, canonicalJson, computeRequestDigest, sha256Hex };

/**
 * Public contract for the pure runtime resolver.
 *
 * The implementation below is intentionally kept in the compatibility layer
 * while it is being moved out of the Unson service. These types describe the
 * normalized boundary explicitly so a Host/Organization adapter cannot pass
 * raw, unauthorised state by accident. Internal legacy helpers remain covered
 * by the narrowly scoped `@ts-nocheck` migration exception above.
 */
export type JudgmentRuntimeIntent =
    | 'answer'
    | 'investigate'
    | 'diagnose'
    | 'design'
    | 'implement'
    | 'review'
    | 'operate';
export type JudgmentRuntimeDomain =
    | 'general'
    | 'knowledge'
    | 'personal_judgment'
    | 'engineering'
    | 'organization'
    | 'operations';
export type JudgmentRuntimeSignal =
    | 'cumulative_effect'
    | 'complexity_growth'
    | 'threshold_proposal'
    | 'parallel_exploration'
    | 'authority_boundary'
    | 'problem_frame_uncertain'
    | 'external_outcome';
export type JudgmentRuntimeActionKind = 'none' | 'read' | 'write' | 'external';
export type JudgmentRuntimeRisk = 'low' | 'medium' | 'high' | 'critical';
export type JudgmentRuntimeConfidence = 'confirmed' | 'inferred' | 'unknown';
export type JudgmentRuntimeStatus = 'resolved' | 'needs_classification' | 'needs_policy_resolution';
export type JudgmentRuntimeAutonomyDecision = 'continue' | 'escalate';

export interface JudgmentRuntimeClassification {
    intent: JudgmentRuntimeIntent;
    domains: JudgmentRuntimeDomain[];
    action_kind: JudgmentRuntimeActionKind;
    risk: JudgmentRuntimeRisk;
    confidence: JudgmentRuntimeConfidence;
    signals: JudgmentRuntimeSignal[];
}

export interface JudgmentRuntimeMessage {
    sequence: number;
    turn_id: string | null;
    role: 'user' | 'assistant';
    phase: string | null;
    text: string;
}

export interface JudgmentRuntimePriorReceipt {
    turn_id: string;
    resolution_id: string;
    request_digest: string;
    context_digest: string | null;
    plan_digest: string;
    classification: JudgmentRuntimeClassification;
    selected_dag_ids: string[];
}

export interface JudgmentRuntimeRuntimeContext {
    host: 'codex' | 'claude-code';
    entrypoint?: 'codex' | 'claude_code' | 'mana' | 'company_os' | 'unknown';
    model: string | null;
    permission_mode: string | null;
    project_binding: string | null;
}

export interface JudgmentRuntimeInstructionBinding {
    scope: string;
    source_ref: string;
    digest: string;
}

export interface JudgmentRuntimeConversationContext {
    schema_version: 'brainbase-conversation-context-v1';
    session_ref: string;
    messages: JudgmentRuntimeMessage[];
    prior_receipts: JudgmentRuntimePriorReceipt[];
    runtime: JudgmentRuntimeRuntimeContext;
    instruction_bindings: JudgmentRuntimeInstructionBinding[];
    completeness: 'complete' | 'partial';
    source_digest: string;
}

export interface JudgmentRuntimeInput {
    request: string;
    turn_id: string;
    project_code: string | null;
    conversation_context: JudgmentRuntimeConversationContext;
    model_interpretation: JudgmentRuntimeClassification | null;
}

export interface JudgmentRuntimeManifestLockEntry {
    runtime_version: string;
    manifest_digest: string;
}

export interface JudgmentRuntimeManifestLock {
    schema_version: 'brainbase-judgment-manifest-lock-v1';
    entries: JudgmentRuntimeManifestLockEntry[];
}

export interface JudgmentRuntimeHostBinding {
    adapter_id: string;
    adapter_version: string;
    status?: string;
    [key: string]: unknown;
}

export interface JudgmentRuntimePolicyScope {
    type: 'global' | 'organization' | 'project' | 'owner';
    id: string | null;
}

export interface JudgmentRuntimePolicyEffect {
    target: string;
    decision: 'require' | 'forbid' | 'prefer';
}

export interface JudgmentRuntimeHumanApproval {
    action_kinds?: JudgmentRuntimeActionKind[];
    risks?: JudgmentRuntimeRisk[];
}

export interface JudgmentRuntimePolicy {
    id: string;
    version: string;
    priority: number;
    strength: 'hard' | 'soft';
    scope: JudgmentRuntimePolicyScope;
    visibility: 'organization' | 'owner';
    owner_person_id: string | null;
    evidence_requirement: string;
    effect: JudgmentRuntimePolicyEffect;
    instruction: string;
    human_approval?: JudgmentRuntimeHumanApproval;
    [key: string]: unknown;
}

export type JudgmentRuntimeNodeKind = 'common' | 'judgment' | 'capability' | 'constraint' | 'fail_closed';

export interface JudgmentRuntimeNode {
    id: string;
    kind: JudgmentRuntimeNodeKind;
    instruction: string;
    required_capability_template: string | null;
    execution_contract?: string;
    [key: string]: unknown;
}

export interface JudgmentRuntimeDag {
    id: string;
    kind: 'domain' | 'constraint' | 'fail_closed';
    path: string[];
    policy_ids: string[];
    [key: string]: unknown;
}

export interface JudgmentRuntimeSelectors {
    domain_order: JudgmentRuntimeDomain[];
    signal_order: JudgmentRuntimeSignal[];
    domain_dags: Record<JudgmentRuntimeDomain, string>;
    signal_dags: Record<JudgmentRuntimeSignal, string>;
    engineering_implementation_dag?: string;
    authority_dag: string;
    clarification_dag: string;
    [key: string]: unknown;
}

export interface JudgmentRuntimeSemanticMatchers {
    intents: Record<JudgmentRuntimeIntent, string[]>;
    domains: Record<Exclude<JudgmentRuntimeDomain, 'general'>, string[]>;
    signals: Record<JudgmentRuntimeSignal, string[]>;
    safety: Record<'write' | 'external' | 'critical', string[]>;
    positive_commands: string[];
    follow_up: string[];
    [key: string]: unknown;
}

export interface JudgmentRuntimeAutonomyPolicy {
    schema_version: 'brainbase-autonomy-policy-v1';
    continue_risks: JudgmentRuntimeRisk[];
    escalate_risks: JudgmentRuntimeRisk[];
    escalate_action_kinds: JudgmentRuntimeActionKind[];
    runtime_escalation_reasons: string[];
    [key: string]: unknown;
}

export interface JudgmentRuntimeManifest {
    schema_version: 'brainbase-judgment-runtime-v1';
    runtime_version: string;
    host_bindings: JudgmentRuntimeHostBinding[];
    policies: JudgmentRuntimePolicy[];
    nodes: JudgmentRuntimeNode[];
    dags: JudgmentRuntimeDag[];
    composition_edges: Array<[string, string]>;
    selectors: JudgmentRuntimeSelectors;
    semantic_matchers: JudgmentRuntimeSemanticMatchers;
    autonomy: JudgmentRuntimeAutonomyPolicy;
    [key: string]: unknown;
}

export interface JudgmentRuntimeReconciliation {
    status: 'resolved' | 'needs_classification';
    classification: JudgmentRuntimeClassification | null;
    assurance: 'verified' | 'bounded' | 'unknown';
    reasons: string[];
    evidence: Record<string, unknown>;
}

export interface JudgmentRuntimeAutonomyResolution {
    autonomy_decision: JudgmentRuntimeAutonomyDecision;
    autonomy_reason_code: 'routine_in_scope' | 'classification_missing' | 'policy_conflict' | 'risk_or_external';
    allowed_runtime_escalation_reasons: string[];
    autonomy_policy_ids: string[];
}

export interface JudgmentRuntimeGraph {
    active_nodes: string[];
    active_edges: Array<[string, string]>;
}

export interface JudgmentRuntimeCapability {
    capability: string;
    status: string;
    input: Record<string, unknown>;
    receipt_required: boolean;
    [key: string]: unknown;
}

export interface JudgmentRuntimeSuppressedPolicy {
    policy_id: string;
    suppressed_by_policy_id: string;
    reason: string;
}

export interface JudgmentRuntimePolicyMerge {
    applicable: JudgmentRuntimePolicy[];
    suppressed: JudgmentRuntimeSuppressedPolicy[];
    conflict: boolean;
}

export interface JudgmentRuntimeResolutionPlan extends JudgmentRuntimeAutonomyResolution, JudgmentRuntimeGraph {
    status: JudgmentRuntimeStatus;
    reconciliation: JudgmentRuntimeReconciliation;
    selected_dag_ids: string[];
    applicable_policies: JudgmentRuntimePolicy[];
    suppressed_policies: JudgmentRuntimeSuppressedPolicy[];
    policy_conflict: boolean;
    required_capabilities: JudgmentRuntimeCapability[];
    active_node_definitions: JudgmentRuntimeNode[];
    unresolved: string[];
    rationale: string[];
}

export interface JudgmentRuntimeCoreInput {
    input: JudgmentRuntimeInput;
    manifest: JudgmentRuntimeManifest;
    /** Policies already filtered by the Organization/Host authorization adapter. */
    applicablePolicies?: JudgmentRuntimePolicy[];
    ownerPersonId?: string | null;
    clientCapabilities?: string[];
}

export interface JudgmentRuntimeGraphOptions {
    clarification?: boolean;
}

export interface JudgmentRuntimeActiveNodeOptions {
    evidenceRequired?: boolean;
}

const INPUT_FIELDS = new Set(['request', 'turn_id', 'project_code', 'conversation_context', 'model_interpretation']);
const CLASSIFICATION_FIELDS = new Set(['intent', 'domains', 'action_kind', 'risk', 'confidence', 'signals']);
const CONVERSATION_CONTEXT_FIELDS = new Set([
    'schema_version', 'session_ref', 'messages', 'prior_receipts', 'runtime',
    'instruction_bindings', 'completeness', 'source_digest'
]);
const MESSAGE_FIELDS = new Set(['sequence', 'turn_id', 'role', 'phase', 'text']);
const PRIOR_RECEIPT_FIELDS = new Set([
    'turn_id', 'resolution_id', 'request_digest', 'context_digest', 'plan_digest',
    'classification', 'selected_dag_ids'
]);
const RUNTIME_FIELDS = new Set(['host', 'entrypoint', 'model', 'permission_mode', 'project_binding']);
const INSTRUCTION_BINDING_FIELDS = new Set(['scope', 'source_ref', 'digest']);
const INTENTS = new Set(['answer', 'investigate', 'diagnose', 'design', 'implement', 'review', 'operate']);
const INTENT_ORDER = ['operate', 'implement', 'review', 'diagnose', 'design', 'investigate', 'answer'];
const DOMAINS = new Set(['general', 'knowledge', 'personal_judgment', 'engineering', 'organization', 'operations']);
const ACTIONS = ['none', 'read', 'write', 'external'];
const RISKS = ['low', 'medium', 'high', 'critical'];
const CONFIDENCES = new Set(['confirmed', 'inferred', 'unknown']);
const SIGNALS = new Set(['cumulative_effect', 'complexity_growth', 'threshold_proposal', 'parallel_exploration', 'authority_boundary', 'problem_frame_uncertain', 'external_outcome']);
const CONTENT_TYPES = new Set(['canonical_fact', 'team_document', 'source_document', 'personal_knowledge', 'operational_state', 'unknown']);
const SCOPE_SPECIFICITY = { global: 0, organization: 1, project: 2, owner: 3 };
const POLICY_VISIBILITIES = new Set(['organization', 'owner']);
const NODE_KINDS = new Set(['common', 'judgment', 'capability', 'constraint', 'fail_closed']);
const DAG_KINDS = new Set(['domain', 'constraint', 'fail_closed']);
const DOMAIN_MATCHERS = new Set(['engineering', 'knowledge', 'personal_judgment', 'organization', 'operations']);
const SAFETY_MATCHERS = new Set(['write', 'external', 'critical']);
const AUTONOMY_DECISIONS = new Set(['continue', 'escalate']);
const AUTONOMY_REASON_CODES = new Set([
    'routine_in_scope', 'classification_missing', 'policy_conflict', 'risk_or_external'
]);
const RUNTIME_ESCALATION_REASONS = new Set([
    'irreversible_action', 'missing_authority', 'owner_value_choice',
    'required_input_unavailable', 'evidenced_terminal_blocker'
]);
const INTENT_MATCHERS = new Set(INTENT_ORDER);
const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ADAPTER_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const RUNTIME_HOSTS = new Set(['codex', 'claude-code']);
const RUNTIME_ENTRYPOINTS = new Set(['codex', 'claude_code', 'mana', 'company_os', 'unknown']);

function compareCodePoints(left, right) {
    const a = Array.from(left, (value) => value.codePointAt(0));
    const b = Array.from(right, (value) => value.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
}

function fail(message, code = 'judgment_resolution_input_invalid', status = 400) {
    throw new JudgmentResolutionError(code, message, status);
}


function exactFields(value, allowed, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail(`${name}.${key} is not allowed`);
    }
}

function requiredString(value, name) {
    if (typeof value !== 'string' || !value.trim()) fail(`${name} is required`);
    return value.trim();
}

function requiredText(value, name) {
    if (typeof value !== 'string' || !value.trim()) fail(`${name} is required`);
    return value;
}

function uniqueEnumArray(value, name, allowed, { optional = false } = {}) {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value) || (!optional && value.length === 0)) fail(`${name} must be a non-empty array`);
    const output = [];
    const seen = new Set();
    for (const entry of value) {
        if (typeof entry !== 'string' || !allowed.has(entry)) fail(`${name} contains an invalid value`);
        if (seen.has(entry)) fail(`${name} contains duplicate value '${entry}'`);
        seen.add(entry);
        output.push(entry);
    }
    return output;
}

function uniqueStringArray(value, name) {
    if (!Array.isArray(value) || value.length === 0) fail(`${name} must be a non-empty array`);
    const output = [];
    const seen = new Set();
    for (const entry of value) {
        const normalized = requiredString(entry, name);
        if (/[\u0000-\u001f\u007f]/u.test(normalized)) fail(`${name} contains an invalid value`);
        if (seen.has(normalized)) fail(`${name} contains duplicate value '${normalized}'`);
        seen.add(normalized);
        output.push(normalized);
    }
    return output;
}

function stringArray(value, name, { allowEmpty = false } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${name} must be a${allowEmpty ? '' : ' non-empty'} array`);
    return value.map((entry) => requiredString(entry, name));
}

function enumValue(value, name, allowed) {
    if (typeof value !== 'string' || !allowed.has(value)) fail(`${name} contains an invalid value`);
    return value;
}

function indexFloor(order, left, right) {
    return order[Math.max(order.indexOf(left), order.indexOf(right))];
}

function actionFloor(intent) {
    if (intent === 'implement' || intent === 'operate') return 'write';
    if (intent === 'investigate' || intent === 'diagnose' || intent === 'review') return 'read';
    return 'none';
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesTerm(request, terms) {
    const normalized = request.toLocaleLowerCase('ja');
    return terms.some((term) => {
        const normalizedTerm = term.toLocaleLowerCase('ja');
        if (/^[a-z0-9_.-]+$/u.test(normalizedTerm)) {
            return new RegExp(`(?<![a-z0-9_])${escapeRegExp(normalizedTerm)}(?![a-z0-9_])`, 'u').test(normalized);
        }
        return normalized.includes(normalizedTerm);
    });
}

function includesPositiveCommandClause(request, terms) {
    const japaneseTerms = terms.filter((term) => !/^[a-z0-9_.-]+$/iu.test(term));
    const normalizedRequest = request.toLocaleLowerCase('ja');
    const includesJapaneseCommand = japaneseTerms.some((term) => {
        const normalizedTerm = term.toLocaleLowerCase('ja');
        let offset = normalizedRequest.indexOf(normalizedTerm);
        while (offset >= 0) {
            const remainder = normalizedRequest.slice(offset + normalizedTerm.length);
            const endsCommand = /^(?:$|[\s、,;；。！？!?])/u.test(remainder)
                || /^(?:(?:ください|下さい|くれ|ほしい|欲しい|おけ|みろ)|(?:おいて|みて)(?:ください|下さい)?|(?:もらえ|いただけ)(?:ます(?:か|でしょうか)|ません(?:か|でしょうか)|ないですか)|(?:もらいたい|いただきたい))(?=$|[\s、,;；。！？!?])/u.test(remainder);
            if (endsCommand) {
                return true;
            }
            offset = normalizedRequest.indexOf(normalizedTerm, offset + normalizedTerm.length);
        }
        return false;
    });
    if (includesJapaneseCommand) return true;
    const englishTerms = terms.filter((term) => /^[a-z0-9_.-]+$/iu.test(term));
    if (englishTerms.length === 0) return false;
    const commandPattern = englishTerms.map(escapeRegExp).join('|');
    const match = new RegExp(
        `^(?:please\\s+|(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|you\\s+must\\s+)?(?:${commandPattern})\\b`,
        'iu'
    ).exec(request.trim());
    if (!match) return false;
    const remainder = request.trim().slice(match[0].length);
    return !/^\s+(?:is|are|was|were|has|have|had)\b/iu.test(remainder);
}

function includesRequestedEffectTerm(request, terms) {
    const normalized = request.toLocaleLowerCase('ja');
    return terms.some((term) => {
        const normalizedTerm = term.toLocaleLowerCase('ja');
        let offset = 0;
        while (offset < normalized.length) {
            const matcher = /^[a-z0-9_.-]+$/u.test(normalizedTerm)
                ? new RegExp(`(?<![a-z0-9_])${escapeRegExp(normalizedTerm)}(?![a-z0-9_])`, 'gu')
                : null;
            if (matcher) matcher.lastIndex = offset;
            const match = matcher?.exec(normalized);
            const index = matcher ? (match?.index ?? -1) : normalized.indexOf(normalizedTerm, offset);
            if (index < 0) return false;
            const continuation = normalized.slice(index + normalizedTerm.length).trimStart();
            const isConditionalTeForm = normalizedTerm.endsWith('して')
                && /^(?:も(?!ら)|しま|いる|いた|ある|あった|おり|はいけ|はなら|よい|良い|いい|問題ない|可能|でき)/u.test(continuation);
            const sentenceTail = continuation.split(/[。！？\n]/u, 1)[0];
            const negation = /(?:は|を|も)?(?:実行|実施)?(?:しない(?:でください)?|しません|行わない(?:でください)?|禁止)/u.exec(sentenceTail);
            const listPrefix = negation ? sentenceTail.slice(0, negation.index) : '';
            const isNegated = /(?:do not|don't|must not)\s*$/u.test(normalized.slice(Math.max(0, index - 16), index))
                || Boolean(negation && !/(?:して|し、|し,|した|する|してください|せよ|しろ)/u.test(listPrefix));
            if (!isConditionalTeForm && !isNegated) return true;
            offset = index + normalizedTerm.length;
        }
        return false;
    });
}

// Bounds keep the check linear in the request length. Past a bound the term
// stays critical, so a bound can keep an escalation but never remove one.
const PROHIBITION_WINDOW = 200;
const MAX_PROHIBITED_OCCURRENCES = 32;
// A prohibition predicate ends its clause. A negation that continues into a
// condition, reason, or question (「行わないと」「しないので」「しませんか」) is not one.
const JAPANESE_PROHIBITION_PREDICATE = /(?:(?:しない|行わない)(?:でください|こと)?|しません|行いません|するな|避けてください|(?:して|って|んで|て|で)?は(?:いけ|なら)(?:ない|ません)|禁止(?:です|されています)?|不可(?:です)?)(?=[ねよ]?\s*[）)」』]*\s*(?:$|[、,，;；。．！!]))/u;
const NOUN = String.raw`(?:(?!等|以外)[\p{Script=Han}\p{Script=Katakana}\p{Script=Latin}\p{Nd}ー々_-])+`;
const ACTION_HEAD = '(?:外部|本番|自動|手動|一括)?(?:変更|操作|処理|作業|実行|送信|送付|更新|反映|書き込み|書込み|投稿|通知|対応|行為|取引|手続き|アクション)';
const COORDINATOR = '(?:・|や|と|および|及び|または|又は|もしくは|並びに|ならびに)';
// All that may separate a critical term from the prohibition governing it: an
// action noun it modifies, the rest of a noun list, and one final particle. A
// comma list must close with など/等, since 「本番削除、確認はしない」 can also
// mean "delete, without confirming". Anything else (「以外の」「のみ行い、」
// 「は後回しに」「の停止は」) means the prohibition governs something other than
// the term.
const PROHIBITED_TERM_TAIL = new RegExp(`^(?:の?${ACTION_HEAD})?(?:(?:\\s*${COORDINATOR}\\s*${NOUN})*(?:など|等)?(?:の${ACTION_HEAD})?|(?:\\s*(?:[、,，]|${COORDINATOR})\\s*${NOUN})+(?:など|等)(?:の${ACTION_HEAD})?)[はをもが]?(?:一切|絶対に|決して)?$`, 'u');
// Before a list comma the term must start its item or follow a noun modifier;
// 「請求書を支払い、」「すぐ支払い、」「至急支払い、」 use it as a verb.
const LIST_ITEM_HEAD = /^(?:(?!等|以外)[\p{Script=Han}\p{Script=Katakana}\p{Script=Latin}\p{Nd}ー々_\- 　]|の|や|と|への|での|からの|までの)*$/u;
const LIST_ITEM_HEAD_END = /(?:^|の|や|と)\s*$/u;

function isProhibitedObject(text, index, length) {
    const before = text.slice(Math.max(0, index - PROHIBITION_WINDOW), index);
    const clause = before.slice(Math.max(...['。', '．', '！', '？', '!', '?', '\n'].map((mark) => before.lastIndexOf(mark))) + 1);
    const clauseHead = clause.slice(Math.max(...['、', ',', '，', ';', '；'].map((mark) => clause.lastIndexOf(mark))) + 1);
    const tailEnd = index + length + PROHIBITION_WINDOW + 1;
    const sentenceTail = /^[^。．！？!?\n]*[。．！？!?\n]?/u.exec(text.slice(index + length, tailEnd))[0];
    // A question, or a sentence too long to judge, is not a prohibition.
    if (sentenceTail.length > PROHIBITION_WINDOW || /[？?]$/u.test(sentenceTail)) return false;
    const prohibition = JAPANESE_PROHIBITION_PREDICATE.exec(sentenceTail);
    if (!prohibition) return false;
    // A quoted or nominalized prohibition (「支払いはしない、という制限は外して」
    // 「支払いはしない、は撤回」) is being discussed, not imposed.
    const predicateEnd = index + length + prohibition.index + prohibition[0].length;
    if (/^[ねよ]?[\s）)」』]*(?:[、,，;；。．！!]?\s*(?:と|って)|[、,，]\s*[はをがもの])/u.test(text.slice(predicateEnd, predicateEnd + 8))) return false;
    const between = sentenceTail.slice(0, prohibition.index);
    if (/^\s*[、,，]/u.test(between) && !(LIST_ITEM_HEAD.test(clauseHead) && LIST_ITEM_HEAD_END.test(clauseHead))) return false;
    return PROHIBITED_TERM_TAIL.test(between);
}

// Polite prohibitions are already stripped from the positive request. A term
// that survives still counts unless a clause-final prohibition governs it
// directly, such as the plain form 「…支払い…などの外部変更は行わない。」.
function includesUnprohibitedTerm(request, terms) {
    const normalized = request.toLocaleLowerCase('ja');
    return terms.some((term) => {
        const normalizedTerm = term.toLocaleLowerCase('ja');
        if (/^[a-z0-9_.-]+$/u.test(normalizedTerm)) return includesTerm(request, [term]);
        let prohibited = 0;
        for (let index = normalized.indexOf(normalizedTerm); index >= 0; index = normalized.indexOf(normalizedTerm, index + normalizedTerm.length)) {
            if (prohibited === MAX_PROHIBITED_OCCURRENCES || !isProhibitedObject(normalized, index, normalizedTerm.length)) return true;
            prohibited += 1;
        }
        return false;
    });
}

function responseAnnotationCommands(request) {
    const commands = [];
    for (const match of request.matchAll(/<response-annotations>([\s\S]*?)<\/response-annotations>/giu)) {
        let annotations;
        try {
            annotations = JSON.parse(match[1]);
        } catch {
            continue;
        }
        if (!Array.isArray(annotations)) continue;
        for (const entry of annotations) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            if (typeof entry.annotation !== 'string' || !entry.annotation.trim()) continue;
            commands.push(entry.annotation.trim());
        }
    }
    return commands;
}

function classificationRequest(request) {
    const annotationCommands = responseAnnotationCommands(request);
    const withoutStructuredMaterial = request
        .replace(/<response-annotations>[\s\S]*?<\/response-annotations>/giu, ' ')
        .replace(/```[\s\S]*?```/gu, ' ')
        .replace(/^>.*$/gmu, ' ');
    const paragraphs = withoutStructuredMaterial.split(/\n\s*\n/u);
    const materialStart = paragraphs.findIndex((paragraph, index) => index > 0 && (
        /(?:^|\n)\s*(?:添付|引用|会話ログ|ログ|参考|資料)\s*[:：]/u.test(paragraph)
        || /(?:^|\n)\s*(?:\d{1,2}:\d{2}|\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{4}\.\d{2}\.\d{2}\s+.+曜日)/u.test(paragraph)
    ));
    const commandParagraphs = materialStart < 0 ? paragraphs : paragraphs.slice(0, materialStart);
    return [...commandParagraphs, ...annotationCommands].join('\n\n').trim();
}

function positiveClassificationRequest(request, manifest) {
    const positiveCommandTerms = manifest.semantic_matchers.positive_commands;
    return request
        .split(/(?<=[。！？.!?\n])/u)
        .map((sentence) => {
            const japaneseBoundary = /(?:しないでください|行わないでください|実行しないでください|しないこと|するな|避けてください|しません|行いません|実行しません|禁止(?:です|されています)?(?=[、,;；。！？\s]|$)|不可(?:です)?(?=[、,;；。！？\s]|$))/u.exec(sentence);
            if (japaneseBoundary) {
                const beforeNegation = sentence.slice(0, japaneseBoundary.index);
                const clauseBoundary = Math.max(
                    beforeNegation.lastIndexOf('、'),
                    beforeNegation.lastIndexOf(','),
                    beforeNegation.lastIndexOf(';'),
                    beforeNegation.lastIndexOf('；')
                );
                const positivePrefix = clauseBoundary >= 0
                    ? beforeNegation.slice(0, clauseBoundary).trim()
                    : '';
                const keepPrefix = includesPositiveCommandClause(positivePrefix, positiveCommandTerms)
                    ? positivePrefix
                    : '';
                const afterNegation = sentence.slice(japaneseBoundary.index + japaneseBoundary[0].length);
                const tailBoundary = /^[、,;；]/u.exec(afterNegation);
                const tailCandidate = tailBoundary
                    ? afterNegation.slice(tailBoundary[0].length).replace(/^[、,;；。！？\s]+/u, '')
                    : '';
                const positiveTail = includesPositiveCommandClause(tailCandidate, positiveCommandTerms)
                    ? tailCandidate
                    : '';
                return [keepPrefix, positiveTail].filter(Boolean).join('。');
            }
            const englishBoundary = /\b(?:do not|don't|must not|never|no(?!-)|is prohibited|are prohibited|is forbidden|are forbidden)\b/iu.exec(sentence);
            if (englishBoundary) {
                const beforeNegation = sentence.slice(0, englishBoundary.index);
                const suffixProhibition = /^(?:is|are) (?:prohibited|forbidden)$/iu.test(englishBoundary[0]);
                const clauseBoundary = Math.max(beforeNegation.lastIndexOf(','), beforeNegation.lastIndexOf(';'));
                const positiveMaterial = suffixProhibition
                    ? (clauseBoundary >= 0 ? beforeNegation.slice(0, clauseBoundary) : '')
                    : beforeNegation;
                const positivePrefix = positiveMaterial
                    .replace(/\b(?:but|and)\s*$/iu, '')
                    .replace(/[,;:\s]+$/u, '')
                    .trim();
                const keepPrefix = includesPositiveCommandClause(positivePrefix, positiveCommandTerms)
                    ? positivePrefix
                    : '';
                const afterNegation = sentence.slice(englishBoundary.index + englishBoundary[0].length);
                const tailBoundary = /(?:[;；]|,\s*(?:but|and(?: then)?)\s+)/iu.exec(afterNegation);
                const tailCandidate = tailBoundary
                    ? afterNegation.slice(tailBoundary.index + tailBoundary[0].length).replace(/^[,.;:!?\s]+/u, '')
                    : '';
                const positiveTail = includesPositiveCommandClause(tailCandidate, positiveCommandTerms)
                    ? tailCandidate
                    : '';
                return [keepPrefix, positiveTail].filter(Boolean).join('. ');
            }
            return sentence;
        })
        .join('')
        .trim();
}

function sortByOrder(values, order) {
    const indexes = new Map(order.map((value, index) => [value, index]));
    return [...values].sort((left, right) => (indexes.get(left) ?? Number.MAX_SAFE_INTEGER) - (indexes.get(right) ?? Number.MAX_SAFE_INTEGER));
}

function validatedClassification(value, name, manifest) {
    exactFields(value, CLASSIFICATION_FIELDS, name);
    const domains = uniqueEnumArray(value.domains, `${name}.domains`, DOMAINS);
    return {
        intent: enumValue(value.intent, `${name}.intent`, INTENTS),
        domains: sortByOrder(domains, manifest.selectors.domain_order),
        action_kind: enumValue(value.action_kind, `${name}.action_kind`, new Set(ACTIONS)),
        risk: enumValue(value.risk, `${name}.risk`, new Set(RISKS)),
        confidence: enumValue(value.confidence, `${name}.confidence`, CONFIDENCES),
        signals: sortByOrder(
            uniqueEnumArray(value.signals, `${name}.signals`, SIGNALS, { optional: true }),
            manifest.selectors.signal_order
        )
    };
}

function validatePolicy(policy, seen) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy) || typeof policy.id !== 'string' || !policy.id || seen.has(policy.id)) throw new TypeError('judgment manifest has duplicate or invalid policy id');
    seen.add(policy.id);
    if (typeof policy.version !== 'string' || !policy.version) throw new TypeError(`policy ${policy.id} version is invalid`);
    if (!Number.isInteger(policy.priority)) throw new TypeError(`policy ${policy.id} priority must be an integer`);
    if (!['hard', 'soft'].includes(policy.strength)) throw new TypeError(`policy ${policy.id} strength is invalid`);
    if (!policy.scope || !(policy.scope.type in SCOPE_SPECIFICITY)) throw new TypeError(`policy ${policy.id} scope is invalid`);
    if (policy.scope.type === 'global' ? policy.scope.id !== null : typeof policy.scope.id !== 'string' || !policy.scope.id) throw new TypeError(`policy ${policy.id} scope id is invalid`);
    if (!POLICY_VISIBILITIES.has(policy.visibility)) throw new TypeError(`policy ${policy.id} visibility is invalid`);
    if (policy.owner_person_id !== null && (typeof policy.owner_person_id !== 'string' || !policy.owner_person_id)) throw new TypeError(`policy ${policy.id} owner is invalid`);
    if (policy.visibility === 'owner' && typeof policy.owner_person_id !== 'string') throw new TypeError(`policy ${policy.id} owner visibility requires an owner`);
    if (typeof policy.evidence_requirement !== 'string' || !policy.evidence_requirement) throw new TypeError(`policy ${policy.id} evidence requirement is invalid`);
    if (!policy.effect || typeof policy.effect.target !== 'string' || !policy.effect.target) throw new TypeError(`policy ${policy.id} effect target is invalid`);
    const decision = policy.effect?.decision;
    if (policy.strength === 'hard' && !['require', 'forbid'].includes(decision)) throw new TypeError(`policy ${policy.id} hard effect is invalid`);
    if (policy.strength === 'soft' && decision !== 'prefer') throw new TypeError(`policy ${policy.id} soft effect is invalid`);
    if (typeof policy.instruction !== 'string' || !policy.instruction) throw new TypeError(`policy ${policy.id} instruction is invalid`);
    if (policy.human_approval !== undefined) {
        const approval = policy.human_approval;
        if (!approval || typeof approval !== 'object' || Array.isArray(approval)) throw new TypeError(`policy ${policy.id} human_approval is invalid`);
        const keys = Object.keys(approval);
        if (keys.length === 0 || keys.some((key) => !['action_kinds', 'risks'].includes(key))) throw new TypeError(`policy ${policy.id} human_approval is invalid`);
        if (approval.action_kinds !== undefined && (!Array.isArray(approval.action_kinds) || approval.action_kinds.length === 0 || approval.action_kinds.some((kind) => !ACTIONS.includes(kind)))) {
            throw new TypeError(`policy ${policy.id} human_approval action_kinds is invalid`);
        }
        if (approval.risks !== undefined && (!Array.isArray(approval.risks) || approval.risks.length === 0 || approval.risks.some((risk) => !RISKS.includes(risk)))) {
            throw new TypeError(`policy ${policy.id} human_approval risks is invalid`);
        }
    }
}

function validateStringTerms(value, name, { allowEmpty = false } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((entry) => typeof entry !== 'string' || !entry)) {
        throw new TypeError(`${name} terms are invalid`);
    }
}

function validateExactKeys(value, expected, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is invalid`);
    const actual = Object.keys(value);
    if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) throw new TypeError(`${name} references an unsupported selector or matcher`);
}

function validateSelectableGraphs(manifest) {
    const signalDagIds = Object.values(manifest.selectors.signal_dags);
    const commonDagIds = [...signalDagIds, manifest.selectors.authority_dag];
    const domainGroups = [
        [manifest.selectors.domain_dags.general],
        manifest.selectors.domain_order
            .filter((domain) => domain !== 'general')
            .map((domain) => manifest.selectors.domain_dags[domain])
    ];
    if (manifest.selectors.engineering_implementation_dag) {
        domainGroups.push(domainGroups[1].map((id) => id === manifest.selectors.domain_dags.engineering
            ? manifest.selectors.engineering_implementation_dag : id));
    }
    for (const domainDagIds of domainGroups) {
        try {
            buildGraph([...new Set([...domainDagIds, ...commonDagIds])], manifest);
        } catch (error) {
            if (error instanceof TypeError && error.message === 'active judgment graph contains a cycle') {
                throw new TypeError('selectable judgment graph contains a cycle');
            }
            throw error;
        }
    }
}

export function validateManifestLock(
    lock: JudgmentRuntimeManifestLock,
    previous: JudgmentRuntimeManifestLock | null = null,
    current: { runtimeVersion: string; manifestDigest: string } | null = null
): true {
    if (!lock || lock.schema_version !== 'brainbase-judgment-manifest-lock-v1' || !Array.isArray(lock.entries) || lock.entries.length === 0) {
        throw new TypeError('judgment manifest lock schema is invalid');
    }
    const versions = new Set();
    for (const entry of lock.entries) {
        if (!entry || typeof entry.runtime_version !== 'string' || !entry.runtime_version) throw new TypeError('judgment manifest lock runtime version is invalid');
        if (versions.has(entry.runtime_version)) throw new TypeError(`judgment manifest lock duplicate runtime version '${entry.runtime_version}'`);
        versions.add(entry.runtime_version);
        if (typeof entry.manifest_digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.manifest_digest)) throw new TypeError('judgment manifest lock digest is invalid');
    }
    if (previous) {
        if (previous.schema_version !== lock.schema_version || !Array.isArray(previous.entries) || lock.entries.length < previous.entries.length) {
            throw new TypeError('judgment manifest lock is append-only');
        }
        for (let index = 0; index < previous.entries.length; index += 1) {
            if (canonicalJson(previous.entries[index]) !== canonicalJson(lock.entries[index])) throw new TypeError('judgment manifest lock is append-only');
        }
    }
    if (current) {
        const last = lock.entries.at(-1);
        if (last.runtime_version !== current.runtimeVersion || last.manifest_digest !== current.manifestDigest) throw new TypeError('judgment manifest lock current pair does not match');
    }
    return true;
}

export function validateManifest(manifest: JudgmentRuntimeManifest, lock: JudgmentRuntimeManifestLock): string {
    if (!manifest || manifest.schema_version !== 'brainbase-judgment-runtime-v1' || typeof manifest.runtime_version !== 'string' || !manifest.runtime_version) throw new TypeError('judgment manifest schema is invalid');
    if (!Array.isArray(manifest.host_bindings) || !Array.isArray(manifest.policies) || !Array.isArray(manifest.nodes) || !Array.isArray(manifest.dags) || !Array.isArray(manifest.composition_edges)) throw new TypeError('judgment manifest collections are invalid');
    const hostIds = new Set();
    for (const host of manifest.host_bindings) {
        if (!host || !ADAPTER_ID_PATTERN.test(host.adapter_id) || !ADAPTER_VERSION_PATTERN.test(host.adapter_version)) throw new TypeError('judgment manifest host binding is invalid');
        const key = `${host.adapter_id}:${host.adapter_version}`;
        if (hostIds.has(key)) throw new TypeError('judgment manifest has duplicate host binding');
        hostIds.add(key);
    }
    const policies = new Set();
    manifest.policies.forEach((policy) => validatePolicy(policy, policies));
    const nodes = new Set();
    for (const node of manifest.nodes) {
        if (!node || typeof node.id !== 'string' || !node.id || nodes.has(node.id)) throw new TypeError('judgment manifest has duplicate or invalid node id');
        nodes.add(node.id);
        if (node.execution_contract !== undefined && node.execution_contract !== 'judgment-node-evidence-v1') throw new TypeError(`judgment node ${node.id} execution contract is invalid`);
        if (!NODE_KINDS.has(node.kind)) throw new TypeError(`judgment node ${node.id} kind is invalid`);
        if (typeof node.instruction !== 'string' || !node.instruction) throw new TypeError(`judgment node ${node.id} instruction is invalid`);
        if (node.required_capability_template !== null && (typeof node.required_capability_template !== 'string' || !node.required_capability_template)) throw new TypeError(`judgment node ${node.id} capability reference is invalid`);
        if (node.kind === 'capability' && typeof node.required_capability_template !== 'string') throw new TypeError(`judgment node ${node.id} capability reference is required`);
    }
    const dags = new Set();
    for (const dag of manifest.dags) {
        if (!dag || typeof dag.id !== 'string' || dags.has(dag.id) || !Array.isArray(dag.path) || dag.path.length === 0) throw new TypeError('judgment manifest has duplicate, invalid, or empty DAG');
        dags.add(dag.id);
        if (!DAG_KINDS.has(dag.kind) || !Array.isArray(dag.policy_ids)) throw new TypeError(`judgment DAG ${dag.id} schema is invalid`);
        if (new Set(dag.path).size !== dag.path.length) throw new TypeError(`judgment DAG ${dag.id} contains a cycle`);
        if (new Set(dag.policy_ids).size !== dag.policy_ids.length) throw new TypeError(`judgment DAG ${dag.id} contains duplicate policy references`);
        for (const nodeId of dag.path) if (!nodes.has(nodeId)) throw new TypeError(`judgment DAG ${dag.id} references missing node ${nodeId}`);
        for (const policyId of dag.policy_ids) if (!policies.has(policyId)) throw new TypeError(`judgment DAG ${dag.id} references missing policy ${policyId}`);
    }
    const compositionEdges = new Set();
    for (const edge of manifest.composition_edges) {
        if (!Array.isArray(edge) || edge.length !== 2 || edge.some((nodeId) => typeof nodeId !== 'string' || !nodes.has(nodeId))) {
            throw new TypeError('judgment composition edge references a missing or invalid node');
        }
        if (edge[0] === edge[1]) throw new TypeError('judgment composition edge cannot reference itself');
        const key = `${edge[0]}\u0000${edge[1]}`;
        if (compositionEdges.has(key)) throw new TypeError('judgment manifest has duplicate composition edge');
        compositionEdges.add(key);
    }
    const selectors = manifest.selectors;
    validateStringTerms(selectors?.domain_order, 'judgment domain order');
    validateStringTerms(selectors?.signal_order, 'judgment signal order');
    if (new Set(selectors.domain_order).size !== selectors.domain_order.length || selectors.domain_order.length !== DOMAINS.size || selectors.domain_order.some((value) => !DOMAINS.has(value))) throw new TypeError('judgment domain order is invalid');
    if (new Set(selectors.signal_order).size !== selectors.signal_order.length || selectors.signal_order.length !== SIGNALS.size || selectors.signal_order.some((value) => !SIGNALS.has(value))) throw new TypeError('judgment signal order is invalid');
    validateExactKeys(selectors.domain_dags, DOMAINS, 'judgment domain selectors');
    validateExactKeys(selectors.signal_dags, SIGNALS, 'judgment signal selectors');
    const selectorDagIds = [
        ...Object.values(selectors.domain_dags),
        ...Object.values(selectors.signal_dags),
        selectors.authority_dag,
        selectors.clarification_dag
    ];
    if (Object.hasOwn(selectors, 'engineering_implementation_dag')) selectorDagIds.push(selectors.engineering_implementation_dag);
    for (const dagId of selectorDagIds) if (!dags.has(dagId)) throw new TypeError(`judgment selector references missing DAG ${dagId}`);
    const matchers = manifest.semantic_matchers;
    validateExactKeys(matchers?.intents, INTENT_MATCHERS, 'judgment intent matchers');
    validateExactKeys(matchers?.domains, DOMAIN_MATCHERS, 'judgment domain matchers');
    validateExactKeys(matchers?.signals, SIGNALS, 'judgment signal matchers');
    validateExactKeys(matchers?.safety, SAFETY_MATCHERS, 'judgment safety matchers');
    for (const [key, terms] of Object.entries(matchers.intents)) validateStringTerms(terms, `judgment intent matcher ${key}`);
    for (const [key, terms] of Object.entries(matchers.domains)) validateStringTerms(terms, `judgment domain matcher ${key}`);
    for (const [key, terms] of Object.entries(matchers.signals)) validateStringTerms(terms, `judgment signal matcher ${key}`);
    for (const [key, terms] of Object.entries(matchers.safety)) validateStringTerms(terms, `judgment safety matcher ${key}`);
    validateStringTerms(matchers.positive_commands, 'judgment positive command matcher');
    validateStringTerms(matchers.follow_up, 'judgment follow-up matcher');
    const autonomy = manifest.autonomy;
    if (!autonomy || autonomy.schema_version !== 'brainbase-autonomy-policy-v1') throw new TypeError('judgment autonomy policy is invalid');
    validateStringTerms(autonomy.continue_risks, 'judgment autonomy continue risks');
    validateStringTerms(autonomy.escalate_risks, 'judgment autonomy escalate risks', { allowEmpty: true });
    validateStringTerms(autonomy.escalate_action_kinds, 'judgment autonomy escalate action kinds', { allowEmpty: true });
    validateStringTerms(autonomy.runtime_escalation_reasons, 'judgment autonomy runtime escalation reasons');
    // escalate_risks / escalate_action_kinds are no longer consulted by autonomyResolution
    // (classification alone never auto-escalates); they stay schema-validated so a stale
    // manifest cannot silently reintroduce a hidden auto-escalation source.
    if (canonicalJson(autonomy.continue_risks) !== canonicalJson(['low', 'medium'])
        || autonomy.escalate_risks.some((risk) => !RISKS.includes(risk))
        || autonomy.escalate_action_kinds.some((kind) => !ACTIONS.includes(kind))
        || autonomy.runtime_escalation_reasons.length !== RUNTIME_ESCALATION_REASONS.size
        || autonomy.runtime_escalation_reasons.some((reason) => !RUNTIME_ESCALATION_REASONS.has(reason))) {
        throw new TypeError('judgment autonomy policy boundary is invalid');
    }
    validateSelectableGraphs(manifest);
    const digest = sha256Hex(canonicalJson(manifest));
    validateManifestLock(lock, null, { runtimeVersion: manifest.runtime_version, manifestDigest: digest });
    return digest;
}

// Policies whose `human_approval` rule matches this turn's classification, in
// deterministic policy-id order. A non-empty result is the only source of a
// risk_or_external escalation now — classification alone never auto-escalates.
function humanApprovalPolicyIds(classification, applicablePolicies) {
    const matched = [];
    for (const policy of applicablePolicies) {
        const rule = policy?.human_approval;
        if (!rule) continue;
        const riskMatch = Array.isArray(rule.risks) && rule.risks.includes(classification.risk);
        const actionMatch = Array.isArray(rule.action_kinds) && rule.action_kinds.includes(classification.action_kind);
        if (riskMatch || actionMatch) matched.push(policy.id);
    }
    return matched.sort(compareCodePoints);
}

export function autonomyResolution(
    status: JudgmentRuntimeStatus,
    classification: JudgmentRuntimeClassification | null,
    manifest: JudgmentRuntimeManifest,
    applicablePolicies: JudgmentRuntimePolicy[] = []
): JudgmentRuntimeAutonomyResolution {
    let decision;
    let reasonCode;
    let policyIds = [];
    if (status === 'needs_classification') {
        decision = 'escalate';
        reasonCode = 'classification_missing';
    } else if (status === 'needs_policy_resolution') {
        decision = 'escalate';
        reasonCode = 'policy_conflict';
    } else {
        policyIds = humanApprovalPolicyIds(classification, applicablePolicies);
        if (policyIds.length > 0) {
            decision = 'escalate';
            reasonCode = 'risk_or_external';
        } else {
            decision = 'continue';
            reasonCode = 'routine_in_scope';
        }
    }
    if (!AUTONOMY_DECISIONS.has(decision) || !AUTONOMY_REASON_CODES.has(reasonCode)) {
        throw new TypeError('judgment autonomy resolution is invalid');
    }
    return {
        autonomy_decision: decision,
        autonomy_reason_code: reasonCode,
        allowed_runtime_escalation_reasons: decision === 'continue'
            ? [...manifest.autonomy.runtime_escalation_reasons]
            : [],
        autonomy_policy_ids: policyIds
    };
}

export function validateRuntimeInput(rawInput: unknown, manifest: JudgmentRuntimeManifest): JudgmentRuntimeInput {
    exactFields(rawInput, INPUT_FIELDS, 'input');
    const request = requiredText(rawInput.request, 'request');
    const turnId = requiredString(rawInput.turn_id, 'turn_id');
    if (turnId.length > 128 || /[\u0000-\u001f\u007f]/u.test(turnId)) fail('turn_id is invalid');
    if (rawInput.conversation_context === undefined) {
        fail('conversation_context is required');
    }
    let conversationContext = null;
    {
        exactFields(rawInput.conversation_context, CONVERSATION_CONTEXT_FIELDS, 'conversation_context');
        if (rawInput.conversation_context.schema_version !== 'brainbase-conversation-context-v1') {
            fail('conversation_context.schema_version is invalid');
        }
        const messages = rawInput.conversation_context.messages;
        if (!Array.isArray(messages)) fail('conversation_context.messages must be an array');
        const validatedMessages = messages.map((message, index) => {
            exactFields(message, MESSAGE_FIELDS, `conversation_context.messages[${index}]`);
            if (message.sequence !== index) fail('conversation_context.messages sequence is invalid');
            if (!['user', 'assistant'].includes(message.role)) fail('conversation_context.messages role is invalid');
            if (message.turn_id !== null && (typeof message.turn_id !== 'string' || !message.turn_id)) fail('conversation_context.messages turn_id is invalid');
            if (message.phase !== null && (typeof message.phase !== 'string' || !message.phase)) fail('conversation_context.messages phase is invalid');
            return {
                sequence: index,
                turn_id: message.turn_id,
                role: message.role,
                phase: message.phase,
                text: requiredText(message.text, `conversation_context.messages[${index}].text`)
            };
        });
        const priorReceipts = rawInput.conversation_context.prior_receipts;
        if (!Array.isArray(priorReceipts)) fail('conversation_context.prior_receipts must be an array');
        const validatedPriorReceipts = priorReceipts.map((receipt, index) => {
            exactFields(receipt, PRIOR_RECEIPT_FIELDS, `conversation_context.prior_receipts[${index}]`);
            const digestFields = ['request_digest', 'plan_digest'];
            for (const field of digestFields) if (!/^[a-f0-9]{64}$/u.test(String(receipt[field]))) fail(`conversation_context.prior_receipts[${index}].${field} is invalid`);
            if (receipt.context_digest !== null && !/^[a-f0-9]{64}$/u.test(String(receipt.context_digest))) fail(`conversation_context.prior_receipts[${index}].context_digest is invalid`);
            return {
                turn_id: requiredString(receipt.turn_id, `conversation_context.prior_receipts[${index}].turn_id`),
                resolution_id: requiredString(receipt.resolution_id, `conversation_context.prior_receipts[${index}].resolution_id`),
                request_digest: receipt.request_digest,
                context_digest: receipt.context_digest,
                plan_digest: receipt.plan_digest,
                classification: validatedClassification(receipt.classification, `conversation_context.prior_receipts[${index}].classification`, manifest),
                selected_dag_ids: stringArray(receipt.selected_dag_ids, `conversation_context.prior_receipts[${index}].selected_dag_ids`)
            };
        });
        exactFields(rawInput.conversation_context.runtime, RUNTIME_FIELDS, 'conversation_context.runtime');
        const runtime = rawInput.conversation_context.runtime;
        if (!RUNTIME_HOSTS.has(runtime.host)) fail('conversation_context.runtime.host is invalid');
        if (runtime.entrypoint !== undefined && !RUNTIME_ENTRYPOINTS.has(runtime.entrypoint)) {
            fail('conversation_context.runtime.entrypoint is invalid');
        }
        for (const nullable of ['model', 'permission_mode', 'project_binding']) {
            if (runtime[nullable] !== null && (typeof runtime[nullable] !== 'string' || !runtime[nullable])) fail(`conversation_context.runtime.${nullable} is invalid`);
        }
        const instructionBindings = rawInput.conversation_context.instruction_bindings;
        if (!Array.isArray(instructionBindings)) fail('conversation_context.instruction_bindings must be an array');
        const validatedInstructionBindings = instructionBindings.map((binding, index) => {
            exactFields(binding, INSTRUCTION_BINDING_FIELDS, `conversation_context.instruction_bindings[${index}]`);
            if (!/^[a-f0-9]{64}$/u.test(String(binding.digest))) fail(`conversation_context.instruction_bindings[${index}].digest is invalid`);
            return {
                scope: requiredString(binding.scope, `conversation_context.instruction_bindings[${index}].scope`),
                source_ref: requiredString(binding.source_ref, `conversation_context.instruction_bindings[${index}].source_ref`),
                digest: binding.digest
            };
        });
        if (!['complete', 'partial'].includes(rawInput.conversation_context.completeness)) fail('conversation_context.completeness is invalid');
        if (!/^[a-f0-9]{64}$/u.test(String(rawInput.conversation_context.session_ref))) fail('conversation_context.session_ref is invalid');
        if (!/^[a-f0-9]{64}$/u.test(String(rawInput.conversation_context.source_digest))) fail('conversation_context.source_digest is invalid');
        const currentMessages = validatedMessages.filter((message) => message.turn_id === turnId);
        const currentMessage = validatedMessages.at(-1);
        if (currentMessages.length !== 1 || currentMessage?.role !== 'user' || currentMessage.turn_id !== turnId || currentMessage.text !== request) {
            fail('conversation_context must end with the exact current request exactly once');
        }
        const { source_digest: _sourceDigest, ...sourceContext } = rawInput.conversation_context;
        if (sha256Hex(canonicalJson(sourceContext)) !== rawInput.conversation_context.source_digest) {
            fail('conversation_context.source_digest does not match canonical context');
        }
        if (rawInput.project_code !== undefined && runtime.project_binding !== rawInput.project_code) {
            fail('conversation_context.runtime.project_binding must match project_code');
        }
        const normalizedRuntime = {
            host: runtime.host,
            model: runtime.model,
            permission_mode: runtime.permission_mode,
            project_binding: runtime.project_binding
        };
        if (runtime.entrypoint !== undefined) normalizedRuntime.entrypoint = runtime.entrypoint;
        conversationContext = {
            schema_version: rawInput.conversation_context.schema_version,
            session_ref: rawInput.conversation_context.session_ref,
            messages: validatedMessages,
            prior_receipts: validatedPriorReceipts,
            runtime: normalizedRuntime,
            instruction_bindings: validatedInstructionBindings,
            completeness: rawInput.conversation_context.completeness,
            source_digest: rawInput.conversation_context.source_digest
        };
    }
    return {
        request,
        turn_id: turnId,
        project_code: rawInput.project_code === undefined ? null : requiredString(rawInput.project_code, 'project_code'),
        conversation_context: conversationContext,
        model_interpretation: rawInput.model_interpretation === undefined
            ? null
            : validatedClassification(rawInput.model_interpretation, 'model_interpretation', manifest)
    };
}

export function reconcileModelInterpretation(input: JudgmentRuntimeInput, manifest: JudgmentRuntimeManifest): JudgmentRuntimeReconciliation {
    if (!input.model_interpretation) {
        return {
            status: 'needs_classification', classification: null, assurance: 'unknown',
            reasons: ['model_interpretation_missing'],
            evidence: { source: 'resolver', source_turn_ids: [], matcher_ids: [] }
        };
    }
    // Host matchers are monotonic safety rails: they may only add risk,
    // action floors, signals, and capabilities. They never replace or weaken
    // the model's semantic interpretation.
    const hardSignals = classify(input, manifest);
    const hardClassification = hardSignals.classification;
    const hardIsSpecific = hardClassification
        && !(hardClassification.intent === 'answer' && hardClassification.domains.length === 1 && hardClassification.domains[0] === 'general');
    const classification = {
        ...input.model_interpretation,
        intent: input.model_interpretation.intent,
        domains: hardIsSpecific
            ? (input.model_interpretation.domains.length === 1 && input.model_interpretation.domains[0] === 'general'
                ? hardClassification.domains
                : sortByOrder([...new Set([...input.model_interpretation.domains, ...hardClassification.domains])], manifest.selectors.domain_order))
            : input.model_interpretation.domains,
        action_kind: hardClassification
            ? indexFloor(ACTIONS, input.model_interpretation.action_kind, hardClassification.action_kind)
            : input.model_interpretation.action_kind,
        risk: hardClassification
            ? indexFloor(RISKS, input.model_interpretation.risk, hardClassification.risk)
            : input.model_interpretation.risk,
        signals: sortByOrder([
            ...new Set([
                ...input.model_interpretation.signals,
                ...(hardClassification?.signals ?? [])
            ])
        ], manifest.selectors.signal_order)
    };
    // Project discovery belongs to knowledge retrieval. An unbound task still
    // has a valid semantic classification; this receipt grants no data access.
    return {
        status: 'resolved',
        classification,
        assurance: classification.confidence === 'confirmed' ? 'verified' : 'bounded',
        reasons: hardSignals.reasons,
        evidence: {
            source: 'current_request', source_turn_ids: [input.turn_id],
            matcher_ids: [...new Set(['model_interpretation', ...(hardSignals.evidence?.matcher_ids ?? [])])]
        }
    };
}

function matchingKeys(text, matchers, order) {
    return order.filter((key) => includesTerm(text, matchers[key]));
}

// Write/operate intent matchers must describe a requested command. State or
// temporal mentions still remain available to the independent safety floors.
function intentCommandTerms(terms) {
    return terms.flatMap((term) => {
        if (/^[a-z0-9_.-]+$/iu.test(term)) return [term];
        if (/[、,;；。！？!?]$/u.test(term) || /(?:して|って|んで|いて|せよ|しろ)$/u.test(term)) {
            return [term];
        }
        return [`${term}して`, `${term}しろ`, `${term}せよ`];
    });
}

function includesRequestedIntentTerm(request, terms) {
    return includesPositiveCommandClause(request, intentCommandTerms(terms));
}

function matchingIntent(text, manifest) {
    return INTENT_ORDER.find((intent) => {
        const terms = manifest.semantic_matchers.intents[intent];
        return ['implement', 'operate'].includes(intent)
            ? includesRequestedIntentTerm(text, terms)
            : includesTerm(text, terms);
    }) || null;
}

function includesFollowUpTerm(text, terms) {
    const normalized = text.toLocaleLowerCase('ja');
    return terms.some((term) => {
        const normalizedTerm = term.toLocaleLowerCase('ja');
        if (normalizedTerm === 'これ' || normalizedTerm === 'こちら') {
            return new RegExp(`${escapeRegExp(normalizedTerm)}(?:は(?:[？?]|どう|何|どれ|どこ|いつ|誰|なぜ)|(?!は))`, 'u').test(normalized);
        }
        if (normalizedTerm === 'では') {
            return /^(?:では)(?:[、,\s]|$)/u.test(normalized.trimStart());
        }
        return includesTerm(normalized, [normalizedTerm]);
    });
}

function classificationFromPriorContext(input, manifest) {
    const context = input.conversation_context;
    if (!context) return null;
    const priorReceipts = [...context.prior_receipts].reverse().filter((receipt) => receipt.turn_id !== input.turn_id);
    const domainReceipt = priorReceipts.find((receipt) => receipt.classification.domains.some((domain) => domain !== 'general'));
    if (domainReceipt) return { classification: domainReceipt.classification, turn_ids: [domainReceipt.turn_id], source: 'prior_receipt' };
    for (let index = context.messages.length - 1; index >= 0; index -= 1) {
        const message = context.messages[index];
        if (message.role !== 'user' || message.turn_id === input.turn_id) continue;
        const domains = matchingKeys(message.text, manifest.semantic_matchers.domains, manifest.selectors.domain_order.filter((domain) => domain !== 'general'));
        if (domains.length === 0) continue;
        const signals = matchingKeys(message.text, manifest.semantic_matchers.signals, manifest.selectors.signal_order);
        const intent = matchingIntent(message.text, manifest) || 'answer';
        return {
            classification: {
                intent,
                domains,
                action_kind: actionFloor(intent),
                risk: actionFloor(intent) === 'write' ? 'medium' : 'low',
                confidence: 'inferred',
                signals
            },
            turn_ids: message.turn_id ? [message.turn_id] : [],
            source: 'prior_message'
        };
    }
    const fallbackReceipt = priorReceipts[0];
    if (fallbackReceipt) return { classification: fallbackReceipt.classification, turn_ids: [fallbackReceipt.turn_id], source: 'prior_receipt' };
    return null;
}

export function classify(input: JudgmentRuntimeInput, manifest: JudgmentRuntimeManifest): JudgmentRuntimeReconciliation {
    const matchers = manifest.semantic_matchers;
    const request = positiveClassificationRequest(classificationRequest(input.request), manifest);
    const detectedDomains = matchingKeys(request, matchers.domains, manifest.selectors.domain_order.filter((domain) => domain !== 'general'));
    const detectedSignals = matchingKeys(request, matchers.signals, manifest.selectors.signal_order);
    const detectedIntent = matchingIntent(request, manifest);
    const followsPrior = includesFollowUpTerm(request, matchers.follow_up);
    const prior = followsPrior ? classificationFromPriorContext(input, manifest) : null;
    const inheritedDomains = detectedDomains.length === 0 && prior ? prior.classification.domains.filter((domain) => domain !== 'general') : [];
    const inheritedSignals = detectedSignals.length === 0 && prior ? prior.classification.signals : [];
    const domains = detectedDomains.length > 0
        ? detectedDomains
        : inheritedDomains.length > 0
            ? inheritedDomains
            : followsPrior && !prior
                ? []
                : ['general'];
    const signals = detectedSignals.length > 0 ? detectedSignals : inheritedSignals;
    const intent = detectedIntent || (prior ? prior.classification.intent : followsPrior ? null : 'answer');
    if (!intent || domains.length === 0) {
        return {
            status: 'needs_classification', classification: null, assurance: 'unknown',
            reasons: ['conversation_referent_missing'],
            evidence: { source: 'resolver', source_turn_ids: [], matcher_ids: [] }
        };
    }
    const detectedAction = includesRequestedEffectTerm(request, matchers.safety.external)
        ? 'external'
        : includesRequestedEffectTerm(request, matchers.safety.write)
            ? 'write'
            : 'none';
    const minimumAction = indexFloor(ACTIONS, actionFloor(intent), detectedAction);
    const minimumRisk = includesUnprohibitedTerm(request, matchers.safety.critical)
        ? 'critical'
        : minimumAction === 'external'
            ? 'high'
            : minimumAction === 'write'
                ? 'medium'
                : 'low';
    const inherited = detectedDomains.length === 0 && Boolean(prior);
    const matcherIds = [
        ...(detectedIntent ? [`intent:${detectedIntent}`] : []),
        ...detectedDomains.map((domain) => `domain:${domain}`),
        ...detectedSignals.map((signal) => `signal:${signal}`),
        ...(detectedAction !== 'none' ? [`effect:${detectedAction}`] : [])
    ];
    return {
        status: 'resolved',
        classification: {
            intent,
            domains: sortByOrder(domains, manifest.selectors.domain_order),
            action_kind: minimumAction,
            risk: minimumRisk,
            confidence: inherited ? 'inferred' : 'confirmed',
            signals: sortByOrder(signals, manifest.selectors.signal_order)
        },
        assurance: inherited ? 'bounded' : 'verified',
        reasons: inherited ? ['classification_inherited_from_prior_turn'] : [],
        evidence: {
            source: inherited ? prior.source : 'current_request',
            source_turn_ids: inherited ? prior.turn_ids : [input.turn_id],
            matcher_ids: matcherIds
        }
    };
}

function policyScopeId(policy, ownerPersonId) {
    return policy.scope.id === '$personal_owner' ? ownerPersonId : policy.scope.id;
}

export function materializePolicy(policy: JudgmentRuntimePolicy, ownerPersonId: string | null): JudgmentRuntimePolicy {
    return {
        ...policy,
        scope: { ...policy.scope, id: policyScopeId(policy, ownerPersonId) },
        owner_person_id: policy.owner_person_id === '$personal_owner' ? ownerPersonId : policy.owner_person_id
    };
}

function policyComparator(left, right) {
    if (left.strength !== right.strength) return left.strength === 'hard' ? -1 : 1;
    if (left.priority !== right.priority) return right.priority - left.priority;
    const scopeDelta = SCOPE_SPECIFICITY[right.scope.type] - SCOPE_SPECIFICITY[left.scope.type];
    if (scopeDelta !== 0) return scopeDelta;
    return compareCodePoints(left.id, right.id);
}

export function mergePolicies(policies: JudgmentRuntimePolicy[]): JudgmentRuntimePolicyMerge {
    const sorted = [...policies].sort(policyComparator);
    const applicable = [];
    const suppressed = [];
    let conflict = false;
    const byTarget = new Map();
    for (const policy of sorted) {
        const target = policy.effect.target;
        if (!byTarget.has(target)) byTarget.set(target, []);
        byTarget.get(target).push(policy);
    }
    for (const group of byTarget.values()) {
        const hard = group.filter((policy) => policy.strength === 'hard');
        const soft = group.filter((policy) => policy.strength === 'soft');
        let winningHard = hard;
        const decisions = new Set(hard.map((policy) => policy.effect.decision));
        if (decisions.has('require') && decisions.has('forbid')) {
            const winner = hard[0];
            const tied = hard.filter((policy) => policy.priority === winner.priority && SCOPE_SPECIFICITY[policy.scope.type] === SCOPE_SPECIFICITY[winner.scope.type]);
            if (new Set(tied.map((policy) => policy.effect.decision)).size > 1) {
                conflict = true;
                winningHard = tied;
                for (const policy of hard.filter((candidate) => !tied.includes(candidate))) {
                    suppressed.push({
                        policy_id: policy.id,
                        suppressed_by_policy_id: winner.id,
                        reason: policy.priority < winner.priority ? 'lower_priority' : 'lower_specificity'
                    });
                }
            } else {
                winningHard = [winner];
                for (const policy of hard.slice(1)) {
                    suppressed.push({
                        policy_id: policy.id,
                        suppressed_by_policy_id: winner.id,
                        reason: policy.priority < winner.priority ? 'lower_priority' : 'lower_specificity'
                    });
                }
            }
        }
        applicable.push(...winningHard);
        if (hard.length > 0) {
            for (const policy of soft) suppressed.push({ policy_id: policy.id, suppressed_by_policy_id: hard[0].id, reason: 'hard_over_soft' });
        } else {
            applicable.push(...soft);
        }
    }
    return { applicable: applicable.sort(policyComparator), suppressed, conflict };
}

export function selectedDags(classification: JudgmentRuntimeClassification, manifest: JudgmentRuntimeManifest): string[] {
    const selected = [];
    for (const domain of classification.domains) {
        if (classification.intent === 'answer'
            && ['none', 'read'].includes(classification.action_kind)
            && classification.risk === 'low'
            && ['engineering', 'operations'].includes(domain)) {
            selected.push(manifest.selectors.domain_dags.general);
            continue;
        }
        const implementationDag = domain === 'engineering' && classification.intent === 'implement'
            ? manifest.selectors.engineering_implementation_dag : null;
        selected.push(implementationDag ?? manifest.selectors.domain_dags[domain]);
    }
    for (const signal of classification.signals) selected.push(manifest.selectors.signal_dags[signal]);
    if (['high', 'critical'].includes(classification.risk) || ['write', 'external'].includes(classification.action_kind) || classification.signals.includes('authority_boundary')) {
        selected.push(manifest.selectors.authority_dag);
    }
    return [...new Set(selected)];
}

export function buildGraph(
    dagIds: string[],
    manifest: JudgmentRuntimeManifest,
    { clarification = false }: JudgmentRuntimeGraphOptions = {}
): JudgmentRuntimeGraph {
    if (clarification) {
        return {
            active_nodes: ['entry', 'reconcile', 'clarification', 'receipt'],
            active_edges: [['entry', 'reconcile'], ['reconcile', 'clarification'], ['clarification', 'receipt']]
        };
    }
    const dagMap = new Map(manifest.dags.map((dag) => [dag.id, dag]));
    const activeNodes = ['entry', 'reconcile'];
    const activeEdges = [['entry', 'reconcile']];
    const addNode = (node) => { if (!activeNodes.includes(node)) activeNodes.push(node); };
    const addEdge = (from, to) => {
        if (!activeEdges.some((edge) => edge[0] === from && edge[1] === to)) activeEdges.push([from, to]);
    };
    for (const dagId of dagIds) {
        const path = dagMap.get(dagId).path;
        path.forEach(addNode);
        addEdge('reconcile', path[0]);
        for (let index = 1; index < path.length; index += 1) addEdge(path[index - 1], path[index]);
        addEdge(path.at(-1), 'merge');
    }
    addNode('merge');
    addNode('receipt');
    addEdge('merge', 'receipt');
    const activeNodeSet = new Set(activeNodes);
    for (const [from, to] of manifest.composition_edges) {
        if (activeNodeSet.has(from) && activeNodeSet.has(to)) addEdge(from, to);
    }
    const orderedNodes = topologicallySortNodes(activeNodes, activeEdges);
    return { active_nodes: orderedNodes, active_edges: activeEdges };
}

export function materializeActiveNodeDefinitions(
    activeNodes: string[],
    manifest: JudgmentRuntimeManifest,
    { evidenceRequired = true }: JudgmentRuntimeActiveNodeOptions = {}
): JudgmentRuntimeNode[] {
    const nodeMap = new Map(manifest.nodes.map((node) => [node.id, node]));
    return activeNodes.map((nodeId) => {
        const node = nodeMap.get(nodeId);
        if (!node) throw new TypeError(`active judgment graph references missing node ${nodeId}`);
        return {
            id: node.id,
            kind: node.kind,
            instruction: node.instruction,
            required_capability_template: node.required_capability_template,
            ...(evidenceRequired && ['problem-frame', 'observe', 'falsify'].every((id) => activeNodes.includes(id))
                && node.execution_contract ? { execution_contract: node.execution_contract } : {})
        };
    });
}

export function topologicallySortNodes(nodes: string[], edges: Array<[string, string]>): string[] {
    const indegree = new Map(nodes.map((node) => [node, 0]));
    const outgoing = new Map(nodes.map((node) => [node, []]));
    const originalOrder = new Map(nodes.map((node, index) => [node, index]));
    for (const [from, to] of edges) {
        if (!indegree.has(from) || !indegree.has(to)) throw new TypeError('active judgment graph references a missing node');
        indegree.set(to, indegree.get(to) + 1);
        outgoing.get(from).push(to);
    }
    const queue = nodes.filter((node) => indegree.get(node) === 0);
    const ordered = [];
    while (queue.length > 0) {
        const node = queue.shift();
        ordered.push(node);
        for (const target of outgoing.get(node)) {
            indegree.set(target, indegree.get(target) - 1);
            if (indegree.get(target) === 0) {
                queue.push(target);
                queue.sort((left, right) => originalOrder.get(left) - originalOrder.get(right));
            }
        }
    }
    if (ordered.length !== nodes.length) throw new TypeError('active judgment graph contains a cycle');
    return ordered;
}

// ADR-014 F1: every resolved turn selects the philosophy, objectives, and
// world models that bear on the response and records how each was used.
// Emitted only to clients that declared support, because older MCP receipt
// validators reject unknown capabilities and would break every turn.
export const JUDGMENT_FRAME_CAPABILITY = 'judgment.frame';
const JUDGMENT_FRAME_INTENTS = new Set(['design', 'review', 'operate']);
const JUDGMENT_FRAME_DOMAINS = new Set(['personal_judgment', 'organization']);

export function isJudgmentBearing(classification: JudgmentRuntimeClassification | null): boolean {
    if (!classification) return false;
    return JUDGMENT_FRAME_INTENTS.has(classification.intent)
        || classification.domains.some((domain) => JUDGMENT_FRAME_DOMAINS.has(domain));
}

export function frameCapabilities(
    input: JudgmentRuntimeInput,
    classification: JudgmentRuntimeClassification | null,
    clientCapabilities: ReadonlySet<string>,
    status: JudgmentRuntimeStatus
): JudgmentRuntimeCapability[] {
    if (status !== 'resolved' || !clientCapabilities.has(JUDGMENT_FRAME_CAPABILITY) || !classification) return [];
    return [{
        capability: JUDGMENT_FRAME_CAPABILITY,
        status: 'required',
        input: {
            kinds: ['philosophy', 'objective', 'model'],
            project_code: input.project_code
        },
        receipt_required: true
    }];
}

export function knowledgeCapabilities(
    input: JudgmentRuntimeInput,
    classification: JudgmentRuntimeClassification | null
): JudgmentRuntimeCapability[] {
    if (!classification?.domains.includes('knowledge')) return [];
    const contentType = classification.domains.includes('personal_judgment')
        ? 'personal_knowledge'
        : classification.domains.includes('operations')
            ? 'operational_state'
            : 'unknown';
    return [{
        capability: 'knowledge.resolve',
        status: 'required',
        input: {
            intent: 'lookup',
            audience: classification.domains.includes('personal_judgment') ? 'personal' : 'team',
            content_type: contentType,
            project_code: input.project_code
        },
        receipt_required: true
    }];
}

/**
 * Resolve the deterministic runtime plan from normalized, already-authorized
 * inputs. `applicablePolicies` must have been filtered by the Org/Host adapter;
 * this core deliberately has no access or tenant lookup and never broadens a
 * deny decision.
 */
export function resolveJudgmentRuntimeCore({
    input,
    manifest,
    applicablePolicies = [],
    ownerPersonId = null,
    clientCapabilities = []
}: JudgmentRuntimeCoreInput): JudgmentRuntimeResolutionPlan {
    const reconciliation = reconcileModelInterpretation(input, manifest);
    const needsClassification = reconciliation.status === 'needs_classification';
    const dagIds = needsClassification
        ? [manifest.selectors.clarification_dag]
        : selectedDags(reconciliation.classification, manifest);
    const graph = buildGraph(dagIds, manifest, { clarification: needsClassification });
    const policies = needsClassification
        ? { applicable: [], suppressed: [], conflict: false }
        : mergePolicies(applicablePolicies.map((policy) => materializePolicy(policy, ownerPersonId)));
    const status = needsClassification
        ? 'needs_classification'
        : policies.conflict
            ? 'needs_policy_resolution'
            : 'resolved';
    const autonomy = autonomyResolution(status, reconciliation.classification, manifest, policies.applicable);
    const activeNodeDefinitions = materializeActiveNodeDefinitions(graph.active_nodes, manifest, {
        evidenceRequired: !(reconciliation.classification?.intent === 'answer'
            && ['none', 'read'].includes(reconciliation.classification?.action_kind)
            && reconciliation.classification?.risk === 'low')
    });
    return {
        status,
        ...autonomy,
        reconciliation,
        selected_dag_ids: dagIds,
        applicable_policies: policies.applicable,
        suppressed_policies: policies.suppressed,
        policy_conflict: policies.conflict,
        required_capabilities: status === 'needs_classification' ? [] : [
            ...knowledgeCapabilities(input, reconciliation.classification),
            ...frameCapabilities(input, reconciliation.classification, new Set(clientCapabilities), status)
        ],
        ...graph,
        active_node_definitions: activeNodeDefinitions,
        unresolved: status === 'needs_classification'
            ? reconciliation.reasons
            : status === 'needs_policy_resolution'
                ? ['policy_conflict']
                : [],
        rationale: status === 'needs_classification'
            ? ['Model semantic interpretation is required before the server can issue a TurnContract.']
            : status === 'needs_policy_resolution'
                ? ['Equally authoritative hard policies conflict; resolve policy before proceeding.']
                : ['The server-owned manifest selected only the judgment branches required by this turn.']
    };
}
