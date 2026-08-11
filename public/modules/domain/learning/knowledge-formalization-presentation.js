/**
 * Internal promotion states remain machine-readable. This projection gives
 * people the concrete transition they are deciding about.
 *
 * @param {Object} candidate
 * @returns {{actionKind: string, primaryActionLabel: string, primaryActionEnabled: boolean, primaryActionDescription: string}}
 */
export function getKnowledgeCandidatePresentation(candidate = {}) {
    const isMemoryCandidate = candidate.kind === 'memory_candidate'
        || candidate.candidateType === 'memory_candidate'
        || candidate.source === 'memory_candidate';

    if (isMemoryCandidate) {
        return {
            actionKind: 'approve_formal_registration',
            primaryActionLabel: '正式登録を承認する',
            primaryActionEnabled: true,
            primaryActionDescription: '承認は登録許可の判断です。正本への登録処理は別工程です。'
        };
    }

    if (candidate.pillar === 'skill') {
        return {
            actionKind: 'skillize',
            primaryActionLabel: '再利用できる手順にする',
            primaryActionEnabled: true,
            primaryActionDescription: '所有repoのSkillへ反映します。'
        };
    }

    if (candidate.pillar === 'wiki') {
        return {
            actionKind: 'classify_destination',
            primaryActionLabel: '保存先の分類が必要',
            primaryActionEnabled: false,
            primaryActionDescription: 'legacy Wikiへの書き込みは廃止済みです。Graph・所有repo・Drive・workspace homeから正本を選んでください。'
        };
    }

    return {
        actionKind: 'formalize',
        primaryActionLabel: '正本へ反映する',
        primaryActionEnabled: true,
        primaryActionDescription: '候補を定められた正本へ反映します。'
    };
}
