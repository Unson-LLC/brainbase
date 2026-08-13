import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    createIdempotencyKey,
    normalizeEvidenceRefs,
    postReceipt,
    requireSingleLine,
    toIso
} from './reporter-core.mjs';

const TERMINAL_STATUS = Object.freeze({
    completed: { status: 'success', action: 'none' },
    failed: { status: 'failed', action: 'check_error' },
    cancelled: { status: 'cancelled', action: 'none' },
    waiting_human: { status: 'waiting_human', action: 'review_run' }
});

function atomicWriteJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, filePath);
}

function observationReceipt(input, automationId, projectId) {
    const observationId = requireSingleLine(input.observation_id, 'observation_id');
    const externalRunId = `${automationId}:observation:${observationId}`;
    const finishedAt = toIso(input.finished_at || new Date(), 'finished_at');
    return {
        contract_version: 'run_receipt.v1',
        source: { type: 'codex_automations', workflow_id: '__connector_observation__', name: automationId },
        run: {
            project_id: projectId,
            external_run_id: externalRunId,
            status: 'blocked',
            evidence_state: 'no_data',
            finished_at: finishedAt,
            summary: `Codex Automation ${automationId} source run identity was unavailable`,
            blocker_reason: 'Codex Automation source run identity was unavailable during observation',
            action_required: 'contact_owner',
            observation_kind: 'connector_observation',
            evidence_refs: []
        },
        delivery: {
            idempotency_key: createIdempotencyKey(projectId, 'codex_automations', externalRunId),
            attempt: 1,
            sent_at: finishedAt
        }
    };
}

export function buildCodexAutomationReceipt(input) {
    const automationId = requireSingleLine(input?.automation_id, 'automation_id');
    const projectId = requireSingleLine(input?.project_id, 'project_id');
    const sourceStatus = requireSingleLine(input?.status, 'status');
    if (!TERMINAL_STATUS[sourceStatus]) {
        return { kind: 'pending', reason: 'source_run_not_terminal' };
    }
    if (!input.run_id) return observationReceipt(input, automationId, projectId);

    const runId = requireSingleLine(input.run_id, 'run_id');
    const externalRunId = `${automationId}:${runId}`;
    const mapped = TERMINAL_STATUS[sourceStatus];
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs);
    const finishedAt = toIso(input.finished_at, 'finished_at');
    const run = {
        project_id: projectId,
        external_run_id: externalRunId,
        status: mapped.status,
        evidence_state: evidenceRefs.length > 0 ? 'confirmed' : 'no_data',
        ...(input.started_at ? { started_at: toIso(input.started_at, 'started_at') } : {}),
        finished_at: finishedAt,
        summary: `Codex Automation ${automationId} finished with source status ${sourceStatus}`,
        action_required: mapped.action,
        evidence_refs: evidenceRefs
    };
    if (mapped.status === 'failed') {
        run.blocker_reason = input.blocker_reason || 'Codex Automation reported a failed terminal state';
    }
    return {
        contract_version: 'run_receipt.v1',
        source: { type: 'codex_automations', workflow_id: automationId, name: automationId },
        run,
        delivery: {
            idempotency_key: createIdempotencyKey(projectId, 'codex_automations', externalRunId),
            attempt: 1,
            sent_at: finishedAt
        }
    };
}

export function enqueueCodexAutomationReceipt(receipt, {
    outboxDir = process.env.CODEX_RUN_RECEIPT_OUTBOX_DIR || 'var/run-receipt-outbox/codex-automations'
} = {}) {
    if (receipt?.kind === 'pending') return receipt;
    const fileName = `${receipt.delivery.idempotency_key}.json`;
    const filePath = path.resolve(outboxDir, fileName);
    if (fs.existsSync(filePath)) return { status: 'duplicate', path: filePath };
    atomicWriteJson(filePath, receipt);
    return { status: 'queued', path: filePath };
}

export async function deliverCodexAutomationOutbox({
    outboxDir = process.env.CODEX_RUN_RECEIPT_OUTBOX_DIR || 'var/run-receipt-outbox/codex-automations',
    deadLetterDir = process.env.CODEX_RUN_RECEIPT_DEAD_LETTER_DIR || 'var/run-receipt-dead-letter/codex-automations',
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
        return { status: 'unavailable', reason: !endpoint ? 'missing_endpoint' : 'missing_service_token', pending: files.length };
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

async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
    const input = await readStdin();
    const receipt = buildCodexAutomationReceipt(input);
    if (receipt.kind === 'pending') {
        process.stdout.write(`${JSON.stringify(receipt)}\n`);
        return;
    }
    const queued = enqueueCodexAutomationReceipt(receipt);
    const delivery = await deliverCodexAutomationOutbox();
    process.stdout.write(`${JSON.stringify({ queued: queued.status, delivery })}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        process.stderr.write(`[run-receipt] ${error.message}\n`);
        process.exitCode = 1;
    });
}
