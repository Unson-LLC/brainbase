import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MANIFEST_PATH = resolve(process.cwd(), 'config/judgment-runtime-manifest.json');
const MANIFEST_LOCK_PATH = resolve(process.cwd(), 'config/judgment-runtime-manifest-lock.json');

const INPUT_FIELDS = new Set(['request', 'turn_id', 'project_code', 'classification_proposal', 'conversation_context', 'knowledge_context']);
const CLASSIFICATION_FIELDS = new Set(['intent', 'domains', 'action_kind', 'risk', 'confidence', 'signals']);
const CONVERSATION_CONTEXT_FIELDS = new Set(['text', 'source_turn_ids']);
const KNOWLEDGE_FIELDS = new Set(['audience', 'content_type']);
const INTENTS = new Set(['answer', 'investigate', 'diagnose', 'design', 'implement', 'review', 'operate']);
const DOMAINS = new Set(['general', 'knowledge', 'personal_judgment', 'engineering', 'organization', 'operations']);
const ACTIONS = ['none', 'read', 'write', 'external'];
const RISKS = ['low', 'medium', 'high', 'critical'];
const CONFIDENCES = new Set(['confirmed', 'inferred', 'unknown']);
const SIGNALS = new Set(['cumulative_effect', 'complexity_growth', 'threshold_proposal', 'parallel_exploration', 'authority_boundary', 'problem_frame_uncertain', 'external_outcome']);
const AUDIENCES = new Set(['personal', 'team', 'organization']);
const CONTENT_TYPES = new Set(['canonical_fact', 'team_document', 'source_document', 'personal_knowledge', 'operational_state', 'unknown']);
const SCOPE_SPECIFICITY = { global: 0, organization: 1, project: 2, owner: 3 };
const POLICY_VISIBILITIES = new Set(['organization', 'owner']);
const NODE_KINDS = new Set(['common', 'judgment', 'capability', 'constraint', 'fail_closed']);
const DAG_KINDS = new Set(['domain', 'constraint', 'fail_closed']);
const DOMAIN_MATCHERS = new Set(['engineering', 'knowledge', 'personal_judgment', 'organization', 'operations']);
const SAFETY_MATCHERS = new Set(['write', 'external', 'critical']);
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

function sortByOrder(values, order) {
    const indexes = new Map(order.map((value, index) => [value, index]));
    return [...values].sort((left, right) => (indexes.get(left) ?? Number.MAX_SAFE_INTEGER) - (indexes.get(right) ?? Number.MAX_SAFE_INTEGER));
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
    if (!Array.isArray(manifest.host_bindings) || !Array.isArray(manifest.policies) || !Array.isArray(manifest.nodes) || !Array.isArray(manifest.dags)) throw new TypeError('judgment manifest collections are invalid');
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
    validateExactKeys(matchers?.domains, DOMAIN_MATCHERS, 'judgment domain matchers');
    validateExactKeys(matchers?.signals, SIGNALS, 'judgment signal matchers');
    validateExactKeys(matchers?.safety, SAFETY_MATCHERS, 'judgment safety matchers');
    for (const [key, terms] of Object.entries(matchers.domains)) validateStringTerms(terms, `judgment domain matcher ${key}`);
    for (const [key, terms] of Object.entries(matchers.signals)) validateStringTerms(terms, `judgment signal matcher ${key}`);
    for (const [key, terms] of Object.entries(matchers.safety)) validateStringTerms(terms, `judgment safety matcher ${key}`);
    validateStringTerms(matchers.safe_general, 'judgment safe-general matcher');
    const digest = sha256Hex(canonicalJson(manifest));
    validateManifestLock(lock, null, { runtimeVersion: manifest.runtime_version, manifestDigest: digest });
    return digest;
}

function validateInput(rawInput, manifest) {
    exactFields(rawInput, INPUT_FIELDS, 'input');
    const request = requiredString(rawInput.request, 'request');
    const turnId = requiredString(rawInput.turn_id, 'turn_id');
    if (turnId.length > 128 || /[\u0000-\u001f\u007f]/u.test(turnId)) fail('turn_id is invalid');
    exactFields(rawInput.classification_proposal, CLASSIFICATION_FIELDS, 'classification_proposal');
    const rawProposal = rawInput.classification_proposal;
    const domains = uniqueEnumArray(rawProposal.domains, 'classification_proposal.domains', DOMAINS);
    if (domains.includes('general') && domains.length > 1) fail('general cannot be combined with another domain');
    const signals = uniqueEnumArray(rawProposal.signals, 'classification_proposal.signals', SIGNALS, { optional: true });
    let conversationContext = null;
    if (rawInput.conversation_context !== undefined) {
        exactFields(rawInput.conversation_context, CONVERSATION_CONTEXT_FIELDS, 'conversation_context');
        conversationContext = {
            text: requiredString(rawInput.conversation_context.text, 'conversation_context.text'),
            source_turn_ids: uniqueStringArray(rawInput.conversation_context.source_turn_ids, 'conversation_context.source_turn_ids')
        };
    }
    let knowledgeContext = null;
    if (rawInput.knowledge_context !== undefined) {
        exactFields(rawInput.knowledge_context, KNOWLEDGE_FIELDS, 'knowledge_context');
        knowledgeContext = {
            audience: enumValue(rawInput.knowledge_context.audience, 'knowledge_context.audience', AUDIENCES),
            content_type: enumValue(rawInput.knowledge_context.content_type, 'knowledge_context.content_type', CONTENT_TYPES)
        };
    }
    const proposal = {
        intent: enumValue(rawProposal.intent, 'classification_proposal.intent', INTENTS),
        domains: sortByOrder(domains, manifest.selectors.domain_order),
        action_kind: enumValue(rawProposal.action_kind, 'classification_proposal.action_kind', new Set(ACTIONS)),
        risk: enumValue(rawProposal.risk, 'classification_proposal.risk', new Set(RISKS)),
        confidence: enumValue(rawProposal.confidence, 'classification_proposal.confidence', CONFIDENCES),
        signals: sortByOrder(signals, manifest.selectors.signal_order)
    };
    return {
        request,
        turn_id: turnId,
        project_code: rawInput.project_code === undefined ? null : requiredString(rawInput.project_code, 'project_code'),
        classification_proposal: proposal,
        conversation_context: conversationContext,
        knowledge_context: knowledgeContext
    };
}

function reconcile(input, manifest) {
    const proposal = input.classification_proposal;
    const matchers = manifest.semantic_matchers;
    const semanticContext = input.conversation_context
        ? `${input.conversation_context.text}\n${input.request}`
        : input.request;
    const detectedDomains = Object.entries(matchers.domains)
        .filter(([, terms]) => includesTerm(semanticContext, terms))
        .map(([domain]) => domain);
    const detectedSignals = Object.entries(matchers.signals)
        .filter(([, terms]) => includesTerm(semanticContext, terms))
        .map(([signal]) => signal);
    const safeGeneral = includesTerm(input.request, matchers.safe_general);
    const detectedAction = includesTerm(input.request, matchers.safety.external)
        ? 'external'
        : includesTerm(input.request, matchers.safety.write)
            ? 'write'
            : 'none';
    const minimumAction = indexFloor(ACTIONS, actionFloor(proposal.intent), detectedAction);
    const minimumRisk = includesTerm(input.request, matchers.safety.critical)
        ? 'critical'
        : minimumAction === 'external'
            ? 'high'
            : minimumAction === 'write'
                ? 'medium'
                : 'low';
    const reasons = [];

    if (proposal.confidence === 'unknown') reasons.push('classification_confidence_unknown');
    if (ACTIONS.indexOf(proposal.action_kind) < ACTIONS.indexOf(minimumAction)) reasons.push('action_below_server_floor');
    if (RISKS.indexOf(proposal.risk) < RISKS.indexOf(minimumRisk)) reasons.push('risk_below_server_floor');

    const proposedNonGeneral = proposal.domains.filter((domain) => domain !== 'general');
    for (const domain of detectedDomains) if (!proposedNonGeneral.includes(domain)) reasons.push('server_detected_domain_missing');
    for (const domain of proposedNonGeneral) if (!detectedDomains.includes(domain)) reasons.push('domain_supported_only_by_proposal');
    for (const signal of detectedSignals) if (!proposal.signals.includes(signal)) reasons.push('server_detected_signal_missing');
    for (const signal of proposal.signals) if (!detectedSignals.includes(signal)) reasons.push('signal_supported_only_by_proposal');

    if (proposal.domains.includes('general')) {
        if (!safeGeneral) reasons.push('general_not_server_supported');
        if (detectedDomains.length > 0 || detectedSignals.length > 0 || !['answer', 'review'].includes(proposal.intent) || ACTIONS.indexOf(minimumAction) > ACTIONS.indexOf('read')) {
            reasons.push('general_conflicts_with_request');
        }
    } else if (safeGeneral && detectedDomains.length === 0) {
        reasons.push('request_classification_conflict');
    }
    if ((detectedDomains.includes('knowledge') || proposal.domains.includes('knowledge')) && !input.knowledge_context) reasons.push('knowledge_context_missing');

    const uniqueReasons = [...new Set(reasons)];
    if (uniqueReasons.length > 0) {
        return { status: 'needs_classification', classification: null, assurance: 'unknown', reasons: uniqueReasons };
    }
    const domains = proposal.domains.includes('general')
        ? ['general']
        : sortByOrder(detectedDomains, manifest.selectors.domain_order);
    const signals = sortByOrder(detectedSignals, manifest.selectors.signal_order);
    return {
        status: 'resolved',
        classification: {
            intent: proposal.intent,
            domains,
            action_kind: indexFloor(ACTIONS, proposal.action_kind, minimumAction),
            risk: indexFloor(RISKS, proposal.risk, minimumRisk),
            confidence: proposal.confidence,
            signals
        },
        assurance: proposal.confidence === 'confirmed' ? 'verified' : 'bounded',
        reasons: []
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
    assertAcyclic(activeNodes, activeEdges);
    return { active_nodes: activeNodes, active_edges: activeEdges };
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

function assertAcyclic(nodes, edges) {
    const indegree = new Map(nodes.map((node) => [node, 0]));
    const outgoing = new Map(nodes.map((node) => [node, []]));
    for (const [from, to] of edges) {
        if (!indegree.has(from) || !indegree.has(to)) throw new TypeError('active judgment graph references a missing node');
        indegree.set(to, indegree.get(to) + 1);
        outgoing.get(from).push(to);
    }
    const queue = nodes.filter((node) => indegree.get(node) === 0);
    let consumed = 0;
    while (queue.length > 0) {
        const node = queue.shift();
        consumed += 1;
        for (const target of outgoing.get(node)) {
            indegree.set(target, indegree.get(target) - 1);
            if (indegree.get(target) === 0) queue.push(target);
        }
    }
    if (consumed !== nodes.length) throw new TypeError('active judgment graph contains a cycle');
}

function knowledgeCapabilities(input, classification) {
    if (!classification?.domains.includes('knowledge')) return [];
    return [{
        capability: 'knowledge.resolve',
        status: 'required',
        input: {
            intent: 'lookup',
            audience: input.knowledge_context.audience,
            content_type: input.knowledge_context.content_type,
            ...(input.project_code ? { project_code: input.project_code } : {})
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
        const reconciliation = reconcile(input, this.manifest);
        const wantsPersonal = input.classification_proposal.domains.includes('personal_judgment')
            || reconciliation.classification?.domains.includes('personal_judgment');
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
            runtime_version: this.manifest.runtime_version,
            manifest_digest: this.manifestDigest,
            host_binding: {
                adapter_id: hostBinding.adapter_id,
                adapter_version: hostBinding.adapter_version,
                status: 'managed',
                enforcement_level: 'host_contract'
            },
            project_code: input.project_code,
            classification_proposal: input.classification_proposal,
            classification: reconciliation.classification,
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
