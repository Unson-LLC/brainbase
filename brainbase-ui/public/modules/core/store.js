/**
 * Proxyベースのリアクティブストア
 * 状態変更を自動検知してリスナーに通知
 */
export class Store {
    constructor(initialState) {
        this._listeners = new Set();
        this._state = this._createProxy(initialState);
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
        Object.assign(this._state, updates);
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
        this._listeners.forEach(listener => {
            try {
                listener(change);
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
    filters: {
        taskFilter: '',
        showAllTasks: false
    },
    ui: {
        inboxOpen: false,
        draggedSessionId: null,
        draggedSessionProject: null
    }
});
