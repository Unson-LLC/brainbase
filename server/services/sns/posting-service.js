// @ts-check
/**
 * SNS Posting Service (SPEC-sns-posting-engine)
 * 旧 sns_post.py 相当を internalize
 */

import { SchedulerService } from './scheduler-service.js';
import {
    assertPersonalKgCandidateScope,
    requirePersonalKgIdentity
} from './personal-kg-identity.js';

function personalKgIdentityFromActor(actor = {}) {
    const organizationId = actor.organization_id
        || actor.organizationId
        || actor.tenant_id
        || actor.tenantId
        || (Array.isArray(actor.org_ids) && actor.org_ids.length === 1 ? actor.org_ids[0] : null);
    return requirePersonalKgIdentity({
        ...actor,
        ownerPersonId: actor.owner_person_id || actor.ownerPersonId || actor.person_id || actor.personId || actor.sub,
        actorPersonId: actor.actor_person_id || actor.actorPersonId || actor.person_id || actor.personId || actor.sub,
        organizationId
    });
}

export class PostingService {
    /**
     * @param {{
     *   accountService: any,
     *   providerRegistry: any,
     *   graphWriter?: { createEvent: (e:any) => Promise<{id:string}> },
     *   candidateRepository?: any,
     *   scheduler?: SchedulerService
     * }} deps
     */
    constructor({ accountService, providerRegistry, graphWriter, candidateRepository = null, scheduler = null }) {
        if (!accountService) throw new Error('accountService required');
        if (!providerRegistry) throw new Error('providerRegistry required');
        this.accountService = accountService;
        this.providerRegistry = providerRegistry;
        this.graphWriter = graphWriter || { createEvent: async (e) => ({ id: `evt_${Date.now()}` }) };
        this.candidateRepository = candidateRepository;
        this.scheduler = scheduler || new SchedulerService();
    }

    /**
     * @param {any} actor
     * @param {{account_id: string, body: string, source_candidate_id?: string, dry_run?: boolean}} input
     */
    async post(actor, input) {
        const { account_id, body, source_candidate_id = null, dry_run = false } = input;

        // INV-1: canUseForPost を必ず呼ぶ
        const verdict = await this.accountService.canUseForPost(account_id, actor);
        if (!verdict.allow) {
            return { posted: false, reason: verdict.reason };
        }

        const account = await this.accountService.repository.findById(account_id);
        if (!account) return { posted: false, reason: 'account-not-found' };

        // INV-2: candidate-store 由来は promoted_to_graph 必須
        if (source_candidate_id && this.candidateRepository) {
            const identity = personalKgIdentityFromActor(actor);
            const c = await this.candidateRepository.findById(source_candidate_id);
            if (!c) return { posted: false, reason: 'source-candidate-not-found' };
            try {
                assertPersonalKgCandidateScope(c, identity);
            } catch {
                return { posted: false, reason: 'source-candidate-scope-mismatch' };
            }
            if (c.promotion_status !== 'promoted_to_graph') {
                return { posted: false, reason: 'source-candidate-not-promoted' };
            }
        }

        const provider = this.providerRegistry.get(account.service);
        if (!provider) return { posted: false, reason: `provider-not-registered:${account.service}` };
        if (typeof provider.post !== 'function') return { posted: false, reason: 'provider-missing-post' };

        // INV-5: dry_run 時は X API を呼ばない
        if (dry_run) {
            return {
                posted: true,
                dry_run: true,
                tweet_id: `dryrun_${Date.now()}`,
                account_id,
                body
            };
        }

        let result;
        try {
            result = await provider.post(account.credential_ref, { text: body });
        } catch (e) {
            if (e.code === 'rate_limited') return { posted: false, reason: 'rate-limited', queued: true };
            return { posted: false, reason: `post-failed:${e.code || 'unknown'}`, error: e.message };
        }

        // INV-3: USED_FOR_POST audit + graph event
        await this.accountService.recordPost(account_id, actor);
        const event = await this.graphWriter.createEvent({
            kind: 'sns_post',
            service: account.service,
            account_id,
            actor_person_id: actor.sub || actor.actor_person_id,
            tweet_id: result.tweet_id,
            body_hash: hashBody(body),
            source_candidate_id,
            occurred_at: new Date().toISOString()
        });

        return { posted: true, tweet_id: result.tweet_id, event_id: event.id };
    }

    /**
     * @param {any} actor
     * @param {{account_id: string, body: string, post_at: string|Date, source_candidate_id?: string}} input
     */
    async schedule(actor, input) {
        const post_at = input.post_at instanceof Date ? input.post_at : new Date(input.post_at);
        const job_id = this.scheduler.schedule({
            run_at: post_at,
            actor,
            input: { account_id: input.account_id, body: input.body, source_candidate_id: input.source_candidate_id }
        });
        return { job_id };
    }

    async _executeJob(job) {
        return this.post(job.actor, job.input);
    }

    async tick(now = new Date()) {
        return this.scheduler.tick(now, (job) => this._executeJob(job));
    }
}

function hashBody(body) {
    // crypto sha256 を使うことで実装明示
    let h = 0;
    for (let i = 0; i < body.length; i += 1) {
        h = ((h << 5) - h) + body.charCodeAt(i);
        h |= 0;
    }
    return `h${h}`;
}
