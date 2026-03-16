/**
 * 汎用入力ドラフト保存（CommandMate移植）
 *
 * セッションごとにlocalStorageにドラフトテキストを保存・復元する。
 * モバイル（MobileInputDraftManager）とデスクトップ共通で使用可能。
 *
 * CommandMateのmessage draft saving pattern:
 * - セッション切り替え時に自動保存
 * - セッション復帰時に自動復元
 * - 送信成功時に自動削除
 */

const STORAGE_PREFIX = 'bb:draft:';

export class InputDraftStore {
    /**
     * ドラフトを保存
     * @param {string} sessionId
     * @param {string} text
     */
    save(sessionId, text) {
        if (!sessionId) return;
        const key = STORAGE_PREFIX + sessionId;
        try {
            localStorage.setItem(key, JSON.stringify({
                text: text ?? '',
                savedAt: Date.now()
            }));
        } catch {
            // localStorage full or unavailable
        }
    }

    /**
     * ドラフトを復元
     * @param {string} sessionId
     * @returns {string|null} 保存されたテキスト、なければnull
     */
    load(sessionId) {
        if (!sessionId) return null;
        const key = STORAGE_PREFIX + sessionId;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return typeof data.text === 'string' ? data.text : null;
        } catch {
            return null;
        }
    }

    /**
     * ドラフトを削除（送信成功時等）
     */
    remove(sessionId) {
        if (!sessionId) return;
        localStorage.removeItem(STORAGE_PREFIX + sessionId);
    }

    /**
     * 非空のドラフトがあるか
     */
    has(sessionId) {
        const draft = this.load(sessionId);
        return draft !== null && draft.length > 0;
    }
}
