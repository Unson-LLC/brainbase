// @ts-check
/**
 * セッションアクティビティ状態の細分化
 *
 * 5段階ステータス:
 * - idle: フック報告なし
 * - waiting: ユーザー入力待ち
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
    WAITING: 'waiting',
    WORKING: 'working',
    THINKING: 'thinking',
    DONE_UNREAD: 'done-unread',
});

/**
 * hookStatusから細分化されたアクティビティ状態を導出
 *
 * @param {{ state?: string, isWorking: boolean, isDone: boolean, activeTurnCount?: number, liveActivity?: { activityKind?: string|null, statusTone?: string|null }|null }|null} hookStatus
 * @returns {string} ActivityState value
 */
export function deriveActivityState(hookStatus) {
    if (!hookStatus) return ActivityState.IDLE;

    if (typeof hookStatus.state === 'string') {
        switch (hookStatus.state) {
        case 'waiting':
            return ActivityState.WAITING;
        case 'running':
            return (hookStatus.activeTurnCount || 0) > 0
                ? ActivityState.THINKING
                : ActivityState.WORKING;
        case 'starting':
            return ActivityState.WORKING;
        case 'done-unread':
            return ActivityState.DONE_UNREAD;
        case 'idle':
            return ActivityState.IDLE;
        default:
            break;
        }
    }

    const activeTurnCount = hookStatus.activeTurnCount || 0;
    const activityKind = hookStatus.liveActivity?.activityKind || null;
    const statusTone = hookStatus.liveActivity?.statusTone || null;
    const isWaiting = statusTone === 'waiting' || activityKind === 'waiting_input';

    if (isWaiting) {
        return ActivityState.WAITING;
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
