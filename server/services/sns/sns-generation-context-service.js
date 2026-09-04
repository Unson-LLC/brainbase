// @ts-check

import {
    isPersonalKgCandidateInScope,
    requirePersonalKgIdentity
} from './personal-kg-identity.js';

const WINNING_STATUSES = new Set(['posted', 'learning_ready']);
const GROUPS = ['by_lane', 'by_source_type', 'by_format', 'by_lifelog_integrity'];
const DEDUPE_STATUSES = new Set([
    'review_needed',
    'approved',
    'scheduled',
    'publishing',
    'posted',
    'learning_ready',
    'skipped',
    'deleted'
]);

function toDateOnly(value) {
    const text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new Error(`date must be YYYY-MM-DD: ${value}`);
    return text;
}

function addDays(date, delta) {
    const next = new Date(`${toDateOnly(date)}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + delta);
    return next.toISOString().slice(0, 10);
}

function lookbackFor(date) {
    return {
        days_7: {
            start_date: addDays(date, -6),
            end_date: toDateOnly(date)
        },
        days_30: {
            start_date: addDays(date, -29),
            end_date: toDateOnly(date)
        }
    };
}

function latestMetrics(post) {
    const snapshots = Array.isArray(post.metrics_snapshots) ? post.metrics_snapshots : [];
    return snapshots[snapshots.length - 1] || null;
}

function engagement(metrics) {
    if (!metrics) return 0;
    return Number(metrics.likes || 0)
        + Number(metrics.reposts || 0)
        + Number(metrics.replies || 0)
        + Number(metrics.bookmarks || 0);
}

function emptyAccumulator() {
    return {
        posts: 0,
        impressions: 0,
        likes: 0,
        reposts: 0,
        replies: 0,
        bookmarks: 0,
        profile_visits: 0,
        engagement: 0,
        engagement_rate: 0
    };
}

function addMetric(target, metrics) {
    target.posts += 1;
    target.impressions += Number(metrics?.impressions || 0);
    target.likes += Number(metrics?.likes || 0);
    target.reposts += Number(metrics?.reposts || 0);
    target.replies += Number(metrics?.replies || 0);
    target.bookmarks += Number(metrics?.bookmarks || 0);
    target.profile_visits += Number(metrics?.profile_visits || 0);
    target.engagement += engagement(metrics);
    target.engagement_rate = target.impressions > 0
        ? Number((target.engagement / target.impressions).toFixed(4))
        : 0;
}

function groupKey(post, group) {
    if (group === 'by_lane') return post.lane || 'unknown';
    if (group === 'by_source_type') return post.source?.type || 'unknown';
    if (group === 'by_format') return post.format || 'unknown';
    if (group === 'by_lifelog_integrity') {
        return post.evidence?.lifelog_check?.decision
            || post.evidence?.quality_gate?.lifelog_integrity?.decision
            || post.evidence?.quality_gate?.decision
            || 'unknown';
    }
    return 'unknown';
}

function summarizePost(post) {
    return {
        id: post.id,
        date: post.date,
        status: post.status,
        lane: post.lane || null,
        title: post.title || null,
        source_type: post.source?.type || null,
        reason: post.deletion_reason || post.memo || null
    };
}

function normalizeBodyFingerprint(body) {
    return String(body || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/https?:\/\/\S+/gu, '')
        .replace(/[「」『』（）()[\]{}【】、。，．・:：;；!?！？"“”'‘’`]/gu, '')
        .replace(/\s+/gu, '')
        .trim();
}

function postSourceUrl(post) {
    return post?.source?.url || post?.source_url || null;
}

function buildRecentHistory(posts, range) {
    const recentPosts = posts
        .filter((post) => DEDUPE_STATUSES.has(post.status))
        .filter((post) => post.date >= range.start_date && post.date <= range.end_date)
        .map((post) => ({
            id: post.id,
            date: post.date,
            status: post.status,
            lane: post.lane || null,
            title: post.title || null,
            body: post.body || '',
            body_fingerprint: normalizeBodyFingerprint(post.body),
            source_url: postSourceUrl(post),
            posted_url: post.posted_url || null
        }))
        .filter((post) => post.body_fingerprint || post.source_url);

    return {
        lookback_start_date: range.start_date,
        lookback_end_date: range.end_date,
        posts: recentPosts,
        used_source_urls: [...new Set(recentPosts.map((post) => post.source_url).filter(Boolean))],
        blocked_body_fingerprints: [...new Set(recentPosts.map((post) => post.body_fingerprint).filter(Boolean))]
    };
}

function buildStats(posts, range) {
    const result = Object.fromEntries(GROUPS.map((group) => [group, {}]));
    const eligible = posts.filter((post) => {
        if (!WINNING_STATUSES.has(post.status)) return false;
        if (post.deleted_at || post.status === 'deleted') return false;
        return post.date >= range.start_date && post.date <= range.end_date;
    });
    for (const post of eligible) {
        const metrics = latestMetrics(post);
        for (const group of GROUPS) {
            const key = groupKey(post, group);
            if (!result[group][key]) result[group][key] = emptyAccumulator();
            addMetric(result[group][key], metrics);
        }
    }
    return result;
}

function linesAfterHeading(text, heading) {
    const lines = String(text || '').split('\n');
    const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
    if (start === -1) return [];
    const block = [];
    for (const line of lines.slice(start + 1)) {
        if (/^#{1,2}\s+/u.test(line)) break;
        block.push(line);
    }
    return block
        .map((line) => line.replace(/^\s*[-*]\s*/u, '').trim())
        .filter(Boolean);
}

function extractStrategy(strategyText = '', _contentPillarsText = '') {
    const toneGuard = linesAfterHeading(strategyText, '投稿の約束');
    const distributionLayers = linesAfterHeading(strategyText, '記録の棚');
    return {
        mode: 'public_lifelog',
        weekly_mix_target: null,
        tone_guard: toneGuard.length > 0 ? toneGuard : [
            '自分が実際に経験したことだけを書く',
            '読者へ助言・指導・説得をしない',
            'CTAや投稿ノルマを置かない'
        ],
        distribution_layers: distributionLayers.length > 0 ? distributionLayers : [
            '今日のログ',
            '仕事の記録',
            '暮らしの記録',
            '思い出',
            '未解決'
        ],
        content_pillars: [
            '今日、実際にあったこと',
            '仕事で手を動かした記録',
            '暮らしの記録',
            'あとで思い出したいこと',
            'まだ答えのないこと'
        ]
    };
}

function candidateToLearning(candidate) {
    return {
        id: candidate.id,
        source_system: candidate.source_system,
        promotion_status: candidate.promotion_status,
        cognitive_type: candidate.cognitive_type,
        body: String(candidate.body || '').slice(0, 240),
        sns: candidate.permission_snapshot?.sns || null,
        evidence_ids: candidate.evidence_ids || []
    };
}

function seedCategory(candidate) {
    return candidate.permission_snapshot?.seed?.category
        || candidate.permission_snapshot?.oyasumi_meeting_personal_kg?.category
        || null;
}

function oyasumiPersonalKgPolicy(candidate) {
    return candidate.permission_snapshot?.oyasumi_meeting_personal_kg || null;
}

function isNonRedactedInternal(candidate) {
    const sensitivity = candidate.sensitivity || 'internal';
    const redactionStatus = candidate.redaction_status || 'none';
    return sensitivity === 'internal' && redactionStatus === 'none';
}

function isSnsContextReadableCandidate(candidate) {
    if (candidate.visibility !== 'owner') return false;
    const oyasumiPolicy = oyasumiPersonalKgPolicy(candidate);
    if (!oyasumiPolicy) return isNonRedactedInternal(candidate);
    if (oyasumiPolicy.memory_layer !== 'sns_ready') return false;
    if (oyasumiPolicy.projection_allowed === false) return false;
    return isNonRedactedInternal(candidate);
}

function compactBody(candidate, max = 180) {
    const body = String(candidate.body || '').replace(/\s+/gu, ' ').trim();
    if (body.length <= max) return body;
    return `${body.slice(0, max - 1).trim()}…`;
}

const LIFELOG_CATEGORIES = new Set([
    'daily_log',
    'work_log',
    'life_log',
    'memory',
    'unresolved',
    'proof'
]);

const FIRST_PERSON_EXPERIENCE_PATTERN = /俺|私|自分|うち|今日|昨日|今朝|今夜|やってみ|作った|決めた|迷っ|失敗|止まった|感じた|思い出した|残しておく|まだ答え/u;

function isLifelogCandidate(candidate) {
    const category = seedCategory(candidate);
    if (!LIFELOG_CATEGORIES.has(category)) return false;
    return FIRST_PERSON_EXPERIENCE_PATTERN.test(String(candidate.body || ''));
}

function sourceSummary(candidates) {
    const counts = new Map();
    for (const candidate of candidates) {
        const source = candidate.source_system || 'unknown';
        counts.set(source, (counts.get(source) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([source_system, count]) => ({ source_system, count }))
        .sort((a, b) => b.count - a.count || a.source_system.localeCompare(b.source_system));
}

function buildPersonalKgContext(candidates = [], { totalCandidateCount = candidates.length } = {}) {
    const ownerVisibleCandidates = candidates.filter((candidate) => candidate.visibility === 'owner');
    const lifelogEntries = ownerVisibleCandidates
        .filter(isLifelogCandidate)
        .sort((a, b) => String(b.created_at || b.updated_at || '').localeCompare(String(a.created_at || a.updated_at || '')))
        .map((candidate) => ({
            id: candidate.id,
            body: compactBody(candidate, 280),
            source_system: candidate.source_system || 'candidate_store',
            category: seedCategory(candidate),
            occurred_at: candidate.created_at || candidate.updated_at || null,
            evidence_ids: candidate.evidence_ids || []
        }))
        .slice(0, 8);
    return {
        memory_count: ownerVisibleCandidates.length,
        guarded_count: Math.max(0, totalCandidateCount - ownerVisibleCandidates.length),
        retrieval_purpose: 'public_lifelog_generation',
        generation_rule: 'first_person_sources_only',
        candidate_sources: sourceSummary(ownerVisibleCandidates),
        lifelog_entries: lifelogEntries,
        anchors: [],
        proof_points: [],
        persona_misunderstandings: [],
        avoid_exposures: [
            'advice_or_instruction',
            'reader_correction_or_persuasion',
            'cta_or_conversion',
            'invented_first_person_experience'
        ]
    };
}

function buildPolicy({ stats30, learning, personalKg, recentHistory }) {
    const needsMoreData = [];
    if (personalKg.lifelog_entries.length === 0) needsMoreData.push('本人の一次体験ソースなし。投稿候補は0件にする');
    if (learning.pending_feedback.length > 0) needsMoreData.push('反応値は観測記録として残すが、次の投稿内容の最適化には使わない');
    return {
        mode: 'public_lifelog',
        recommended_lanes: ['today_log', 'work_log', 'life_log', 'memory', 'unresolved'],
        avoid_patterns: [
            'advice_or_instruction',
            'reader_correction_or_persuasion',
            'cta_or_conversion',
            'external_summary_without_lived_experience',
            'invented_first_person_experience',
            'ai_auto_posting_smell',
            learning.deleted.length > 0 ? 'deleted_post_reuse_without_rewrite' : null,
            learning.publish_failed.length > 0 ? 'publish_failed_retry_without_cause_check' : null
        ].filter(Boolean),
        winning_angles: [],
        needs_more_data: [...new Set(needsMoreData)].slice(0, 8),
        quote_target_policy: [],
        source_policy: {
            required: 'actual_first_person_experience',
            missing_source_result: 'zero_posts',
            external_signals: 'reflection_prompts_only'
        },
        success_policy: [
            '本人の経験に忠実である',
            '未来の自分が読み返せる',
            'プライバシーを守る',
            '助言・説得・CTAを含めない'
        ],
        recent_history: recentHistory
    };
}

function buildLearning({ posts, candidates }) {
    const createdCandidates = candidates
        .filter((candidate) => candidate.source_system === 'sns-feedback')
        .map(candidateToLearning);
    const pendingFeedback = posts
        .filter((post) => WINNING_STATUSES.has(post.status))
        .filter((post) => latestMetrics(post))
        .filter((post) => !post.learning_candidate_id)
        .map(summarizePost);
    return {
        created_candidates: createdCandidates,
        pending_feedback: pendingFeedback,
        publish_failed: posts.filter((post) => post.status === 'publish_failed').map(summarizePost),
        skipped: posts.filter((post) => post.status === 'skipped').map(summarizePost),
        deleted: posts.filter((post) => post.status === 'deleted' || post.deleted_at).map(summarizePost)
    };
}

export class SnsGenerationContextService {
    constructor({
        ledgerRepository,
        candidateRepository = null,
        strategyText = '',
        contentPillarsText = ''
    } = {}) {
        if (!ledgerRepository || typeof ledgerRepository.listPosts !== 'function') {
            throw new Error('ledgerRepository with listPosts required');
        }
        this.ledgerRepository = ledgerRepository;
        this.candidateRepository = candidateRepository;
        this.strategyText = strategyText;
        this.contentPillarsText = contentPillarsText;
    }

    async buildContext({
        date,
        lookbackDays = 30,
        viewer
    }) {
        const access = requirePersonalKgIdentity(viewer);
        const targetDate = toDateOnly(date);
        const startDate = addDays(targetDate, -Math.max(1, lookbackDays) + 1);
        const posts = await this.ledgerRepository.listPosts({ startDate, endDate: targetDate }, access);
        const allCandidates = this.candidateRepository
            ? await this.candidateRepository.list({ owner_person_id: access.owner_person_id })
            : [];
        const scopedCandidates = allCandidates.filter((candidate) => isPersonalKgCandidateInScope(candidate, access));
        const candidates = scopedCandidates.filter(isSnsContextReadableCandidate);
        const lookback = lookbackFor(targetDate);
        const strategy = extractStrategy(this.strategyText, this.contentPillarsText);
        const personalKg = buildPersonalKgContext(candidates, { totalCandidateCount: scopedCandidates.length });
        const postingStats = {
            days_7: buildStats(posts, lookback.days_7),
            days_30: buildStats(posts, lookback.days_30)
        };
        const learning = buildLearning({ posts, candidates });
        const recentHistory = buildRecentHistory(posts, { start_date: startDate, end_date: targetDate });
        const generationPolicy = buildPolicy({
            stats30: postingStats.days_30,
            learning,
            personalKg,
            recentHistory
        });
        return {
            date: targetDate,
            lookback,
            strategy,
            personal_kg: personalKg,
            posting_stats: postingStats,
            learning,
            generation_policy: generationPolicy,
            evidence: [
                { kind: 'sns_posting_ledger', ref: `sns_posting_ledger_posts:${startDate}..${targetDate}` },
                { kind: 'candidate_store', ref: `memory_candidates owner:${access.owner_person_id} organization:${access.organization_id}` },
                { kind: 'sns_strategy_os', ref: 'sns/sns_strategy_os.md' },
                { kind: 'content_pillars', ref: 'sns/content_pillars.md' }
            ]
        };
    }
}

export {
    buildLearning,
    buildRecentHistory,
    buildStats,
    buildPersonalKgContext,
    buildPolicy,
    extractStrategy,
    lookbackFor,
    normalizeBodyFingerprint
};
