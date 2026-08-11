#!/usr/bin/env node
// 既存の brainbase_source_ready な meeting_note_draft run を
// transcript同梱のEve dispatchへバックフィルする運用スクリプト。
// 手順の正本: docs/runbooks/eve-meeting-note-backfill.md
//
// Usage:
//   node script/backfill-eve-meeting-note-dispatch.mjs \
//     --ledger <path/to/var/workflow-ledger.json> \
//     [--base-url http://localhost:31013] \
//     [--api-key $INTERNAL_API_SECRET] \
//     [--run-id <run_id> ...] \
//     [--execute]
//
// デフォルトはdry-run（候補一覧の表示のみ）。--execute で実dispatchする。

import fs from 'node:fs';

function parseArgs(argv) {
    const args = { runIds: [], execute: false, baseUrl: 'http://localhost:31013' };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--ledger') args.ledger = argv[++i];
        else if (arg === '--base-url') args.baseUrl = argv[++i];
        else if (arg === '--api-key') args.apiKey = argv[++i];
        else if (arg === '--run-id') args.runIds.push(argv[++i]);
        else if (arg === '--execute') args.execute = true;
        else throw new Error(`unknown argument: ${arg}`);
    }
    if (!args.ledger) throw new Error('--ledger <path> is required');
    if (args.execute && args.runIds.length !== 1) {
        throw new Error('--execute requires exactly one --run-id');
    }
    return args;
}

function listBackfillCandidates(ledger, runIdFilter) {
    const outputs = Array.isArray(ledger.outputs) ? ledger.outputs : [];
    return outputs
        .filter((output) => output?.metadata?.output_key === 'meeting_note_draft')
        .filter((output) => output?.payload?.generation_status === 'brainbase_source_ready')
        .filter((output) => runIdFilter.length === 0 || runIdFilter.includes(output.workflow_run_id))
        .map((output) => ({
            run_id: output.workflow_run_id,
            output_id: output.id,
            org_id: output.org_id,
            project_id: output.project_id,
            package_id: output.metadata?.package_id || null,
            loop_intent_id: output.metadata?.loop_intent_id || null,
            source_text_hash: output.payload?.source_text_hash || null,
            title: output.payload?.title || null
        }));
}

async function dispatchCandidate(candidate, { baseUrl, apiKey }) {
    const response = await fetch(`${baseUrl}/api/workflows/control/loop-intents/${candidate.loop_intent_id}/eve-session`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(apiKey ? { 'x-internal-api-key': apiKey } : {})
        },
        body: JSON.stringify({
            force_new_session: true,
            meeting_note_generation: { run_id: candidate.run_id }
        })
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
}

// AppError responses come in two shapes: 400s from the eve-session route carry
// { error: <string>, state_transition }, while the default envelope nests
// { error: { code, message } }. Surface both without printing [object Object].
function describeDispatchFailure(body = {}) {
    const error = body.error;
    const message = typeof error === 'string'
        ? error
        : error?.message || error?.code || JSON.stringify(body).slice(0, 200);
    return body.state_transition ? `${body.state_transition}: ${message}` : message;
}

async function main() {
    const args = parseArgs(process.argv);
    const ledger = JSON.parse(fs.readFileSync(args.ledger, 'utf8'));
    const candidates = listBackfillCandidates(ledger, args.runIds);

    console.log(`backfill candidates: ${candidates.length}`);
    for (const candidate of candidates) {
        console.log(`- run=${candidate.run_id} package=${candidate.package_id} hash=${candidate.source_text_hash} title=${candidate.title}`);
        if (!candidate.loop_intent_id) {
            console.log('  -> skip: loop_intent_id missing on output metadata');
            continue;
        }
        if (!candidate.source_text_hash) {
            console.log('  -> skip: source_text_hash missing (re-ingest the recording first)');
            continue;
        }
        if (!args.execute) {
            console.log('  -> dry-run (use --execute to dispatch)');
            continue;
        }
        try {
            const result = await dispatchCandidate(candidate, args);
            const dispatch = result.body?.eve_session_dispatch;
            if (result.status === 201 && dispatch) {
                console.log(`  -> dispatched: eve_run=${dispatch.run?.id} session=${dispatch.eve_session?.session_id}`);
            } else {
                console.log(`  -> failed (${result.status}): ${describeDispatchFailure(result.body)}`);
            }
        } catch (error) {
            console.log(`  -> failed: ${error?.message || error}`);
        }
    }
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});
