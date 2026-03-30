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

    saveDraftNow(mode) {
        const inputEl = mode === 'composer' ? this.elements.composerInput : this.elements.dockInput;
        if (!inputEl) return;
        this.saveDraft(mode, inputEl);
    }

    saveDraft(mode, inputEl) {
        const sessionId = appStore.getState().currentSessionId || 'general';
        const payload = {
            value: inputEl.value,
            selectionStart: inputEl.selectionStart ?? 0,
            selectionEnd: inputEl.selectionEnd ?? 0,
            updatedAt: Date.now()
        };
        const key = `${STORAGE_KEYS.draft}:${sessionId}:${mode}`;
        console.log(`[draft] Saving draft for session ${sessionId} (${mode}):`, payload.value.substring(0, 50));
        saveJson(key, payload);
        eventBus.emit(EVENTS.MOBILE_INPUT_DRAFT_SAVED, { mode, sessionId });
    }

    restoreDrafts() {
        const sessionId = appStore.getState().currentSessionId || 'general';
        this.restoreDraftFor('dock', sessionId, this.elements.dockInput);
        this.restoreDraftFor('composer', sessionId, this.elements.composerInput);
    }

    restoreDraftFor(mode, sessionId, inputEl) {
        if (!inputEl) return;
        const draft = loadJson(`${STORAGE_KEYS.draft}:${sessionId}:${mode}`, null);
        console.log(`[draft] Restoring draft for session ${sessionId} (${mode}):`, draft ? draft.value.substring(0, 50) : '(empty)');
        if (!draft) return;
        inputEl.value = draft.value || '';
        const start = draft.selectionStart ?? 0;
        const end = draft.selectionEnd ?? start;
        inputEl.setSelectionRange(start, end);
    }

    // loadJson / saveJson imported from utils/local-storage.js
}
