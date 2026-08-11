// @ts-check
/**
 * SNS Public Lifelog Integrity Scoring
 *
 * 互換のため関数名は維持する。読者適合・拡散・再利用価値は採点せず、
 * 本人の一次体験への忠実さと公開上の危険だけを決定的に確認する。
 */

const FIRST_PERSON_EXPERIENCE_PATTERN = /俺|私|自分|うち|今日|昨日|今朝|今夜|やってみ|作った|決めた|迷っ|失敗|止まった|感じた|思い出した|残しておく|まだ答え/u;
const ADVICE_PATTERN = /すべき|した方がいい|しよう|してください|正解は|最初に見るべき|間違えてる|できてない|みんなはどう|詳しくは|DM(?:ください)?|プロフィール(?:へ|から)|問い合わせ/u;

const WEIGHTS = Object.freeze({
    source_fidelity: 50,
    first_person_experience: 30,
    evidence_present: 20,
    duplicate_penalty: -30,
    advice_penalty: -100,
    privacy_penalty: -100
});

/**
 * @param {{body?:string, derived_from?:Array<string>, evidence_ids?:Array<any>, sensitivity?:string}} source
 * @param {any} _viewer
 * @param {Array<{body?:string}>} history
 * @returns {{score:number, breakdown:Record<string,number>}}
 */
export function scoreDraftCandidate(source, _viewer, history = []) {
    const body = String(source?.body || '').trim();
    const evidenceCount = (Array.isArray(source?.derived_from) ? source.derived_from.length : 0)
        + (Array.isArray(source?.evidence_ids) ? source.evidence_ids.length : 0);
    const duplicate = body.length > 0 && history.some((item) => String(item?.body || '').trim() === body);
    const privateSource = ['confidential', 'top-secret'].includes(String(source?.sensitivity || ''));

    const breakdown = {
        source_fidelity: body && evidenceCount > 0 ? WEIGHTS.source_fidelity : 0,
        first_person_experience: FIRST_PERSON_EXPERIENCE_PATTERN.test(body)
            ? WEIGHTS.first_person_experience
            : 0,
        evidence_present: evidenceCount > 0 ? WEIGHTS.evidence_present : 0,
        duplicate_penalty: duplicate ? WEIGHTS.duplicate_penalty : 0,
        advice_penalty: ADVICE_PATTERN.test(body) ? WEIGHTS.advice_penalty : 0,
        privacy_penalty: privateSource ? WEIGHTS.privacy_penalty : 0
    };

    return {
        score: Object.values(breakdown).reduce((total, value) => total + value, 0),
        breakdown
    };
}

export { WEIGHTS };
