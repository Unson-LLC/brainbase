// @ts-check

const DEFAULT_OWNER_PERSON_ID = 'sato_keigo';
const WINNING_STATUSES = new Set(['posted', 'learning_ready']);
const GROUPS = ['by_lane', 'by_source_type', 'by_format', 'by_persona_affect', 'by_algorithm_fit'];

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
    if (group === 'by_persona_affect') {
        return post.evidence?.quality_gate?.persona_affect?.decision
            || post.evidence?.quality_gate?.decision
            || 'unknown';
    }
    if (group === 'by_algorithm_fit') {
        return post.evidence?.algorithm_fit?.candidate_source
            || post.evidence?.algorithm_fit?.decision
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

function extractStrategy(strategyText = '', contentPillarsText = '') {
    const toneGuard = linesAfterHeading(strategyText, 'Tone Guard');
    const distributionLayers = linesAfterHeading(strategyText, 'Distribution Layers');
    const pillars = String(contentPillarsText)
        .split('\n')
        .map((line) => line.replace(/^\s*[-*]\s*/u, '').trim())
        .filter((line) => line && !line.startsWith('#'))
        .slice(0, 12);
    return {
        weekly_mix_target: {
            peer_circle: 0.3,
            trust_balance: 0.25,
            own_proof: 0.2,
            philosophy: 0.15,
            learn_in_public: 0.05,
            cta: 0.05
        },
        tone_guard: toneGuard.length > 0 ? toneGuard : [
            '読者に運用都合を見せない',
            'AI投稿自動化感を出さない',
            '英語で書く必要がある語だけ英語にする'
        ],
        distribution_layers: distributionLayers.length > 0 ? distributionLayers : [
            'Peer Circle',
            'Amplifier Quote',
            'Own Proof'
        ],
        content_pillars: pillars
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
    return candidate.permission_snapshot?.seed?.category || null;
}

function compactBody(candidate, max = 180) {
    const body = String(candidate.body || '').replace(/\s+/gu, ' ').trim();
    if (body.length <= max) return body;
    return `${body.slice(0, max - 1).trim()}…`;
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

function personalKgAnchorCandidates(candidates) {
    const categories = new Set(['philosophy', 'operating_principle', 'content_design', 'sales_philosophy']);
    return candidates
        .filter((candidate) => categories.has(seedCategory(candidate)))
        .filter((candidate) => ['claim', 'insight', 'preference', 'hypothesis'].includes(candidate.cognitive_type))
        .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
        .map((candidate) => compactBody(candidate));
}

function personalKgProofCandidates(candidates) {
    return candidates
        .filter((candidate) => {
            const category = seedCategory(candidate);
            const body = String(candidate.body || '');
            return category === 'proof'
                || candidate.cognitive_type === 'result'
                || /^Own Proof:/u.test(body)
                || /実績|会議時間|受注|PR #/u.test(body);
        })
        .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
        .map((candidate) => compactBody(candidate, 220));
}

function buildPersonalKgContext(candidates = []) {
    const snsCandidates = candidates.filter((candidate) => candidate.source_system === 'sns-feedback');
    const ownerVisibleCandidates = candidates.filter((candidate) => candidate.visibility === 'owner');
    const anchorCandidates = personalKgAnchorCandidates(ownerVisibleCandidates);
    const proofCandidates = personalKgProofCandidates(ownerVisibleCandidates);
    return {
        memory_count: ownerVisibleCandidates.length,
        candidate_sources: sourceSummary(ownerVisibleCandidates),
        anchors: [...new Set([
            ...anchorCandidates,
            'Claude Code / Codexは小技ではなく、権限・レビュー境界・記憶の設計で会社導入する',
            'SNS投稿生成より、読者理解を個人KGへ戻して次の仮説に使うことが本体'
        ])].slice(0, 10),
        proof_points: [...new Set([
            ...proofCandidates,
            ...snsCandidates
                .map((candidate) => compactBody(candidate, 220))
                .filter((body) => /保存|bookmark|反応|engagement|権限|レビュー/u.test(body))
        ])].slice(0, 8),
        persona_misunderstandings: [
            '良いAIツールを選べば導入が進むと思っている',
            'AI活用を個人スキルや投稿生成の問題として捉えている'
        ],
        avoid_exposures: [
            '少し上の人に絡む',
            '相手の読者に入る',
            'APIで投稿',
            '自動投稿'
        ]
    };
}

function topKeys(stats, group, limit = 3) {
    return Object.entries(stats[group] || {})
        .sort(([, a], [, b]) => {
            if (b.engagement_rate !== a.engagement_rate) return b.engagement_rate - a.engagement_rate;
            return b.engagement - a.engagement;
        })
        .slice(0, limit)
        .map(([key]) => key)
        .filter((key) => key !== 'unknown');
}

function buildPolicy({ stats30, learning, personalKg }) {
    const recommended = topKeys(stats30, 'by_lane');
    for (const lane of ['peer_circle', 'trust_balance', 'own_proof']) {
        if (!recommended.includes(lane)) recommended.push(lane);
    }
    const winningAngles = [
        ...personalKg.proof_points.slice(0, 3),
        'Claude Code法人導入は、ツール紹介より権限・レビュー境界・記憶の設計に戻す',
        '反応が弱い型も捨てず、Persona Brainの誤解や不安に戻して別角度へ変換する'
    ];
    const needsMoreData = [];
    if (!stats30.by_algorithm_fit || Object.keys(stats30.by_algorithm_fit).length === 0 || stats30.by_algorithm_fit.unknown) {
        needsMoreData.push('algorithm_fitをdraft evidenceに残して勝ち筋比較できるようにする');
    }
    for (const lane of ['own_proof', 'philosophy', 'learn_in_public']) {
        if (!stats30.by_lane?.[lane]) needsMoreData.push(`${lane}は直近30日データが少ないためPersonal KG proofで再検証する`);
    }
    if (learning.pending_feedback.length > 0) {
        needsMoreData.push('posted metricsをlearning candidate化して次回Contextへ戻す');
    }
    return {
        recommended_lanes: recommended.slice(0, 5),
        avoid_patterns: [
            'internal_growth_tactic_exposed',
            'ai_auto_posting_smell',
            'reader_negative_persona_affect',
            'english_japanese_mixed_unnecessarily',
            learning.deleted.length > 0 ? 'deleted_post_reuse_without_rewrite' : null,
            learning.publish_failed.length > 0 ? 'publish_failed_retry_without_cause_check' : null
        ].filter(Boolean),
        winning_angles: [...new Set(winningAngles)].slice(0, 6),
        needs_more_data: [...new Set(needsMoreData)].slice(0, 8),
        quote_target_policy: [
            '日本語圏の同格〜少し上の実務者を優先する',
            '相手の投稿を補強し、相手の読者に会社導入の責任境界を翻訳する',
            '相手選定や成長施策の都合を本文に出さない',
            '巨大アカウントより、拾ってくれる近い界隈の投稿を優先する'
        ]
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
        viewer = { actor_person_id: DEFAULT_OWNER_PERSON_ID, org_ids: ['unson'] }
    }) {
        const targetDate = toDateOnly(date);
        const startDate = addDays(targetDate, -Math.max(1, lookbackDays) + 1);
        const posts = await this.ledgerRepository.listPosts({ startDate, endDate: targetDate });
        const candidates = this.candidateRepository
            ? await this.candidateRepository.list({ owner_person_id: viewer.actor_person_id || DEFAULT_OWNER_PERSON_ID })
            : [];
        const lookback = lookbackFor(targetDate);
        const strategy = extractStrategy(this.strategyText, this.contentPillarsText);
        const personalKg = buildPersonalKgContext(candidates);
        const postingStats = {
            days_7: buildStats(posts, lookback.days_7),
            days_30: buildStats(posts, lookback.days_30)
        };
        const learning = buildLearning({ posts, candidates });
        const generationPolicy = buildPolicy({
            stats30: postingStats.days_30,
            learning,
            personalKg
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
                { kind: 'candidate_store', ref: `memory_candidates owner:${viewer.actor_person_id || DEFAULT_OWNER_PERSON_ID}` },
                { kind: 'sns_strategy_os', ref: 'shared/_codex/sns/sns_strategy_os.md' },
                { kind: 'content_pillars', ref: 'shared/_codex/sns/content_pillars.md' }
            ]
        };
    }
}

export {
    buildLearning,
    buildStats,
    buildPersonalKgContext,
    buildPolicy,
    extractStrategy,
    lookbackFor
};
