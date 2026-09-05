// @ts-check
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PromotionGateService } from '../candidate-store/promotion-gate-service.js';
import { scan } from '../candidate-store/pii-scanner.js';

const SOURCE_MODES = new Set(['mcp', 'drive', 'gmail', 'local_folder', 'single_document']);
const OBSERVATION_CLASSES = new Set(['observed', 'inferred']);
const SUBJECT_TYPES = new Set([
    'person', 'org', 'customer', 'partner', 'contact', 'project', 'app', 'brand',
    'frame', 'decision', 'philosophy', 'glossary_term', 'story', 'raci_assignment'
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SECRET_KEY = /(?:^|_)(?:token|access_?token|refresh_?token|id_?token|oauth_?token|api_?key|private_?key|client_?secret|secret|password|credential|authorization|cookie)(?:$|_)/i;
const RAW_CONTENT_KEY = /^(?:raw(?:_body|_content|_text)?|body|content|document|message_body|answer)$/i;
const SECRET_VALUE = /(?:^|\s)Bearer\s+[A-Za-z0-9._~+/-]+=*|\bsk-[A-Za-z0-9_-]{16,}\b/;
const SECRET_ASSIGNMENT = /(?:^|[?&#;,\s])(?:access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|api[_-]?key|private[_-]?key|client[_-]?secret|secret|password|credential|authorization|cookie)(?:%[^=:\s&#;,]*)?\s*(?:=|:)\s*[^\s&#;,]+/i;
const URI_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*:[^@/?#\s]+@/i;
const SECRET_DECODE_LIMIT = 8;
const REVIEW_REASON_MAX_LENGTH = 500;
const RUN_LEDGER_SCHEMA_VERSION = 'onboarding_runs.v1';
const FIRST_VALUE_PRESENTATION_CONTRACT = Object.freeze({
    version: 'first_value_clarity.v1',
    sections: Object.freeze(['覚えていたこと', 'つながったこと', '次にできること']),
    initial_format: 'short_bullets',
    initial_table: false,
    separate_confirmed_and_unverified: true,
    technical_details: 'separate_on_request',
    value_evidence: 'human_review',
    cli_sample_counts_as_value: false
});
const PERMISSION_SNAPSHOT_KEYS = new Set([
    'visibility', 'collected_by', 'provider', 'connection_id', 'grant_id', 'account_id',
    'folder_id', 'project_code', 'role_min', 'sensitivity', 'scope', 'scopes', 'roles',
    'clearance', 'authorized_at', 'expires_at'
]);
const PERMISSION_SNAPSHOT_MAX_BYTES = 8192;
const WORKFLOW_STATES = [
    'initialized',
    'source_ready',
    'candidates_ready',
    'promotion_reviewed',
    'first_value_ready',
    'first_value_answer_reviewed'
];

export class OnboardingRuntimeError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.name = 'OnboardingRuntimeError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
        );
    }
    return value;
}

function retryIdentity(candidate) {
    const keys = [
        'id', 'cognitive_type', 'owner_person_id', 'actor_person_id', 'project_code',
        'org_ids', 'project_ids', 'visibility', 'sensitivity', 'role_min', 'agency_level',
        'recommended_subject_type', 'source_system', 'source_event_ids',
        'permission_snapshot', 'evidence_ids', 'body'
    ];
    return JSON.stringify(canonicalize(Object.fromEntries(keys.map((key) => [key, candidate[key]]))));
}

function sourceReceiptIdentity(receipt) {
    const keys = [
        'mode', 'source_id', 'evidence_ref', 'content_hash', 'permission_snapshot',
        'collection_status'
    ];
    return JSON.stringify(canonicalize(Object.fromEntries(keys.map((key) => [key, receipt[key]]))));
}

export class InMemoryOnboardingRunRepository {
    constructor() {
        this.runs = new Map();
    }

    async create(run) {
        if (this.runs.has(run.id)) throw new Error(`onboarding run already exists: ${run.id}`);
        this.runs.set(run.id, clone(run));
        return clone(run);
    }

    async findById(id) {
        return clone(this.runs.get(id) || null);
    }

    async update(id, updater) {
        const current = this.runs.get(id);
        if (!current) return null;
        const next = await updater(clone(current));
        this.runs.set(id, clone(next));
        return clone(next);
    }
}

export class JsonFileOnboardingRunRepository extends InMemoryOnboardingRunRepository {
    constructor({ filePath }) {
        super();
        this.filePath = filePath;
        this.loaded = false;
        this.loadPromise = null;
        this.writeQueue = Promise.resolve();
        this.mutationQueue = Promise.resolve();
    }

    async _load() {
        if (this.loaded) return;
        if (!this.loadPromise) {
            this.loadPromise = (async () => {
                try {
                    const parsed = JSON.parse(await this._readLedger());
                    if (parsed?.schema_version !== RUN_LEDGER_SCHEMA_VERSION) {
                        throw new OnboardingRuntimeError(
                            'onboarding_ledger_schema_unsupported',
                            `unsupported onboarding run ledger schema: ${parsed?.schema_version || 'missing'}`,
                            503
                        );
                    }
                    for (const run of Array.isArray(parsed.runs) ? parsed.runs : []) this.runs.set(run.id, run);
                } catch (error) {
                    if (error?.code !== 'ENOENT') throw error;
                }
                this.loaded = true;
            })();
        }
        try {
            await this.loadPromise;
        } catch (error) {
            this.loadPromise = null;
            throw error;
        }
    }

    async _readLedger() {
        return fs.readFile(this.filePath, 'utf8');
    }

    async _persist(runs = this.runs) {
        const snapshot = JSON.stringify({ schema_version: RUN_LEDGER_SCHEMA_VERSION, runs: [...runs.values()] }, null, 2);
        const pending = this.writeQueue.catch(() => {}).then(async () => {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
            try {
                await fs.writeFile(tempPath, snapshot, { mode: 0o600 });
                await fs.rename(tempPath, this.filePath);
            } catch (error) {
                await fs.unlink(tempPath).catch(() => {});
                throw error;
            }
        });
        this.writeQueue = pending.catch(() => {});
        return pending;
    }

    async create(run) {
        return this._mutate(async () => {
            await this._load();
            if (this.runs.has(run.id)) throw new Error(`onboarding run already exists: ${run.id}`);
            const nextRuns = new Map(this.runs);
            nextRuns.set(run.id, clone(run));
            await this._persist(nextRuns);
            this.runs = nextRuns;
            return clone(run);
        });
    }

    async findById(id) {
        await this._load();
        await this.mutationQueue;
        return super.findById(id);
    }

    async update(id, updater) {
        return this._mutate(async () => {
            await this._load();
            const current = this.runs.get(id);
            if (!current) return null;
            const updated = await updater(clone(current));
            const nextRuns = new Map(this.runs);
            nextRuns.set(id, clone(updated));
            await this._persist(nextRuns);
            this.runs = nextRuns;
            return clone(updated);
        });
    }

    async _mutate(operation) {
        const pending = this.mutationQueue.then(operation);
        this.mutationQueue = pending.catch(() => {});
        return pending;
    }
}

function iso(now) {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
}

function requireString(value, field, max) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
        throw new OnboardingRuntimeError('input_invalid', `${field} must be 1..${max} characters`);
    }
    return value.trim();
}

function decodeSecretInspectionPass(value) {
    return value
        .replaceAll('+', ' ')
        .replace(/%([0-9a-f]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        .trim();
}

function assertNoSecretOrRaw(value, trail = []) {
    if (typeof value === 'string') {
        let candidate = value.trim();
        for (let pass = 0; pass < SECRET_DECODE_LIMIT; pass += 1) {
            if (SECRET_VALUE.test(candidate) || SECRET_ASSIGNMENT.test(candidate) || URI_USERINFO.test(candidate)) {
                throw new OnboardingRuntimeError('secret_or_raw_content_rejected', `secret-like value rejected at ${trail.join('.')}`, 400);
            }
            const decoded = decodeSecretInspectionPass(candidate);
            if (decoded === candidate) return;
            candidate = decoded;
        }
        throw new OnboardingRuntimeError('secret_or_raw_content_rejected', `over-encoded value rejected at ${trail.join('.')}`, 400);
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoSecretOrRaw(item, [...trail, String(index)]));
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (SECRET_KEY.test(key) || RAW_CONTENT_KEY.test(key)) {
            throw new OnboardingRuntimeError('secret_or_raw_content_rejected', `forbidden field rejected at ${[...trail, key].join('.')}`, 400);
        }
        assertNoSecretOrRaw(child, [...trail, key]);
    }
}

function validatePermissionSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new OnboardingRuntimeError('input_invalid', 'permission_snapshot is required');
    }
    assertNoSecretOrRaw(value, ['permission_snapshot']);
    const keys = Object.keys(value);
    const forbidden = keys.find((key) => !PERMISSION_SNAPSHOT_KEYS.has(key));
    if (forbidden) {
        throw new OnboardingRuntimeError(
            'permission_snapshot_invalid',
            `permission_snapshot field is not allowed: ${forbidden}`,
            400
        );
    }
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > PERMISSION_SNAPSHOT_MAX_BYTES) {
        throw new OnboardingRuntimeError('permission_snapshot_invalid', 'permission_snapshot is too large', 400);
    }
    for (const [key, child] of Object.entries(value)) {
        const validScalar = typeof child === 'string' || typeof child === 'boolean' || typeof child === 'number' || child === null;
        const validArray = Array.isArray(child)
            && child.length <= 50
            && child.every((item) => typeof item === 'string' && item.length <= 500);
        if (!validScalar && !validArray) {
            throw new OnboardingRuntimeError(
                'permission_snapshot_invalid',
                `permission_snapshot.${key} must be a scalar or bounded string array`,
                400
            );
        }
        if (typeof child === 'string' && child.length > 1000) {
            throw new OnboardingRuntimeError('permission_snapshot_invalid', `permission_snapshot.${key} is too long`, 400);
        }
    }
    return clone(value);
}

function candidateIdFor(runId, sourceId, evidenceId) {
    const digest = crypto.createHash('sha256').update(`${runId}\0${sourceId}\0${evidenceId}`).digest('hex');
    return `onb_cand_${digest.slice(0, 32)}`;
}

function sourceEventPrefixFor(runId, sourceId) {
    const sourceDigest = crypto.createHash('sha256').update(sourceId).digest('hex');
    return `${runId}:source_sha256:${sourceDigest}:`;
}

function sourceEventIdFor(runId, sourceId, evidenceId) {
    return `${sourceEventPrefixFor(runId, sourceId)}${evidenceId}`;
}

function actorContext(actor) {
    const personId = actor?.personId || actor?.person_id || actor?.sub;
    const projectCodes = Array.isArray(actor?.projectCodes) ? actor.projectCodes : [];
    if (!personId) throw new OnboardingRuntimeError('actor_context_missing', 'authenticated person is required', 401);
    return { personId, projectCodes, role: actor?.role || 'member', access: actor?.access || actor };
}

function assertProject(actor, projectCode) {
    const context = actorContext(actor);
    if (!context.projectCodes.includes(projectCode)) {
        throw new OnboardingRuntimeError('project_scope_denied', `project '${projectCode}' is outside authenticated scope`, 403);
    }
    return context;
}

function organizationIdForContext(context) {
    const access = context?.access || {};
    return access.organizationId || access.organization_id || access.tenantId || null;
}

function assertHumanActor(actor) {
    if (actor?.authSource === 'internal' || actor?.authSource === 'service-token') {
        throw new OnboardingRuntimeError(
            'human_review_required',
            'candidate approval and first-value review require an authenticated human actor',
            403
        );
    }
}

function candidateProjection(candidate, item) {
    let review = {};
    try {
        const parsed = JSON.parse(candidate.body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) review = parsed;
    } catch {
        // A malformed legacy candidate stays reviewable by metadata without exposing its body.
    }
    return {
        id: candidate.id,
        promotion_status: candidate.promotion_status,
        promoted_graph_entity_id: candidate.promoted_graph_entity_id || null,
        redaction_status: candidate.redaction_status,
        redaction_required: candidate.redaction_status === 'needs_redaction',
        observation_class: item.observation_class,
        subject_type: item.subject_type,
        evidence_ids: item.evidence_ids,
        fact: candidate.redaction_status === 'needs_redaction'
            ? null
            : typeof review.fact === 'string' ? review.fact : null,
        evidence_ref: typeof review.evidence_ref === 'string' ? review.evidence_ref : null
    };
}

function assertRunStatus(run, allowed, operation) {
    if (!allowed.includes(run.status)) {
        throw new OnboardingRuntimeError(
            'onboarding_state_conflict',
            `${operation} is not allowed while run status is '${run.status}'`,
            409
        );
    }
}

function advanceWorkflowState(current, target) {
    const currentIndex = WORKFLOW_STATES.indexOf(current);
    const targetIndex = WORKFLOW_STATES.indexOf(target);
    return currentIndex >= targetIndex ? current : target;
}

export class OnboardingRuntimeService {
    constructor({ repository, candidateRepository, infoSSOTService, now = () => new Date(), idFactory = () => `onb_${crypto.randomUUID()}` }) {
        if (!repository || !candidateRepository || !infoSSOTService) throw new Error('onboarding runtime dependencies are required');
        this.repository = repository;
        this.candidateRepository = candidateRepository;
        this.infoSSOTService = infoSSOTService;
        this.now = now;
        this.idFactory = idFactory;
        this.ingestQueues = new Map();
    }

    async _withCandidateAccess(context, work) {
        const organizationId = organizationIdForContext(context);
        if (typeof this.candidateRepository.transaction !== 'function') {
            return work(this.candidateRepository);
        }
        if (!organizationId) {
            throw new OnboardingRuntimeError(
                'onboarding_organization_context_required',
                'authenticated organization is required for candidate access',
                403
            );
        }
        const access = {
            ...(context.access || {}),
            personId: context.personId,
            organizationId,
            projectCodes: context.projectCodes,
            role: context.role || context.access?.role || 'member'
        };
        return this.candidateRepository.transaction(work, { access });
    }

    async _scopedRun(actor, runId) {
        const run = await this.repository.findById(runId);
        if (!run) throw new OnboardingRuntimeError('onboarding_run_not_found', `run not found: ${runId}`, 404);
        const context = assertProject(actor, run.project_code);
        if (context.personId !== run.owner_person_id) {
            throw new OnboardingRuntimeError('onboarding_owner_denied', 'onboarding run is visible only to its owner', 403);
        }
        return run;
    }

    async _project(run, candidateRepository = this.candidateRepository) {
        const items = await Promise.all(run.candidate_items.map(async (item) => {
            const candidate = await candidateRepository.findById(item.candidate_id);
            return candidate ? candidateProjection(candidate, item) : { ...item, unavailable: true };
        }));
        return { ...run, candidates: items, candidate_items: undefined };
    }

    async startRun(actor, input) {
        assertNoSecretOrRaw(input);
        const projectCode = requireString(input?.project_code, 'project_code', 200);
        const context = assertProject(actor, projectCode);
        const valueTarget = requireString(input?.value_target, 'value_target', 500);
        if (!SOURCE_MODES.has(input?.source_mode)) throw new OnboardingRuntimeError('input_invalid', 'unsupported source_mode');
        const startedAt = iso(this.now);
        return this.repository.create({
            id: this.idFactory(),
            project_code: projectCode,
            owner_person_id: context.personId,
            value_target: valueTarget,
            source_mode: input.source_mode,
            status: 'collecting',
            workflow_state: 'initialized',
            started_at: startedAt,
            updated_at: startedAt,
            source_ready_at: null,
            sources: [],
            candidate_items: [],
            promoted_graph_entity_ids: [],
            first_value_presentation_contract: clone(FIRST_VALUE_PRESENTATION_CONTRACT),
            first_value_receipt: null,
            first_value_review: null
        });
    }

    async getRun(actor, runId) {
        const run = await this._scopedRun(actor, runId);
        const context = assertProject(actor, run.project_code);
        return this._withCandidateAccess(context, (candidateRepository) => this._project(run, candidateRepository));
    }

    async ingestSource(actor, runId, input) {
        // Use the same normalized identity as the durable receipt. Otherwise inputs that
        // differ only by surrounding whitespace can bypass the per-source queue and race.
        const sourceId = typeof input?.source?.source_id === 'string' ? input.source.source_id.trim() : '';
        const lockKey = `${runId}\0${sourceId}`;
        const previous = this.ingestQueues.get(lockKey) || Promise.resolve();
        const pending = previous.catch(() => {}).then(() => this._ingestSource(actor, runId, input));
        this.ingestQueues.set(lockKey, pending);
        try {
            return await pending;
        } finally {
            if (this.ingestQueues.get(lockKey) === pending) this.ingestQueues.delete(lockKey);
        }
    }

    async _ingestSource(actor, runId, input) {
        assertNoSecretOrRaw(input);
        const run = await this._scopedRun(actor, runId);
        assertRunStatus(run, ['collecting', 'reviewing'], 'source ingestion');
        const context = assertProject(actor, run.project_code);
        const source = input?.source || {};
        if (source.mode !== run.source_mode || !SOURCE_MODES.has(source.mode)) {
            throw new OnboardingRuntimeError('source_mode_mismatch', 'source mode does not match the run');
        }
        if (source.collection_status !== 'collected') {
            throw new OnboardingRuntimeError('source_collection_unavailable', 'source was not collected', 424);
        }
        const receipt = {
            mode: source.mode,
            source_id: requireString(source.source_id, 'source.source_id', 1000),
            evidence_ref: requireString(source.evidence_ref, 'source.evidence_ref', 1000),
            content_hash: requireString(source.content_hash, 'source.content_hash', 80),
            permission_snapshot: validatePermissionSnapshot(source.permission_snapshot),
            collection_status: source.collection_status,
            collected_at: iso(this.now)
        };
        if (!SHA256.test(receipt.content_hash)) throw new OnboardingRuntimeError('input_invalid', 'content_hash must be sha256:<hex>');
        const existingReceipt = run.sources.find((item) => item.source_id === receipt.source_id);
        if (existingReceipt && sourceReceiptIdentity(existingReceipt) !== sourceReceiptIdentity(receipt)) {
            throw new OnboardingRuntimeError(
                'source_receipt_conflict',
                'source_id already belongs to a different receipt version',
                409
            );
        }
        // A candidate can be durable even when the subsequent run-ledger update fails. Consult
        // that durable surface by source_id as well, so rotating evidence_id cannot bypass the
        // receipt-version guard and leave two candidate versions behind.
        const organizationId = organizationIdForContext(context);
        const inputCandidates = Array.isArray(input.candidates) ? input.candidates : [];
        const preparedDrafts = inputCandidates.map((draft, index) => {
            if (!OBSERVATION_CLASSES.has(draft.observation_class)) throw new OnboardingRuntimeError('input_invalid', 'unsupported observation_class');
            if (!SUBJECT_TYPES.has(draft.subject_type)) throw new OnboardingRuntimeError('input_invalid', 'unsupported subject_type');
            const fact = requireString(draft.fact, `candidates.${index}.fact`, 2000);
            const evidenceId = requireString(draft.evidence_id, `candidates.${index}.evidence_id`, 1000);
            const body = JSON.stringify({
                fact,
                observation_class: draft.observation_class,
                source_id: receipt.source_id,
                content_hash: receipt.content_hash,
                evidence_ref: receipt.evidence_ref
            });
            if (scan(body).block) {
                throw new OnboardingRuntimeError('candidate_content_blocked', 'candidate was blocked by PII scan', 422);
            }
            return {
                item: {
                    candidate_id: candidateIdFor(run.id, receipt.source_id, evidenceId),
                    observation_class: draft.observation_class,
                    subject_type: draft.subject_type,
                    evidence_ids: [evidenceId]
                },
                candidate: {
                    id: candidateIdFor(run.id, receipt.source_id, evidenceId),
                    cognitive_type: draft.observation_class === 'observed' ? 'observation' : 'hypothesis',
                    owner_person_id: run.owner_person_id,
                    actor_person_id: context.personId,
                    project_code: run.project_code,
                    organization_id: organizationId,
                    org_ids: organizationId ? [organizationId] : [],
                    project_ids: [run.project_code],
                    visibility: 'owner',
                    sensitivity: 'internal',
                    role_min: 'member',
                    agency_level: 'synthesize',
                    recommended_subject_type: draft.subject_type,
                    source_system: `onboarding:${source.mode}`,
                    source_event_ids: [sourceEventIdFor(run.id, receipt.source_id, evidenceId)],
                    permission_snapshot: receipt.permission_snapshot,
                    evidence_ids: [evidenceId],
                    body
                }
            };
        });
        if (new Set(preparedDrafts.map(({ item }) => item.candidate_id)).size !== preparedDrafts.length) {
            throw new OnboardingRuntimeError('input_invalid', 'candidate evidence_id values must be unique within a source batch');
        }

        // Resolve every existing deterministic id before writing anything. This makes a retry
        // recover candidates created before a repository/run-ledger failure, while rejecting a
        // changed payload instead of silently reusing an unrelated candidate.
        const createdItems = await this._withCandidateAccess(context, async (candidateRepository) => {
            const durableCandidates = await candidateRepository.list({
                owner_person_id: run.owner_person_id,
                source_system: `onboarding:${source.mode}`,
                source_event_prefix: sourceEventPrefixFor(run.id, receipt.source_id)
            });
            for (const candidate of durableCandidates) {
                let durableReceipt;
                try {
                    const body = JSON.parse(candidate.body);
                    durableReceipt = {
                        mode: source.mode,
                        source_id: body.source_id,
                        evidence_ref: body.evidence_ref,
                        content_hash: body.content_hash,
                        permission_snapshot: candidate.permission_snapshot,
                        collection_status: 'collected'
                    };
                } catch {
                    throw new OnboardingRuntimeError(
                        'source_receipt_conflict',
                        'source_id has an unreadable durable receipt',
                        409
                    );
                }
                if (sourceReceiptIdentity(durableReceipt) !== sourceReceiptIdentity(receipt)) {
                    throw new OnboardingRuntimeError(
                        'source_receipt_conflict',
                        'source_id already belongs to a different durable receipt version',
                        409
                    );
                }
            }

            const existingCandidates = await Promise.all(
                preparedDrafts.map(({ item }) => candidateRepository.findById(item.candidate_id))
            );
            for (let index = 0; index < preparedDrafts.length; index += 1) {
                const existing = existingCandidates[index];
                if (!existing) continue;
                const expected = preparedDrafts[index].candidate;
                if (retryIdentity(existing) !== retryIdentity(expected)) {
                    throw new OnboardingRuntimeError('candidate_retry_conflict', 'existing candidate does not match retry payload', 409);
                }
            }

            const gate = new PromotionGateService({ repository: candidateRepository });
            const createdItems = [];
            for (let index = 0; index < preparedDrafts.length; index += 1) {
                const prepared = preparedDrafts[index];
                let candidate = existingCandidates[index];
                if (!candidate) {
                    const created = await gate.createCandidate(prepared.candidate);
                    if (created.blocked || !created.candidate) {
                        throw new OnboardingRuntimeError('candidate_content_blocked', 'candidate was blocked by PII scan', 422);
                    }
                    candidate = created.candidate;
                }
                if (candidate.promotion_status === 'candidate') {
                    candidate = await gate.requestApproval(candidate.id, { actor_person_id: context.personId });
                }
                createdItems.push(prepared.item);
            }
            return createdItems;
        });

        const updated = await this.repository.update(run.id, (current) => ({
            ...current,
            status: 'reviewing',
            workflow_state: advanceWorkflowState(
                current.workflow_state || 'initialized',
                createdItems.length > 0 ? 'candidates_ready' : 'source_ready'
            ),
            source_ready_at: current.source_ready_at || receipt.collected_at,
            updated_at: receipt.collected_at,
            sources: current.sources.some((item) => item.source_id === receipt.source_id)
                ? current.sources
                : [...current.sources, receipt],
            candidate_items: [
                ...current.candidate_items,
                ...createdItems.filter((item) => !current.candidate_items.some((existing) => existing.candidate_id === item.candidate_id))
            ]
        }));
        return this._withCandidateAccess(context, (candidateRepository) => this._project(updated, candidateRepository));
    }

    async reviewCandidate(actor, runId, candidateId, input) {
        assertNoSecretOrRaw(input);
        const decision = input?.decision;
        if (!['approve', 'reject'].includes(decision)) {
            throw new OnboardingRuntimeError('input_invalid', 'decision must be approve or reject');
        }
        const reason = input?.reason === undefined
            ? (decision === 'reject' ? 'rejected' : 'onboarding evidence confirmed')
            : requireString(input.reason, 'reason', REVIEW_REASON_MAX_LENGTH);
        const run = await this._scopedRun(actor, runId);
        assertHumanActor(actor);
        assertRunStatus(run, ['reviewing', 'answering'], 'candidate review');
        const context = assertProject(actor, run.project_code);
        const item = run.candidate_items.find((candidate) => candidate.candidate_id === candidateId);
        if (!item) throw new OnboardingRuntimeError('candidate_not_in_run', 'candidate does not belong to this run', 404);
        const result = await this._withCandidateAccess(context, async (candidateRepository) => {
            const gate = new PromotionGateService({
                repository: candidateRepository,
                graphWriter: {
                    createEntity: async (entity, metadata) => {
                        const body = JSON.parse(entity.payload.body);
                        const source = run.sources.find((receipt) => receipt.source_id === body.source_id);
                        if (!source) {
                            throw new OnboardingRuntimeError('source_receipt_missing', 'candidate source receipt is unavailable', 409);
                        }
                        const id = `onb_${metadata.derived_from_candidate_id}`;
                        const graphResult = await this.infoSSOTService.createOrUpdateGraphEntity(context.access, {
                            id,
                            entityType: entity.type,
                            projectCode: run.project_code,
                            projectName: run.project_code,
                            payload: {
                                ...body,
                                derived_from_candidate_id: metadata.derived_from_candidate_id,
                                source_system: `onboarding:${source.mode}`,
                                source_event_ids: item.evidence_ids.map((evidenceId) => sourceEventIdFor(run.id, source.source_id, evidenceId)),
                                evidence_ids: item.evidence_ids,
                                permission_snapshot: source.permission_snapshot,
                                promoted_at: iso(this.now)
                            },
                            roleMin: entity.role_min || 'member',
                            sensitivity: entity.sensitivity || 'internal'
                        });
                        return { id: graphResult.entity_id };
                    }
                }
            });

            if (decision === 'reject') {
                return {
                    candidate: await gate.rejectCandidate(candidateId, { actor_person_id: context.personId }, reason),
                    graphEntity: null
                };
            }
            if (item.observation_class === 'inferred') {
                throw new OnboardingRuntimeError('inferred_candidate_not_promotable', 'inferred candidate cannot be promoted', 409);
            }
            return gate.approveCandidate(candidateId, { actor_person_id: context.personId }, {
                targetSubjectType: item.subject_type,
                reason,
                resumeApproved: true
            });
        });

        if (decision === 'reject') {
            await this.repository.update(run.id, (current) => ({
                ...current,
                workflow_state: advanceWorkflowState(current.workflow_state || 'initialized', 'promotion_reviewed'),
                updated_at: iso(this.now)
            }));
            return { candidate: candidateProjection(result.candidate, item), graph_entity_id: null };
        }
        const graphEntityId = result.graphEntity?.id;
        if (!graphEntityId) throw new OnboardingRuntimeError('graph_write_unavailable', 'Graph promotion did not return an entity id', 503);
        await this.repository.update(run.id, (current) => ({
            ...current,
            status: 'answering',
            workflow_state: advanceWorkflowState(current.workflow_state || 'initialized', 'promotion_reviewed'),
            updated_at: iso(this.now),
            promoted_graph_entity_ids: [...new Set([...current.promoted_graph_entity_ids, graphEntityId])]
        }));
        return { candidate: candidateProjection(result.candidate, item), graph_entity_id: graphEntityId };
    }

    async recordFirstValue(actor, runId, input) {
        assertNoSecretOrRaw(input);
        const run = await this._scopedRun(actor, runId);
        assertRunStatus(run, ['answering'], 'first-value recording');
        const hash = requireString(input?.answer_hash, 'answer_hash', 80);
        if (!SHA256.test(hash)) throw new OnboardingRuntimeError('input_invalid', 'answer_hash must be sha256:<hex>');
        const usedIds = Array.isArray(input?.used_graph_entity_ids) ? input.used_graph_entity_ids : [];
        if (usedIds.some((id) => !run.promoted_graph_entity_ids.includes(id))) {
            throw new OnboardingRuntimeError('unpromoted_graph_reference', 'answer references an entity not promoted by this run', 409);
        }
        if (usedIds.length === 0) throw new OnboardingRuntimeError('input_invalid', 'used_graph_entity_ids must not be empty');
        const presentedSections = Array.isArray(input?.presented_sections) ? input.presented_sections : [];
        if (
            input?.presentation_contract_version !== FIRST_VALUE_PRESENTATION_CONTRACT.version
            || presentedSections.length !== FIRST_VALUE_PRESENTATION_CONTRACT.sections.length
            || presentedSections.some((section, index) => section !== FIRST_VALUE_PRESENTATION_CONTRACT.sections[index])
        ) {
            throw new OnboardingRuntimeError(
                'first_value_presentation_invalid',
                'first-value answer must use the active presentation contract',
                409
            );
        }
        const generatedAt = iso(this.now);
        return this.repository.update(run.id, (current) => ({
            ...current,
            status: 'answering',
            workflow_state: advanceWorkflowState(current.workflow_state || 'initialized', 'first_value_ready'),
            updated_at: generatedAt,
            first_value_receipt: {
                answer_hash: hash,
                used_graph_entity_ids: [...new Set(usedIds)],
                presentation_contract_version: FIRST_VALUE_PRESENTATION_CONTRACT.version,
                presented_sections: [...FIRST_VALUE_PRESENTATION_CONTRACT.sections],
                missing_context: Array.isArray(input.missing_context)
                    ? input.missing_context.slice(0, 50).map((value, index) => requireString(value, `missing_context.${index}`, 200))
                    : [],
                generated_at: generatedAt
            }
        }));
    }

    async reviewFirstValue(actor, runId, input) {
        const run = await this._scopedRun(actor, runId);
        assertHumanActor(actor);
        assertRunStatus(run, ['answering'], 'first-value review');
        if (!run.first_value_receipt || !run.source_ready_at) {
            throw new OnboardingRuntimeError('first_value_not_ready', 'first-value receipt is not ready', 409);
        }
        if (!['useful', 'not_useful'].includes(input?.verdict)) throw new OnboardingRuntimeError('input_invalid', 'verdict must be useful or not_useful');
        const reviewedAt = iso(this.now);
        const elapsedMs = new Date(reviewedAt).getTime() - new Date(run.source_ready_at).getTime();
        return this.repository.update(run.id, (current) => ({
            ...current,
            status: 'first_value_answer_reviewed',
            workflow_state: 'first_value_answer_reviewed',
            updated_at: reviewedAt,
            first_value_review: {
                verdict: input.verdict,
                reviewed_at: reviewedAt,
                elapsed_ms: elapsedMs,
                within_ten_minutes: elapsedMs <= 600000
            }
        }));
    }
}
