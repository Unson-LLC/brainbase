import {
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRuntimePaths } from '../../../lib/runtime-paths.js';

const DEFAULT_REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_DELIVERY_RECEIPT_DIRNAME = 'knowledge-event-delivery-receipt';

export function resolveJudgmentKnowledgeEventOutboxPath({
    env = process.env,
    varDir = env.BRAINBASE_VAR_DIR,
    repoDir = DEFAULT_REPO_DIR
} = {}) {
    if (env.BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR) {
        return env.BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR;
    }
    if (!varDir && env.BRAINBASE_JUDGMENT_JOURNAL_DIR) {
        return join(
            dirname(resolve(env.BRAINBASE_JUDGMENT_JOURNAL_DIR)),
            'knowledge-event-outbox',
            'codex-judgment'
        );
    }
    const canonicalVarDir = varDir || resolveRuntimePaths({ repoDir, env }).varDir;
    return join(canonicalVarDir, 'knowledge-event-outbox', 'codex-judgment');
}

export function resolveJudgmentKnowledgeEventDeliveryReceiptPath({
    env = process.env,
    varDir = env.BRAINBASE_VAR_DIR,
    outboxDir,
    repoDir = DEFAULT_REPO_DIR
} = {}) {
    if (env.BRAINBASE_KNOWLEDGE_EVENT_DELIVERY_RECEIPT_DIR) {
        return env.BRAINBASE_KNOWLEDGE_EVENT_DELIVERY_RECEIPT_DIR;
    }
    if (env.BRAINBASE_KNOWLEDGE_EVENT_DELIVERY_RECEIPTS_DIR) {
        return env.BRAINBASE_KNOWLEDGE_EVENT_DELIVERY_RECEIPTS_DIR;
    }
    const resolvedOutboxDir = outboxDir || env.BRAINBASE_KNOWLEDGE_EVENT_OUTBOX_DIR;
    if (resolvedOutboxDir) {
        return join(dirname(dirname(resolvedOutboxDir)), DEFAULT_DELIVERY_RECEIPT_DIRNAME, basename(resolvedOutboxDir));
    }
    if (!varDir && env.BRAINBASE_JUDGMENT_JOURNAL_DIR) {
        return join(
            dirname(resolve(env.BRAINBASE_JUDGMENT_JOURNAL_DIR)),
            DEFAULT_DELIVERY_RECEIPT_DIRNAME,
            'codex-judgment'
        );
    }
    const canonicalVarDir = varDir || resolveRuntimePaths({ repoDir, env }).varDir;
    return join(canonicalVarDir, DEFAULT_DELIVERY_RECEIPT_DIRNAME, 'codex-judgment');
}

export function resolveJudgmentKnowledgeEventDeliveryAuth({
    endpoint,
    env = process.env
} = {}) {
    let isLoopback = false;
    try {
        const hostname = new URL(endpoint).hostname;
        isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    } catch {
        // An invalid endpoint is handled by delivery as an unavailable/failing dependency.
    }
    if (isLoopback) {
        return {
            internalApiKey: env.INTERNAL_API_SECRET || null,
            serviceToken: null
        };
    }
    return {
        internalApiKey: null,
        serviceToken: env.BRAINBASE_KNOWLEDGE_EVENT_SERVICE_TOKEN || null
    };
}

export function createJudgmentOutboxDeliveryService({
    outboxDir,
    deadLetterDir,
    endpoint,
    deliveryAuth = {},
    env = process.env,
    deliver = deliverJudgmentKnowledgeEventOutbox
} = {}) {
    return {
        deliverPending: (context = {}) => deliver({
            outboxDir,
            deadLetterDir,
            endpoint,
            ...deliveryAuth,
            organizationId: context.access?.organizationId
                || context.access?.tenantId
                || env.BRAINBASE_ORGANIZATION_ID
                || null
        })
    };
}

function jsonFiles(directory) {
    try {
        return readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
    } catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
    }
}

function atomicWrite(target, value) {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, target);
}

function safeResponseStatus(response) {
    return Number.isInteger(response?.status) ? response.status : null;
}

async function readResponseJson(response, errorCode) {
    if (typeof response?.json !== 'function') {
        const error = new Error(errorCode);
        error.code = errorCode;
        throw error;
    }
    try {
        return await response.json();
    } catch {
        const error = new Error(errorCode);
        error.code = errorCode;
        throw error;
    }
}

function responseRecord(body) {
    const candidates = [
        body,
        body?.result,
        body?.data,
        body?.receipt,
        body?.cycle
    ];
    return candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        && ('event_id' in candidate || 'candidate_id' in candidate || 'schema_version' in candidate))
        || candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate))
        || null;
}

function deliveryProjectCode(event) {
    return event?.project_code
        || event?.applicability_scope?.project_code
        || null;
}

function cycleEndpoint(endpoint, eventId, projectCode) {
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        const error = new Error('knowledge_event_readback_endpoint_invalid');
        error.code = 'knowledge_event_readback_endpoint_invalid';
        throw error;
    }
    const pathname = url.pathname.replace(/\/+$/, '');
    const cyclePath = pathname.endsWith('/events')
        ? `${pathname.slice(0, -'/events'.length)}/cycles/${encodeURIComponent(eventId)}`
        : `${pathname}/cycles/${encodeURIComponent(eventId)}`;
    url.pathname = cyclePath || `/cycles/${encodeURIComponent(eventId)}`;
    url.searchParams.set('project_code', projectCode);
    return url.toString();
}

function deliveryHeaders({ internalApiKey, serviceToken, organizationId }) {
    const headers = { 'Content-Type': 'application/json' };
    if (internalApiKey) headers['x-internal-api-key'] = internalApiKey;
    else if (serviceToken) headers.Authorization = `Bearer ${serviceToken}`;
    if (organizationId) headers['x-brainbase-organization-id'] = organizationId;
    return headers;
}

function normalizeErrorCode(error, fallback) {
    return typeof error?.code === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(error.code)
        ? error.code
        : fallback;
}

function toPostAck(body, eventId, httpStatus, receivedAt) {
    const record = responseRecord(body);
    if (record?.event_id !== eventId) {
        const error = new Error('knowledge_event_delivery_ack_identity_mismatch');
        error.code = 'knowledge_event_delivery_ack_identity_mismatch';
        throw error;
    }
    if (typeof record?.candidate_id !== 'string' || record.candidate_id.length === 0) {
        const error = new Error('knowledge_event_delivery_ack_missing_candidate');
        error.code = 'knowledge_event_delivery_ack_missing_candidate';
        throw error;
    }
    const ack = {
        event_id: eventId,
        candidate_id: record.candidate_id,
        http_status: httpStatus,
        received_at: receivedAt
    };
    if (typeof record.processing_stage === 'string') ack.processing_stage = record.processing_stage;
    if (typeof record.semantic_state === 'string') ack.semantic_state = record.semantic_state;
    if (record.idempotent === true) ack.idempotent = true;
    return ack;
}

function toReadbackReceipt(body, eventId, candidateId, readbackAt) {
    const record = responseRecord(body);
    if (record?.schema_version !== 'knowledge_cycle_receipt.v1') {
        const error = new Error('knowledge_event_readback_schema_mismatch');
        error.code = 'knowledge_event_readback_schema_mismatch';
        throw error;
    }
    if (record.event_id !== eventId || record.candidate_id !== candidateId) {
        const error = new Error('knowledge_event_readback_identity_mismatch');
        error.code = 'knowledge_event_readback_identity_mismatch';
        throw error;
    }
    if (record.processing_stage !== 'retrievable' || record.semantic_state !== 'active') {
        const error = new Error('knowledge_event_readback_not_retrievable');
        error.code = 'knowledge_event_readback_not_retrievable';
        throw error;
    }
    const readback = {
        schema_version: record.schema_version,
        event_id: eventId,
        candidate_id: candidateId,
        processing_stage: record.processing_stage,
        semantic_state: record.semantic_state,
        readback_at: readbackAt
    };
    if (typeof record.retrievable_at === 'string') readback.retrievable_at = record.retrievable_at;
    return readback;
}

function receiptIsConfirmed(receipt, { eventId, candidateId, projectCode }) {
    return receipt?.schema_version === 'knowledge_event_delivery_receipt.v1'
        && receipt.status === 'confirmed'
        && receipt.event_id === eventId
        && receipt.candidate_id === candidateId
        && receipt.project_code === projectCode
        && receipt.post?.event_id === eventId
        && receipt.post?.candidate_id === candidateId
        && receipt.readback?.schema_version === 'knowledge_cycle_receipt.v1'
        && receipt.readback?.event_id === eventId
        && receipt.readback?.candidate_id === candidateId
        && receipt.readback?.processing_stage === 'retrievable'
        && receipt.readback?.semantic_state === 'active';
}

function readConfirmedReceipt(path, args) {
    try {
        const receipt = JSON.parse(readFileSync(path, 'utf8'));
        return receiptIsConfirmed(receipt, args) ? receipt : null;
    } catch {
        return null;
    }
}

export function enqueueJudgmentKnowledgeEvent(event, {
    directory,
    now = () => new Date()
} = {}) {
    if (!event?.event_id) throw new Error('knowledge event_id is required');
    if (!directory) throw new Error('knowledge event outbox directory is required');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = join(directory, `${event.event_id}.json`);
    try {
        const existing = JSON.parse(readFileSync(target, 'utf8'));
        if (JSON.stringify(existing.event) !== JSON.stringify(event)) {
            throw new Error('knowledge_event_outbox_conflict');
        }
        return { status: 'existing', path: target };
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    atomicWrite(target, {
        event,
        delivery: { attempt: 1, queued_at: now().toISOString() }
    });
    return { status: 'queued', path: target };
}

export async function deliverJudgmentKnowledgeEventOutbox({
    outboxDir,
    deadLetterDir,
    deliveryReceiptDir,
    endpoint,
    internalApiKey,
    serviceToken,
    organizationId,
    fetchImpl = globalThis.fetch,
    maxAttempts = 5,
    limit = Infinity,
    now = () => new Date(),
    env = process.env,
    repoDir = DEFAULT_REPO_DIR
} = {}) {
    const allFiles = jsonFiles(outboxDir);
    const files = allFiles.slice(0, Math.max(0, limit));
    if (!endpoint || typeof fetchImpl !== 'function') {
        return {
            status: 'unavailable',
            delivered: 0,
            failed: 0,
            retryable: allFiles.length,
            dead_lettered: 0,
            pending: allFiles.length
        };
    }
    let delivered = 0;
    let failed = 0;
    let retryable = 0;
    let deadLettered = 0;
    const resolvedDeadLetterDir = deadLetterDir || join(
        dirname(dirname(outboxDir)),
        'knowledge-event-dead-letter',
        basename(outboxDir)
    );
    const resolvedDeliveryReceiptDir = deliveryReceiptDir || resolveJudgmentKnowledgeEventDeliveryReceiptPath({
        env,
        outboxDir,
        repoDir
    });
    const moveToDeadLetter = (target, file) => {
        mkdirSync(resolvedDeadLetterDir, { recursive: true, mode: 0o700 });
        renameSync(target, join(resolvedDeadLetterDir, file));
        deadLettered += 1;
    };
    for (const file of files) {
        const target = join(outboxDir, file);
        let queued;
        try {
            queued = JSON.parse(readFileSync(target, 'utf8'));
        } catch {
            failed += 1;
            moveToDeadLetter(target, file);
            continue;
        }
        const event = queued.event;
        const eventId = event?.event_id;
        const projectCode = deliveryProjectCode(event);
        const postAck = queued.delivery?.post_ack;
        const attempt = queued.delivery?.attempt || 1;
        const readbackAttempt = queued.delivery?.readback_attempt || 1;
        if (!postAck && attempt > maxAttempts) {
            failed += 1;
            moveToDeadLetter(target, file);
            continue;
        }
        const receiptPath = eventId
            ? join(resolvedDeliveryReceiptDir, `${eventId}.json`)
            : null;
        if (postAck && receiptPath && readConfirmedReceipt(receiptPath, {
            eventId,
            candidateId: postAck.candidate_id,
            projectCode
        })) {
            try {
                unlinkSync(target);
                delivered += 1;
                continue;
            } catch {
                // Keep the confirmed receipt and let the normal failure path retain the Outbox.
            }
        }
        let failureKind = postAck ? 'readback' : 'post';
        let lastStatus = null;
        let lastErrorCode = 'knowledge_event_delivery_unknown_error';
        try {
            const eventOrganizationId = queued.event?.organization_id
                || queued.event?.applicability_scope?.organization_id
                || null;
            if (eventOrganizationId && organizationId && eventOrganizationId !== organizationId) {
                const error = new Error('knowledge_event_organization_context_conflict');
                error.code = 'knowledge_event_organization_context_conflict';
                throw error;
            }
            const deliveryOrganizationId = eventOrganizationId || organizationId || null;
            if (!deliveryOrganizationId) {
                const error = new Error('knowledge_event_organization_context_required');
                error.code = 'knowledge_event_organization_context_required';
                throw error;
            }
            if (!eventId) {
                const error = new Error('knowledge_event_event_id_required');
                error.code = 'knowledge_event_event_id_required';
                throw error;
            }
            if (!projectCode) {
                const error = new Error('knowledge_event_project_code_required');
                error.code = 'knowledge_event_project_code_required';
                throw error;
            }
            const headers = deliveryHeaders({
                internalApiKey,
                serviceToken,
                organizationId: deliveryOrganizationId
            });
            let confirmedPostAck = postAck;
            if (!confirmedPostAck) {
                failureKind = 'post';
                const response = await fetchImpl(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(event)
                });
                lastStatus = safeResponseStatus(response);
                if (!response?.ok) {
                    const error = new Error('knowledge event delivery failed');
                    error.code = lastStatus === 409
                        ? 'knowledge_event_conflict'
                        : 'knowledge_event_delivery_http_error';
                    throw error;
                }
                const body = await readResponseJson(response, 'knowledge_event_delivery_ack_missing');
                const ackSavedAt = now().toISOString();
                confirmedPostAck = toPostAck(
                    body,
                    eventId,
                    lastStatus,
                    ackSavedAt
                );
                const ackQueued = {
                    ...queued,
                    delivery: {
                        ...queued.delivery,
                        post_ack: confirmedPostAck,
                        phase: 'readback_pending',
                        readback_attempt: queued.delivery?.readback_attempt || 1,
                        ack_saved_at: ackSavedAt
                    }
                };
                atomicWrite(target, ackQueued);
                queued = ackQueued;
            }

            failureKind = 'readback';
            const readbackUrl = cycleEndpoint(endpoint, eventId, projectCode);
            const readbackResponse = await fetchImpl(readbackUrl, {
                method: 'GET',
                headers
            });
            lastStatus = safeResponseStatus(readbackResponse);
            if (!readbackResponse?.ok) {
                const error = new Error('knowledge event readback failed');
                error.code = 'knowledge_event_readback_http_error';
                throw error;
            }
            const readbackBody = await readResponseJson(
                readbackResponse,
                'knowledge_event_readback_body_missing'
            );
            const readback = toReadbackReceipt(
                readbackBody,
                eventId,
                confirmedPostAck.candidate_id,
                now().toISOString()
            );
            const deliveryReceipt = {
                schema_version: 'knowledge_event_delivery_receipt.v1',
                status: 'confirmed',
                event_id: eventId,
                candidate_id: confirmedPostAck.candidate_id,
                project_code: projectCode,
                post: confirmedPostAck,
                readback,
                confirmed_at: now().toISOString()
            };
            mkdirSync(resolvedDeliveryReceiptDir, { recursive: true, mode: 0o700 });
            atomicWrite(receiptPath, deliveryReceipt);
            unlinkSync(target);
            delivered += 1;
        } catch (error) {
            failed += 1;
            lastErrorCode = normalizeErrorCode(error, lastErrorCode);
            const isReadbackFailure = failureKind === 'readback';
            const nextAttempt = attempt + (isReadbackFailure ? 0 : 1);
            const nextReadbackAttempt = readbackAttempt + (isReadbackFailure ? 1 : 0);
            const next = {
                ...queued,
                delivery: {
                    ...queued.delivery,
                    attempt: nextAttempt,
                    ...(isReadbackFailure ? { readback_attempt: nextReadbackAttempt } : {}),
                    last_failed_at: now().toISOString(),
                    last_status: lastStatus,
                    last_error_code: lastErrorCode
                }
            };
            if ((!isReadbackFailure && lastStatus === 409)
                || (!isReadbackFailure && next.delivery.attempt > maxAttempts)
                || (isReadbackFailure && next.delivery.readback_attempt > maxAttempts)) {
                atomicWrite(target, next);
                moveToDeadLetter(target, file);
            } else {
                atomicWrite(target, next);
                retryable += 1;
            }
        }
    }
    return {
        status: 'processed',
        delivered,
        failed,
        retryable,
        dead_lettered: deadLettered,
        pending: jsonFiles(outboxDir).length
    };
}

export async function listJudgmentKnowledgeEventOutboxExceptions({ directory } = {}) {
    return jsonFiles(directory).map((file) => {
        const path = join(directory, file);
        let queued;
        try {
            queued = JSON.parse(readFileSync(path, 'utf8'));
        } catch {
            return {
                code: 'knowledge_event_outbox_corrupt',
                path: file
            };
        }
        return {
            code: 'knowledge_event_outbox',
            event_id: queued.event?.event_id,
            path: file,
            created_at: queued.delivery?.queued_at
        };
    });
}

export async function listKnowledgeEventDeadLetters({ directory } = {}) {
    return jsonFiles(directory).map((file) => {
        const target = join(directory, file);
        let queued;
        try {
            queued = JSON.parse(readFileSync(target, 'utf8'));
        } catch {
            queued = null;
        }
        return {
            code: 'knowledge_event_dead_letter',
            event_id: queued?.event?.event_id || file.replace(/\.json$/, ''),
            path: file,
            created_at: queued?.delivery?.last_failed_at
                || queued?.delivery?.queued_at
                || new Date().toISOString()
        };
    });
}
