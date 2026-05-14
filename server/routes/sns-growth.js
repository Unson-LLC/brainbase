// @ts-check
import express from 'express';

import {
    InMemorySnsPostingLedgerRepository,
    InvalidSnsPostTransitionError,
    SnsPostValidationError,
    summarizeSnsPosts
} from '../services/sns/posting-ledger-repository.js';

function defaultActor() {
    return {
        sub: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        role: 'ceo',
        org_ids: ['unson', 'salestailor', 'techknight', 'baao']
    };
}

function currentWeekRange(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + mondayOffset);
    const startDate = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 6);
    const endDate = d.toISOString().slice(0, 10);
    return { startDate, endDate };
}

function sendRouteError(res, error) {
    if (error instanceof InvalidSnsPostTransitionError) {
        return res.status(409).json({ error: error.message, code: 'invalid_status_transition' });
    }
    if (error instanceof SnsPostValidationError) {
        return res.status(400).json({ error: error.message, code: 'invalid_sns_post' });
    }
    return res.status(500).json({ error: 'sns_growth_route_failed' });
}

function normalizeMetricsSnapshot(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const keys = ['impressions', 'likes', 'reposts', 'replies', 'bookmarks', 'profile_visits'];
    const snapshot = {};
    for (const key of keys) {
        if (input[key] === undefined || input[key] === null || input[key] === '') continue;
        const value = Number(input[key]);
        if (!Number.isFinite(value) || value < 0) {
            throw new SnsPostValidationError(`invalid metric value: ${key}`);
        }
        snapshot[key] = value;
    }
    return Object.keys(snapshot).length > 0 ? snapshot : null;
}

export function createSnsGrowthRouter({ repository = null, publishService = null } = {}) {
    const router = express.Router();
    const ledger = repository || new InMemorySnsPostingLedgerRepository();

    router.get('/posts', async (req, res) => {
        try {
            const fallback = currentWeekRange();
            const startDate = String(req.query.startDate || fallback.startDate);
            const endDate = String(req.query.endDate || fallback.endDate);
            const status = req.query.status ? String(req.query.status) : null;
            const posts = await ledger.listPosts({ startDate, endDate, status });
            res.json({
                range: { startDate, endDate },
                posts,
                summary: summarizeSnsPosts(posts)
            });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    router.post('/review-pack', async (req, res) => {
        try {
            const result = await ledger.upsertReviewPack({
                account_id: req.body?.account_id,
                account_handle: req.body?.account_handle,
                drafts: req.body?.drafts || req.body?.pack?.drafts || []
            });
            const posts = await ledger.listPosts({});
            res.status(201).json({
                ...result,
                summary: summarizeSnsPosts(posts)
            });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    router.post('/posts/:id/publish', async (req, res) => {
        try {
            if (!publishService) {
                return res.status(503).json({
                    error: 'SNS publish service unavailable',
                    code: 'sns_publish_service_unavailable'
                });
            }
            const result = await publishService.publishPost(req.params.id, {
                actor: defaultActor(),
                dry_run: req.body?.dry_run === true,
                confirm_public_post: req.body?.confirm_public_post === true
            });
            res.json(result);
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    router.post('/posts/:id/feedback', async (req, res) => {
        try {
            const existing = await ledger.findById(req.params.id);
            if (!existing) return res.status(404).json({ error: 'sns post not found' });
            const metricsSnapshot = normalizeMetricsSnapshot(req.body?.metrics_snapshot || req.body?.metrics);
            const markLearningReady = req.body?.mark_learning_ready === true;
            if (!metricsSnapshot && !markLearningReady) {
                return res.status(400).json({
                    error: 'metrics_snapshot or mark_learning_ready required',
                    code: 'sns_feedback_required'
                });
            }
            const hasMetricsEvidence = metricsSnapshot || (Array.isArray(existing.metrics_snapshots) && existing.metrics_snapshots.length > 0);
            if (markLearningReady && !hasMetricsEvidence) {
                return res.status(400).json({
                    error: 'metrics_snapshot required before learning_ready',
                    code: 'sns_feedback_metrics_required'
                });
            }
            const patch = {};
            if (metricsSnapshot) patch.metrics_snapshot = metricsSnapshot;
            if (markLearningReady && existing.status === 'posted') patch.status = 'learning_ready';
            const post = await ledger.updatePost(req.params.id, patch, defaultActor());
            res.json({ post });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    router.patch('/posts/:id', async (req, res) => {
        try {
            const post = await ledger.updatePost(req.params.id, req.body || {}, defaultActor());
            if (!post) return res.status(404).json({ error: 'sns post not found' });
            res.json({ post });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    return router;
}
