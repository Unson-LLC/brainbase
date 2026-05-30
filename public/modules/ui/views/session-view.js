// SessionView — vestigial shell after Phase K3b.
//
// Session-list rendering (desktop #session-list and the mobile #mobile-session-list
// bottom-sheet) is now owned entirely by the React island (ui-islands/session-list/*).
// The old vanilla renderer + its row/menu/drag/toolbar machinery (and
// session-list-renderer.js) were retired here. What remains is the small, still-imported
// surface: the grouped-list classifier (used by the island) and the hibernation message
// helpers, plus a no-op SessionView class kept so app wiring (ui-setup-mixin) is unchanged.

const HIBERNATION_BLOCKER_LABELS = {
    active_turn: '実行中の応答があります',
    pending_startup: '起動処理が完了していません',
    pending_input: '未送信の入力があります',
    active_owner: 'ほかの表示がターミナルを操作中です',
    pinned: 'ピン留めされています',
    unsupported_engine: 'このエンジンはまだスリープに対応していません',
    weak_process_ownership: '停止対象プロセスの所有判定が弱いため安全にスリープできません',
    missing_restore_metadata: '再開に必要なCodex復元情報がありません',
    unknown_process_ownership: '所有者不明のプロセスがあるため安全にスリープできません'
};

export function formatHibernationBlockers(blockers = []) {
    if (!Array.isArray(blockers) || blockers.length === 0) return '';
    return blockers
        .map(blocker => HIBERNATION_BLOCKER_LABELS[blocker] || blocker)
        .join(' / ');
}

export function buildHibernationFailureMessage(detail = '') {
    const guidance = '確認: 入力中の端末・進行中タスク・所有者不明プロセスを閉じてから再試行してください';
    return detail
        ? `スリープできません: ${detail}。${guidance}`
        : `スリープできません。${guidance}`;
}

// State buckets for the grouped ('project') view. Consumed by the React island.
export function classifySessionsForGroupedList(sessions = []) {
    return {
        activeSessions: sessions.filter(s =>
            s.intendedState !== 'archived' &&
            s.intendedState !== 'paused' &&
            s.intendedState !== 'hibernated' &&
            s.intendedState !== 'broken' &&
            (!s.intendedState || s.intendedState === 'active')
        ),
        pausedSessions: sessions.filter(s => s.intendedState === 'paused'),
        hibernatedSessions: sessions.filter(s => s.intendedState === 'hibernated' || s.intendedState === 'broken')
    };
}

export class SessionView {
    constructor({ sessionService } = {}) {
        this.sessionService = sessionService;
        this.container = null;
        this._unsubscribers = [];
    }

    // The React island owns #session-list; mounting only records the container.
    mount(container) {
        this.container = container;
    }

    unmount() {
        this._unsubscribers.forEach(unsub => { try { unsub?.(); } catch { /* noop */ } });
        this._unsubscribers = [];
        this.container = null;
    }
}
