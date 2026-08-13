import crypto from 'crypto';

import { principalNamespace } from './canonical-task-principal.js';

const STATUSES = new Set(['pending', 'in_progress', 'waiting', 'completed']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function normalizeProjectCodes(value) {
    const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return [...new Set(values.flatMap((item) => String(item).split(','))
        .map((item) => item.trim()).filter(Boolean))];
}

function hasInvalidProjectCode(value) {
    const values = Array.isArray(value) ? value : (value == null ? [] : [value]);
    return values.some((item) => typeof item !== 'string'
        || item.split(',').some((code) => !code.trim() || code.trim().length > 100));
}
const TRANSITIONS = Object.freeze({
    pending: new Set(['in_progress', 'waiting', 'completed']),
    in_progress: new Set(['waiting', 'completed']),
    waiting: new Set(['in_progress', 'completed']),
    completed: new Set()
});

function splitCsv(value) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
}

function fingerprint(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function iso(value, fieldErrors, field) {
    if (value == null || value === '') return value == null ? null : value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        fieldErrors[field] = ['invalid_iso8601'];
        return value;
    }
    return date.toISOString();
}

export class CanonicalTaskError extends Error {
    constructor(code, message, status, details = {}) {
        super(message);
        this.name = 'CanonicalTaskError';
        this.code = code;
        this.status = status;
        this.details = details;
        this.fieldErrors = details.fieldErrors;
        this.currentTask = details.currentTask;
    }
}

function validationError(fieldErrors) {
    return new CanonicalTaskError('validation_failed', 'Canonical Task request is invalid', 422, { fieldErrors });
}

function optionalTrimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeWorkflowCandidate(rawCandidate, outputId, index) {
    const candidate = rawCandidate && typeof rawCandidate === 'object'
        ? rawCandidate
        : { title: typeof rawCandidate === 'string' ? rawCandidate : '' };
    const title = optionalTrimmed(candidate.title) || '';
    const contentFingerprint = fingerprint({
        title,
        description: candidate.description ?? null,
        priority: candidate.priority || 'medium',
        assignee_person_id: candidate.assignee_person_id || candidate.selected_owner_id || null,
        due_at: candidate.due_at || null,
        source_excerpt: candidate.source_excerpt || null,
        evidence_refs: Array.isArray(candidate.evidence_refs) ? candidate.evidence_refs : []
    });
    const candidateId = optionalTrimmed(candidate.candidate_id)
        || optionalTrimmed(candidate.id)
        || `task_candidate_${contentFingerprint.slice(0, 24)}`;
    return {
        raw: candidate,
        index,
        candidateId,
        contentFingerprint,
        aliases: new Set([
            candidateId,
            optionalTrimmed(candidate.candidate_id),
            optionalTrimmed(candidate.id),
            `${outputId}_item_${index + 1}`
        ].filter(Boolean))
    };
}

function workflowActorContext(actor = {}) {
    const actorId = actor.person_id || actor.sub || 'workflow';
    return {
        principal: { type: 'service', id: 'workflow-task-materializer' },
        authSource: 'service-internal',
        auditPrincipal: actor.person_id
            ? { type: 'person', id: actor.person_id }
            : { type: 'service', id: actor.sub || 'workflow' },
        auditAuthSource: actor.authSource || 'workflow-human-step',
        access: {
            role: actor.role || 'member',
            projectCodes: Array.isArray(actor.projectCodes) ? actor.projectCodes : [],
            clearance: Array.isArray(actor.clearance) ? actor.clearance : ['internal'],
            personId: actorId
        }
    };
}

export class CanonicalTaskService {
    constructor({
        repository,
        infoSSOTService,
        readiness,
        operationRepository,
        auditRepository = null,
        ownerPersonId,
        ownerAliasIds = splitCsv(process.env.BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS),
        webBaseUrl = process.env.BRAINBASE_PUBLIC_URL || process.env.BRAINBASE_BASE_URL || 'http://localhost:31013',
        clock = () => new Date()
    } = {}) {
        if (!repository) throw new Error('Canonical Task repository is required');
        this.repository = repository;
        this.infoSSOTService = infoSSOTService;
        this.readiness = readiness;
        this.operationRepository = operationRepository;
        this.auditRepository = auditRepository;
        this.ownerPersonId = ownerPersonId;
        this.ownerPersonIds = new Set([ownerPersonId, ...splitCsv(ownerAliasIds)].filter(Boolean));
        this.webBaseUrl = webBaseUrl;
        this.clock = clock;
    }

    async upsertMutationAudit({ action, task, taskId, context, operationKey, operationFingerprint, changes, sourceRefs = [] }) {
        if (!this.auditRepository || typeof this.auditRepository.upsertAuditLog !== 'function') {
            throw new CanonicalTaskError('task_audit_unavailable', 'Canonical Task audit log is unavailable', 503);
        }
        const actor = context.auditPrincipal || context.principal;
        const authSource = context.auditAuthSource || context.authSource || null;
        const id = `canonical-task:${fingerprint({ action, operationKey, operationFingerprint })}`;
        try {
            return await this.auditRepository.upsertAuditLog({
                id,
                workspace_id: 'personal',
                project_id: 'brainbase',
                actor_id: actor.id,
                actor_type: actor.type,
                actor_principal: actor,
                actor_namespace: principalNamespace(actor),
                auth_source: authSource,
                action,
                target_type: 'canonical_task',
                target_id: taskId || task?.id,
                changes,
                source_refs: sourceRefs
            });
        } catch (error) {
            if (error instanceof CanonicalTaskError) throw error;
            throw new CanonicalTaskError(
                'task_audit_unavailable',
                'Canonical Task audit log is unavailable',
                503,
                { cause: error?.message }
            );
        }
    }

    isOwner(context) {
        return context?.principal?.type === 'person' && context.principal.id === this.ownerPersonId;
    }

    normalizeOwnerContext(context = {}) {
        const isWorkflowInternal = context?.authSource === 'service-internal';
        const projectCodes = Array.isArray(context?.access?.projectCodes) ? context.access.projectCodes : [];
        const clearance = Array.isArray(context?.access?.clearance) ? context.access.clearance : [];
        if (!isWorkflowInternal && (!projectCodes.includes('brainbase') || !clearance.includes('internal'))) {
            throw new CanonicalTaskError(
                'canonical_task_scope_required',
                'Canonical Task API requires brainbase project scope and internal clearance',
                403
            );
        }
        if (context?.principal?.type !== 'person') return context;
        if (!this.ownerPersonIds.has(context.principal.id)) {
            throw new CanonicalTaskError(
                'personal_kg_owner_required',
                'Canonical Task API requires the configured Personal KG owner',
                403
            );
        }
        return {
            ...context,
            principal: { ...context.principal, id: this.ownerPersonId },
            access: context.access ? { ...context.access, personId: this.ownerPersonId } : context.access
        };
    }

    normalizeTaskResponse(task) {
        if (!task) return null;
        let webUrl = task.web_url;
        try {
            const parsed = new URL(webUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
            webUrl = parsed.toString();
        } catch {
            webUrl = new URL(
                `/api/companion/tasks/${encodeURIComponent(task.id)}`,
                this.webBaseUrl
            ).toString();
        }
        const normalized = {
            ...task,
            completed_at: task.completed_at ?? null,
            web_url: webUrl
        };
        for (const key of ['_payload_fingerprint', '_last_operation_key', '_last_operation_fingerprint']) {
            delete normalized[key];
            if (task[key] !== undefined) {
                Object.defineProperty(normalized, key, { value: task[key], enumerable: false });
            }
        }
        return normalized;
    }

    assertOwnerTask(task, context) {
        const normalized = this.normalizeTaskResponse(task);
        if (!normalized || (this.isOwner(context) && normalized.assignee_person_id !== this.ownerPersonId)) {
            throw new CanonicalTaskError('task_not_found', 'Task not found', 404);
        }
        return normalized;
    }

    async recoverCreatedTask({ operationKey, payloadFingerprint, context, conflictMessage }) {
        const existing = await this.read(() => this.repository.findByIdempotencyKey(operationKey));
        if (!existing) return { recovered: false };
        if (existing._payload_fingerprint && existing._payload_fingerprint !== payloadFingerprint) {
            throw new CanonicalTaskError(
                'idempotency_conflict',
                conflictMessage,
                409
            );
        }
        return {
            recovered: true,
            result: this.assertOwnerTask(existing, context)
        };
    }

    async read(operation) {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof CanonicalTaskError || error?.code === 'validation_failed' || error?.code === 'task_not_found') throw error;
            throw new CanonicalTaskError('task_store_unavailable', 'Canonical Task store is unavailable', 503, { cause: error?.message });
        }
    }

    validateQuery(query = {}, context) {
        const errors = {};
        const statuses = Array.isArray(query.status) ? query.status : (query.status ? [query.status] : []);
        const priorities = Array.isArray(query.priority) ? query.priority : (query.priority ? [query.priority] : []);
        const projectCodes = normalizeProjectCodes(query.project_code);
        if (statuses.some((value) => !STATUSES.has(value))) errors.status = ['invalid_status'];
        if (priorities.some((value) => !PRIORITIES.has(value))) errors.priority = ['invalid_priority'];
        if (hasInvalidProjectCode(query.project_code)) errors.project_code = ['invalid_project_code'];
        const limit = query.limit == null ? 50 : Number(query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) errors.limit = ['must_be_between_1_and_50'];
        const dueAfter = iso(query.due_after, errors, 'due_after');
        const dueBefore = iso(query.due_before, errors, 'due_before');
        if (dueAfter && dueBefore && dueAfter > dueBefore) errors.due_after = ['must_not_be_after_due_before'];
        let assigneePersonId = query.assignee_person_id;
        if (this.isOwner(context)) {
            if (assigneePersonId && assigneePersonId !== this.ownerPersonId) errors.assignee_person_id = ['owner_scope_required'];
            assigneePersonId = this.ownerPersonId;
        }
        if (Object.keys(errors).length) throw validationError(errors);
        return { statuses, priorities, projectCodes, limit, cursor: query.cursor, dueAfter, dueBefore, assigneePersonId };
    }

    validateSearchQuery(query = {}, context) {
        const normalizedQuery = typeof query.query === 'string'
            ? query.query.normalize('NFKC').trim().replace(/\s+/g, ' ')
            : '';
        const errors = {};
        if (!normalizedQuery || normalizedQuery.length > 200) {
            errors.query = ['must_be_between_1_and_200_characters'];
        }
        const limit = query.limit == null ? 20 : Number(query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
            errors.limit = ['must_be_between_1_and_20'];
        }
        if (Object.keys(errors).length) throw validationError(errors);
        const filters = this.validateQuery({ ...query, limit }, context);
        return {
            ...filters,
            tokens: normalizedQuery.split(' ')
        };
    }

    async listTasks(query, context) {
        context = this.normalizeOwnerContext(context);
        const filters = this.validateQuery(query, context);
        const page = await this.read(() => this.repository.list(filters));
        const items = page.items
            .map((task) => this.normalizeTaskResponse(task))
            .filter((task) => !this.isOwner(context) || task.assignee_person_id === this.ownerPersonId);
        return {
            items,
            total_count: Number.isInteger(page.totalCount) ? page.totalCount : items.length,
            count_status: page.countStatus || 'exact',
            next_cursor: page.nextCursor || null,
            read_status: page.readStatus || 'complete',
            warnings: items.flatMap((task) => task.normalization_warnings || []),
            as_of: this.clock().toISOString()
        };
    }

    async searchTasks(query, context) {
        context = this.normalizeOwnerContext(context);
        const filters = this.validateSearchQuery(query, context);
        if (typeof this.repository.search !== 'function') {
            throw new CanonicalTaskError(
                'task_search_unavailable',
                'Canonical Task bounded search is unavailable',
                503
            );
        }
        const page = await this.read(() => this.repository.search(filters));
        const items = page.items
            .map((task) => this.normalizeTaskResponse(task))
            .filter((task) => !this.isOwner(context) || task.assignee_person_id === this.ownerPersonId);
        return {
            items,
            total_count: null,
            count_status: 'not_requested',
            has_more: Boolean(page.hasMore),
            next_cursor: page.nextCursor || null,
            read_status: page.readStatus || 'complete',
            warnings: items.flatMap((task) => task.normalization_warnings || []),
            as_of: this.clock().toISOString()
        };
    }

    async getTask(taskId, context) {
        context = this.normalizeOwnerContext(context);
        const task = await this.read(() => this.repository.get(taskId));
        return this.assertOwnerTask(task, context);
    }

    async verifyAssigneePerson(personId, context) {
        if (!personId) return null;
        if (!this.infoSSOTService?.listGraphEntities) {
            throw new CanonicalTaskError('assignee_directory_unavailable', 'Graph People directory is unavailable', 503);
        }
        // Canonical Task mutations run with a least-privilege service token whose
        // normal role is `member`. Assignee verification is a narrower operation:
        // it may resolve an exact Person ID and display name, but it must not grant
        // the caller general GM access to Graph entities. Preserve the service
        // token's project and clearance boundaries while allowing People rows whose
        // directory visibility is `gm`.
        const directoryAccess = context.access?.role === 'member'
            ? { ...context.access, role: 'gm', level: 2 }
            : context.access;
        const matchesPersonId = (item) => (
            item?.id === personId
            || item?.entity_id === personId
            || item?.payload?.person_id === personId
        );
        let rows;
        try {
            // Person identity is global in Graph SSOT. Project scoping can hide a
            // canonical person whose primary row belongs to another project even
            // when that person is a Brainbase project member.
            rows = await this.infoSSOTService.listGraphEntities(directoryAccess, { id: personId, entityType: 'person', limit: 1 });
            if (!rows.some(matchesPersonId)) {
                rows = await this.infoSSOTService.listGraphEntities(directoryAccess, {
                    query: personId,
                    entityType: 'person',
                    limit: 10
                });
            }
        } catch (error) {
            throw new CanonicalTaskError('assignee_directory_unavailable', 'Graph People directory is unavailable', 503, { cause: error?.message });
        }
        const matches = rows.filter((item) => {
            return matchesPersonId(item) && item.entity_type === 'person';
        });
        if (matches.length !== 1) {
            const reason = matches.length > 1 ? 'ambiguous' : 'not_found';
            throw new CanonicalTaskError('invalid_assignee_person_id', 'assignee_person_id does not uniquely identify a Graph person', 422, { fieldErrors: { assignee_person_id: [reason] } });
        }
        const [row] = matches;
        return row.payload?.display_name || row.payload?.name || row.display_name || row.name || personId;
    }

    validateCreate(input = {}) {
        const errors = {};
        const title = typeof input.title === 'string' ? input.title.trim() : '';
        if (!title || title.length > 200) errors.title = ['must_be_between_1_and_200_characters'];
        const priority = input.priority || 'medium';
        if (!PRIORITIES.has(priority)) errors.priority = ['invalid_priority'];
        const dueAt = iso(input.due_at, errors, 'due_at');
        if (input.source_refs !== undefined && !Array.isArray(input.source_refs)) errors.source_refs = ['must_be_array'];
        if (input.project_codes !== undefined && !Array.isArray(input.project_codes)) errors.project_codes = ['must_be_array'];
        if (Array.isArray(input.project_codes) && hasInvalidProjectCode(input.project_codes)) {
            errors.project_codes = ['invalid_project_code'];
        }
        if (Object.keys(errors).length) throw validationError(errors);
        return {
            title, description: input.description ?? null, priority,
            assignee_person_id: input.assignee_person_id, due_at: dueAt,
            source_refs: input.source_refs || [],
            project_codes: normalizeProjectCodes(input.project_codes)
        };
    }

    assertIdempotencyKey(key) {
        if (typeof key !== 'string' || !key.trim()) throw validationError({ idempotency_key: ['required'] });
        const normalized = key.trim();
        if (/^(api|workflow):/.test(normalized)) {
            throw new CanonicalTaskError('reserved_idempotency_prefix', 'Idempotency key uses a reserved prefix', 422);
        }
        if (normalized.length > 200) throw validationError({ idempotency_key: ['too_long'] });
        return normalized;
    }

    async createTask(input, context) {
        await this.readiness?.assertMutationReady();
        context = this.normalizeOwnerContext(context);
        const payload = this.validateCreate(input);
        const clientKey = this.assertIdempotencyKey(context.idempotencyKey);
        if (this.isOwner(context)) {
            if (payload.assignee_person_id && payload.assignee_person_id !== this.ownerPersonId) {
                throw new CanonicalTaskError('forbidden_assignee', 'Owner credentials cannot assign another person', 403);
            }
            payload.assignee_person_id = this.ownerPersonId;
        }
        payload.assignee_display_name = await this.verifyAssigneePerson(payload.assignee_person_id, context);
        const namespace = principalNamespace(context.principal);
        const operationKey = `api:${namespace}:${clientKey}`;
        const payloadFingerprint = fingerprint(payload);
        const result = await this.operationRepository.execute({
            scope: 'task-create', operationKey, fingerprint: payloadFingerprint,
             projectResult: (task) => ({ task_id: task.id, task_version: task.version }),
             recover: () => this.recoverCreatedTask({
                 operationKey,
                 payloadFingerprint,
                 context,
                 conflictMessage: 'Idempotency key was reused with different input'
             }),
            run: async () => {
                const existing = await this.read(() => this.repository.findByIdempotencyKey(operationKey));
                if (existing) {
                    if (existing._payload_fingerprint && existing._payload_fingerprint !== payloadFingerprint) {
                        throw new CanonicalTaskError('idempotency_conflict', 'Idempotency key was reused with different input', 409);
                    }
                    return this.assertOwnerTask(existing, context);
                }
                return this.read(() => this.repository.create({
                    ...payload, status: 'pending', version: 1,
                    idempotency_key: operationKey, payload_fingerprint: payloadFingerprint
                }));
            }
        });
        const normalized = this.normalizeTaskResponse(result);
        await this.upsertMutationAudit({
            action: 'canonical_task.created',
            task: normalized,
            context,
            operationKey,
            operationFingerprint: payloadFingerprint,
            changes: { before: null, after: normalized },
            sourceRefs: payload.source_refs
        });
        return normalized;
    }

    async createManaCapture(input = {}, context) {
        await this.readiness?.assertMutationReady();
        context = this.normalizeOwnerContext(context);
        const captureId = optionalTrimmed(input.capture_id);
        const content = optionalTrimmed(input.content);
        const fieldErrors = {};
        if (!captureId) fieldErrors.capture_id = ['required'];
        if (captureId && captureId.length > 200) fieldErrors.capture_id = ['too_long'];
        if (!content) fieldErrors.content = ['required'];
        if (context?.authSource !== 'session' || context?.principal?.type !== 'person') {
            throw new CanonicalTaskError('mana_session_required', 'Mana capture requires an authenticated session', 401);
        }
        if (Object.keys(fieldErrors).length) throw validationError(fieldErrors);

        const payload = this.validateCreate({
            title: input.title || content,
            description: content,
            priority: input.priority || 'medium',
            assignee_person_id: this.ownerPersonId,
            due_at: input.due_at,
            source_refs: [{
                type: 'mana_capture',
                capture_id: captureId,
                capture_type: optionalTrimmed(input.type) || 'issue',
                project: optionalTrimmed(input.project),
                content
            }]
        });
        payload.assignee_display_name = await this.verifyAssigneePerson(payload.assignee_person_id, context);

        const operationKey = `mana:${principalNamespace(context.principal)}:${captureId}`;
        const payloadFingerprint = fingerprint(payload);
        const result = await this.operationRepository.execute({
            scope: 'task-create', operationKey, fingerprint: payloadFingerprint,
             projectResult: (task) => ({ task_id: task.id, task_version: task.version }),
             recover: () => this.recoverCreatedTask({
                 operationKey,
                 payloadFingerprint,
                 context,
                 conflictMessage: 'capture_id was reused with different input'
             }),
            run: async () => {
                const existing = await this.read(() => this.repository.findByIdempotencyKey(operationKey));
                if (existing) {
                    if (existing._payload_fingerprint && existing._payload_fingerprint !== payloadFingerprint) {
                        throw new CanonicalTaskError('idempotency_conflict', 'capture_id was reused with different input', 409);
                    }
                    return this.assertOwnerTask(existing, context);
                }
                return this.read(() => this.repository.create({
                    ...payload,
                    status: 'pending',
                    version: 1,
                    idempotency_key: operationKey,
                    payload_fingerprint: payloadFingerprint
                }));
            }
        });
        const normalized = this.normalizeTaskResponse(result);
        await this.upsertMutationAudit({
            action: 'canonical_task.created',
            task: normalized,
            context,
            operationKey,
            operationFingerprint: payloadFingerprint,
            changes: { before: null, after: normalized },
            sourceRefs: payload.source_refs
        });
        return normalized;
    }

    async materializeWorkflowApproval({ step, output, responseRef = null, actor = {} } = {}) {
        await this.readiness?.assertMutationReady();
        if (!step?.id || !output?.id || !Array.isArray(output.payload)) {
            throw new CanonicalTaskError(
                'invalid_task_candidate_output',
                'Task candidate output is invalid',
                409
            );
        }

        const candidates = output.payload.map((candidate, index) => normalizeWorkflowCandidate(candidate, output.id, index));
        const reviewItems = Array.isArray(responseRef?.review_items) ? responseRef.review_items : [];
        const reviewByCandidate = new Map();
        for (const reviewItem of reviewItems) {
            const reference = optionalTrimmed(reviewItem?.candidate_id)
                || optionalTrimmed(reviewItem?.id)
                || (Number.isInteger(reviewItem?.index) ? `${output.id}_item_${reviewItem.index}` : null);
            const candidate = candidates.find((item) => reference && item.aliases.has(reference));
            if (!candidate) {
                throw validationError({ review_items: ['unknown_candidate_id'] });
            }
            if (reviewByCandidate.has(candidate.candidateId)) {
                throw validationError({ review_items: ['duplicate_candidate_id'] });
            }
            reviewByCandidate.set(candidate.candidateId, reviewItem);
        }

        const allowedEditedFields = new Set(['title', 'description', 'priority', 'assignee_person_id', 'due_at']);
        const approved = [];
        const excludedCandidates = [];
        const warnings = [];
        for (const candidate of candidates) {
            const review = reviewByCandidate.get(candidate.candidateId) || null;
            const resolution = review?.resolution
                || (['approve', 'approveWithEdits'].includes(review?.decision_mode) ? 'approved' : null)
                || 'approved';
            if (resolution !== 'approved') {
                excludedCandidates.push({
                    candidate_id: candidate.candidateId,
                    resolution,
                    reason: optionalTrimmed(review?.reason) || null
                });
                continue;
            }
            const editedFields = Array.isArray(review?.edited_fields) ? review.edited_fields : [];
            if (editedFields.some((field) => !allowedEditedFields.has(field))) {
                throw validationError({ edited_fields: ['field_not_editable'] });
            }
            const taskInput = {
                title: candidate.raw.title,
                description: candidate.raw.description ?? null,
                priority: candidate.raw.priority || 'medium',
                assignee_person_id: candidate.raw.assignee_person_id || candidate.raw.selected_owner_id || null,
                due_at: candidate.raw.due_at || null,
                source_refs: [
                    ...(Array.isArray(candidate.raw.evidence_refs) ? candidate.raw.evidence_refs : []),
                    ...(Array.isArray(output.metadata?.evidence_refs) ? output.metadata.evidence_refs : []),
                    { type: 'workflow_output', output_id: output.id, candidate_id: candidate.candidateId },
                    { type: 'workflow_human_step', step_id: step.id, run_id: step.workflow_run_id }
                ]
            };
            for (const field of editedFields) {
                taskInput[field] = field === 'assignee_person_id'
                    ? (review.assignee_person_id || review.selected_owner_id || null)
                    : review[field];
            }
            if (!taskInput.assignee_person_id) {
                throw new CanonicalTaskError(
                    'unresolved_task_assignee',
                    `Task candidate '${candidate.candidateId}' has no Graph person ID`,
                    409,
                    { candidate_id: candidate.candidateId }
                );
            }
            approved.push({ ...candidate, taskInput });
        }

        const context = workflowActorContext(actor);
        const prepared = [];
        for (const candidate of approved) {
            const payload = this.validateCreate(candidate.taskInput);
            payload.assignee_display_name = await this.verifyAssigneePerson(payload.assignee_person_id, context);
            prepared.push({ ...candidate, payload });
        }

        const stableOrdinals = new Map(
            [...prepared]
                .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
                .map((candidate, index) => [candidate, index + 1])
        );
        const taskIds = [];
        let replayed = false;
        for (const candidate of prepared) {
            const payloadFingerprint = fingerprint(candidate.payload);
            const operationKey = `workflow:${output.id}:${candidate.contentFingerprint}:${stableOrdinals.get(candidate)}`;
            const existing = await this.read(() => this.repository.findByIdempotencyKey(operationKey));
            if (existing) replayed = true;
            const created = await this.operationRepository.execute({
                scope: 'workflow-task-create',
                operationKey,
                fingerprint: payloadFingerprint,
                 projectResult: (task) => ({ task_id: task.id, task_version: task.version }),
                 recover: () => this.recoverCreatedTask({
                     operationKey,
                     payloadFingerprint,
                     context,
                     conflictMessage: 'Workflow Task candidate changed after materialization'
                 }),
                run: async () => {
                    const replay = await this.read(() => this.repository.findByIdempotencyKey(operationKey));
                    if (replay) {
                        if (replay._payload_fingerprint && replay._payload_fingerprint !== payloadFingerprint) {
                            throw new CanonicalTaskError(
                                'idempotency_conflict',
                                'Workflow Task candidate changed after materialization',
                                409
                            );
                        }
                        return replay;
                    }
                    return this.read(() => this.repository.create({
                        ...candidate.payload,
                        status: 'pending',
                        version: 1,
                        idempotency_key: operationKey,
                        payload_fingerprint: payloadFingerprint
                    }));
                }
            });
            const normalized = this.normalizeTaskResponse(created);
            await this.upsertMutationAudit({
                action: 'canonical_task.created',
                task: normalized,
                context,
                operationKey,
                operationFingerprint: payloadFingerprint,
                changes: { before: null, after: normalized },
                sourceRefs: candidate.payload.source_refs
            });
            taskIds.push(created.id);
        }

        if (candidates.length === 0) {
            warnings.push({ code: 'no_task_candidates', message: 'Task candidate output was empty' });
        }
        return {
            status: 'completed',
            task_ids: taskIds,
            excluded_candidates: excludedCandidates,
            warnings,
            replayed
        };
    }

    validateVersion(value) {
        if (!Number.isInteger(value) || value < 1) throw validationError({ expected_version: ['positive_integer_required'] });
    }

    async versionedMutation(taskId, expectedVersion, context, mutation, apply) {
        await this.readiness?.assertMutationReady();
        context = this.normalizeOwnerContext(context);
        this.validateVersion(expectedVersion);
        const operationKey = `task-version:${taskId}:${expectedVersion}`;
        const opFingerprint = fingerprint({
            kind: mutation.kind,
            task_id: taskId,
            expected_version: expectedVersion,
            payload: mutation.payload ?? null,
            transition: mutation.transition ?? null,
            actor: context.principal
        });
        const marker = {
            last_operation_key: operationKey,
            last_operation_fingerprint: opFingerprint
        };
        const wasApplied = (task) => Boolean(
            task
            && task.version === expectedVersion + 1
            && task._last_operation_key === operationKey
            && task._last_operation_fingerprint === opFingerprint
        );
        const assertExpectedVersion = (task) => {
            if (task.version !== expectedVersion) {
                throw new CanonicalTaskError('version_conflict', 'Task version does not match', 409, { currentTask: task });
            }
        };
        const current = await this.getTask(taskId, context);
        if (!wasApplied(current)) assertExpectedVersion(current);
        const result = await this.operationRepository.execute({
            scope: 'task-version', operationKey,
            fingerprint: opFingerprint,
            projectResult: (task) => ({ task_id: task.id, task_version: task.version }),
            recover: async () => {
                const recovered = await this.getTask(taskId, context);
                if (wasApplied(recovered)) return { recovered: true, result: recovered };
                assertExpectedVersion(recovered);
                return { recovered: false };
            },
            run: async () => {
                const latest = await this.getTask(taskId, context);
                if (wasApplied(latest)) return latest;
                assertExpectedVersion(latest);
                return apply(latest, marker);
            }
        });
        const normalized = this.normalizeTaskResponse(result);
        await this.upsertMutationAudit({
            action: mutation.kind === 'transition' ? 'canonical_task.transitioned' : 'canonical_task.updated',
            task: normalized,
            context,
            operationKey,
            operationFingerprint: opFingerprint,
            changes: {
                before: { version: expectedVersion },
                after: {
                    version: normalized.version,
                    ...(mutation.kind === 'transition'
                        ? {
                            status: normalized.status,
                            waiting_on: normalized.waiting_on,
                            review_at: normalized.review_at,
                            completed_at: normalized.completed_at
                        }
                        : {})
                },
                ...(mutation.payload ? { fields: mutation.payload } : {}),
                ...(mutation.transition ? { transition: mutation.transition } : {})
            },
            sourceRefs: normalized.source_refs || []
        });
        return normalized;
    }

    async updateTask(taskId, input = {}, context) {
        context = this.normalizeOwnerContext(context);
        const allowed = ['title', 'description', 'priority', 'assignee_person_id', 'due_at', 'project_codes'];
        const errors = {};
        const patch = {};
        for (const key of Object.keys(input)) {
            if (key !== 'expected_version' && !allowed.includes(key)) errors[key] = ['field_not_mutable'];
        }
        if ('title' in input) {
            const title = typeof input.title === 'string' ? input.title.trim() : '';
            if (!title || title.length > 200) errors.title = ['must_be_between_1_and_200_characters']; else patch.title = title;
        }
        if ('description' in input) patch.description = input.description;
        if ('priority' in input) {
            if (!PRIORITIES.has(input.priority)) errors.priority = ['invalid_priority']; else patch.priority = input.priority;
        }
        if ('due_at' in input) patch.due_at = iso(input.due_at, errors, 'due_at');
        if ('assignee_person_id' in input) patch.assignee_person_id = input.assignee_person_id;
        if ('project_codes' in input) {
            if (!Array.isArray(input.project_codes)) errors.project_codes = ['must_be_array'];
            else if (hasInvalidProjectCode(input.project_codes)) errors.project_codes = ['invalid_project_code'];
            else patch.project_codes = normalizeProjectCodes(input.project_codes);
        }
        if (Object.keys(errors).length) throw validationError(errors);
        if (this.isOwner(context) && 'assignee_person_id' in patch && patch.assignee_person_id !== this.ownerPersonId) {
            throw new CanonicalTaskError('forbidden_assignee', 'Owner credentials cannot change Task ownership', 403);
        }
        if ('assignee_person_id' in patch) patch.assignee_display_name = await this.verifyAssigneePerson(patch.assignee_person_id, context);
        return this.versionedMutation(
            taskId,
            input.expected_version,
            context,
            { kind: 'update', payload: patch, transition: null },
            (_current, marker) => this.read(() => this.repository.update(taskId, {
                ...patch,
                ...marker,
                version: input.expected_version + 1
            }))
        );
    }

    async transitionTask(taskId, input = {}, context) {
        context = this.normalizeOwnerContext(context);
        const errors = {};
        if (!STATUSES.has(input.to_status)) errors.to_status = ['invalid_status'];
        if (input.to_status === 'waiting' && (!input.waiting_on || !String(input.waiting_on).trim())) errors.waiting_on = ['required_for_waiting'];
        const reviewAt = iso(input.review_at, errors, 'review_at');
        if (Object.keys(errors).length) throw validationError(errors);
        const transition = {
            to_status: input.to_status,
            waiting_on: input.to_status === 'waiting' ? String(input.waiting_on).trim() : null,
            review_at: input.to_status === 'waiting' ? reviewAt : null
        };
        return this.versionedMutation(taskId, input.expected_version, context, {
            kind: 'transition', payload: null, transition
        }, (current, marker) => {
            if (!TRANSITIONS[current.status]?.has(transition.to_status)) {
                throw new CanonicalTaskError('invalid_transition', 'Task transition is not allowed', 409, { currentTask: current });
            }
            return this.read(() => this.repository.update(taskId, {
                status: transition.to_status,
                waiting_on: transition.waiting_on,
                review_at: transition.review_at,
                completed_at: transition.to_status === 'completed' ? this.clock().toISOString() : null,
                version: input.expected_version + 1,
                ...marker
            }));
        });
    }

    async deleteTask(taskId, input = {}, context) {
        await this.readiness?.assertMutationReady();
        context = this.normalizeOwnerContext(context);
        this.validateVersion(input.expected_version);
        const clientKey = this.assertIdempotencyKey(context.idempotencyKey);
        const namespace = principalNamespace(context.principal);
        const operationKey = `delete:${namespace}:${clientKey}`;
        const versionClaimKey = `task-version:${taskId}:${input.expected_version}`;
        const operationFingerprint = fingerprint({
            kind: 'delete',
            taskId,
            expectedVersion: input.expected_version,
            principalNamespace: namespace
        });
        const versionFingerprint = fingerprint({ kind: 'delete', taskId, expectedVersion: input.expected_version });
        const result = await this.operationRepository.executePreparedDelete({
            operationKey,
            versionClaimKey,
            fingerprint: operationFingerprint,
            versionFingerprint,
            principalNamespace: namespace,
            prepare: async () => {
                const current = await this.getTask(taskId, context);
                if (current.version !== input.expected_version) {
                    throw new CanonicalTaskError('version_conflict', 'Task version does not match', 409, { currentTask: current });
                }
                return {
                    authorizationSnapshot: {
                        task_id: taskId,
                        task_version: current.version,
                        actor: context.principal,
                        auth_source: context.authSource || null
                    },
                    result: { task_id: taskId, deleted: true, version: input.expected_version + 1 }
                };
            },
            findTask: () => this.read(() => this.repository.get(taskId)),
            removeTask: () => this.read(() => this.repository.delete(taskId))
        });
        await this.upsertMutationAudit({
            action: 'canonical_task.deleted',
            taskId,
            context,
            operationKey,
            operationFingerprint,
            changes: { before: { task_id: taskId, version: input.expected_version }, after: null }
        });
        return result;
    }
}
