// @ts-check
/**
 * Personal KG SNS Weekly Planner
 *
 * 個人KG memoryをsourceに、レビュー用の1週間分SNS draft packを決定論的に作る。
 * 投稿実行や外部X API呼び出しは行わない。
 */

const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_POST_CHARS = 280;

const WEEKLY_PATTERN = [
    ['trust_balance', 'peer_circle', 'own_proof'],
    ['trust_balance', 'peer_circle', 'philosophy'],
    ['own_proof', 'peer_circle', 'trust_balance'],
    ['philosophy', 'peer_circle', 'learn_in_public'],
    ['trust_balance', 'peer_circle', 'own_proof'],
    ['trust_balance', 'peer_circle', 'philosophy'],
    ['own_proof', 'learn_in_public', 'soft_cta']
];

const DEFAULT_WEEKLY_CONTENT_MIX = Object.freeze({
    trust_balance: 5,
    peer_circle: 6,
    own_proof: 4,
    philosophy: 3,
    learn_in_public: 2,
    soft_cta: 1
});

const LANE_KEYWORDS = {
    trust_balance: ['Claude Code', 'AI PM', 'AI駆動経営', 'AI社員', 'ナレッジグラフ', '業務フロー'],
    peer_circle: ['Peer Circle', '引用', '同じ界隈', '仲間', '読者'],
    own_proof: ['Own Proof', 'PR #', 'M1-M4', 'VibePro', '実装', '通した'],
    philosophy: ['Persona Brain', '相手の脳', 'AIはツール', '組織ユニット', '哲学', 'OS'],
    learn_in_public: ['失敗', '事故', '学んだ', '再発防止', 'インシデント', 'guard'],
    soft_cta: ['診断', '導線', 'プロフィール', '固定', '迷う']
};

const LANE_INTENT = {
    trust_balance: 'Claude Code / AI PM / AI経営理解で信頼残高を積む',
    peer_circle: '近接界隈の同格から少し上の相手に、仲間として拾われる引用コメントを作る',
    own_proof: '自分で作っている実装・運用実績を、思想ではなく証拠として出す',
    philosophy: 'Persona Brain、AI組織、責任境界などの判断基準を短く置く',
    learn_in_public: '事故、検証、学習を隠さず、運用知として戻す',
    soft_cta: '売り込みではなく、次に見に行く場所を自然に作る'
};

function addDays(date, offset) {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
}

function truncateText(value, max = MAX_POST_CHARS) {
    const text = String(value || '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function firstSentence(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    const parts = cleaned.split(/(?<=[。！？])/u).filter(Boolean);
    return parts[0] || cleaned;
}

function cleanMemoryText(text) {
    return String(text || '')
        .replace(/^Own Proof:\s*/u, '')
        .replace(/^気づいた:\s*/u, '')
        .replace(/Peer Circle候補:\s*[^。！？]+[。！？]?/gu, '')
        .replace(/knowledge-graph-kernel/giu, 'ナレッジグラフ基盤')
        .replace(/M1-M4/gu, '最初の4段階')
        .replace(/\bACL\b/gu, '権限管理')
        .replace(/Persona Brain/gu, '相手の脳')
        .replace(/deterministic guard/giu, '機械的なガード')
        .replace(/silent drop/giu, 'サイレントに消えた')
        .replace(/Story/gu, 'ストーリー')
        .replace(/Architecture/gu, '設計')
        .replace(/Spec/gu, '仕様')
        .replace(/Graphify/gu, '関係整理')
        .replace(/Gate/gu, '検証ゲート')
        .replace(/graph traversal/giu, 'つながり')
        .replace(/entity/giu, '情報')
        .replace(/Candidate Store/gu, '記憶の置き場')
        .replace(/SNS posting engine/gu, '投稿の下書き')
        .replace(/PR evidence/gu, 'PR証跡')
        .replace(/Tips/gu, '小技')
        .replace(/Skills/gu, 'スキル')
        .replace(/\s+/g, ' ')
        .trim();
}

function finalizePublicCopy(text) {
    return truncateText(String(text || '')
        .replace(/Peer Circle/gu, '近い界隈')
        .replace(/Own Proof/gu, '実績')
        .replace(/Learn in Public/gu, '公開学習')
        .replace(/Soft CTA/gu, '自然な導線')
        .replace(/knowledge-graph-kernel/giu, 'ナレッジグラフ基盤')
        .replace(/M1-M4/gu, '最初の4段階')
        .replace(/\bACL\b/gu, '権限管理')
        .replace(/Persona Brain/gu, '相手の脳')
        .replace(/deterministic guard/giu, '機械的なガード')
        .replace(/silent drop/giu, 'サイレントに消えた')
        .replace(/Story/gu, 'ストーリー')
        .replace(/Architecture/gu, '設計')
        .replace(/Spec/gu, '仕様')
        .replace(/Graphify/gu, '関係整理')
        .replace(/Gate/gu, '検証ゲート')
        .replace(/Graph traversal/giu, 'つながり')
        .replace(/graph traversal/giu, 'つながり')
        .replace(/entity/giu, '情報')
        .replace(/Candidate Store/gu, '記憶の置き場')
        .replace(/SNS posting engine/gu, '投稿の下書き')
        .replace(/PR evidence/gu, 'PR証跡')
        .replace(/Tips/gu, '小技')
        .replace(/Skills/gu, 'スキル')
        .replace(/。/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim());
}

function sourceMatchesLane(source, lane) {
    const body = source?.body || '';
    return (LANE_KEYWORDS[lane] || []).some((keyword) => body.includes(keyword));
}

function scoreSourceForLane(source, lane, viewer) {
    let score = 0;
    const body = String(source?.body || '');
    const isContentMeta = /投稿設計|X運用|投稿生成|APIで投稿/.test(body);
    const isPeerMemory = body.includes('Peer Circle候補');
    const isOwnProof = /Own Proof|PR #|M1-M4|実装|通した|実運用|削減|自動化/.test(body);
    const isPhilosophy = /Persona Brain|相手の脳|AIはツール|組織ユニット|基準|哲学/.test(body);
    if (isPeerMemory && lane !== 'peer_circle') score -= 20;
    if (isPeerMemory && lane === 'peer_circle') score += 12;
    if (isContentMeta && !['peer_circle', 'soft_cta'].includes(lane)) score -= 12;
    if (isOwnProof && lane === 'own_proof') score += 12;
    if (isOwnProof && !['own_proof', 'trust_balance'].includes(lane)) score -= 18;
    if (isPhilosophy && lane === 'philosophy') score += 12;
    if (isPhilosophy && lane === 'own_proof') score -= 16;
    if (sourceMatchesLane(source, lane)) score += 10;
    const interests = Array.isArray(viewer?.interests) ? viewer.interests : [];
    for (const interest of interests) {
        if (source?.body?.includes(interest)) score += 2;
    }
    if (source?.reuse_count) score += Math.min(source.reuse_count, 3);
    return score;
}

function normalizeSources(sources) {
    return sources
        .filter((source) => source && source.id && source.body)
        .map((source) => ({
            ...source,
            derived_from: Array.isArray(source.derived_from) ? source.derived_from : [],
            evidence_ids: Array.isArray(source.evidence_ids) ? source.evidence_ids : []
        }));
}

function selectSourceForLane(sources, lane, viewer, cursors, excludedIds = new Set()) {
    if (sources.length === 0) {
        throw new Error('personal KG sources required');
    }
    const ranked = [...sources].sort((a, b) => scoreSourceForLane(b, lane, viewer) - scoreSourceForLane(a, lane, viewer));
    const laneSources = ranked.filter((source) => scoreSourceForLane(source, lane, viewer) > 0);
    const basePool = laneSources.length > 0 ? laneSources : ranked;
    const nonExcluded = basePool.filter((source) => !excludedIds.has(source.id));
    const pool = nonExcluded.length > 0 ? nonExcluded : basePool;
    const cursor = cursors[lane] || 0;
    const selected = pool[cursor % pool.length];
    cursors[lane] = cursor + 1;
    return selected;
}

function topicFromSource(source, fallback = 'AI運用') {
    const body = source?.body || '';
    for (const keyword of ['Claude Code', 'AI PM', 'AI駆動経営', 'ナレッジグラフ', 'VibePro', 'SalesTailor', 'AI電話']) {
        if (body.includes(keyword)) return keyword;
    }
    return fallback;
}

function completePersonaBrain({ source, lane, viewer, signal }) {
    const target = viewer?.persona || viewer?.target_person || 'AI導入を任された事業責任者 / PM / 経営者';
    const topic = signal?.topic || topicFromSource(source);
    return {
        target_person: target,
        current_situation: `${topic} に関心はあるが、自社でどこから運用に落とすか迷っている`,
        existing_belief: '良いツールやTipsを入れればAI活用が進むと思っている',
        misunderstanding: 'AI活用は投稿生成やツール利用量の問題だと捉えている',
        fear: '事故が起きた時の責任境界や、現場に定着しないリスクが見えている',
        blocker: '最初に設計すべき業務フロー、権限、記憶、レビュー境界が分からない',
        resonant_detail: truncateText(firstSentence(source?.body), 90),
        avoid_phrasing: 'AIで全部自動化できます',
        natural_next_action: lane === 'peer_circle'
            ? '引用元の論点と合わせて保存し、自社ならどの業務に当てるか考える'
            : 'プロフィールや固定導線を見て、自社の最初の1業務を考える',
        success_signal: lane === 'peer_circle' ? 'peer_reply_or_repost' : 'bookmark_or_profile_visit'
    };
}

function composeBody({ lane, source, signal }) {
    const sentence = firstSentence(cleanMemoryText(source.body));
    const body = cleanMemoryText(source.body);
    if (lane === 'peer_circle') {
        if (!signal) {
            return '';
        }
        const handle = signal?.author_handle || 'この投稿';
        return finalizePublicCopy(
            `${handle} の話、相手の読者に向けて言い換えると、ここはかなり実務っぽい\n\n` +
            `${signal?.text || sentence}\n\n` +
            '小技ではなく、責任・権限・記憶・レビュー境界まで含めて見ると実務に落ちる'
        );
    }
    if (signal?.kind === 'news') {
        return finalizePublicCopy(
            `今日のニュースをこの観点で見ると、${sentence}\n\n` +
            '新機能そのものより、どの業務フローに接続して学習へ戻すかが差になる'
        );
    }

    if (lane === 'trust_balance' && body.includes('AI PM')) {
        return finalizePublicCopy(
            'AI PMって「タスク管理をAIにやらせること」だと思われがちだけど、たぶん本体はそこじゃない。\n\n' +
            '本当に設計すべきなのは、責任分界・意思決定ログ・レビュー境界・学習の戻し先。\n\n' +
            'AIを入れるほど、PMの仕事は“管理”より“境界設計”になる'
        );
    }
    if (lane === 'trust_balance' && body.includes('Claude Code')) {
        return finalizePublicCopy(
            'Claude Code法人導入で差がつくのは、小技の量ではなく運用設計だと思う\n\n' +
            'CLAUDE.md、スキル、権限、レビュー、検収\n\n' +
            'ここまで含めて初めて「会社で使えるAI」になる'
        );
    }
    if (lane === 'trust_balance') {
        return finalizePublicCopy(
            `${sentence}\n\n` +
            'ツール名ではなく、業務フロー・責任境界・学習の戻し先まで見ると、AI導入の解像度が上がる'
        );
    }
    if (lane === 'own_proof') {
        return finalizePublicCopy(
            `実装してわかった。\n\n${sentence}\n\n` +
            '思想は、動いている運用と証跡まで落ちて初めて信用になる'
        );
    }
    if (lane === 'philosophy') {
        return finalizePublicCopy(
            `自分の基準はこれ。\n\n${sentence}\n\n` +
            'ツール名より、役割・権限・記憶・承認・証跡を先に見る'
        );
    }
    if (lane === 'learn_in_public') {
        return finalizePublicCopy(
            `失敗から学んだのは、${sentence}\n\n` +
            '事故を隠すより、停止条件・責任境界・再発防止を仕組みに戻す方が強い'
        );
    }
    if (lane === 'soft_cta') {
        return finalizePublicCopy(
            'AI導入で迷うなら、最初に見るべきはツール一覧じゃない。\n\n' +
            '自社の「最初の1業務」を選んで、どこをAIに渡し、どこで人間が戻るかを書き出す。\n\n' +
            'そこから始める方が失敗しにくい'
        );
    }
    return finalizePublicCopy(sentence);
}

function sortSignalsByBand(signals) {
    const rank = { primary: 0, secondary: 1, out_of_band: 2 };
    return [...signals].sort((a, b) => {
        const bandDiff = rank[classifyPeerSignalBand(a)] - rank[classifyPeerSignalBand(b)];
        if (bandDiff !== 0) return bandDiff;
        return String(a.author_handle || a.id || '').localeCompare(String(b.author_handle || b.id || ''));
    });
}

function pickSignal(signals, index) {
    if (!signals || signals.length === 0) return null;
    return signals[index % signals.length];
}

function summarize(drafts) {
    return drafts.reduce((acc, draft) => {
        acc.by_lane[draft.lane] = (acc.by_lane[draft.lane] || 0) + 1;
        if (draft.signal?.kind === 'news') acc.news_signal_slots += 1;
        if (draft.signal?.kind === 'peer_post') acc.peer_signal_slots += 1;
        return acc;
    }, {
        total: drafts.length,
        by_lane: {},
        peer_signal_slots: 0,
        news_signal_slots: 0,
        content_mix: DEFAULT_WEEKLY_CONTENT_MIX
    });
}

export function classifyPeerSignalBand(signal) {
    const followers = Number(signal?.author_followers ?? signal?.followers);
    if (!Number.isFinite(followers)) return signal?.target_band === 'primary' ? 'primary' : 'out_of_band';
    if (followers >= 2000 && followers <= 20000) return 'primary';
    if (followers > 20000 && followers <= 50000) return 'secondary';
    return 'out_of_band';
}

export class PersonalKgSnsWeeklyPlanner {
    /**
     * @param {{ graphReader: { listRecentEntities: Function } }} deps
     */
    constructor({ graphReader }) {
        if (!graphReader || typeof graphReader.listRecentEntities !== 'function') {
            throw new Error('graphReader required');
        }
        this.graphReader = graphReader;
    }

    /**
     * @param {any} viewer
     * @param {{startDate:string, lookbackDays?:number, peerSignals?:Array<any>, newsSignals?:Array<any>}} options
     */
    async buildWeeklyDraftPack(viewer, options) {
        if (!viewer || !viewer.sub) throw new Error('viewer.sub required');
        if (!options?.startDate) throw new Error('startDate required');

        const since = new Date(Date.parse(`${options.startDate}T00:00:00.000Z`) - (options.lookbackDays || DEFAULT_LOOKBACK_DAYS) * 24 * 60 * 60 * 1000).toISOString();
        const sources = normalizeSources(await this.graphReader.listRecentEntities({ since, viewer }));
        const peerPool = sortSignalsByBand(options.peerSignals || []).filter((signal) => classifyPeerSignalBand(signal) !== 'out_of_band');
        const newsPool = options.newsSignals || [];
        const cursors = {};
        const drafts = [];
        let peerCursor = 0;
        let newsCursor = 0;

        WEEKLY_PATTERN.forEach((lanes, dayIndex) => {
            const date = addDays(options.startDate, dayIndex);
            const daySourceIds = new Set();
            lanes.forEach((lane, slotIndex) => {
                const source = selectSourceForLane(sources, lane, viewer, cursors, daySourceIds);
                daySourceIds.add(source.id);
                const signal = lane === 'peer_circle'
                    ? pickSignal(peerPool, peerCursor++)
                    : (slotIndex === 0 ? pickSignal(newsPool, newsCursor++) : null);
                const format = lane === 'peer_circle'
                    ? (signal ? 'quote_repost_commentary' : 'peer_research_prompt')
                    : (signal?.kind === 'news' ? 'news_commentary' : 'standalone');
                const personaBrain = completePersonaBrain({ source, lane, viewer, signal });
                drafts.push({
                    id: `week_${date}_${slotIndex + 1}_${lane}`,
                    date,
                    slot_index: slotIndex + 1,
                    status: 'draft_review',
                    publish_intent: 'manual_review_only',
                    lane,
                    lane_intent: LANE_INTENT[lane],
                    format,
                    body: composeBody({ lane, source, signal }),
                    kg_source_entity_id: source.id,
                    source_candidate_id: source.source_candidate_id || null,
                    derived_from: [source.id, ...source.derived_from],
                    evidence_ids: source.evidence_ids,
                    persona_brain: personaBrain,
                    signal: signal ? {
                        id: signal.id,
                        kind: signal.kind,
                        author_handle: signal.author_handle || null,
                        author_followers: signal.author_followers || null,
                        target_band: signal.kind === 'peer_post' ? classifyPeerSignalBand(signal) : null,
                        title: signal.title || null,
                        topic: signal.topic || null,
                        url: signal.url || null
                    } : null,
                    safety: {
                        requires_human_review: true,
                        no_post_api: true,
                        no_auto_posting_language: true
                    }
                });
            });
        });

        return {
            week_start: options.startDate,
            days: WEEKLY_PATTERN.map((_, index) => {
                const date = addDays(options.startDate, index);
                return { date, drafts: drafts.filter((draft) => draft.date === date) };
            }),
            drafts,
            summary: summarize(drafts)
        };
    }
}

export { DEFAULT_WEEKLY_CONTENT_MIX, WEEKLY_PATTERN };
