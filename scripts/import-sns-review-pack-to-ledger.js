#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SHARED_SNS_ROOT = '/Users/ksato/workspace/shared/_codex/sns';
const DEFAULT_DAILY_BRIEFS_DIR = path.join(SHARED_SNS_ROOT, 'x/ops/daily-briefs');

function todayJst() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

export function parseArgs(argv) {
    const args = {
        date: todayJst(),
        file: null,
        baseUrl: process.env.BRAINBASE_URL || 'http://localhost:31013',
        dryRun: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--date') args.date = argv[++i];
        if (arg === '--file') args.file = argv[++i];
        if (arg === '--base-url') args.baseUrl = argv[++i];
        if (arg === '--dry-run') args.dryRun = true;
    }
    return args;
}

function defaultFileForDate(date) {
    return path.join(DEFAULT_DAILY_BRIEFS_DIR, `${date}-signals.json`);
}

function sourceTypeForPost(post) {
    if (!post.source_url) return 'Personal KG';
    if (post.lane === 'peer_circle') return 'Peer Circle';
    return 'News';
}

export function reviewPackToLedgerPayload(input) {
    const reviewPack = input?.reviewPack;
    if (!reviewPack || !Array.isArray(reviewPack.posts)) {
        throw new Error('signals JSON must include reviewPack.posts');
    }
    return {
        account_id: input.account_id || 'acc_x_sato',
        account_handle: input.account_handle || '@AIBizNavigator',
        drafts: reviewPack.posts.map((post, index) => ({
            id: `ohayo_${reviewPack.date}_${post.slot || index + 1}`,
            date: reviewPack.date,
            slot_index: index + 1,
            lane: post.lane || null,
            format: post.source_url ? 'quote_repost_commentary' : 'standalone',
            body: post.body || '',
            title: post.topic || post.label || null,
            source_type: sourceTypeForPost(post),
            source_url: post.source_url || null,
            persona_brain: post.persona_brain || {},
            algorithm_fit: post.algorithm_fit || null,
            generation_context_evidence: post.generation_context_evidence || null,
            graph_check: post.graph_check || {},
            quality_gate: post.quality_gate || {},
            safety: {
                requires_human_review: true,
                persona_affect: post.quality_gate?.persona_affect || null
            },
            evidence_ids: [],
            derived_from: []
        }))
    };
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Ledger import failed: ${response.status} ${body.error || ''}`.trim());
    }
    return body;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const filePath = args.file || defaultFileForDate(args.date);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const payload = reviewPackToLedgerPayload(parsed);
    if (args.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    const result = await postJson(`${args.baseUrl.replace(/\/$/u, '')}/api/sns-growth/review-pack`, payload);
    console.log(JSON.stringify({
        imported_file: filePath,
        created: result.created?.length || 0,
        updated: result.updated?.length || 0,
        summary: result.summary
    }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
