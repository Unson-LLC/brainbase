#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { resolveSnsRoot } from './workspace-paths.js';
import { normalizeSnsTenantBoundary } from '../server/services/sns/posting-ledger-repository.js';

const SNS_ROOT = resolveSnsRoot();
const DEFAULT_DAILY_BRIEFS_DIR = path.join(SNS_ROOT, 'x/ops/daily-briefs');

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

export function resolveSnsTenantBoundary(env = process.env) {
    const required = [
        'BRAINBASE_SNS_TENANT_ID',
        'BRAINBASE_SNS_TENANT_REVISION',
        'BRAINBASE_SNS_RESOURCE_OBJECT_TYPE',
        'BRAINBASE_SNS_RESOURCE_ID'
    ];
    const missing = required.filter((name) => typeof env[name] !== 'string' || env[name].length === 0);
    if (missing.length > 0) {
        throw new Error(`SNS tenant boundary environment is required: ${missing.join(', ')}`);
    }
    return normalizeSnsTenantBoundary({
        tenant_context: {
            tenant: {
                tenant_id: env.BRAINBASE_SNS_TENANT_ID,
                tenant_revision: env.BRAINBASE_SNS_TENANT_REVISION
            }
        },
        resource_ref: {
            object_type: env.BRAINBASE_SNS_RESOURCE_OBJECT_TYPE,
            resource_id: env.BRAINBASE_SNS_RESOURCE_ID
        }
    }, { required: true });
}

export function reviewPackToLedgerPayload(input, {
    tenantBoundary = input?.tenant_boundary,
    requireTenantBoundary = false
} = {}) {
    const reviewPack = input?.reviewPack;
    if (!reviewPack || !Array.isArray(reviewPack.posts)) {
        throw new Error('signals JSON must include reviewPack.posts');
    }
    if (reviewPack.posts.length === 0) {
        const holdReasons = Array.isArray(reviewPack.holds)
            ? reviewPack.holds
                .flatMap((hold) => hold.reasons || [])
                .filter(Boolean)
            : [];
        const suffix = holdReasons.length > 0
            ? `; holds=${[...new Set(holdReasons)].join(',')}`
            : '';
        throw new Error(`reviewPack.posts is empty; SNS Ledger import would create no reviewable posts${suffix}`);
    }
    const canonicalTenantBoundary = normalizeSnsTenantBoundary(tenantBoundary, {
        required: requireTenantBoundary
    });
    return {
        account_id: input.account_id || 'acc_x_sato',
        account_handle: input.account_handle || '@AIBizNavigator',
        drafts: reviewPack.posts.map((post, index) => ({
            id: `ohayo_${reviewPack.date}_${post.slot || index + 1}`,
            date: reviewPack.date,
            slot_index: index + 1,
            time: post.time || null,
            scheduled_at: post.scheduled_at || null,
            lane: post.lane || null,
            format: post.format || (post.source_url ? 'quote_repost_commentary' : 'standalone'),
            body: post.body || '',
            title: post.topic || post.label || null,
            source_type: sourceTypeForPost(post),
            source_url: post.source_url || null,
            persona_brain: post.persona_brain || {},
            algorithm_fit: post.algorithm_fit || null,
            lifelog_check: post.lifelog_check || null,
            generation_context_evidence: post.generation_context_evidence || null,
            graph_check: post.graph_check || {},
            quality_gate: post.quality_gate || {},
            safety: {
                requires_human_review: true,
                lifelog_integrity: post.quality_gate?.check_type === 'lifelog_integrity'
                    ? post.quality_gate
                    : null,
                persona_affect: post.quality_gate?.persona_affect || null
            },
            evidence_ids: post.lifelog_check?.evidence_ids || [],
            derived_from: post.lifelog_check?.source_id ? [post.lifelog_check.source_id] : [],
            ...(canonicalTenantBoundary ? { tenant_boundary: structuredClone(canonicalTenantBoundary) } : {})
        }))
    };
}

function countByReason(skipped = []) {
    const counts = {};
    for (const item of skipped) {
        const reason = item?.reason || 'unknown';
        counts[reason] = (counts[reason] || 0) + 1;
    }
    return counts;
}

export function summarizeImportResult(result, { importedFile, expectedDrafts } = {}) {
    const created = result.created?.length || 0;
    const updated = result.updated?.length || 0;
    const skippedItems = result.skipped || [];
    const skipped = skippedItems.length;
    const expected = Number(expectedDrafts ?? created + updated + skipped);
    const success = expected > 0 && (created + updated) > 0;
    return {
        imported_file: importedFile || null,
        created,
        updated,
        skipped,
        success,
        skipped_reasons: countByReason(skippedItems),
        skipped_items: skippedItems,
        summary: result.summary
    };
}

export function assertImportCreatedReviewablePosts(summary) {
    if (!summary.success) {
        const reasons = Object.entries(summary.skipped_reasons || {})
            .map(([reason, count]) => `${reason}:${count}`)
            .join(',');
        throw new Error(`SNS Ledger import created no reviewable posts; created=${summary.created} updated=${summary.updated} skipped=${summary.skipped}${reasons ? ` reasons=${reasons}` : ''}`);
    }
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
    const tenantBoundary = resolveSnsTenantBoundary();
    const payload = reviewPackToLedgerPayload(parsed, {
        tenantBoundary,
        requireTenantBoundary: true
    });
    if (args.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    const result = await postJson(`${args.baseUrl.replace(/\/$/u, '')}/api/sns-growth/review-pack`, payload);
    const summary = summarizeImportResult(result, {
        importedFile: filePath,
        expectedDrafts: payload.drafts.length
    });
    console.log(JSON.stringify(summary, null, 2));
    assertImportCreatedReviewablePosts(summary);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
