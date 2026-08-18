// @ts-check
import express from 'express';

import { AccountService } from '../services/account/account-service.js';
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
    if (Number.isInteger(error?.status) && typeof error?.code === 'string') {
        return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return res.status(500).json({ error: 'sns_growth_route_failed' });
}

function credentialRefForUi(credentialRef, env = process.env) {
    if (!credentialRef || typeof credentialRef !== 'object') return null;
    const allowedKeys = ['provider', 'path', 'version', 'env', 'project'];
    const safe = {};
    for (const key of allowedKeys) {
        if (credentialRef[key]) safe[key] = credentialRef[key];
    }
    if (credentialRef.env) {
        safe.env_present = Boolean(env[credentialRef.env]);
    }
    safe.posting_bridge_env_present = ['X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET']
        .every((key) => Boolean(String(env[key] || '').trim()));
    return safe;
}

async function accountWithUiState(accountService, account, env = process.env) {
    const defaults = {};
    for (const purpose of ['sns_posting', 'sns_metrics']) {
        const current = await accountService.getDefault('person', 'sato_keigo', account.service, purpose);
        defaults[purpose] = current?.id === account.id;
    }
    return {
        id: account.id,
        service: account.service,
        scope_type: account.scope_type,
        owner_person_id: account.owner_person_id,
        org_id: account.org_id,
        project_id: account.project_id,
        display_name: account.display_name,
        external_account_id: account.external_account_id,
        external_handle: account.external_handle,
        status: account.status,
        capabilities: account.capabilities || [],
        credential_ref: credentialRefForUi(account.credential_ref, env),
        defaults,
        last_verified_at: account.last_verified_at || null,
        updated_at: account.updated_at || null
    };
}

async function findVisibleAccount(accountService, accountId, actor) {
    const visibleAccounts = await accountService.listForActor(actor);
    return visibleAccounts.find((account) => account.id === accountId) || null;
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

function hasSchedule(post) {
    if (!post) return false;
    if (post.scheduled_at) return true;
    return Boolean(post.date && post.time);
}

function normalizeOperationalPatch(existing, patch = {}) {
    if (!patch || typeof patch !== 'object') return {};
    if (patch.status !== 'approved') return patch;
    if (!hasSchedule(existing)) return patch;
    return {
        ...patch,
        status: 'scheduled'
    };
}

export function createSnsGrowthRouter({
    repository = null,
    publishService = null,
    accountService = null,
    accountProvider = null,
    env = process.env
} = {}) {
    const router = express.Router();
    const ledger = repository || new InMemorySnsPostingLedgerRepository();
    const accounts = accountService || new AccountService();

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

    router.get('/accounts', async (_req, res) => {
        try {
            const visibleAccounts = await accounts.listForActor(defaultActor());
            const xAccounts = visibleAccounts.filter((account) => account.service === 'x');
            const responseAccounts = await Promise.all(xAccounts.map((account) => accountWithUiState(accounts, account, env)));
            res.json({ accounts: responseAccounts });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    router.post('/accounts/:id/default', async (req, res) => {
        try {
            const purpose = req.body?.purpose ? String(req.body.purpose) : 'sns_posting';
            if (!['sns_posting', 'sns_metrics'].includes(purpose)) {
                return res.status(400).json({ error: 'invalid account default purpose', code: 'invalid_account_default_purpose' });
            }
            const actor = defaultActor();
            const visibleAccount = await findVisibleAccount(accounts, req.params.id, actor);
            if (!visibleAccount || visibleAccount.service !== 'x') return res.status(404).json({ error: 'account not found' });
            await accounts.setDefault({
                subject_type: 'person',
                subject_id: 'sato_keigo',
                service: 'x',
                purpose,
                account_id: req.params.id
            }, actor);
            const account = await accounts.repository.findById(req.params.id);
            res.json({ account: await accountWithUiState(accounts, account || visibleAccount, env) });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    router.post('/accounts/:id/health-check', async (req, res) => {
        try {
            const account = await findVisibleAccount(accounts, req.params.id, defaultActor());
            if (!account || account.service !== 'x') return res.status(404).json({ error: 'account not found' });
            if (!accountProvider?.healthCheck) {
                return res.status(503).json({ error: 'X account provider unavailable', code: 'x_account_provider_unavailable' });
            }
            const healthResult = await accountProvider.healthCheck(account.credential_ref);
            let rateLimit = null;
            if (accountProvider.getRateLimitStatus) {
                try {
                    rateLimit = await accountProvider.getRateLimitStatus(account.credential_ref);
                } catch (error) {
                    rateLimit = { remaining: null, resetAt: null, reason: error?.code || error?.message || 'rate_limit_unavailable' };
                }
            }
            res.json({
                account: await accountWithUiState(accounts, account, env),
                health: {
                    ok: Boolean(healthResult?.ok),
                    reason: healthResult?.reason || null,
                    credential_mode: healthResult?.credential_mode || null,
                    rate_limit: rateLimit
                }
            });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    router.post('/posts/:id/publish', async (req, res) => {
        try {
            if (req.body?.dry_run !== true) {
                return res.status(409).json({
                    error: 'Direct public SNS publish is disabled; use the scheduled publisher',
                    code: 'sns_direct_public_publish_disabled'
                });
            }
            if (!publishService) {
                return res.status(503).json({
                    error: 'SNS publish service unavailable',
                    code: 'sns_publish_service_unavailable'
                });
            }
            const result = await publishService.publishPost(req.params.id, {
                actor: defaultActor(),
                dry_run: true,
                confirm_public_post: false
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
            const existing = await ledger.findById(req.params.id);
            if (!existing) return res.status(404).json({ error: 'sns post not found' });
            const patch = normalizeOperationalPatch(existing, req.body || {});
            const post = await ledger.updatePost(req.params.id, patch, defaultActor());
            if (!post) return res.status(404).json({ error: 'sns post not found' });
            res.json({ post });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    return router;
}
