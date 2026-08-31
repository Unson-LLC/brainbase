import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIRECTORY = import.meta.url.startsWith('file:')
    ? dirname(fileURLToPath(import.meta.url))
    : resolve(process.cwd(), 'server/services');
const MANIFEST_PATH = resolve(MODULE_DIRECTORY, '../../config/judgment-runtime-manifest.json');
const MANIFEST_LOCK_PATH = resolve(MODULE_DIRECTORY, '../../config/judgment-runtime-manifest-lock.json');

const INPUT_FIELDS = new Set(['request', 'turn_id', 'project_code', 'conversation_context']);
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
const RUNTIME_FIELDS = new Set(['host', 'model', 'permission_mode', 'project_binding']);
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

function compareCodePoints(left, right) {
    const a = Array.from(left, (value) => value.codePointAt(0));
    const b = Array.from(right, (value) => value.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
}

export function canonicalJson(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('canonical JSON only supports finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    if (typeof value === 'object') {
        return `{${Object.keys(value).sort(compareCodePoints).map((key) => {
            const entry = value[key];
            if (entry === undefined) throw new TypeError('canonical JSON does not support undefined');
            return `${JSON.stringify(key)}:${canonicalJson(entry)}`;
        }).join(',')}}`;
    }
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

export function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}

export function computeRequestDigest(rawInput) {
    return sha256Hex(canonicalJson(rawInput));
}

export class JudgmentResolutionError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = 'JudgmentResolutionError';
        this.code = code;
        this.status = status;
    }

    toJSON() {
        return { name: this.name, code: this.code, status: this.status, message: this.message };
    }
}

function fail(message, code = 'judgment_resolution_input_invalid', status = 400) {
    throw new JudgmentResolutionError(code, message, status);
}

function readJson(url) {
    return JSON.parse(readFileSync(url, 'utf8'));
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

function includesRequestedEffectTerm(request, terms) {
    const normalized = request.toLocaleLowerCase('ja');
    return terms.some((term) => {
        const normalizedTerm = term.toLocaleLowerCase('ja');
        if (/^[a-z0-9_.-]+$/u.test(normalizedTerm)) {
            return new RegExp(`(?<![a-z0-9_])${escapeRegExp(normalizedTerm)}(?![a-z0-9_])`, 'u').test(normalized);
        }

        let offset = 0;
        while (offset < normalized.length) {
            const index = normalized.indexOf(normalizedTerm, offset);
            if (index < 0) return false;
            const continuation = normalized.slice(index + normalizedTerm.length).trimStart();
            const isConditionalTeForm = normalizedTerm.endsWith('して')
                && /^(?:も(?!ら)|しま|いる|いた|ある|あった|おり|はいけ|はなら|よい|良い|いい|問題ない|可能|でき)/u.test(continuation);
            if (!isConditionalTeForm) return true;
            offset = index + normalizedTerm.length;
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

function sortByOrder(values, order) {
    const indexes = new Map(order.map((value, index) => [value, index]));
    return [...values].sort((left, right) => (indexes.get(left) ?? Number.MAX_SAFE_INTEGER) - (indexes.get(right) ?? Number.MAX_SAFE_INTEGER));
}

function validatedClassification(value, name, manifest) {
    exactFields(value, CLASSIFICATION_FIELDS, name);
    const domains = uniqueEnumArray(value.domains, `${name}.domains`, DOMAINS);
    if (domains.includes('general') && domains.length > 1) fail('general cannot be combined with another domain');
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

export function validateManifestLock(lock, previous = null, current = null) {
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

function validateManifest(manifest, lock) {
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
    validateStringTerms(matchers.follow_up, 'judgment follow-up matcher');
    const autonomy = manifest.autonomy;
    if (!autonomy || autonomy.schema_version !== 'brainbase-autonomy-policy-v1') throw new TypeError('judgment autonomy policy is invalid');
    validateStringTerms(autonomy.continue_risks, 'judgment autonomy continue risks');
    validateStringTerms(autonomy.escalate_risks, 'judgment autonomy escalate risks');
    validateStringTerms(autonomy.escalate_action_kinds, 'judgment autonomy escalate action kinds');
    validateStringTerms(autonomy.runtime_escalation_reasons, 'judgment autonomy runtime escalation reasons');
    if (canonicalJson(autonomy.continue_risks) !== canonicalJson(['low', 'medium'])
        || canonicalJson(autonomy.escalate_risks) !== canonicalJson(['high', 'critical'])
        || canonicalJson(autonomy.escalate_action_kinds) !== canonicalJson(['external'])
        || autonomy.runtime_escalation_reasons.length !== RUNTIME_ESCALATION_REASONS.size
        || autonomy.runtime_escalation_reasons.some((reason) => !RUNTIME_ESCALATION_REASONS.has(reason))) {
        throw new TypeError('judgment autonomy policy boundary is invalid');
    }
    validateSelectableGraphs(manifest);
    const digest = sha256Hex(canonicalJson(manifest));
    validateManifestLock(lock, null, { runtimeVersion: manifest.runtime_version, manifestDigest: digest });
    return digest;
}

function autonomyResolution(status, classification, manifest) {
    let decision;
    let reasonCode;
    if (status === 'needs_classification') {
        decision = 'escalate';
        reasonCode = 'classification_missing';
    } else if (status === 'needs_policy_resolution') {
        decision = 'escalate';
        reasonCode = 'policy_conflict';
    } else if (manifest.autonomy.escalate_risks.includes(classification.risk)
        || manifest.autonomy.escalate_action_kinds.includes(classification.action_kind)) {
        decision = 'escalate';
        reasonCode = 'risk_or_external';
    } else {
        decision = 'continue';
        reasonCode = 'routine_in_scope';
    }
    if (!AUTONOMY_DECISIONS.has(decision) || !AUTONOMY_REASON_CODES.has(reasonCode)) {
        throw new TypeError('judgment autonomy resolution is invalid');
    }
    return {
        autonomy_decision: decision,
        autonomy_reason_code: reasonCode,
        allowed_runtime_escalation_reasons: decision === 'continue'
            ? [...manifest.autonomy.runtime_escalation_reasons]
            : []
    };
}

function validateInput(rawInput, manifest) {
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
        if (runtime.host !== 'codex') fail('conversation_context.runtime.host is invalid');
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
        conversationContext = {
            schema_version: rawInput.conversation_context.schema_version,
            session_ref: rawInput.conversation_context.session_ref,
            messages: validatedMessages,
            prior_receipts: validatedPriorReceipts,
            runtime: {
                host: runtime.host,
                model: runtime.model,
                permission_mode: runtime.permission_mode,
                project_binding: runtime.project_binding
            },
            instruction_bindings: validatedInstructionBindings,
            completeness: rawInput.conversation_context.completeness,
            source_digest: rawInput.conversation_context.source_digest
        };
    }
    return {
        request,
        turn_id: turnId,
        project_code: rawInput.project_code === undefined ? null : requiredString(rawInput.project_code, 'project_code'),
        conversation_context: conversationContext
    };
}

function matchingKeys(text, matchers, order) {
    return order.filter((key) => includesTerm(text, matchers[key]));
}

function matchingIntent(text, manifest) {
    return INTENT_ORDER.find((intent) => {
        const terms = manifest.semantic_matchers.intents[intent];
        return ['implement', 'operate'].includes(intent)
            ? includesRequestedEffectTerm(text, terms)
            : includesTerm(text, terms);
    }) || null;
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

function classify(input, manifest) {
    const matchers = manifest.semantic_matchers;
    const request = classificationRequest(input.request);
    const detectedDomains = matchingKeys(request, matchers.domains, manifest.selectors.domain_order.filter((domain) => domain !== 'general'));
    const detectedSignals = matchingKeys(request, matchers.signals, manifest.selectors.signal_order);
    const detectedIntent = matchingIntent(request, manifest);
    const followsPrior = includesTerm(request, matchers.follow_up);
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
    const minimumRisk = includesTerm(request, matchers.safety.critical)
        ? 'critical'
        : minimumAction === 'external'
            ? 'high'
            : minimumAction === 'write'
                ? 'medium'
                : 'low';
    if (domains.includes('knowledge') && !input.project_code) {
        return {
            status: 'needs_classification', classification: null, assurance: 'unknown',
            reasons: ['knowledge_project_code_missing'],
            evidence: {
                source: 'resolver', source_turn_ids: prior?.turn_ids || [],
                matcher_ids: ['domain:knowledge']
            }
        };
    }
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

function materializePolicy(policy, ownerPersonId) {
    return {
        ...policy,
        scope: { ...policy.scope, id: policyScopeId(policy, ownerPersonId) },
        owner_person_id: policy.owner_person_id === '$personal_owner' ? ownerPersonId : policy.owner_person_id
    };
}

function isPolicyApplicable(policy, access) {
    if (policy.scope.type === 'global') return true;
    if (policy.scope.type === 'organization') return Boolean(access?.tenantId) && policy.scope.id === access.tenantId;
    if (policy.scope.type === 'project') return Array.isArray(access?.projectCodes) && access.projectCodes.includes(policy.scope.id);
    if (policy.scope.type === 'owner') return Boolean(access?.personId) && policy.scope.id === access.personId;
    return false;
}

function policyComparator(left, right) {
    if (left.strength !== right.strength) return left.strength === 'hard' ? -1 : 1;
    if (left.priority !== right.priority) return right.priority - left.priority;
    const scopeDelta = SCOPE_SPECIFICITY[right.scope.type] - SCOPE_SPECIFICITY[left.scope.type];
    if (scopeDelta !== 0) return scopeDelta;
    return compareCodePoints(left.id, right.id);
}

function mergePolicies(policies) {
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

function selectedDags(classification, manifest) {
    const selected = [];
    for (const domain of classification.domains) selected.push(manifest.selectors.domain_dags[domain]);
    for (const signal of classification.signals) selected.push(manifest.selectors.signal_dags[signal]);
    if (['high', 'critical'].includes(classification.risk) || ['write', 'external'].includes(classification.action_kind) || classification.signals.includes('authority_boundary')) {
        selected.push(manifest.selectors.authority_dag);
    }
    return [...new Set(selected)];
}

function buildGraph(dagIds, manifest, { clarification = false } = {}) {
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

function materializeActiveNodeDefinitions(activeNodes, manifest) {
    const nodeMap = new Map(manifest.nodes.map((node) => [node.id, node]));
    return activeNodes.map((nodeId) => {
        const node = nodeMap.get(nodeId);
        if (!node) throw new TypeError(`active judgment graph references missing node ${nodeId}`);
        return {
            id: node.id,
            kind: node.kind,
            instruction: node.instruction,
            required_capability_template: node.required_capability_template
        };
    });
}

function topologicallySortNodes(nodes, edges) {
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

function knowledgeCapabilities(input, classification) {
    if (!classification?.domains.includes('knowledge')) return [];
    return [{
        capability: 'knowledge.resolve',
        status: 'required',
        input: {
            intent: 'lookup',
            audience: classification.domains.includes('personal_judgment') ? 'personal' : 'team',
            content_type: 'unknown',
            project_code: input.project_code
        },
        receipt_required: true
    }];
}

export class JudgmentResolutionService {
    constructor({
        now = () => new Date(),
        id = () => `jr_${randomUUID()}`,
        manifest = readJson(MANIFEST_PATH),
        manifestLock = readJson(MANIFEST_LOCK_PATH),
        personalOwnerPersonId = process.env.BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID || null,
        personalOwnerAliasIds = (process.env.BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS || '').split(',').map((value) => value.trim()).filter(Boolean)
    } = {}) {
        try {
            this.manifestDigest = validateManifest(manifest, manifestLock);
        } catch (error) {
            throw new JudgmentResolutionError('judgment_manifest_invalid', error instanceof Error ? error.message : String(error), 500);
        }
        this.manifest = manifest;
        this.now = now;
        this.id = id;
        this.personalOwnerPersonId = personalOwnerPersonId;
        this.personalOwnerAliasIds = new Set(personalOwnerAliasIds);
    }

    hasHostBinding(adapterId, adapterVersion) {
        return this.manifest.host_bindings.some((binding) => binding.adapter_id === adapterId && binding.adapter_version === adapterVersion);
    }

    resolve(rawInput = {}, { access = {}, hostBinding } = {}) {
        const input = validateInput(rawInput, this.manifest);
        if (!hostBinding || hostBinding.status !== 'managed') fail('verified host binding is required', 'judgment_host_binding_untrusted', 403);
        if (!this.hasHostBinding(hostBinding.adapter_id, hostBinding.adapter_version)) {
            fail('host binding is not registered', 'judgment_host_binding_untrusted', 403);
        }
        const reconciliation = classify(input, this.manifest);
        const wantsPersonal = reconciliation.classification?.domains.includes('personal_judgment');
        const allowedOwnerIds = new Set([this.personalOwnerPersonId, ...this.personalOwnerAliasIds].filter(Boolean));
        if (wantsPersonal && (access.personId === 'internal_api' || !allowedOwnerIds.has(access.personId))) {
            fail('personal judgment is not accessible', 'personal_judgment_not_accessible', 403);
        }

        const needsClassification = reconciliation.status === 'needs_classification';
        const policyAccess = this.personalOwnerAliasIds.has(access.personId)
            ? { ...access, personId: this.personalOwnerPersonId }
            : access;
        const dagIds = needsClassification
            ? [this.manifest.selectors.clarification_dag]
            : selectedDags(reconciliation.classification, this.manifest);
        const graph = buildGraph(dagIds, this.manifest, { clarification: needsClassification });
        const dagMap = new Map(this.manifest.dags.map((dag) => [dag.id, dag]));
        const policyIds = [...new Set(dagIds.flatMap((dagId) => dagMap.get(dagId).policy_ids || []))];
        const policyMap = new Map(this.manifest.policies.map((policy) => [policy.id, materializePolicy(policy, this.personalOwnerPersonId)]));
        const policies = needsClassification
            ? { applicable: [], suppressed: [], conflict: false }
            : mergePolicies(policyIds.map((id) => policyMap.get(id)).filter((policy) => policy && isPolicyApplicable(policy, policyAccess)));
        const status = needsClassification
            ? 'needs_classification'
            : policies.conflict
                ? 'needs_policy_resolution'
                : 'resolved';
        const autonomy = autonomyResolution(status, reconciliation.classification, this.manifest);
        const requestDigest = computeRequestDigest(rawInput);
        const contextDigest = rawInput.conversation_context === undefined
            ? null
            : sha256Hex(canonicalJson(rawInput.conversation_context));
        const receipt = {
            resolution_id: this.id(),
            resolved_at: this.now().toISOString(),
            turn_id: input.turn_id,
            request_digest: requestDigest,
            context_digest: contextDigest,
            status,
            ...autonomy,
            runtime_version: this.manifest.runtime_version,
            manifest_digest: this.manifestDigest,
            host_binding: {
                adapter_id: hostBinding.adapter_id,
                adapter_version: hostBinding.adapter_version,
                status: 'managed',
                enforcement_level: 'host_contract'
            },
            project_code: input.project_code,
            classification: reconciliation.classification,
            classification_evidence: reconciliation.evidence,
            classification_assurance: reconciliation.assurance,
            reconciliation_reasons: reconciliation.reasons,
            selected_dag_ids: dagIds,
            applicable_policies: policies.applicable,
            suppressed_policies: policies.suppressed,
            required_capabilities: needsClassification ? [] : knowledgeCapabilities(input, reconciliation.classification),
            ...graph,
            active_node_definitions: materializeActiveNodeDefinitions(graph.active_nodes, this.manifest),
            unresolved: status === 'needs_classification'
                ? ['classification']
                : status === 'needs_policy_resolution'
                    ? ['policy_conflict']
                    : [],
            rationale: status === 'needs_classification'
                ? ['Semantic classification was not verified by a server-owned matcher.']
                : status === 'needs_policy_resolution'
                    ? ['Equally authoritative hard policies conflict; resolve policy before proceeding.']
                    : ['The server-owned manifest selected only the judgment branches required by this turn.']
        };
        const planValue = { ...receipt };
        delete planValue.resolution_id;
        delete planValue.resolved_at;
        delete planValue.request_digest;
        receipt.plan_digest = sha256Hex(canonicalJson(planValue));
        return receipt;
    }
}
