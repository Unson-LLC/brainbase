/**
 * セッションアクティビティ状態の細分化
 *
 * CommandMateの5段階ステータスパターンをbrainbaseに適用:
 * - idle: フック報告なし
 * - working: AIが稼働中
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
    DONE_UNREAD: 'done-unread',
    STALE: 'stale',
});

/**
 * hookStatusから細分化されたアクティビティ状態を導出
 *
 * @param {Object|null} hookStatus - サーバーからのhookStatus
 * @param {boolean} hookStatus.isWorking
 * @param {boolean} hookStatus.isDone
 * @returns {string} ActivityState value
 */
export function deriveActivityState(hookStatus) {
    if (!hookStatus) return ActivityState.IDLE;

    if (hookStatus.isWorking) {
        return ActivityState.WORKING;
    }

    // Done state
    if (hookStatus.isDone) {
        return ActivityState.DONE_UNREAD;
    }

    return ActivityState.IDLE;
}
