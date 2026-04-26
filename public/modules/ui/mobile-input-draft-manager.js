import { appStore } from '../core/store.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { loadJson, saveJson } from '../utils/local-storage.js';

const STORAGE_KEYS = {
    draft: 'bb_mobile_draft'
};

/**
 * MobileInputDraftManager
 *
 * モバイル入力欄のドラフト保存・復元を担当
 *
 * 責務:
 * - セッションごとのドラフト保存（400ms遅延）
 * - セッション切り替え時のドラフト復元
 * - localStorage への保存・読み込み
 */
export class MobileInputDraftManager {
    constructor(elements) {
        this.elements = elements;
        this.draftTimers = {};
    }

    scheduleDraftSave(mode, inputEl) {
        if (!inputEl) return;
        if (this.draftTimers[mode]) {
            clearTimeout(this.draftTimers[mode]);
        }
        this.draftTimers[mode] = setTimeout(() => {
            this.saveDraft(mode, inputEl);
        }, 400);
    }

    cancelPendingTimer(mode) {
        if (this.draftTimers[mode]) {
            clearTimeout(this.draftTimers[mode]);
            this.draftTimers[mode] = null;
        }
    }

    saveDraftNow(mode, sessionId = null) {
        this.cancelPendingTimer(mode);
        const inputEl = mode === 'composer' ? this.elements.composerInput : this.elements.dockInput;
        if (!inputEl) return;
        this.saveDraft(mode, inputEl, sessionId);
    }

    saveDraft(mode, inputEl, explicitSessionId = null) {
        const sessionId = explicitSessionId || appStore.getState().currentSessionId || 'general';
        const key = this.getDraftKey(sessionId, mode);

        if (!inputEl.value.trim()) {
            try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
            return;
        }

        const payload = {
            value: inputEl.value,
            selectionStart: inputEl.selectionStart ?? 0,
            selectionEnd: inputEl.selectionEnd ?? 0,
            updatedAt: Date.now()
        };
        saveJson(key, payload);
        eventBus.emit(EVENTS.MOBILE_INPUT_DRAFT_SAVED, { mode, sessionId });
    }

    restoreDrafts(sessionId = null) {
        sessionId = sessionId || appStore.getState().currentSessionId || 'general';
        this.restoreDraftFor('dock', sessionId, this.elements.dockInput);
        this.restoreDraftFor('composer', sessionId, this.elements.composerInput);
    }

    restoreDraftFor(mode, sessionId, inputEl) {
        if (!inputEl) return;
        const draft = loadJson(this.getDraftKey(sessionId, mode), null);
        console.log(`[draft] Restoring draft for session ${sessionId} (${mode}):`, draft ? draft.value.substring(0, 50) : '(empty)');
        if (!draft) {
            inputEl.value = '';
            inputEl.setSelectionRange(0, 0);
            return;
        }
        inputEl.value = draft.value || '';
        const start = draft.selectionStart ?? 0;
        const end = draft.selectionEnd ?? start;
        inputEl.setSelectionRange(start, end);
    }

    getDraftKey(sessionId, mode) {
        return `${STORAGE_KEYS.draft}:${sessionId}:${mode}`;
    }

    // loadJson / saveJson imported from utils/local-storage.js
}
