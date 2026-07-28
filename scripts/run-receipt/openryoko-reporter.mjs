import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    createIdempotencyKey,
    postReceipt,
    requireSingleLine,
    toIso
} from './reporter-core.mjs';

const TERMINAL_STATUS = Object.freeze({
    idle: { status: 'success', action: 'none' },
    error: { status: 'failed', action: 'check_error' },
    interrupted: { status: 'cancelled', action: 'none' }
});

function atomicWriteJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, filePath);
}

export function buildOpenRyokoReceipt(input) {
    const sessionId = requireSingleLine(input?.id, 'id');
    const projectId = requireSingleLine(input?.project_id, 'project_id');
    const sourceStatus = requireSingleLine(input?.status, 'status');
    if (!TERMINAL_STATUS[sourceStatus]) {
        return { kind: 'pending', reason: 'source_run_not_terminal' };
    }

    const sourceName = requireSingleLine(input.connector || input.source || 'unknown', 'connector');
    const workflowId = `openryoko-${sourceName}`;
    const mapped = TERMINAL_STATUS[sourceStatus];
    const finishedAt = toIso(input.lastActivity, 'lastActivity');
    const run = {
        project_id: projectId,
        external_run_id: sessionId,
        ...(input.parentSessionId
            ? { parent_external_run_id: requireSingleLine(input.parentSessionId, 'parentSessionId') }
            : {}),
        status: mapped.status,
        evidence_state: 'confirmed',
        ...(input.createdAt ? { started_at: toIso(input.createdAt, 'createdAt') } : {}),
        finished_at: finishedAt,
        summary: `OpenRyoko ${sourceName} session finished with source status ${sourceStatus}`,
        action_required: mapped.action,
        evidence_refs: [{
            kind: 'artifact_ref',
            ref: `openryoko:session/${sessionId}`,
            label: 'OpenRyoko session metadata'
        }]
    };
    if (mapped.status === 'failed') {
        run.blocker_reason = 'OpenRyoko reported an error terminal state';
    }
    return {
        contract_version: 'run_receipt.v1',
        source: {
            type: 'openryoko',
            workflow_id: workflowId,
            name: workflowId,
            runtime_target: 'lightsail'
        },
        run,
        delivery: {
            idempotency_key: createIdempotencyKey(projectId, 'openryoko', sessionId),
            attempt: 1,
            sent_at: finishedAt
        }
    };
}

export function enqueueOpenRyokoReceipt(receipt, {
    outboxDir = process.env.OPENRYOKO_RUN_RECEIPT_OUTBOX_DIR
        || 'var/run-receipt-outbox/openryoko'
} = {}) {
    if (receipt?.kind === 'pending') return receipt;
    const filePath = path.resolve(outboxDir, `${receipt.delivery.idempotency_key}.json`);
    if (fs.existsSync(filePath)) return { status: 'duplicate', path: filePath };
    atomicWriteJson(filePath, receipt);
    return { status: 'queued', path: filePath };
}

export async function deliverOpenRyokoOutbox({
    outboxDir = process.env.OPENRYOKO_RUN_RECEIPT_OUTBOX_DIR
        || 'var/run-receipt-outbox/openryoko',
    deadLetterDir = process.env.OPENRYOKO_RUN_RECEIPT_DEAD_LETTER_DIR
        || 'var/run-receipt-dead-letter/openryoko',
    endpoint = process.env.BRAINBASE_RUN_RECEIPT_INGEST_URL,
    serviceToken = process.env.BRAINBASE_RUN_RECEIPT_SERVICE_TOKEN,
    fetchImpl = globalThis.fetch,
    maxAttempts = 5,
    now = () => new Date()
} = {}) {
    const files = fs.existsSync(outboxDir)
        ? fs.readdirSync(outboxDir).filter((name) => name.endsWith('.json')).sort()
        : [];
    if (!endpoint || !serviceToken || typeof fetchImpl !== 'function') {
        return {
            status: 'unavailable',
            reason: !endpoint ? 'missing_endpoint' : 'missing_service_token',
            pending: files.length
        };
    }

    const summary = { status: 'completed', delivered: 0, retryable: 0, dead_lettered: 0 };
    for (const fileName of files) {
        const filePath = path.resolve(outboxDir, fileName);
        const receipt = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const attempt = Number.isInteger(receipt.delivery?.attempt) ? receipt.delivery.attempt : 1;
        receipt.delivery = { ...receipt.delivery, attempt, sent_at: toIso(now(), 'sent_at') };
        let response;
        try {
            response = await postReceipt(receipt, { endpoint, serviceToken, fetchImpl });
        } catch {
            response = { ok: false, status: 0 };
        }
        if (response.ok) {
            fs.unlinkSync(filePath);
            summary.delivered += 1;
        } else if (attempt >= maxAttempts) {
            fs.mkdirSync(deadLetterDir, { recursive: true });
            atomicWriteJson(path.resolve(deadLetterDir, fileName), receipt);
            fs.unlinkSync(filePath);
            summary.dead_lettered += 1;
        } else {
            receipt.delivery.attempt = attempt + 1;
            atomicWriteJson(filePath, receipt);
            summary.retryable += 1;
        }
    }
    return summary;
}

export async function collectOpenRyokoSessions({
    gatewayUrl = process.env.OPENRYOKO_GATEWAY_URL || 'http://127.0.0.1:7777',
    projectId = process.env.BRAINBASE_PROJECT_ID,
    stateFile = process.env.OPENRYOKO_RUN_RECEIPT_STATE_FILE
        || 'var/run-receipt-state/openryoko.json',
    outboxDir,
    fetchImpl = globalThis.fetch
} = {}) {
    requireSingleLine(projectId, 'project_id');
    const response = await fetchImpl(`${gatewayUrl.replace(/\/+$/, '')}/api/sessions`);
    if (!response.ok) throw new Error(`OpenRyoko sessions endpoint returned ${response.status}`);
    const sessions = await response.json();
    if (!Array.isArray(sessions)) throw new Error('OpenRyoko sessions endpoint must return an array');

    const previous = fs.existsSync(stateFile)
        ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        : null;
    const observed = { ...(previous?.observed || {}) };
    const initialized = Boolean(previous);
    const summary = { status: initialized ? 'completed' : 'initialized', observed: sessions.length, queued: 0 };

    for (const session of sessions) {
        if (!session?.id || !session?.status || !session?.lastActivity) continue;
        const signature = `${session.status}:${session.lastActivity}`;
        const priorSignature = observed[session.id];
        observed[session.id] = signature;
        if (!initialized || priorSignature === signature) continue;
        const receipt = buildOpenRyokoReceipt({ ...session, project_id: projectId });
        if (receipt.kind === 'pending') continue;
        const result = enqueueOpenRyokoReceipt(receipt, { outboxDir });
        if (result.status === 'queued') summary.queued += 1;
    }

    atomicWriteJson(path.resolve(stateFile), { version: 1, observed });
    return summary;
}

async function main() {
    const collection = await collectOpenRyokoSessions();
    const delivery = await deliverOpenRyokoOutbox();
    process.stdout.write(`${JSON.stringify({ collection, delivery })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        process.stderr.write(`[openryoko-run-receipt] ${error.message}\n`);
        process.exitCode = 1;
    });
}
