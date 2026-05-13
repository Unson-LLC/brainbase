#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import process from 'node:process';
import pg from 'pg';

import { PgCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../server/services/candidate-store/promotion-gate-service.js';
import { PgSnsPostingLedgerRepository } from '../server/services/sns/posting-ledger-repository.js';
import {
    buildSnsFeedbackCandidateDraft,
    SnsFeedbackLearningService
} from '../server/services/sns/feedback-learning-service.js';
import { databaseConfig } from './migrate-m5a-production-schema.js';

const { Pool } = pg;

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
        postId: null,
        postedUrl: null,
        metricsJson: null,
        postedAt: new Date().toISOString(),
        learningReady: false,
        dryRun: false,
        json: false
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--date') args.date = argv[++i];
        if (arg === '--post-id') args.postId = argv[++i];
        if (arg === '--posted-url') args.postedUrl = argv[++i];
        if (arg === '--metrics-json') args.metricsJson = argv[++i];
        if (arg === '--posted-at') args.postedAt = argv[++i];
        if (arg === '--learning-ready') args.learningReady = true;
        if (arg === '--dry-run') args.dryRun = true;
        if (arg === '--json') args.json = true;
    }
    return args;
}

export function validateArgs(args) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(args.date)) {
        throw new Error('--date must be YYYY-MM-DD');
    }
    if (args.postId && args.postedUrl && !/^https:\/\/x\.com\/[^/]+\/status\/\d+/u.test(args.postedUrl)) {
        throw new Error('--posted-url must be an X status URL');
    }
    if ((args.postedUrl || args.metricsJson || args.learningReady) && !args.postId) {
        throw new Error('--post-id is required when recording feedback fields');
    }
    if (args.learningReady && (!args.postedUrl && !args.metricsJson)) {
        throw new Error('--learning-ready requires --posted-url and/or --metrics-json in the same command, or an already posted ledger record');
    }
}

export function parseMetrics(input) {
    if (!input) return null;
    const raw = input.startsWith('@') ? fs.readFileSync(input.slice(1), 'utf8') : input;
    return JSON.parse(raw);
}

export async function maybeRecordFeedback(repository, args) {
    if (!args.postId || (!args.postedUrl && !args.metricsJson && !args.learningReady)) return null;
    const post = await repository.findById(args.postId);
    if (!post) throw new Error(`SNS post not found: ${args.postId}`);
    const metrics = parseMetrics(args.metricsJson);
    if (args.dryRun) {
        return { post, dry_run_patch: { posted_url: args.postedUrl, metrics_snapshot: metrics, learning_ready: args.learningReady } };
    }

    let current = post;
    if (args.postedUrl || metrics) {
        if (current.status === 'approved') {
            current = await repository.updatePost(current.id, { status: 'scheduled' }, { actor_person_id: 'sato_keigo' });
        }
        const patch = {
            posted_url: args.postedUrl || current.posted_url,
            posted_at: current.posted_at || args.postedAt,
            metrics_snapshot: metrics || undefined
        };
        if (current.status === 'scheduled') patch.status = 'posted';
        current = await repository.updatePost(current.id, patch, { actor_person_id: 'sato_keigo' });
    }
    if (args.learningReady && current.status === 'posted') {
        current = await repository.updatePost(current.id, { status: 'learning_ready' }, { actor_person_id: 'sato_keigo' });
    }
    return { post: current };
}

async function dryRunCandidates(repository, args) {
    const posts = args.postId
        ? [await repository.findById(args.postId)]
        : await repository.listPosts({ startDate: args.date, endDate: args.date, status: 'learning_ready' });
    return posts.filter(Boolean).map((post) => {
        try {
            return { post_id: post.id, candidate: buildSnsFeedbackCandidateDraft(post) };
        } catch (error) {
            return { post_id: post.id, skipped: true, reason: error.message };
        }
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    validateArgs(args);
    const pool = new Pool(databaseConfig());
    try {
        const ledgerRepository = new PgSnsPostingLedgerRepository({ pool });
        const recorded = await maybeRecordFeedback(ledgerRepository, args);
        if (args.dryRun) {
            const candidates = await dryRunCandidates(ledgerRepository, args);
            console.log(JSON.stringify({ recorded, candidates }, null, 2));
            return;
        }
        const candidateRepository = new PgCandidateRepository({ pool });
        const candidateService = new PromotionGateService({ repository: candidateRepository });
        const service = new SnsFeedbackLearningService({ ledgerRepository, candidateService });
        const results = args.postId
            ? [await service.createLearningCandidateForPost(args.postId, { actor_person_id: 'sato_keigo' })]
            : await service.createLearningCandidatesForDate(args.date, { actor_person_id: 'sato_keigo' });
        console.log(JSON.stringify({
            date: args.date,
            recorded: recorded?.post?.id || null,
            created: results.filter((result) => result.created).length,
            skipped: results.filter((result) => result.skipped || result.duplicate || result.blocked).length,
            candidate_ids: results.map((result) => result.candidate?.id).filter(Boolean)
        }, null, 2));
    } finally {
        await pool.end();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
