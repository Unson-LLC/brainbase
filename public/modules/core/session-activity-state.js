// @ts-check
/**
 * セッションアクティビティ状態の細分化（CommandMate移植）
 *
 * CommandMateの5段階ステータスパターンをbrainbaseに適用:
 * - idle: フック報告なし
 * - working: AI起動中（turn未開始）
 * - thinking: AIがturn処理中（activeTurnCount > 0）
 * - goalseek: Goal-Seek反復実行中
 * - done-unread: AI完了（未読）
 * - stale: タイムアウト（将来拡張用）
 *
 * 従来の3状態（working/done-unread/idle）からの拡張。
 * 既存の hookStatus データ構造をそのまま利用。
 */

/**
 * アクティビティ状態の定数
 */
export const ActivityState = Object.freeze({
    IDLE: 'idle',
    WORKING: 'working',
    THINKING: 'thinking',
    GOALSEEK: 'goalseek',
    DONE_UNREAD: 'done-unread',
    STALE: 'stale',
});

/**
 * hookStatusから細分化されたアクティビティ状態を導出
 *
 * @param {{ isWorking: boolean, isDone: boolean, activeTurnCount?: number, goalSeek?: { active?: boolean } }|null} hookStatus
 * @returns {string} ActivityState value
 */
export function deriveActivityState(hookStatus) {
    if (!hookStatus) return ActivityState.IDLE;

    const goalSeekActive = hookStatus.goalSeek?.active === true;
    const activeTurnCount = hookStatus.activeTurnCount || 0;

    // Goal-Seek最優先: goalSeek.active なら GOALSEEK
    if (goalSeekActive) {
        return ActivityState.GOALSEEK;
    }

    // Working states
    if (hookStatus.isWorking) {
        // activeTurnCount > 0: AIが実際にturn処理中
        if (activeTurnCount > 0) {
            return ActivityState.THINKING;
        }
        // activeTurnCount = 0: 起動中だがturn未開始
        return ActivityState.WORKING;
    }

    // Done state
    if (hookStatus.isDone) {
        return ActivityState.DONE_UNREAD;
    }

    return ActivityState.IDLE;
}
