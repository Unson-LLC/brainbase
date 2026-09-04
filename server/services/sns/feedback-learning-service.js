// @ts-check
import { DuplicateCandidateError } from '../candidate-store/candidate-repository.js';
import { requirePersonalKgIdentity } from './personal-kg-identity.js';

function latestMetrics(post) {
    const snapshots = Array.isArray(post.metrics_snapshots) ? post.metrics_snapshots : [];
    return snapshots[snapshots.length - 1] || null;
}

function metricLine(metrics) {
    if (!metrics) return 'metrics: 未記録';
    const parts = [
        ['impressions', metrics.impressions],
        ['likes', metrics.likes],
        ['reposts', metrics.reposts],
        ['replies', metrics.replies],
        ['bookmarks', metrics.bookmarks],
        ['profile_visits', metrics.profile_visits]
    ].filter(([, value]) => value !== undefined && value !== null);
    return parts.length > 0
        ? parts.map(([key, value]) => `${key}: ${value}`).join(', ')
        : 'metrics: 記録あり';
}

function engagementRate(metrics) {
    const impressions = Number(metrics?.impressions || 0);
    if (!impressions) return null;
    const engagement = Number(metrics.likes || 0)
        + Number(metrics.reposts || 0)
        + Number(metrics.replies || 0)
        + Number(metrics.bookmarks || 0);
    return Number((engagement / impressions).toFixed(4));
}

function assertEligible(post) {
    if (!post) throw new Error('SNS post not found');
    if (post.learning_candidate_id) throw new Error('SNS post already linked to a learning candidate');
    if (post.status !== 'learning_ready') {
        throw new Error(`SNS post must be learning_ready before candidate handoff: ${post.status}`);
    }
    if (!post.posted_url) throw new Error('posted_url required before candidate handoff');
    if (!latestMetrics(post)) throw new Error('metrics_snapshot required before candidate handoff');
}

export function buildSnsFeedbackCandidateDraft(post, access) {
    assertEligible(post);
    const identity = requirePersonalKgIdentity(access);
    const metrics = latestMetrics(post);
    const rate = engagementRate(metrics);
    return {
        id: `cand_sns_feedback_${post.id}`,
        cognitive_type: 'observation',
        owner_person_id: identity.owner_person_id,
        actor_person_id: identity.actor_person_id,
        organization_id: identity.organization_id,
        source_system: 'sns-feedback',
        source_event_ids: [`sns-post:${post.id}`],
        workspace: 'unson',
        project_code: 'brainbase',
        org_ids: identity.org_ids,
        project_ids: ['brainbase'],
        visibility: 'owner',
        sensitivity: 'internal',
        role_min: 'member',
        agency_level: 'synthesize',
        requires_approval: true,
        evidence_ids: [
            { uri: post.posted_url, kind: 'posted_url' },
            { uri: `sns-ledger:${post.id}`, kind: 'sns_posting_ledger' }
        ],
        permission_snapshot: {
            sns: {
                post_id: post.id,
                account_id: post.account_id,
                account_handle: post.account_handle,
                lane: post.lane,
                source: post.source,
                quality_gate: post.evidence?.quality_gate || {},
                posted_url: post.posted_url,
                metrics_snapshot: metrics,
                engagement_rate: rate,
                learning_policy: 'observation_only_no_content_optimization',
                personal_kg_identity: {
                    owner_person_id: identity.owner_person_id,
                    actor_person_id: identity.actor_person_id,
                    organization_id: identity.organization_id
                }
            }
        },
        body: [
            `SNS feedback observation: ${post.title}`,
            `posted_url: ${post.posted_url}`,
            `lane: ${post.lane || '-'}`,
            metricLine(metrics),
            rate === null ? null : `engagement_rate: ${rate}`,
            'learning_policy: observation_only_no_content_optimization',
            '',
            'post_body:',
            post.body
        ].filter((line) => line !== null).join('\n'),
        redaction_status: 'none',
        confidence: 0.7
    };
}

export class SnsFeedbackLearningService {
    constructor({ ledgerRepository, candidateService }) {
        if (!ledgerRepository) throw new Error('ledgerRepository required');
        if (!candidateService || typeof candidateService.createCandidate !== 'function') {
            throw new Error('candidateService with createCandidate required');
        }
        this.ledgerRepository = ledgerRepository;
        this.candidateService = candidateService;
    }

    async createLearningCandidateForPost(postId, actor = {}) {
        const identity = requirePersonalKgIdentity(actor);
        const post = await this.ledgerRepository.findById(postId, identity);
        const draft = buildSnsFeedbackCandidateDraft(post, identity);
        try {
            const result = await this.candidateService.createCandidate(draft);
            if (result.blocked) return { post, blocked: true, findings: result.findings || [] };
            const linked = await this.ledgerRepository.updatePost(post.id, {
                learning_candidate_id: result.candidate.id
            }, identity);
            return { post: linked, candidate: result.candidate, created: true };
        } catch (error) {
            if (error instanceof DuplicateCandidateError) {
                return { post, duplicate: true, created: false };
            }
            throw error;
        }
    }

    async createLearningCandidatesForDate(date, actor = {}) {
        const identity = requirePersonalKgIdentity(actor);
        const posts = await this.ledgerRepository.listPosts({
            startDate: date,
            endDate: date,
            status: 'learning_ready'
        }, identity);
        const results = [];
        for (const post of posts) {
            if (post.learning_candidate_id) {
                results.push({ post, skipped: true, reason: 'already_linked' });
                continue;
            }
            results.push(await this.createLearningCandidateForPost(post.id, identity));
        }
        return results;
    }
}
