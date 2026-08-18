import crypto from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 128 * 1024;
const MAX_ENTITIES = 80;
const MAX_TASKS = 50;
const MAX_MINUTES = 3;
const GRAPH_ENTITY_TYPES = 'project,person,org,brand,decision,glossary_term,document';

export class MeetingMinutesContextReceiptError extends Error {
    constructor(code, message, statusCode = 400, details = {}) {
        super(message);
        this.name = 'MeetingMinutesContextReceiptError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function normalizeIdentity(input = {}) {
    const identity = {
        run_id: typeof input.run_id === 'string' ? input.run_id.trim() : '',
        project_code: typeof input.project_code === 'string' ? input.project_code.trim() : '',
        transcript_sha256: typeof input.transcript_sha256 === 'string'
            ? input.transcript_sha256.trim().toLowerCase()
            : ''
    };
    if (!identity.run_id || !/^[a-zA-Z0-9._:-]{1,200}$/.test(identity.run_id)) {
        throw new MeetingMinutesContextReceiptError('meeting_minutes_context_input_invalid', 'run_id is invalid');
    }
    if (!identity.project_code || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(identity.project_code)) {
        throw new MeetingMinutesContextReceiptError('meeting_minutes_context_input_invalid', 'project_code is invalid');
    }
    if (!/^[a-f0-9]{64}$/.test(identity.transcript_sha256)) {
        throw new MeetingMinutesContextReceiptError(
            'meeting_minutes_context_input_invalid',
            'transcript_sha256 must be a lowercase SHA-256 digest'
        );
    }
    return identity;
}

function projectCodes(actor = {}) {
    return Array.isArray(actor.projectCodes)
        ? actor.projectCodes.map((value) => String(value).trim()).filter(Boolean)
        : [];
}

function assertProjectAccess(actor, projectCode) {
    const allowed = projectCodes(actor);
    const privileged = actor?.role === 'ceo' || actor?.authType === 'internal_api';
    if (!privileged && !allowed.includes(projectCode)) {
        throw new MeetingMinutesContextReceiptError(
            'project_not_accessible',
            `project '${projectCode}' is not accessible`,
            403
        );
    }
}

function graphAccess(actor, projectCode) {
    return {
        role: ['member', 'gm', 'ceo'].includes(String(actor?.role || '').toLowerCase())
            ? String(actor.role).toLowerCase()
            : 'ceo',
        projectCodes: Array.from(new Set([...projectCodes(actor), projectCode])),
        clearance: Array.isArray(actor?.clearance) && actor.clearance.length ? actor.clearance : ['internal'],
        personId: actor?.person_id || actor?.personId || actor?.sub || null
    };
}

function canonicalTaskContext(actor, projectCode) {
    const serviceId = actor?.sub || 'meeting-minutes-context-receipt';
    return {
        principal: { type: 'service', id: 'meeting-minutes-context-receipt' },
        authSource: 'service-internal',
        auditPrincipal: { type: 'service', id: serviceId },
        auditAuthSource: actor?.authType || 'meeting-minutes-context-receipt',
        access: {
            role: actor?.role || 'member',
            projectCodes: Array.from(new Set([...projectCodes(actor), projectCode])),
            clearance: Array.isArray(actor?.clearance) && actor.clearance.length
                ? actor.clearance
                : ['internal'],
            personId: actor?.person_id || actor?.personId || actor?.sub || null
        }
    };
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function compact(value, depth = 0) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.slice(0, 4000);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 4) return String(value).slice(0, 500);
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => compact(item, depth + 1));
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).slice(0, 40).map(([key, item]) => [key, compact(item, depth + 1)])
        );
    }
    return String(value).slice(0, 500);
}

function flattenEntities(groups = {}) {
    const priority = new Map([
        ['project', 0], ['decision', 1], ['document', 2], ['org', 3],
        ['glossary_term', 4], ['person', 5], ['brand', 6]
    ]);
    return Object.entries(groups)
        .sort(([left], [right]) => (priority.get(left) ?? 99) - (priority.get(right) ?? 99))
        .flatMap(([type, records]) => (Array.isArray(records)
            ? records.map((record) => ({ entity_type: type, ...compact(record) }))
            : []))
        .slice(0, MAX_ENTITIES);
}

function approvedMinutes(entities) {
    return entities
        .filter((entity) => entity.entity_type === 'document')
        .filter((entity) => String(entity.status || entity.review_status || '').toLowerCase() === 'approved')
        .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
        .slice(0, MAX_MINUTES)
        .map((entity) => ({
            id: entity.id || entity.entity_id || null,
            name: entity.name || entity.title || null,
            source_ref: entity.source_ref || entity.url || null,
            updated_at: entity.updated_at || null
        }));
}

function sourceRefs(entities, tasks, minutes) {
    return [
        ...entities.map((item) => ({ type: 'graph_entity', id: item.id || item.entity_id || null })),
        ...tasks.map((item) => ({ type: 'canonical_task', id: item.id || item.task_id || null })),
        ...minutes.map((item) => ({ type: 'approved_minutes', id: item.id, ref: item.source_ref }))
    ].filter((item) => item.id);
}

function boundedReceipt(receipt) {
    const candidate = structuredClone(receipt);
    while (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_BYTES) {
        if (candidate.context.entities.length) candidate.context.entities.pop();
        else if (candidate.context.open_tasks.length) candidate.context.open_tasks.pop();
        else if (candidate.context.source_refs.length) candidate.context.source_refs.pop();
        else {
            throw new MeetingMinutesContextReceiptError(
                'meeting_minutes_context_too_large',
                'meeting minutes context receipt exceeds 128 KiB',
                503
            );
        }
    }
    return candidate;
}

export class JsonFileMeetingMinutesContextReceiptRepository {
    constructor({ filePath }) {
        this.filePath = filePath;
    }

    async readAll() {
        try {
            const parsed = JSON.parse(await readFile(this.filePath, 'utf8'));
            return Array.isArray(parsed.receipts) ? parsed.receipts : [];
        } catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }
    }

    async put(receipt) {
        const receipts = await this.readAll();
        const next = [...receipts.filter((item) => item.receipt_id !== receipt.receipt_id), receipt];
        const dir = path.dirname(this.filePath);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
        const tempPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await writeFile(tempPath, `${JSON.stringify({ version: 1, receipts: next }, null, 2)}\n`, { mode: 0o600 });
        await chmod(tempPath, 0o600);
        await rename(tempPath, this.filePath);
        await chmod(this.filePath, 0o600);
        return receipt;
    }

    async get(receiptId) {
        return (await this.readAll()).find((item) => item.receipt_id === receiptId) || null;
    }
}

export class MeetingMinutesContextReceiptService {
    constructor({ infoSSOTService, canonicalTaskService, repository, clock = () => new Date() }) {
        this.infoSSOTService = infoSSOTService;
        this.canonicalTaskService = canonicalTaskService;
        this.repository = repository;
        this.clock = clock;
    }

    async create(input, actor = {}) {
        const identity = normalizeIdentity(input);
        assertProjectAccess(actor, identity.project_code);
        const errors = [];
        let graph = null;
        let tasks = null;
        try {
            graph = await this.infoSSOTService.getContext(graphAccess(actor, identity.project_code), {
                projectCode: identity.project_code,
                entityTypes: GRAPH_ENTITY_TYPES,
                limit: MAX_ENTITIES,
                humanReadable: false,
                includeEdges: true,
                includePhilosophy: false,
                scope: 'meeting_minutes_generation'
            });
        } catch (error) {
            errors.push({ source: 'graph', code: 'graph_context_unavailable', message: error?.message || String(error) });
        }
        try {
            tasks = await this.canonicalTaskService.listTasks({
                project_code: identity.project_code,
                status: ['pending', 'in_progress', 'waiting'],
                limit: MAX_TASKS
            }, canonicalTaskContext(actor, identity.project_code));
        } catch (error) {
            errors.push({ source: 'tasks', code: 'canonical_tasks_unavailable', message: error?.message || String(error) });
        }
        const entities = flattenEntities(graph?.entities || {});
        const openTasks = (Array.isArray(tasks?.items) ? tasks.items : [])
            .filter((task) => task.status !== 'completed')
            .slice(0, MAX_TASKS)
            .map((task) => compact(task));
        const minutes = approvedMinutes(entities);
        const context = {
            project: entities.filter((item) => item.entity_type === 'project'),
            people: entities.filter((item) => item.entity_type === 'person'),
            organizations: entities.filter((item) => item.entity_type === 'org'),
            glossary: entities.filter((item) => item.entity_type === 'glossary_term'),
            decisions: entities.filter((item) => item.entity_type === 'decision'),
            entities,
            edges: compact(graph?.edges || []),
            open_tasks: openTasks,
            approved_minutes_refs: minutes,
            source_refs: sourceRefs(entities, openTasks, minutes)
        };
        const sourceStatus = {
            graph: graph ? 'resolved' : 'unavailable',
            tasks: tasks ? 'resolved' : 'unavailable'
        };
        const isEmpty = entities.length === 0 && openTasks.length === 0;
        const status = errors.length === 2
            ? 'unavailable'
            : errors.length
                ? 'partial'
                : isEmpty ? 'confirmed_empty' : 'resolved';
        const resolvedAt = this.clock().toISOString();
        const receiptId = `mmctx_${digest(identity).slice(0, 32)}`;
        const base = {
            schema_version: 'meeting_minutes_context_receipt.v1',
            receipt_id: receiptId,
            identity,
            status,
            source_status: sourceStatus,
            searched_scope: {
                project_code: identity.project_code,
                entity_types: GRAPH_ENTITY_TYPES.split(','),
                entity_limit: MAX_ENTITIES,
                task_limit: MAX_TASKS,
                approved_minutes_limit: MAX_MINUTES
            },
            resolved_at: resolvedAt,
            context,
            errors
        };
        const receipt = boundedReceipt({ ...base, checksum: digest(base) });
        receipt.checksum = digest({ ...receipt, checksum: undefined });
        return this.repository.put(receipt);
    }

    async get(receiptId, input, actor = {}) {
        const identity = normalizeIdentity(input);
        assertProjectAccess(actor, identity.project_code);
        const receipt = await this.repository.get(receiptId);
        if (!receipt) {
            throw new MeetingMinutesContextReceiptError(
                'meeting_minutes_context_receipt_not_found',
                'meeting minutes context receipt was not found',
                404
            );
        }
        if (JSON.stringify(receipt.identity) !== JSON.stringify(identity)) {
            throw new MeetingMinutesContextReceiptError(
                'meeting_minutes_context_identity_mismatch',
                'meeting minutes context receipt identity does not match',
                409
            );
        }
        return receipt;
    }
}
