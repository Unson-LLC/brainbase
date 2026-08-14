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
    endpoint,
    internalApiKey,
    serviceToken,
    organizationId,
    fetchImpl = globalThis.fetch,
    maxAttempts = 5,
    limit = Infinity,
    now = () => new Date()
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
    const moveToDeadLetter = (target, file) => {
        mkdirSync(resolvedDeadLetterDir, { recursive: true, mode: 0o700 });
        renameSync(target, join(resolvedDeadLetterDir, file));
        deadLettered += 1;
    };
    for (const file of files) {
        const target = join(outboxDir, file);
        let queued;
        let lastStatus = null;
        let lastErrorCode = 'knowledge_event_delivery_unknown_error';
        try {
            queued = JSON.parse(readFileSync(target, 'utf8'));
        } catch {
            failed += 1;
            moveToDeadLetter(target, file);
            continue;
        }
        const attempt = queued.delivery?.attempt || 1;
        if (attempt > maxAttempts) {
            failed += 1;
            moveToDeadLetter(target, file);
            continue;
        }
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
            const headers = { 'Content-Type': 'application/json' };
            if (internalApiKey) headers['x-internal-api-key'] = internalApiKey;
            else if (serviceToken) headers.Authorization = `Bearer ${serviceToken}`;
            headers['x-brainbase-organization-id'] = deliveryOrganizationId;
            const response = await fetchImpl(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(queued.event)
            });
            if (!response?.ok) {
                lastStatus = Number.isInteger(response?.status) ? response.status : null;
                const error = new Error('knowledge event delivery failed');
                error.code = lastStatus === 409
                    ? 'knowledge_event_conflict'
                    : 'knowledge_event_delivery_http_error';
                throw error;
            }
            unlinkSync(target);
            delivered += 1;
        } catch (error) {
            failed += 1;
            if (typeof error?.code === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(error.code)) {
                lastErrorCode = error.code;
            }
            const next = {
                ...queued,
                delivery: {
                    ...queued.delivery,
                    attempt: attempt + 1,
                    last_failed_at: now().toISOString(),
                    last_status: lastStatus,
                    last_error_code: lastErrorCode
                }
            };
            if (lastStatus === 409 || next.delivery.attempt > maxAttempts) {
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
