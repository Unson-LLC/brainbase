// @ts-check
import { ContractError } from '../multitenant/errors.js';
import { requireSnsAuthority } from './sns-authority.js';

const DEFAULT_LIMIT = 20;

function toDate(value) {
    if (value instanceof Date) return value;
    return new Date(value);
}

function isDue(post, now) {
    if (!post || post.status !== 'scheduled' || !post.scheduled_at) return false;
    const scheduledAt = new Date(post.scheduled_at);
    return !Number.isNaN(scheduledAt.getTime()) && scheduledAt <= now;
}

function failureMemo(error, now) {
    const message = error?.message || String(error || 'unknown error');
    return `[sns-scheduled-publisher failed ${now.toISOString()}] ${message}`;
}

export class SnsScheduledPublisher {
    constructor({ ledgerRepository, publishService, tenantBoundaryAuthorizer = null, now = () => new Date() }) {
        if (!ledgerRepository) throw new Error('ledgerRepository required');
        if (!publishService || typeof publishService.publishPost !== 'function') {
            throw new Error('publishService.publishPost required');
        }
        this.ledgerRepository = ledgerRepository;
        this.publishService = publishService;
        this.tenantBoundaryAuthorizer = typeof tenantBoundaryAuthorizer === 'function'
            ? tenantBoundaryAuthorizer
            : null;
        this.now = now;
    }

    async run({
        actor = {},
        dry_run = false,
        auto_publish_enabled = false,
        limit = DEFAULT_LIMIT
    } = {}) {
        const authority = requireSnsAuthority(actor);
        const currentNow = toDate(this.now());
        const scheduled = await this.ledgerRepository.listPosts({ status: 'scheduled' }, authority);
        const duePosts = scheduled
            .filter((post) => isDue(post, currentNow))
            .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
            .slice(0, limit);
        const result = {
            scanned: scheduled.length,
            due: duePosts.length,
            posted: 0,
            failed: 0,
            skipped: 0,
            dry_run,
            due_posts: duePosts.map((post) => post.id),
            posted_posts: [],
            failed_posts: [],
            skipped_posts: []
        };

        if (dry_run) return result;

        if (!auto_publish_enabled) {
            result.skipped = duePosts.length;
            result.skipped_posts = duePosts.map((post) => ({
                post_id: post.id,
                reason: 'auto_publish_disabled'
            }));
            return result;
        }

        for (const post of duePosts) {
            await this._authorizeTenantBoundary(post);
            const claimed = await this._claim(post, currentNow, authority);
            if (!claimed) {
                result.skipped += 1;
                result.skipped_posts.push({ post_id: post.id, reason: 'claim_lost' });
                continue;
            }
            try {
                const published = await this.publishService.publishPost(claimed.id, {
                    actor: authority,
                    dry_run: false,
                    confirm_public_post: true
                });
                result.posted += 1;
                result.posted_posts.push({
                    post_id: published.post?.id || claimed.id,
                    posted_url: published.post?.posted_url || null
                });
            } catch (error) {
                result.failed += 1;
                const failed = await this.ledgerRepository.updatePost(claimed.id, {
                    status: 'publish_failed',
                    memo: [claimed.memo, failureMemo(error, currentNow)].filter(Boolean).join('\n')
                }, authority);
                result.failed_posts.push({
                    post_id: claimed.id,
                    error: error?.message || String(error),
                    status: failed?.status || 'publish_failed'
                });
            }
        }

        return result;
    }

    async _authorizeTenantBoundary(post) {
        if (!this.tenantBoundaryAuthorizer) {
            throw new ContractError('UPSTREAM_UNAVAILABLE', {
                status: 503,
                retryable: true,
                fault_domain: 'brainbase_cloud'
            });
        }
        const binding = post?.evidence?.tenant_boundary;
        if (!binding || typeof binding !== 'object' || Array.isArray(binding)
            || !binding.tenant_context?.tenant?.tenant_id
            || !binding.tenant_context?.tenant?.tenant_revision
            || !binding.resource_ref?.object_type
            || !binding.resource_ref?.resource_id) {
            throw new ContractError('TENANT_BOUNDARY_INVALID', { status: 400 });
        }
        const authorization = await this.tenantBoundaryAuthorizer(structuredClone(binding));
        if (authorization?.authorized !== true) {
            throw new ContractError('UPSTREAM_UNAVAILABLE', {
                status: 503,
                retryable: true,
                fault_domain: 'brainbase_cloud'
            });
        }
    }

    async _claim(post, now, actor) {
        if (typeof this.ledgerRepository.claimScheduledPost === 'function') {
            return this.ledgerRepository.claimScheduledPost(post.id, { now }, actor);
        }
        const fresh = await this.ledgerRepository.findById(post.id, actor);
        if (!isDue(fresh, now)) return null;
        return this.ledgerRepository.updatePost(post.id, { status: 'publishing' }, actor);
    }
}

export const __private__ = {
    isDue,
    failureMemo
};
