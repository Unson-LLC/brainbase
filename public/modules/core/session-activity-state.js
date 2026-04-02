// @ts-check
/**
 * セッションアクティビティ状態の細分化
 *
 * 4段階ステータス:
 * - idle: フック報告なし
 * - working: AI起動中（turn未開始）
 * - thinking: AIがturn処理中（activeTurnCount > 0）
 * - done-unread: AI完了（未読）
 *
 * 既存の hookStatus データ構造をそのまま利用。
 */

/**
 * アクティビティ状態の定数
 */
export const ActivityState = Object.freeze({
    IDLE: 'idle',
    WORKING: 'working',
    THINKING: 'thinking',
    DONE_UNREAD: 'done-unread',
});

/**
 * hookStatusから細分化されたアクティビティ状態を導出
 *
 * @param {{ isWorking: boolean, isDone: boolean, activeTurnCount?: number }|null} hookStatus
 * @returns {string} ActivityState value
 */
export function deriveActivityState(hookStatus) {
    if (!hookStatus) return ActivityState.IDLE;

    const activeTurnCount = hookStatus.activeTurnCount || 0;

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
