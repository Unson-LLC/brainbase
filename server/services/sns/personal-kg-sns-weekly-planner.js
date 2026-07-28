// @ts-check
/**
 * Personal KG Public Lifelog Planner
 *
 * 個人KGに本人の一次体験として残っている文だけを、手動レビュー用の
 * 公開ライフログ候補へ移す。助言の生成、外部情報の要約、投稿実行はしない。
 */

const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_POST_CHARS = 280;
const WEEK_DAYS = 7;

const WEEKLY_PATTERN = Object.freeze([]);
const DEFAULT_WEEKLY_CONTENT_MIX = Object.freeze({});
const LIFELOG_CATEGORIES = new Set([
    'daily_log',
    'work_log',
    'life_log',
    'memory',
    'unresolved',
    'proof'
]);
const FIRST_PERSON_EXPERIENCE_PATTERN = /俺|私|自分|うち|今日|昨日|今朝|今夜|やってみ|作った|決めた|迷っ|失敗|止まった|感じた|思い出した|残しておく|まだ答え/u;
const ADVICE_PATTERN = /すべき|した方がいい|しよう|してください|正解は|最初に見るべき|間違えてる|できてない|みんなはどう|詳しくは|DM(?:ください)?|プロフィール(?:へ|から)|問い合わせ/u;

function addDays(date, offset) {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
}

function truncateText(value, max = MAX_POST_CHARS) {
    const text = String(value || '')
        .replace(/[ \t]+/gu, ' ')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function sourceCategory(source) {
    return source?.category
        || source?.permission_snapshot?.seed?.category
        || source?.permission_snapshot?.oyasumi_meeting_personal_kg?.category
        || null;
}

function isLifelogSource(source) {
    if (!source?.id || !source?.body) return false;
    if (source.lifelog_ready === true) return FIRST_PERSON_EXPERIENCE_PATTERN.test(String(source.body));
    return LIFELOG_CATEGORIES.has(sourceCategory(source))
        && FIRST_PERSON_EXPERIENCE_PATTERN.test(String(source.body));
}

function laneFor(source) {
    const category = sourceCategory(source);
    if (category === 'work_log' || category === 'proof') return 'work_log';
    if (category === 'life_log') return 'life_log';
    if (category === 'memory') return 'memory';
    if (category === 'unresolved') return 'unresolved';
    return 'today_log';
}

function lifelogRisks(body) {
    const text = String(body || '').trim();
    const risks = [];
    if (!text) risks.push('missing_first_person_source');
    if (text && !FIRST_PERSON_EXPERIENCE_PATTERN.test(text)) risks.push('missing_first_person_experience');
    if (ADVICE_PATTERN.test(text)) risks.push('advice_or_instruction');
    return risks;
}

/**
 * 互換名は維持するが、判定対象はPersonaではなく公開ライフログの完全性。
 */
export function evaluatePersonaAffect({ body }) {
    const risks = lifelogRisks(body);
    return {
        decision: risks.length === 0 ? 'pass' : 'blocked',
        likely_reader_feeling: null,
        negative_feeling_risks: risks,
        repair_guidance: risks.length === 0
            ? '本人の一次体験としてそのまま手動レビュー可能'
            : '助言へ書き換えず、本人の実体験ソースへ戻る。ソースがなければ投稿しない',
        persona_assumption: null,
        check_type: 'lifelog_integrity'
    };
}

/**
 * 互換名は維持するが、反応最適化は行わない。
 */
export function evaluateXAlgorithmFit({ body, personaAffect }) {
    const risks = Array.isArray(personaAffect?.negative_feeling_risks)
        ? personaAffect.negative_feeling_risks
        : lifelogRisks(body);
    return {
        decision: risks.length === 0 ? 'reviewable' : 'blocked',
        candidate_source: 'personal_kg_lifelog',
        predicted_positive_actions: [],
        predicted_negative_actions: [],
        negative_feedback_risks: risks,
        author_diversity: null,
        graph_edge_goal: null,
        optimization_policy: 'none'
    };
}

export function classifyPeerSignalBand(signal) {
    const followers = Number(signal?.author_followers ?? signal?.followers);
    if (!Number.isFinite(followers)) return signal?.target_band === 'primary' ? 'primary' : 'out_of_band';
    if (followers >= 2000 && followers <= 20000) return 'primary';
    if (followers > 20000 && followers <= 50000) return 'secondary';
    return 'out_of_band';
}

function normalizeSources(sources) {
    return (Array.isArray(sources) ? sources : [])
        .filter(isLifelogSource)
        .map((source) => ({
            ...source,
            derived_from: Array.isArray(source.derived_from) ? source.derived_from : [],
            evidence_ids: Array.isArray(source.evidence_ids) ? source.evidence_ids : []
        }));
}

function buildDraft(source, startDate, index) {
    const date = addDays(startDate, Math.min(index, WEEK_DAYS - 1));
    const body = truncateText(source.body);
    const integrity = evaluatePersonaAffect({ body });
    const algorithmCompatibility = evaluateXAlgorithmFit({ body, personaAffect: integrity });
    return {
        id: `lifelog_${date}_${index + 1}`,
        date,
        slot_index: 1,
        status: 'draft_review',
        publish_intent: 'manual_review_only',
        lane: laneFor(source),
        lane_intent: '未来の自分へ、実際にあったことを残す',
        format: 'first_person_lifelog',
        body,
        kg_source_entity_id: source.id,
        source_candidate_id: source.source_candidate_id || null,
        derived_from: [source.id, ...source.derived_from],
        evidence_ids: source.evidence_ids,
        lifelog_check: {
            decision: integrity.decision,
            source_id: source.id,
            source_system: source.source_system || 'personal_kg',
            source_category: sourceCategory(source),
            occurred_at: source.created_at || source.updated_at || null,
            first_person_evidence: integrity.decision === 'pass',
            risks: integrity.negative_feeling_risks
        },
        algorithm_fit: algorithmCompatibility,
        signal: null,
        safety: {
            requires_human_review: true,
            no_post_api: true,
            no_advice: !integrity.negative_feeling_risks.includes('advice_or_instruction'),
            lifelog_integrity: integrity
        }
    };
}

function summarize(drafts, sourceCount, externalPromptCount) {
    return {
        total: drafts.length,
        eligible_lifelog_sources: sourceCount,
        by_lane: drafts.reduce((acc, draft) => {
            acc[draft.lane] = (acc[draft.lane] || 0) + 1;
            return acc;
        }, {}),
        content_mix: DEFAULT_WEEKLY_CONTENT_MIX,
        external_prompts_ignored_for_drafts: externalPromptCount,
        no_source_reason: sourceCount === 0 ? 'no_first_person_lifelog_source' : null
    };
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

        const lookbackDays = options.lookbackDays || DEFAULT_LOOKBACK_DAYS;
        const since = new Date(
            Date.parse(`${options.startDate}T00:00:00.000Z`) - lookbackDays * 24 * 60 * 60 * 1000
        ).toISOString();
        const sources = normalizeSources(await this.graphReader.listRecentEntities({ since, viewer }));
        const drafts = sources
            .slice(0, WEEK_DAYS)
            .map((source, index) => buildDraft(source, options.startDate, index))
            .filter((draft) => draft.lifelog_check.decision === 'pass');
        const days = Array.from({ length: WEEK_DAYS }, (_, index) => {
            const date = addDays(options.startDate, index);
            return { date, drafts: drafts.filter((draft) => draft.date === date) };
        });
        const externalPromptCount = (options.peerSignals?.length || 0) + (options.newsSignals?.length || 0);

        return {
            week_start: options.startDate,
            days,
            drafts,
            summary: summarize(drafts, sources.length, externalPromptCount)
        };
    }
}

export { DEFAULT_WEEKLY_CONTENT_MIX, WEEKLY_PATTERN };
