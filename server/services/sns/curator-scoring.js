// @ts-check
/**
 * SNS Draft Scoring (SPEC-sns-readonly-curator Contract-1)
 * Deterministic（同 input → 同 score）。LLM 呼び出しは含まない。
 */

const WEIGHTS = {
    novelty: 25,
    decision_value: 20,
    failure_recovery: 15,
    evidence_count: 10,
    audience_fit: 10,
    reuse_value: 10,
    flamewar_risk_penalty: -10
};

const FAILURE_RECOVERY_KEYWORDS = ['失敗', '挫折', '直した', '解決', '回復', '学んだ', 'fixed', 'recovered'];
const FLAMEWAR_KEYWORDS = ['炎上', '叩く', '批判', '攻撃', '罵倒'];

/**
 * @param {{cognitive_type:string, body:string, derived_from?:Array<string>, sensitivity?:string}} source
 * @param {{interests?:Array<string>}} viewer
 * @param {Array<{body:string}>} history
 * @returns {{score:number, breakdown:Record<string,number>}}
 */
export function scoreDraftCandidate(source, viewer, history = []) {
    const breakdown = {};
    const body = source.body || '';

    // novelty: history 内に body の最初 30 文字が含まれていない場合 +
    const probe = body.slice(0, 30);
    const isNovel = !history.some((h) => (h.body || '').includes(probe));
    breakdown.novelty = isNovel ? WEIGHTS.novelty : 0;

    breakdown.decision_value = ['claim', 'decision'].includes(source.cognitive_type) ? WEIGHTS.decision_value : 0;

    breakdown.failure_recovery = FAILURE_RECOVERY_KEYWORDS.some((k) => body.includes(k)) ? WEIGHTS.failure_recovery : 0;

    const evidenceCount = Array.isArray(source.derived_from) ? source.derived_from.length : 0;
    breakdown.evidence_count = Math.min(evidenceCount, 3) * (WEIGHTS.evidence_count / 3);

    const interests = (viewer && viewer.interests) || [];
    breakdown.audience_fit = interests.some((kw) => body.includes(kw)) ? WEIGHTS.audience_fit : 0;

    breakdown.reuse_value = source.reuse_count ? Math.min(source.reuse_count, 3) * (WEIGHTS.reuse_value / 3) : 0;

    const flamewarHit = FLAMEWAR_KEYWORDS.some((k) => body.includes(k));
    breakdown.flamewar_risk_penalty = flamewarHit ? WEIGHTS.flamewar_risk_penalty : 0;

    const sensitivityPenalty = ['confidential', 'top-secret'].includes(source.sensitivity) ? -20 : 0;
    breakdown.sensitivity_penalty = sensitivityPenalty;

    const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { score, breakdown };
}

export { WEIGHTS };
