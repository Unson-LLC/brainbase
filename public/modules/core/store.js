/**
 * Proxyベースのリアクティブストア
 * 状態変更を自動検知してリスナーに通知
 *
 * 機能:
 * - revision: 変更バージョン追跡（古いイベント破棄用）
 * - batch(): 複数setState時の通知を1回にまとめる
 * - subscribeToSelector(): 特定の値だけを監視
 */
export class Store {
    constructor(initialState) {
        this._listeners = new Set();
        this._state = this._createProxy(initialState);
        // revision: 変更バージョン追跡
        this._revision = 0;
        // batch: 複数setState時の通知をまとめる
        this._isBatching = false;
        this._batchedChanges = [];
    }

    /**
     * 現在のrevisionを取得
     * @returns {number} - 現在のrevision番号
     */
    getRevision() {
        return this._revision;
    }

    /**
     * 状態をProxyでラップ
     * @private
     */
    _createProxy(target) {
        const self = this;
        return new Proxy(target, {
            set(obj, key, value) {
                const oldValue = obj[key];
                obj[key] = value;
                if (oldValue !== value) {
                    self._notify({ key, value, oldValue });
                }
                return true;
            }
        });
    }

    /**
     * 状態取得
     * @returns {Object} - 現在の状態
     */
    getState() {
        return this._state;
    }

    /**
     * 状態更新
     * @param {Object} updates - 更新内容
     */
    setState(updates) {
        this._revision++;
        Object.assign(this._state, updates);
    }

    /**
     * 複数のsetStateを1回の通知にまとめる
     * @param {Function} updateFn - 複数のsetStateを含む関数
     */
    batch(updateFn) {
        const wasBatching = this._isBatching;
        this._isBatching = true;
        this._batchedChanges = [];

        try {
            updateFn();
        } finally {
            this._isBatching = wasBatching;
            if (!wasBatching && this._batchedChanges.length > 0) {
                // バッチ完了: まとめて通知
                const mergedChanges = {};
                this._batchedChanges.forEach(change => {
                    mergedChanges[change.key] = change.value;
                });
                this._notifyListeners({
                    key: '_batch',
                    value: mergedChanges,
                    isBatch: true,
                    revision: this._revision,
                    changes: this._batchedChanges
                });
                this._batchedChanges = [];
            }
        }
    }

    /**
     * Selector関数で特定の値だけを購読
     * @param {Function} selector - 状態から値を抽出する関数
     * @param {Function} listener - リスナー関数
     * @param {Function} [equalityFn=Object.is] - 等価判定関数
     * @returns {Function} - 購読解除関数
     */
    subscribeToSelector(selector, listener, equalityFn = Object.is) {
        let lastValue = selector(this._state);

        const wrappedListener = (change) => {
            const newValue = selector(this._state);
            if (!equalityFn(lastValue, newValue)) {
                const oldValue = lastValue;
                lastValue = newValue;
                listener({
                    value: newValue,
                    oldValue,
                    revision: change.revision,
                    isStale: () => this._revision > change.revision
                });
            }
        };

        this._listeners.add(wrappedListener);
        return () => this._listeners.delete(wrappedListener);
    }

    /**
     * 変更購読
     * @param {Function} listener - リスナー関数
     * @returns {Function} - 購読解除関数
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    /**
     * リスナーに通知
     * @private
     */
    _notify(change) {
        const currentRevision = this._revision;
        const enrichedChange = {
            ...change,
            revision: currentRevision,
            isStale: () => this._revision > currentRevision
        };

        if (this._isBatching) {
            // バッチモード: 変更を蓄積
            this._batchedChanges.push(enrichedChange);
            return;
        }

        this._notifyListeners(enrichedChange);
    }

    /**
     * リスナーに実際に通知
     * @private
     */
    _notifyListeners(change) {
        const currentRevision = change.revision;
        this._listeners.forEach(listener => {
            try {
                // isStaleを正しく設定
                const changeWithStale = {
                    ...change,
                    isStale: () => this._revision > currentRevision
                };
                listener(changeWithStale);
            } catch (error) {
                console.error('Error in store listener:', error);
            }
        });
    }
}

/**
 * アプリケーション全体のストア
 */
export const appStore = new Store({
    sessions: [],
    currentSessionId: null,
    tasks: [],
    schedule: null,
    inbox: [],
    testMode: false, // テストモード（読み取り専用）
    filters: {
        taskFilter: '',
        showAllTasks: false
    },
    ui: {
        inboxOpen: false,
        draggedSessionId: null,
        draggedSessionProject: null
    },
    // Auto-Claude RecoveryManager pattern
    recovery: {
        hints: null,
        attemptCount: 0,
        isStuck: false,
        maxAttempts: 3
    },
    // Auto-Claude QA Loop pattern
    qa: {
        currentReviews: [],
        history: [],
        escalations: [],
        config: {
            maxIterations: 3,
            similarityThreshold: 0.8
        }
    },
    // Auto-Claude parallel agent pattern
    agents: {
        running: [],
        completed: [],
        failed: [],
        maxConcurrent: 12
    }
});
