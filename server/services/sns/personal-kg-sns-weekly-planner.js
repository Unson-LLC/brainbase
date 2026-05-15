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

function hasReaderWorldAnchor(text) {
    return /自社|会社|現場|導入|運用|PM|経営|業務|実務|責任|権限|レビュー|学習|迷|詰ま|止ま|怖|不安|事故|信頼/u.test(text);
}

function personaFeelingFor(risks, body) {
    if (!body) return '引用元未選定なので、読者に見せる本文はまだない';
    if (risks.includes('internal_growth_tactic_exposed')) return '自分が成長施策の対象として使われているように感じる';
    if (risks.includes('lecturing_tone')) return '上から正解を言われ、自分の迷いを責められているように感じる';
    if (risks.includes('self_first_without_reader_bridge')) return '投稿者の実績や思想だけを見せられ、自分の現場に関係ないように感じる';
    if (risks.includes('no_reader_world_anchor')) return '自分の現場の不安や迷いが本文に入っていないように感じる';
    if (risks.includes('peer_quote_takes_without_giving')) return '引用元の話を踏み台にしているように感じる';
    return '自分の現場の迷いを言語化されたと感じる';
}

function repairGuidanceFor(risks) {
    if (risks.length === 0) return 'そのままreview可能';
    const guidance = [];
    if (risks.includes('internal_growth_tactic_exposed')) {
        guidance.push('運用方針や相手選定の都合を消し、実際の会話として書く');
    }
    if (risks.includes('lecturing_tone')) {
        guidance.push('正解を告げる文ではなく、読者の迷いを先に受け止める');
    }
    if (risks.includes('self_first_without_reader_bridge')) {
        guidance.push('実績や思想の前に、読者の現場で起きる詰まりへ接続する');
    }
    if (risks.includes('no_reader_world_anchor')) {
        guidance.push('自社、現場、業務、責任境界、レビューなど読者の脳内語彙を入れる');
    }
    if (risks.includes('peer_quote_takes_without_giving')) {
        guidance.push('相手の論点を補強し、相手が拾いやすい現場知見を足す');
    }
    return guidance.join(' / ');
}

export function evaluatePersonaAffect({ body, lane, personaBrain, signal }) {
    const text = String(body || '').trim();
    const risks = [];
    if (!text) {
        return {
            decision: 'pass',
            likely_reader_feeling: personaFeelingFor([], text),
            negative_feeling_risks: [],
            repair_guidance: '引用元が決まるまで本文を作らない'
        };
    }

    if (/同じ界隈の少し上の人|少し上の人|絡み|見つけたら|候補|相手の読者に向けて|引用元未選定/u.test(text)) {
        risks.push('internal_growth_tactic_exposed');
    }
    if (/迷うなら|最初に見るべき|ツール一覧じゃない|間違えてる|できてない|正解はこれ/u.test(text)) {
        risks.push('lecturing_tone');
    }
    if (/^(自分の基準はこれ|実装してわかった)/u.test(text) && !hasReaderWorldAnchor(text)) {
        risks.push('self_first_without_reader_bridge');
    }
    if (!hasReaderWorldAnchor(text)) {
        risks.push('no_reader_world_anchor');
    }
    if (lane === 'peer_circle' && signal && !/これ|うちでも|同じ|分かる|実務|現場/u.test(text)) {
        risks.push('peer_quote_takes_without_giving');
    }

    const uniqueRisks = [...new Set(risks)];
    return {
        decision: uniqueRisks.length > 0 ? 'blocked' : 'pass',
        likely_reader_feeling: personaFeelingFor(uniqueRisks, text),
        negative_feeling_risks: uniqueRisks,
        repair_guidance: repairGuidanceFor(uniqueRisks),
        persona_assumption: personaBrain?.target_person || 'AI導入を任された事業責任者 / PM / 経営者'
    };
}

function positiveActionsFor({ lane, signal }) {
    if (lane === 'peer_circle' && signal) return ['quote', 'reply', 'repost', 'profile_click', 'dwell'];
    if (signal?.kind === 'news') return ['reply', 'repost', 'profile_click', 'dwell'];
    if (lane === 'trust_balance') return ['bookmark', 'profile_click', 'dwell'];
    if (lane === 'own_proof') return ['profile_click', 'dwell', 'bookmark'];
    if (lane === 'philosophy') return ['reply', 'bookmark', 'dwell'];
    if (lane === 'learn_in_public') return ['reply', 'bookmark', 'profile_click'];
    return ['profile_click', 'bookmark'];
}

function candidateSourceFor({ lane, signal }) {
    if (lane === 'peer_circle' && signal?.kind === 'peer_post') return 'near_peer_quote';
    if (lane === 'peer_circle') return 'near_peer_research';
    if (signal?.kind === 'news') return 'news_context';
    return 'personal_kg_semantic_anchor';
}

function graphEdgeGoalFor({ lane, signal }) {
    if (lane === 'peer_circle' && signal?.author_handle) return `peer_reply_or_repost:${signal.author_handle}`;
    if (lane === 'peer_circle') return 'find_peer_signal:near_peer_quote';
    if (signal?.kind === 'news') return 'news_reply_or_repost:ai_ops_context';
    if (lane === 'trust_balance') return 'bookmark_or_profile_visit:trust_balance';
    if (lane === 'own_proof') return 'profile_click:own_proof';
    if (lane === 'philosophy') return 'reply_or_bookmark:philosophy';
    if (lane === 'learn_in_public') return 'reply_or_bookmark:learning_loop';
    return 'profile_click:soft_cta';
}

function negativeActionsFor(risks) {
    const actions = [];
    if (risks.includes('not_interested_risk') || risks.includes('low_relevance_risk')) actions.push('not_interested');
    if (risks.includes('mute_risk')) actions.push('mute_author');
    if (risks.includes('report_risk')) actions.push('report');
    return [...new Set(actions)];
}

export function evaluateXAlgorithmFit({ body, lane, signal, personaAffect }) {
    const text = String(body || '').trim();
    const personaRisks = Array.isArray(personaAffect?.negative_feeling_risks)
        ? personaAffect.negative_feeling_risks
        : [];
    const risks = [];

    if (lane === 'peer_circle' && !signal) risks.push('missing_peer_signal');
    if (personaAffect?.decision === 'blocked') risks.push('negative_persona_affect');
    if (personaRisks.includes('lecturing_tone') || personaRisks.includes('no_reader_world_anchor')) {
        risks.push('not_interested_risk');
    }
    if (personaRisks.includes('internal_growth_tactic_exposed') || personaRisks.includes('peer_quote_takes_without_giving')) {
        risks.push('mute_risk');
    }
    if (text && text.length < 40) risks.push('low_dwell_context');
    if (text && !hasReaderWorldAnchor(text)) risks.push('low_relevance_risk');

    const uniqueRisks = [...new Set(risks)];
    const blockingRisks = uniqueRisks.filter((risk) => risk !== 'missing_peer_signal');
    const decision = blockingRisks.length > 0
        ? 'blocked'
        : (uniqueRisks.includes('missing_peer_signal') ? 'needs_peer_signal' : 'reviewable');

    return {
        decision,
        candidate_source: candidateSourceFor({ lane, signal }),
        predicted_positive_actions: positiveActionsFor({ lane, signal }),
        predicted_negative_actions: negativeActionsFor(uniqueRisks),
        negative_feedback_risks: uniqueRisks,
        author_diversity: {
            scope: 'weekly_pack',
            repeated_author_handle: signal?.author_handle || null,
            policy: lane === 'peer_circle'
                ? 'prefer near-peer variety when multiple primary-band signals exist'
                : 'avoid same-day KG source reuse'
        },
        graph_edge_goal: graphEdgeGoalFor({ lane, signal })
    };
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
            `これめちゃ分かる\n\n` +
            `${handle} の言ってる ${signal?.text || sentence} って、実務だと責任・権限・記憶・レビュー境界まで含めて見る話なんよな\n\n` +
            'うちでもAIを会社で使える形に近づけるほど、ここを先に決めないと止まる'
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
            `AI導入って、思想だけだと現場は動きにくい\n\n` +
            `${sentence}\n\n` +
            'ここまで自分で通してみて、動いている運用と証跡まで落ちて初めて会社で信用されると感じた'
        );
    }
    if (lane === 'philosophy') {
        return finalizePublicCopy(
            `AI導入で迷った時、俺はまずここを見る\n\n${sentence}\n\n` +
            'ツール名より、役割・権限・記憶・承認・証跡を先に見る'
        );
    }
    if (lane === 'learn_in_public') {
        return finalizePublicCopy(
            `失敗から学んだのは、${sentence}\n\n` +
            '事故が起きた時に信頼を戻すのは、言い訳ではなく停止条件・責任境界・再発防止を仕組みに戻すこと'
        );
    }
    if (lane === 'soft_cta') {
        return finalizePublicCopy(
            'AI導入で詰まる会社ほど、ツール選定の前で迷ってることが多い\n\n' +
            'まず自社の「最初の1業務」を選んで、どこをAIに渡し、どこで人間が戻るかを書き出す\n\n' +
            'そこが見えると、次の一手を決めやすい'
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
                const body = composeBody({ lane, source, signal });
                const personaAffect = evaluatePersonaAffect({ body, lane, personaBrain, signal });
                const algorithmFit = evaluateXAlgorithmFit({ body, lane, signal, personaAffect });
                drafts.push({
                    id: `week_${date}_${slotIndex + 1}_${lane}`,
                    date,
                    slot_index: slotIndex + 1,
                    status: 'draft_review',
                    publish_intent: 'manual_review_only',
                    lane,
                    lane_intent: LANE_INTENT[lane],
                    format,
                    body,
                    kg_source_entity_id: source.id,
                    source_candidate_id: source.source_candidate_id || null,
                    derived_from: [source.id, ...source.derived_from],
                    evidence_ids: source.evidence_ids,
                    persona_brain: personaBrain,
                    algorithm_fit: algorithmFit,
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
                        no_auto_posting_language: true,
                        persona_affect: personaAffect
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
