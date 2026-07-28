import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    createIdempotencyKey,
    postReceipt,
    requireSingleLine,
    toIso
} from '../../../scripts/run-receipt/reporter-core.mjs';

const CONCLUSIONS = Object.freeze({
    success: { status: 'success', action: 'none' },
    failure: { status: 'failed', action: 'check_error' },
    timed_out: { status: 'failed', action: 'check_error' },
    startup_failure: { status: 'failed', action: 'check_error' },
    stale: { status: 'failed', action: 'check_error' },
    cancelled: { status: 'cancelled', action: 'none' },
    action_required: { status: 'waiting_human', action: 'review_run' },
    neutral: { status: 'blocked', action: 'review_run' },
    skipped: { status: 'blocked', action: 'review_run' }
});

export function buildGitHubActionsReceipt(input) {
    const repositoryId = requireSingleLine(String(input?.repository_id || ''), 'repository_id');
    const repository = requireSingleLine(input?.repository, 'repository');
    const workflowId = requireSingleLine(String(input?.workflow_id || ''), 'workflow_id');
    const runId = requireSingleLine(String(input?.run_id || ''), 'run_id');
    const runAttempt = requireSingleLine(String(input?.run_attempt || ''), 'run_attempt');
    const projectId = requireSingleLine(input?.project_id, 'project_id');
    const conclusion = requireSingleLine(input?.conclusion, 'conclusion');
    const mapped = CONCLUSIONS[conclusion];
    if (!mapped) throw new Error(`conclusion=${conclusion} is not supported`);

    const sourceWorkflowId = `github:${repositoryId}:workflow:${workflowId}`;
    const externalRunId = `github:${repositoryId}:run:${runId}:attempt:${runAttempt}`;
    const finishedAt = toIso(input.finished_at, 'finished_at');
    const runUrl = `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`;
    const run = {
        project_id: projectId,
        external_run_id: externalRunId,
        workflow_name: input.workflow_name
            ? requireSingleLine(input.workflow_name, 'workflow_name', 120)
            : sourceWorkflowId,
        status: mapped.status,
        evidence_state: 'confirmed',
        ...(input.started_at ? { started_at: toIso(input.started_at, 'started_at') } : {}),
        finished_at: finishedAt,
        summary: `GitHub Actions workflow concluded with ${conclusion}`,
        action_required: mapped.action,
        evidence_refs: [{ kind: 'url', ref: runUrl, label: 'GitHub Actions run' }]
    };
    if (['failed', 'blocked'].includes(mapped.status)) {
        run.blocker_reason = `GitHub Actions authoritative conclusion was ${conclusion}`;
    }
    return {
        contract_version: 'run_receipt.v1',
        source: { type: 'github_actions', workflow_id: sourceWorkflowId, name: repository },
        run,
        delivery: {
            idempotency_key: createIdempotencyKey(projectId, 'github_actions', externalRunId),
            attempt: 1,
            sent_at: finishedAt
        }
    };
}

function writeArtifact(receipt, tempDir) {
    fs.mkdirSync(tempDir, { recursive: true });
    const artifactPath = path.resolve(tempDir, `${receipt.delivery.idempotency_key}.json`);
    fs.writeFileSync(artifactPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    return artifactPath;
}

export async function reportGitHubActionsRun(input, {
    endpoint = process.env.INPUT_ENDPOINT,
    serviceToken = process.env['INPUT_SERVICE-TOKEN'] || process.env.INPUT_SERVICE_TOKEN,
    tempDir = process.env.RUNNER_TEMP || path.join(os.tmpdir(), 'github-actions-run-receipt'),
    fetchImpl = globalThis.fetch,
    maxAttempts = 3,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    now = () => new Date()
} = {}) {
    const receipt = buildGitHubActionsReceipt(input);
    if (!endpoint || !serviceToken || typeof fetchImpl !== 'function') {
        return {
            status: 'unavailable',
            reason: !endpoint ? 'missing_endpoint' : 'missing_service_token',
            artifact_path: writeArtifact(receipt, tempDir)
        };
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        receipt.delivery = { ...receipt.delivery, attempt, sent_at: toIso(now(), 'sent_at') };
        let response;
        try {
            response = await postReceipt(receipt, { endpoint, serviceToken, fetchImpl });
        } catch {
            response = { ok: false, status: 0 };
        }
        if (response.ok) return { status: 'delivered', attempt, http_status: response.status };
        if (attempt < maxAttempts) await sleep(Math.min(250 * (2 ** (attempt - 1)), 2_000));
    }
    return { status: 'failed', reason: 'retry_exhausted', artifact_path: writeArtifact(receipt, tempDir) };
}

function input(name, fallback = undefined) {
    return process.env[`INPUT_${name.toUpperCase()}`] || process.env[`INPUT_${name.toUpperCase().replaceAll('-', '_')}`] || fallback;
}

function appendOutput(name, value) {
    if (!process.env.GITHUB_OUTPUT) return;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

async function main() {
    const now = new Date();
    const result = await reportGitHubActionsRun({
        repository_id: input('repository-id', process.env.GITHUB_REPOSITORY_ID),
        repository: input('repository', process.env.GITHUB_REPOSITORY),
        workflow_id: input('workflow-id', process.env.GITHUB_WORKFLOW_REF),
        workflow_name: input('workflow-name', process.env.GITHUB_WORKFLOW),
        run_id: input('run-id', process.env.GITHUB_RUN_ID),
        run_attempt: input('run-attempt', process.env.GITHUB_RUN_ATTEMPT || '1'),
        project_id: input('project-id'),
        conclusion: input('conclusion'),
        started_at: input('started-at'),
        finished_at: input('finished-at', now.toISOString())
    }, {
        endpoint: input('endpoint'),
        serviceToken: input('service-token')
    });
    appendOutput('delivery-status', result.status);
    if (result.artifact_path) appendOutput('receipt-artifact-path', result.artifact_path);
    process.stdout.write(`[run-receipt] delivery=${result.status}${result.reason ? ` reason=${result.reason}` : ''}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch((error) => {
        process.stderr.write(`[run-receipt] ${error.message}\n`);
        process.exitCode = 1;
    });
}
