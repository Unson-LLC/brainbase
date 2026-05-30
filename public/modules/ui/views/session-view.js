import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { groupSessionsByProject } from '../../session-manager.js';
import { getProjectFromSession } from '../../project-mapping.js';
import { renderSessionGroupHeaderHTML, renderSessionRowHTML } from '../../session-list-renderer.js';
import { deriveSessionUiState } from '../../session-ui-state.js';
import { FolderTreeView } from './folder-tree-view.js';
import { showConfirm } from '../../confirm-modal.js';
import { dismissToast, showError, showInfo, showSuccess } from '../../toast.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';

const SESSION_FAVORITES_STORAGE_KEY = 'brainbase.sessionFavorites.v1';
const SESSION_MENU_DEBUG_MAX_ENTRIES = 120;
const SESSION_MENU_DEBUG_ENDPOINT = '/api/client-diagnostics/session-menu';

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

function describeSessionMenuElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    const rect = element.getBoundingClientRect?.();
    return {
        tag: element.tagName,
        id: element.id || null,
        className: String(element.className || ''),
        dataId: element.dataset?.id || null,
        title: element.getAttribute?.('title') || null,
        text: (element.textContent || '').trim().slice(0, 80),
        rect: rect ? {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        } : null
    };
}

/**
 * セッション表示のUIコンポーネント
 * 現行版と同じ構造でプロジェクトグループ表示
 */
export class SessionView {
    // Flag read by both the vanilla renderer (to bail) and the React island (to mount).
    static _sessionListIslandEnabled() {
        // Default ON. Opt OUT with ?island=0 or localStorage bb:session-list-island='0'.
        // Mirrors ui-islands/session-list/index.jsx islandEnabled().
        try {
            const p = new URLSearchParams(location.search);
            if (p.get('island') === '0') return false;
            if (p.has('island')) return true;
            if (localStorage.getItem('bb:session-list-island') === '0') return false;
            return true;
        } catch { return true; }
    }

    constructor({ sessionService, fileViewerService }) {
        this.sessionService = sessionService;
        this.folderTreeView = new FolderTreeView({ sessionService, fileViewerService });
        this.container = null;
        this._unsubscribers = [];
        this._renderRafId = null;
        this.legacyFavoriteSessionIds = this._loadFavoriteSessionIds();
        this._legacyFavoritesMigrationInFlight = false;
        this.sessionSearchQuery = '';
        this.showFavoriteSessionsOnly = false;
        this._timelineAttentionSortBySessionId = new Map();
        this._sessionMenuDebugSeq = 0;
        this._sessionMenuCaptureHandler = null;
        this._sessionMenuRetargetedClick = null;
        // Drag and drop state
        this.draggedSessionId = null;
        this.draggedSessionProject = null;
    }

    _scheduleRender() {
        if (this._renderRafId) return;
        this._renderRafId = requestAnimationFrame(() => {
            this._renderRafId = null;
            this.render();
        });
    }

    _buildSessionMenuDebugSnapshot(phase, { event = null, row = null, menuToggle = null, dropdownMenu = null, session = null, reason = null } = {}) {
        const state = appStore.getState();
        const eventPoint = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
            ? { x: Math.round(event.clientX), y: Math.round(event.clientY) }
            : null;
        const hitElement = eventPoint && typeof document.elementFromPoint === 'function'
            ? document.elementFromPoint(event.clientX, event.clientY)
            : null;
        const overlay = document.getElementById('menu-overlay');
        const fileViewerPanel = document.getElementById('file-viewer-panel');
        const activeElement = document.activeElement;
        const path = typeof event?.composedPath === 'function'
            ? event.composedPath().slice(0, 8).map(describeSessionMenuElement)
            : [];
        const openMenus = Array.from(document.querySelectorAll('.session-dropdown-menu'))
            .filter(menu => !menu.classList.contains('hidden'))
            .map(menu => {
                const menuRow = menu.closest('.session-child-row');
                return {
                    sessionId: menuRow?.dataset?.id || null,
                    connected: menu.isConnected,
                    hidden: menu.classList.contains('hidden'),
                    element: describeSessionMenuElement(menu)
                };
            });

        return {
            seq: ++this._sessionMenuDebugSeq,
            phase,
            reason,
            timestamp: new Date().toISOString(),
            sessionId: session?.id || row?.dataset?.id || null,
            currentSessionId: state.currentSessionId || null,
            sessionListView: state.ui?.sessionListView || null,
            sidebarPrimaryView: state.ui?.sidebarPrimaryView || null,
            fileViewerActive: document.body.classList.contains('file-viewer-active'),
            renderScheduled: Boolean(this._renderRafId),
            event: event ? {
                type: event.type,
                button: event.button,
                buttons: event.buttons,
                isTrusted: event.isTrusted,
                defaultPrevented: event.defaultPrevented,
                eventPhase: event.eventPhase,
                pointerType: event.pointerType || null,
                point: eventPoint
            } : null,
            target: describeSessionMenuElement(event?.target),
            currentTarget: describeSessionMenuElement(event?.currentTarget),
            hitElement: describeSessionMenuElement(hitElement),
            hitClosestMenuToggle: Boolean(hitElement?.closest?.('.session-menu-toggle')),
            hitClosestRow: hitElement?.closest?.('.session-child-row')?.dataset?.id || null,
            path,
            row: {
                connected: Boolean(row?.isConnected),
                element: describeSessionMenuElement(row)
            },
            menuToggle: {
                connected: Boolean(menuToggle?.isConnected),
                disabled: Boolean(menuToggle?.disabled),
                element: describeSessionMenuElement(menuToggle),
                computed: menuToggle ? {
                    display: getComputedStyle(menuToggle).display,
                    visibility: getComputedStyle(menuToggle).visibility,
                    opacity: getComputedStyle(menuToggle).opacity,
                    pointerEvents: getComputedStyle(menuToggle).pointerEvents
                } : null
            },
            dropdownMenu: {
                connected: Boolean(dropdownMenu?.isConnected),
                hidden: dropdownMenu ? dropdownMenu.classList.contains('hidden') : null,
                element: describeSessionMenuElement(dropdownMenu),
                computed: dropdownMenu ? {
                    display: getComputedStyle(dropdownMenu).display,
                    visibility: getComputedStyle(dropdownMenu).visibility,
                    opacity: getComputedStyle(dropdownMenu).opacity,
                    pointerEvents: getComputedStyle(dropdownMenu).pointerEvents,
                    zIndex: getComputedStyle(dropdownMenu).zIndex
                } : null
            },
            overlay: {
                exists: Boolean(overlay),
                hidden: overlay ? overlay.classList.contains('hidden') : null,
                element: describeSessionMenuElement(overlay)
            },
            fileViewerPanel: {
                display: fileViewerPanel ? getComputedStyle(fileViewerPanel).display : null,
                element: describeSessionMenuElement(fileViewerPanel)
            },
            activeElement: describeSessionMenuElement(activeElement),
            openMenus
        };
    }

    _logSessionMenuDebug(phase, details = {}) {
        const snapshot = this._buildSessionMenuDebugSnapshot(phase, details);
        try {
            const key = '__brainbaseSessionMenuDebug';
            const entries = Array.isArray(window[key]) ? window[key] : [];
            entries.push(snapshot);
            window[key] = entries.slice(-SESSION_MENU_DEBUG_MAX_ENTRIES);
        } catch {
            // Diagnostics must never break the menu itself.
        }

        console.info('[session-menu-debug]', snapshot);

        try {
            fetch(SESSION_MENU_DEBUG_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
                body: JSON.stringify(snapshot)
            }).catch(() => {});
        } catch {
            // Ignore transport failures; the in-browser ring buffer still remains.
        }

        return snapshot;
    }

    _getElementAtEventPoint(event) {
        if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
        if (typeof document.elementFromPoint !== 'function') return null;
        return document.elementFromPoint(event.clientX, event.clientY);
    }

    _shouldSuppressSessionMenuRetargetClick(event) {
        const retarget = this._sessionMenuRetargetedClick;
        if (!retarget || Date.now() > retarget.until) {
            this._sessionMenuRetargetedClick = null;
            return false;
        }

        const target = event?.target;
        const hitElement = this._getElementAtEventPoint(event);
        const targetRow = target?.closest?.('.session-child-row') || null;
        const hitRow = hitElement?.closest?.('.session-child-row') || null;
        const targetToggle = target?.closest?.('.session-menu-toggle') || null;
        const hitToggle = hitElement?.closest?.('.session-menu-toggle') || null;

        return Boolean(
            retarget.row?.isConnected &&
            (
                targetRow === retarget.row ||
                hitRow === retarget.row ||
                targetToggle === retarget.menuToggle ||
                hitToggle === retarget.menuToggle
            )
        );
    }

    _isSessionRowActionEvent(event) {
        const target = event?.target;
        const hitElement = this._getElementAtEventPoint(event);
        return Boolean(
            target?.closest?.('button') ||
            target?.closest?.('.drag-handle') ||
            target?.closest?.('.session-dropdown-menu') ||
            hitElement?.closest?.('button') ||
            hitElement?.closest?.('.drag-handle') ||
            hitElement?.closest?.('.session-dropdown-menu')
        );
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    /**
     * 行のビジュアルを決定する入力値からフィンガープリントを生成
     * @private
     */
    _computeRowFingerprint(session, currentSessionId, options) {
        const uiState = deriveSessionUiState(session.id);
        const summary = session.summary || {};
        const convSummary = session.conversationSummary || {};
        return [
            session.id,
            session.name || '',
            currentSessionId === session.id ? '1' : '0',
            uiState.activity || '',
            uiState.attention || '',
            uiState.transport || '',
            uiState.recentFile?.path || '',
            session.intendedState || '',
            session.hasWorktree ? '1' : '0',
            session.engine || '',
            options.project || '',
            summary.repo || '',
            summary.baseBranch || '',
            summary.dirty ? '1' : '0',
            summary.unpushed ? '1' : '0',
            summary.unmerged || summary.needsMerge ? '1' : '0',
            summary.conflict || summary.hasConflicts ? '1' : '0',
            summary.changesNotPushed || 0,
            summary.prStatus || '',
            convSummary.totalConversations || 0,
            options.isFavorite ? '1' : '0',
        ].join('\t');
    }

    _buildSessionRowElement(session, currentSessionId, options = {}) {
        const { project, showProjectEmoji = false, isDraggable = true, enableDrag = true } = options;
        const isFavorite = this._isFavoriteSession(session);
        const sessionUiState = deriveSessionUiState(session.id);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = renderSessionRowHTML(session, {
            isActive: currentSessionId === session.id,
            project,
            showProjectEmoji,
            isDraggable,
            isFavorite,
            sessionUiState
        });
        const childRow = wrapper.firstElementChild;
        childRow.dataset.fingerprint = this._computeRowFingerprint(session, currentSessionId, { project, isFavorite });

        childRow.addEventListener('click', async (e) => {
            if (!this._isSessionRowActionEvent(e)) {
                const sessionId = childRow.dataset.id;
                if (sessionId) {
                    this._closeAllMenus('row-select');
                    await this.sessionService.switchSession(sessionId);
                } else {
                    console.error('Session ID not found in row:', childRow);
                }
            }
        });

        this._attachSessionActionHandlers(childRow, session, { enableDrag });
        return childRow;
    }

    _refreshSessionRows(sessionIds = []) {
        if (!this.container || !Array.isArray(sessionIds) || sessionIds.length === 0) return;
        // Island owns #session-list rows; vanilla per-row refresh must not touch them.
        if (SessionView._sessionListIslandEnabled()) return;

        const { sessions, currentSessionId } = appStore.getState();
        for (const sessionId of sessionIds) {
            const currentRow = this.container.querySelector(`.session-child-row[data-id="${sessionId}"]`);
            if (!currentRow) continue;
            const session = (sessions || []).find((item) => item.id === sessionId);
            if (!session) continue;

            const project = currentRow.dataset.project || getProjectFromSession(session);
            const showProjectEmoji = Boolean(currentRow.querySelector('.session-project-emoji'));
            const dragHandle = currentRow.querySelector('.drag-handle');
            const isDraggable = dragHandle?.getAttribute('draggable') !== 'false';
            const enableDrag = isDraggable;
            // フィンガープリント比較：レンダリング入力が同じなら差し替え不要
            const newFingerprint = this._computeRowFingerprint(session, currentSessionId, {
                project,
                isFavorite: this._isFavoriteSession(session)
            });
            if (currentRow.dataset.fingerprint === newFingerprint) continue;

            const wasMenuOpen = Boolean(currentRow.querySelector('.session-dropdown-menu:not(.hidden)'));

            const nextRow = this._buildSessionRowElement(session, currentSessionId, {
                project,
                showProjectEmoji,
                isDraggable,
                enableDrag
            });
            currentRow.replaceWith(nextRow);
            refreshIcons({ root: nextRow });

            if (wasMenuOpen) {
                const nextDropdownMenu = nextRow.querySelector('.session-dropdown-menu');
                const nextMenuToggle = nextRow.querySelector('.session-menu-toggle');
                if (nextDropdownMenu) {
                    nextDropdownMenu.classList.remove('hidden');
                    nextRow.classList.add('session-menu-open');
                    document.getElementById('menu-overlay')?.classList.remove('hidden');
                    this._logSessionMenuDebug('refresh-row-preserved-open-menu', {
                        row: nextRow,
                        menuToggle: nextMenuToggle,
                        dropdownMenu: nextDropdownMenu,
                        session,
                        reason: 'row-refresh'
                    });
                    this._scheduleSessionDropdownLayout(nextRow, nextDropdownMenu, nextMenuToggle, session, 'refresh-row-preserved-open-menu');
                }
            }
        }
    }

    _scheduleSessionDropdownLayout(row, dropdownMenu, menuToggle, session, phase, event = null) {
        if (!row || !dropdownMenu) return;
        requestAnimationFrame(() => {
            dropdownMenu.style.top = '';
            dropdownMenu.style.bottom = '';
            dropdownMenu.style.marginTop = '';
            dropdownMenu.style.marginBottom = '';
            dropdownMenu.style.maxHeight = '';
            dropdownMenu.style.overflowY = '';

            const mobileSessionList = row.closest('#mobile-session-list');
            const mobileBoundary = mobileSessionList || row.closest('.bottom-sheet-content');
            if (mobileBoundary) {
                const rowRect = row.getBoundingClientRect();
                const boundaryRect = mobileBoundary.getBoundingClientRect();
                const menuHeight = dropdownMenu.scrollHeight;
                const gap = 4;
                const spaceBelow = Math.max(0, boundaryRect.bottom - rowRect.bottom - gap);
                const spaceAbove = Math.max(0, rowRect.top - boundaryRect.top - gap);
                const openBelow = spaceBelow >= Math.min(menuHeight, 180) || spaceBelow >= spaceAbove;
                const availableSpace = openBelow ? spaceBelow : spaceAbove;

                dropdownMenu.style.top = openBelow ? '100%' : 'auto';
                dropdownMenu.style.bottom = openBelow ? 'auto' : '100%';
                dropdownMenu.style.marginTop = openBelow ? `${gap}px` : '0';
                dropdownMenu.style.marginBottom = openBelow ? '0' : `${gap}px`;

                if (availableSpace > 0 && menuHeight > availableSpace) {
                    dropdownMenu.style.maxHeight = `${Math.max(96, availableSpace)}px`;
                    dropdownMenu.style.overflowY = 'auto';
                }
                this._logSessionMenuDebug(`${phase}-opened-after-layout`, {
                    event,
                    row,
                    menuToggle,
                    dropdownMenu,
                    session
                });
                return;
            }

            const menuRect = dropdownMenu.getBoundingClientRect();
            if (menuRect.bottom > window.innerHeight) {
                dropdownMenu.style.top = 'auto';
                dropdownMenu.style.bottom = '100%';
                dropdownMenu.style.marginTop = '0';
                dropdownMenu.style.marginBottom = '4px';
            } else {
                dropdownMenu.style.top = '';
                dropdownMenu.style.bottom = '';
                dropdownMenu.style.marginTop = '';
                dropdownMenu.style.marginBottom = '';
            }
            this._logSessionMenuDebug(`${phase}-opened-after-layout`, {
                event,
                row,
                menuToggle,
                dropdownMenu,
                session
            });
        });
    }

    /**
     * イベントリスナーの設定
     */
    _setupEventListeners() {
        // イベント購読（バッチングで重複renderを抑制）
        const unsub1 = eventBus.on(EVENTS.SESSION_LOADED, () => this._scheduleRender());
        const unsub2 = eventBus.on(EVENTS.SESSION_CREATED, () => this._scheduleRender());
        const unsub3 = eventBus.on(EVENTS.SESSION_UPDATED, () => this._scheduleRender());
        const unsub4 = eventBus.on(EVENTS.SESSION_DELETED, () => this._scheduleRender());
        const unsub5 = eventBus.on(EVENTS.SESSION_PAUSED, () => this._scheduleRender());
        const unsub6 = eventBus.on(EVENTS.SESSION_RESUMED, () => this._scheduleRender());
        const unsub6b = eventBus.on(EVENTS.SESSION_UI_STATE_CHANGED, (event) => {
            const sessionListView = appStore.getState().ui?.sessionListView || 'timeline';
            const sessionIds = event.detail?.sessionIds;
            const hasTargetSessionIds = Array.isArray(sessionIds) && sessionIds.length > 0;

            if (sessionListView === 'timeline') {
                // 差分更新 → 必要なら並び替え（フルrenderしない）
                if (hasTargetSessionIds) {
                    this._refreshSessionRows(sessionIds);
                } else {
                    this._scheduleRender();
                }
                this._reorderTimelineRows();
                return;
            }

            if (hasTargetSessionIds) {
                this._refreshSessionRows(sessionIds);
                return;
            }
            this._scheduleRender();
        });
        const unsub7 = appStore.subscribeToSelector(
            state => state.ui?.sessionListView,
            () => this._scheduleRender()
        );
        const unsub8 = appStore.subscribeToSelector(
            state => state.ui?.sidebarPrimaryView,
            () => this._scheduleRender()
        );
        const unsub9 = appStore.subscribeToSelector(
            state => state.folderTree,
            () => this._scheduleRender()
        );
        const unsub10 = appStore.subscribeToSelector(
            state => state.currentSessionId,
            () => this._scheduleRender()
        );
        const unsub11 = appStore.subscribeToSelector(
            state => Boolean(state.fileViewer),
            () => this._scheduleRender()
        );

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6, unsub6b, unsub7, unsub8, unsub9, unsub10, unsub11);

        // ドロップダウンメニューの外側クリックで閉じる処理（document全体で1回のみ）
        this._outsideClickHandler = (e) => {
            if (this._shouldSuppressSessionMenuRetargetClick(e)) {
                const row = this._sessionMenuRetargetedClick?.row || null;
                const menuToggle = this._sessionMenuRetargetedClick?.menuToggle || null;
                const dropdownMenu = row?.querySelector?.('.session-dropdown-menu') || null;
                this._logSessionMenuDebug('outside-click-ignored-after-retarget', {
                    event: e,
                    row,
                    menuToggle,
                    dropdownMenu
                });
                e.preventDefault();
                e.stopPropagation();
                this._sessionMenuRetargetedClick = null;
                return;
            }

            // クリックされた要素がメニュートグルまたはドロップダウン内かチェック
            const hitElement = this._getElementAtEventPoint(e);
            const isMenuToggle = e.target.closest('.session-menu-toggle') || hitElement?.closest?.('.session-menu-toggle');
            const isDropdownMenu = e.target.closest('.session-dropdown-menu') || hitElement?.closest?.('.session-dropdown-menu');

            // どちらでもない場合、すべてのメニューを閉じる
            if (!isMenuToggle && !isDropdownMenu) {
                this._closeAllMenus('outside-click');
            }
        };
        document.addEventListener('click', this._outsideClickHandler);

        this._sessionMenuCaptureHandler = (e) => {
            const target = e.target;
            const hitElement = this._getElementAtEventPoint(e);
            const hitMenuToggle = hitElement?.closest?.('.session-menu-toggle') || null;
            let menuToggle = target?.closest?.('.session-menu-toggle') || hitMenuToggle || null;
            let dropdownMenu = target?.closest?.('.session-dropdown-menu') || menuToggle?.closest?.('.session-actions-container')?.querySelector?.('.session-dropdown-menu') || null;
            const row = target?.closest?.('.session-child-row') || hitMenuToggle?.closest?.('.session-child-row') || menuToggle?.closest?.('.session-child-row') || dropdownMenu?.closest?.('.session-child-row') || null;
            if (row && !menuToggle) {
                menuToggle = row.querySelector('.session-menu-toggle');
            }
            if (row && !dropdownMenu) {
                dropdownMenu = row.querySelector('.session-dropdown-menu');
            }
            const overlay = target?.closest?.('#menu-overlay') || null;
            if (!row && !menuToggle && !dropdownMenu && !overlay) return;

            // The React session-list island owns its own menu (React onClick). This
            // capture handler retargets/suppresses real pointer sequences for the
            // vanilla menus, which would swallow the island toggle's click and stop the
            // menu opening. Never intercept toggles inside the island-owned container.
            const islandHost = menuToggle || dropdownMenu || row;
            if (islandHost?.closest?.('[data-island-owned="1"]')) return;
            this._logSessionMenuDebug(`document-capture:${e.type}`, {
                event: e,
                row,
                menuToggle,
                dropdownMenu,
                reason: overlay ? 'overlay-target' : null
            });

            if (e.type === 'click' && this._shouldSuppressSessionMenuRetargetClick(e)) {
                this._logSessionMenuDebug('document-capture:click-ignored-after-retarget', {
                    event: e,
                    row,
                    menuToggle,
                    dropdownMenu
                });
                e.preventDefault();
                e.stopPropagation();
                this._sessionMenuRetargetedClick = null;
                return;
            }

            if (
                e.type === 'pointerdown' &&
                hitMenuToggle &&
                target?.closest?.('.session-menu-toggle') !== hitMenuToggle
            ) {
                if (typeof e.button === 'number' && e.button !== 0) {
                    e.stopPropagation();
                    return;
                }

                this._sessionMenuRetargetedClick = {
                    row,
                    menuToggle: hitMenuToggle,
                    until: Date.now() + 800
                };
                this._logSessionMenuDebug('document-capture:hit-toggle-retarget', {
                    event: e,
                    row,
                    menuToggle: hitMenuToggle,
                    dropdownMenu
                });
                e.preventDefault();
                e.stopPropagation();

                const EventCtor = window.PointerEvent || window.MouseEvent;
                const syntheticPointerDown = new EventCtor('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    button: e.button,
                    buttons: e.buttons,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    pointerType: e.pointerType || 'mouse'
                });
                hitMenuToggle.dispatchEvent(syntheticPointerDown);
            }
        };
        document.addEventListener('pointerdown', this._sessionMenuCaptureHandler, true);
        document.addEventListener('click', this._sessionMenuCaptureHandler, true);

        // iframe上のオーバーレイクリックでメニューを閉じる
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay) {
            menuOverlay.addEventListener('click', () => {
                this._closeAllMenus('overlay-click');
            });
        }
    }

    /**
     * すべてのドロップダウンメニューを閉じる
     */
    _closeAllMenus(reason = 'unknown') {
        const openMenus = Array.from(document.querySelectorAll('.session-dropdown-menu'))
            .filter(menu => !menu.classList.contains('hidden'));
        if (openMenus.length > 0) {
            this._logSessionMenuDebug('close-all-before', {
                row: openMenus[0].closest('.session-child-row'),
                dropdownMenu: openMenus[0],
                menuToggle: openMenus[0].closest('.session-actions-container')?.querySelector('.session-menu-toggle') || null,
                reason
            });
        }
        document.querySelectorAll('.session-dropdown-menu').forEach(menu => {
            menu.classList.add('hidden');
        });
        document.querySelectorAll('.session-child-row.session-menu-open').forEach(row => {
            row.classList.remove('session-menu-open');
        });
        // オーバーレイを非表示
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay) {
            menuOverlay.classList.add('hidden');
        }
    }

    /**
     * セッションリストをレンダリング（状態別セクション構造）
     */
    render() {
        if (!this.container) return;

        // Coexistence guard: when the React session-list island is enabled
        // (flag-gated, Spec: story-session-list-react-island), the vanilla renderer
        // must not touch #session-list. Read the SAME flag the island reads
        // (deterministic, mount-order independent) — otherwise both fight over the
        // container and lucide refreshIcons() churns 800+ SVGs per poll.
        if (SessionView._sessionListIslandEnabled()) return;

        this._renderListBody();
    }

    /**
     * Render the vanilla session list into an arbitrary container.
     * Used by the mobile bottom-sheet (#mobile-session-list), which must keep its
     * original vanilla design even when the desktop #session-list is owned by the
     * React island. We temporarily retarget this.container so the existing render
     * body (which builds rows WITH their action/menu/drag handlers) writes into the
     * target, then restore it. Synchronous, so no other code observes the swap.
     */
    renderInto(targetEl) {
        if (!targetEl) return;
        const saved = this.container;
        this.container = targetEl;
        try {
            this._renderListBody();
        } finally {
            this.container = saved;
        }
    }

    /**
     * The actual vanilla session-list render (no island guard). Writes into
     * this.container, so callers set/restore it (render() / renderInto()).
     */
    _renderListBody() {
        if (!this.container) return;

        this._closeAllMenus('render-start');

        // Clear container
        this.container.innerHTML = '';

        const { sessions, currentSessionId, ui } = appStore.getState();
        const sidebarPrimaryView = ui?.sidebarPrimaryView || 'sessions';
        const sessionListView = ui?.sessionListView || 'timeline';

        if (sidebarPrimaryView === 'folders') {
            this.folderTreeView.render(this.container);
            return;
        }

        if (!sessions || sessions.length === 0) {
            this.container.innerHTML = '<div class="empty-state">セッションがありません</div>';
            return;
        }

        const toolbar = this._renderSessionListToolbar(sessions);
        this.container.appendChild(toolbar);
        this._attachSessionListToolbarHandlers(toolbar);
        this._migrateLegacyFavoritesToServer(sessions);

        const visibleSessions = this._filterSessionsForList(sessions);

        if (visibleSessions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state session-list-empty';
            empty.textContent = this.showFavoriteSessionsOnly
                ? 'お気に入りのセッションはありません'
                : '一致するセッションがありません';
            this.container.appendChild(empty);
            refreshIcons({ root: this.container });
            return;
        }

        if (sessionListView === 'timeline') {
            const timelineList = this._renderTimelineList(visibleSessions, currentSessionId);
            this.container.appendChild(timelineList);
        } else {
            // 状態別にセッションを分類（アーカイブを除く）
            const { activeSessions, pausedSessions, hibernatedSessions } = classifySessionsForGroupedList(visibleSessions);

            // 作業中セクション
            if (activeSessions.length > 0) {
                const workingSection = this._renderSection('作業中', this._sortFavoriteSessionsFirst(activeSessions), currentSessionId, true);
                this.container.appendChild(workingSection);
            }

            if (pausedSessions.length > 0) {
                const pausedSection = this._renderSection('停止中', this._sortFavoriteSessionsFirst(pausedSessions), currentSessionId, false);
                this.container.appendChild(pausedSection);
            }

            if (hibernatedSessions.length > 0) {
                const hibernatedSection = this._renderSection('スリープ中', this._sortFavoriteSessionsFirst(hibernatedSessions), currentSessionId, false);
                this.container.appendChild(hibernatedSection);
            }
        }

        // Lucideアイコンを初期化
        refreshIcons({ root: this.container });
    }

    _loadFavoriteSessionIds() {
        try {
            const storage = window.localStorage;
            if (!storage || typeof storage.getItem !== 'function') return new Set();
            const raw = storage.getItem(SESSION_FAVORITES_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return new Set(Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : []);
        } catch (error) {
            console.warn('Failed to load session favorites:', error);
            return new Set();
        }
    }

    _persistFavoriteSessionIds() {
        try {
            const storage = window.localStorage;
            if (!storage || typeof storage.setItem !== 'function') return;
            storage.setItem(
                SESSION_FAVORITES_STORAGE_KEY,
                JSON.stringify(Array.from(this.legacyFavoriteSessionIds))
            );
        } catch (error) {
            console.warn('Failed to persist session favorites:', error);
        }
    }

    _clearLegacyFavoriteSessionIds() {
        this.legacyFavoriteSessionIds.clear();
        try {
            window.localStorage?.removeItem?.(SESSION_FAVORITES_STORAGE_KEY);
        } catch {
            // ignore storage failures; server state is authoritative.
        }
    }

    _removeLegacyFavoriteSessionId(sessionId) {
        const id = String(sessionId || '');
        if (!id) return;
        if (!this.legacyFavoriteSessionIds.delete(id)) return;
        if (this.legacyFavoriteSessionIds.size === 0) {
            this._clearLegacyFavoriteSessionIds();
            return;
        }
        this._persistFavoriteSessionIds();
    }

    _findSessionById(sessionId) {
        const id = String(sessionId || '');
        const sessions = appStore.getState().sessions || [];
        return sessions.find((session) => session.id === id) || null;
    }

    _hasServerFavoriteValue(session) {
        return Boolean(session && Object.prototype.hasOwnProperty.call(session, 'favorite'));
    }

    _isFavoriteSession(sessionOrId) {
        const session = typeof sessionOrId === 'object' && sessionOrId
            ? sessionOrId
            : this._findSessionById(sessionOrId);
        const id = String(session?.id || sessionOrId || '');
        if (this._hasServerFavoriteValue(session)) {
            return session.favorite === true;
        }
        return this.legacyFavoriteSessionIds.has(id);
    }

    _migrateLegacyFavoritesToServer(sessions = []) {
        if (this._legacyFavoritesMigrationInFlight || this.legacyFavoriteSessionIds.size === 0) return;
        if (!this.sessionService || typeof this.sessionService.setSessionFavorite !== 'function') return;

        const idsToMigrate = (sessions || [])
            .filter((session) => this.legacyFavoriteSessionIds.has(String(session.id || '')) && session.favorite !== true)
            .map((session) => session.id);

        if (idsToMigrate.length === 0) {
            this._clearLegacyFavoriteSessionIds();
            return;
        }

        this._legacyFavoritesMigrationInFlight = true;
        Promise.all(idsToMigrate.map((sessionId) => this.sessionService.setSessionFavorite(sessionId, true)))
            .then(() => {
                this._clearLegacyFavoriteSessionIds();
            })
            .catch((error) => {
                console.warn('Failed to migrate legacy session favorites:', error);
            })
            .finally(() => {
                this._legacyFavoritesMigrationInFlight = false;
            });
    }

    _toggleSessionFavorite(sessionId, options = {}) {
        const id = String(sessionId || '');
        if (!id) return;
        const session = this._findSessionById(id);
        const nextFavorite = !this._isFavoriteSession(session || id);
        const promise = typeof this.sessionService?.setSessionFavorite === 'function'
            ? this.sessionService.setSessionFavorite(id, nextFavorite)
            : this.sessionService?.updateSession?.(id, { favorite: nextFavorite });

        this._removeLegacyFavoriteSessionId(id);
        if (promise && typeof promise.catch === 'function') {
            promise.catch((error) => {
                console.error('Failed to update session favorite:', error);
                showError('お気に入りの保存に失敗しました');
            });
        }
        this.render();
        if (typeof options.afterRender === 'function') {
            options.afterRender();
        }
    }

    _renderSessionListToolbar(sessions) {
        const toolbar = document.createElement('div');
        toolbar.className = 'session-list-toolbar';
        const favoriteCount = this._getListableSessions(sessions)
            .filter(session => this._isFavoriteSession(session)).length;
        toolbar.innerHTML = `
            <label class="session-search-wrap">
                <i data-lucide="search"></i>
                <input
                    class="session-search-input"
                    type="search"
                    value="${escapeHtml(this.sessionSearchQuery)}"
                    placeholder="セッションを検索"
                    aria-label="セッションを検索"
                >
            </label>
            <button
                class="session-favorites-filter-btn${this.showFavoriteSessionsOnly ? ' active' : ''}"
                type="button"
                aria-pressed="${this.showFavoriteSessionsOnly ? 'true' : 'false'}"
                title="お気に入りのみ"
                aria-label="お気に入りのみ"
            >
                <i data-lucide="star"></i>
                <span class="session-favorites-count">${favoriteCount}</span>
            </button>
        `;
        return toolbar;
    }

    _getListableSessions(sessions) {
        return (sessions || []).filter(session => session?.intendedState !== 'archived');
    }

    _attachSessionListToolbarHandlers(toolbar, options = {}) {
        const { afterRender = null, focusRoot = null } = options;
        const searchInput = toolbar.querySelector('.session-search-input');
        if (searchInput) {
            let isComposing = false;
            const applySearch = () => {
                const cursor = searchInput.selectionStart ?? searchInput.value.length;
                this.sessionSearchQuery = searchInput.value;
                this.render();
                if (typeof afterRender === 'function') {
                    afterRender();
                }
                requestAnimationFrame(() => {
                    const root = typeof focusRoot === 'function'
                        ? focusRoot()
                        : (focusRoot || this.container);
                    const nextInput = root?.querySelector('.session-search-input');
                    if (!nextInput) return;
                    nextInput.focus();
                    if (typeof nextInput.setSelectionRange === 'function') {
                        nextInput.setSelectionRange(cursor, cursor);
                    }
                });
            };

            searchInput.addEventListener('compositionstart', () => {
                isComposing = true;
            });

            searchInput.addEventListener('compositionend', () => {
                isComposing = false;
                applySearch();
            });

            searchInput.addEventListener('input', (event) => {
                if (isComposing || event.isComposing) return;
                applySearch();
            });
        }

        const favoritesButton = toolbar.querySelector('.session-favorites-filter-btn');
        if (favoritesButton) {
            favoritesButton.addEventListener('click', () => {
                this.showFavoriteSessionsOnly = !this.showFavoriteSessionsOnly;
                this.render();
                if (typeof afterRender === 'function') {
                    afterRender();
                }
            });
        }
    }

    attachToolbarHandlersToContainer(container, options = {}) {
        if (!container) return;
        const toolbar = container.querySelector('.session-list-toolbar');
        if (toolbar) {
            this._attachSessionListToolbarHandlers(toolbar, options);
        }
    }

    _filterSessionsForList(sessions) {
        const query = this.sessionSearchQuery.trim().toLowerCase();
        return this._getListableSessions(sessions).filter(session => {
            if (this.showFavoriteSessionsOnly && !this._isFavoriteSession(session)) return false;
            if (!query) return true;
            return this._getSessionSearchText(session).includes(query);
        });
    }

    _getSessionSearchText(session) {
        const project = getProjectFromSession(session);
        const uiState = session?.id ? deriveSessionUiState(session.id) : {};
        const summary = uiState?.summary || session?.summary || {};
        const recentFile = uiState?.recentFile || {};
        return [
            session?.id,
            session?.name,
            project,
            session?.engine,
            session?.path,
            session?.worktree?.path,
            summary.repo,
            summary.baseBranch,
            summary.workspacePath,
            recentFile.path,
            recentFile.label,
        ].filter(Boolean).join(' ').toLowerCase();
    }

    _sortFavoriteSessionsFirst(sessions) {
        return [...(sessions || [])].sort((a, b) => {
            const favoriteA = this._isFavoriteSession(a) ? 0 : 1;
            const favoriteB = this._isFavoriteSession(b) ? 0 : 1;
            if (favoriteA !== favoriteB) return favoriteA - favoriteB;
            return 0;
        });
    }

    /**
     * 時系列リストをレンダリング
     * @private
     */
    _renderTimelineList(sessions, currentSessionId) {
        const listDiv = document.createElement('div');
        listDiv.className = 'session-timeline-list';

        const timelineSessions = this._getTimelineSessions(sessions);

        timelineSessions.forEach(session => {
            const project = getProjectFromSession(session);
            const childRow = this._buildSessionRowElement(session, currentSessionId, {
                project,
                showProjectEmoji: true,
                isDraggable: false,
                enableDrag: false
            });
            listDiv.appendChild(childRow);
        });

        return listDiv;
    }

    /**
     * 時系列表示用のセッション一覧を取得
     *
     * ソート優先度:
     * 1. 青インジケータセッション（active turnあり）を最上部に配置
     *    - 条件: activity === 'thinking'
     * 2. 完了イベントがあったセッションを次に配置
     *    - 緑インジケータが既読で消えても、その場で通常枠へ落とさない
     * 3. 残りのセッションは時系列順（最新が上）
     *
     * @param {Array} sessions - セッション一覧
     * @returns {Array} ソート済みセッション一覧（アーカイブ済み除外）
     * @private
     */
    _getTimelineSessions(sessions) {
        const filtered = (sessions || []).filter(s => s.intendedState !== 'archived');
        const visibleIds = new Set(filtered.map((session) => session.id));
        for (const sessionId of this._timelineAttentionSortBySessionId.keys()) {
            if (!visibleIds.has(sessionId)) {
                this._timelineAttentionSortBySessionId.delete(sessionId);
            }
        }

        const sortMetadataById = new Map();
        for (const session of filtered) {
            const uiState = deriveSessionUiState(session.id);
            const livePriority = this._getActivitySortPriority(uiState);
            const liveTimestamp = this._getSessionSortTimestamp(session, uiState);

            if (livePriority === 1) {
                this._timelineAttentionSortBySessionId.delete(session.id);
            } else if (livePriority === 2) {
                this._timelineAttentionSortBySessionId.set(session.id, liveTimestamp);
            }

            const hasRememberedDone = this._timelineAttentionSortBySessionId.has(session.id);
            sortMetadataById.set(session.id, {
                priority: livePriority === 3 && hasRememberedDone ? 2 : livePriority,
                timestamp: livePriority === 3 && hasRememberedDone
                    ? this._timelineAttentionSortBySessionId.get(session.id)
                    : liveTimestamp
            });
        }

        const sorted = [...filtered].sort((a, b) => {
            const favoriteA = this._isFavoriteSession(a) ? 0 : 1;
            const favoriteB = this._isFavoriteSession(b) ? 0 : 1;
            if (favoriteA !== favoriteB) return favoriteA - favoriteB;

            const metaA = sortMetadataById.get(a.id) || {};
            const metaB = sortMetadataById.get(b.id) || {};
            const priorityA = metaA.priority || 3;
            const priorityB = metaB.priority || 3;

            if (priorityA !== priorityB) return priorityA - priorityB;

            // 優先度3: 同一優先度内は時系列順（最新が上）
            return (metaB.timestamp || 0) - (metaA.timestamp || 0);
        });

        return sorted;
    }

    _getActivitySortPriority(uiState) {
        const hookStatus = uiState?.hookStatus || null;
        if (hookStatus?.state) {
            if (['running', 'starting', 'waiting'].includes(hookStatus.state)) return 1;
            if (hookStatus.state === 'done-unread') return 2;
            return 3;
        }
        if (['thinking', 'working', 'waiting'].includes(uiState?.activity)) return 1;
        if (uiState?.activity === 'done-unread') return 2;
        return 3;
    }

    /**
     * タイムラインのDOM要素を正しい順序に並び替え（要素の移動のみ、再作成しない）
     * @private
     */
    _reorderTimelineRows() {
        const listDiv = this.container?.querySelector('.session-timeline-list');
        if (!listDiv) return;
        const { sessions } = appStore.getState();
        const expected = this._getTimelineSessions(this._filterSessionsForList(sessions));
        const rows = listDiv.querySelectorAll('.session-child-row');

        // 順序が同じならスキップ
        let needsReorder = rows.length !== expected.length;
        if (!needsReorder) {
            for (let i = 0; i < expected.length; i++) {
                if (rows[i].dataset.id !== expected[i].id) { needsReorder = true; break; }
            }
        }
        if (!needsReorder) return;

        // 既存要素をMapに保持
        const rowMap = new Map();
        for (const row of rows) {
            rowMap.set(row.dataset.id, row);
        }

        // 正しい順序で既存要素をappend（DOM要素の移動 = 再作成なし）
        for (const session of expected) {
            const row = rowMap.get(session.id);
            if (row) {
                listDiv.appendChild(row);
            }
        }
    }

    /**
     * セッションのソート用タイムスタンプを取得
     * @private
     */
    _getSessionSortTimestamp(session, uiStateOverride = null) {
        const pickTimestamp = (value) => {
            if (!value) return null;
            if (typeof value === 'number') return value;
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
        };

        const uiState = uiStateOverride || (session?.id ? deriveSessionUiState(session.id) : null);
        const liveStatus = uiState?.hookStatus || null;

        // done-unread sessions: use completion/output timestamp for ordering within the green group
        if (uiState?.activity === 'done-unread') {
            const doneUnreadTimestamp = Math.max(
                liveStatus?.lastDoneAt || 0,
                liveStatus?.liveActivity?.assistantSnippetUpdatedAt || 0,
                pickTimestamp(session.lastAssistantSnippetAt) || 0
            );
            if (doneUnreadTimestamp > 0) return doneUnreadTimestamp;
        }

        const liveOutputTimestamp = Math.max(
            liveStatus?.liveActivity?.assistantSnippetUpdatedAt || 0,
            pickTimestamp(session.lastAssistantSnippetAt) || 0
        );
        if (liveOutputTimestamp > 0) {
            return liveOutputTimestamp;
        }

        // Primary: user's last interaction time
        const accessed = pickTimestamp(session.lastAccessedAt);
        if (accessed) return accessed;

        // Fallback: creation time
        const candidates = [session.created, session.createdAt, session.createdDate];
        for (const candidate of candidates) {
            const picked = pickTimestamp(candidate);
            if (picked) return picked;
        }

        // Last resort: extract from session ID
        if (session.id) {
            const match = session.id.match(/session-(\d{13})/);
            if (match) return parseInt(match[1], 10);
        }

        return 0;
    }

    /**
     * セクションをレンダリング（プロジェクトごとにグループ化）
     * @private
     */
    _renderSection(title, sessions, currentSessionId, isExpanded) {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'session-section';

        // セクションヘッダー
        const header = document.createElement('div');
        header.className = 'session-section-header';
        header.innerHTML = `
            <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}"></i>
            <span>${escapeHtml(title)}</span>
            <span class="session-count">${sessions.length}</span>
        `;

        // セクションコンテナ
        const childrenDiv = document.createElement('div');
        childrenDiv.className = 'session-section-children';
        childrenDiv.style.display = isExpanded ? 'block' : 'none';

        // ヘッダークリックで展開/折りたたみ
        header.addEventListener('click', () => {
            const isCurrentlyExpanded = childrenDiv.style.display !== 'none';
            childrenDiv.style.display = isCurrentlyExpanded ? 'none' : 'block';
            const icon = header.querySelector('i');
            if (icon) {
                icon.setAttribute('data-lucide', isCurrentlyExpanded ? 'chevron-right' : 'chevron-down');
                refreshIcons();
            }
        });

        // プロジェクトごとにグループ化
        const grouped = groupSessionsByProject(sessions, {
            excludeArchived: false,
            includeEmptyProjects: false
        });

        // プロジェクトグループごとにレンダリング
        for (const [project, projectSessions] of Object.entries(grouped)) {
            const projectGroup = this._renderProjectGroup(project, projectSessions, currentSessionId);
            childrenDiv.appendChild(projectGroup);
        }

        sectionDiv.appendChild(header);
        sectionDiv.appendChild(childrenDiv);
        return sectionDiv;
    }

    /**
     * プロジェクトグループをレンダリング
     * @private
     */
    _renderProjectGroup(project, sessions, currentSessionId) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'session-project-group';

        // プロジェクトヘッダー
        const header = document.createElement('div');
        header.innerHTML = renderSessionGroupHeaderHTML(project, { isExpanded: true });
        const headerEl = header.firstElementChild;
        headerEl.classList.add('session-project-header');

        // プロジェクトセッションコンテナ
        const projectSessionsDiv = document.createElement('div');
        projectSessionsDiv.className = 'session-project-children';

        // ヘッダークリックで展開/折りたたみ
        headerEl.addEventListener('click', (e) => {
            if (!e.target.closest('.add-project-session-btn')) {
                const isCurrentlyExpanded = projectSessionsDiv.style.display !== 'none';
                projectSessionsDiv.style.display = isCurrentlyExpanded ? 'none' : 'block';
                const icon = headerEl.querySelector('.folder-icon i');
                icon.setAttribute('data-lucide', isCurrentlyExpanded ? 'folder' : 'folder-open');
                refreshIcons();
            }
        });

        // 新規セッション追加ボタン
        const addBtn = headerEl.querySelector('.add-project-session-btn');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetProject = addBtn.dataset.project;
                eventBus.emit(EVENTS.CREATE_SESSION, { project: targetProject });
            });
        }

        // 各セッションをレンダリング
        sessions.forEach(session => {
            const childRow = this._buildSessionRowElement(session, currentSessionId, {
                project,
                showProjectEmoji: false,
                isDraggable: true,
                enableDrag: true
            });
            projectSessionsDiv.appendChild(childRow);
        });

        groupDiv.appendChild(headerEl);
        groupDiv.appendChild(projectSessionsDiv);
        return groupDiv;
    }

    /**
     * セッション行のアクションボタンにイベントハンドラーを設定
     */
    _attachSessionActionHandlers(row, session, options = {}) {
        const { enableDrag = true } = options;
        // Menu toggle button
        const menuToggle = row.querySelector('.session-menu-toggle');
        const dropdownMenu = row.querySelector('.session-dropdown-menu');

        if (menuToggle && dropdownMenu) {
            let lastPointerToggleAt = 0;
            const toggleDropdown = (e, triggerPhase) => {
                this._logSessionMenuDebug(`${triggerPhase}-before`, { event: e, row, menuToggle, dropdownMenu, session });
                e.preventDefault();
                e.stopPropagation();

                // Close all other open menus
                document.querySelectorAll('.session-dropdown-menu').forEach(menu => {
                    if (menu !== dropdownMenu) {
                        menu.classList.add('hidden');
                        menu.closest('.session-child-row')?.classList.remove('session-menu-open');
                    }
                });

                // Toggle this menu
                const isOpening = dropdownMenu.classList.contains('hidden');
                dropdownMenu.classList.toggle('hidden');
                row.classList.toggle('session-menu-open', isOpening);
                this._logSessionMenuDebug(isOpening ? `${triggerPhase}-opened-sync` : `${triggerPhase}-closed-sync`, {
                    event: e,
                    row,
                    menuToggle,
                    dropdownMenu,
                    session
                });

                // Viewport boundary detection — flip menu above if it overflows
                if (isOpening) {
                    this._scheduleSessionDropdownLayout(row, dropdownMenu, menuToggle, session, triggerPhase, e);
                }

                // オーバーレイの表示/非表示
                const menuOverlay = document.getElementById('menu-overlay');
                if (menuOverlay) {
                    if (isOpening) {
                        // メニューを開く場合、オーバーレイを表示
                        menuOverlay.classList.remove('hidden');
                    } else {
                        // メニューを閉じる場合、他に開いているメニューがなければオーバーレイを非表示
                        const hasOpenMenu = Array.from(document.querySelectorAll('.session-dropdown-menu'))
                            .some(menu => !menu.classList.contains('hidden'));
                        if (!hasOpenMenu) {
                            menuOverlay.classList.add('hidden');
                        }
                    }
                }
                this._logSessionMenuDebug(`${triggerPhase}-after-overlay`, { event: e, row, menuToggle, dropdownMenu, session });
            };

            menuToggle.addEventListener('pointerdown', (e) => {
                this._logSessionMenuDebug('toggle-pointerdown', { event: e, row, menuToggle, dropdownMenu, session });
                if (typeof e.button === 'number' && e.button !== 0) {
                    e.stopPropagation();
                    return;
                }
                lastPointerToggleAt = Date.now();
                toggleDropdown(e, 'toggle-pointerdown');
            });
            menuToggle.addEventListener('mousedown', (e) => {
                this._logSessionMenuDebug('toggle-mousedown', { event: e, row, menuToggle, dropdownMenu, session });
                e.preventDefault();
                e.stopPropagation();
            });
            dropdownMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
            dropdownMenu.addEventListener('mousedown', (e) => e.stopPropagation());
            menuToggle.addEventListener('click', (e) => {
                const isDuplicatePointerClick = Date.now() - lastPointerToggleAt < 800;
                if (isDuplicatePointerClick) {
                    this._logSessionMenuDebug('toggle-click-ignored-after-pointerdown', {
                        event: e,
                        row,
                        menuToggle,
                        dropdownMenu,
                        session
                    });
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                toggleDropdown(e, 'toggle-click');
            });
            menuToggle.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                toggleDropdown(e, 'toggle-keydown');
            });
        }

        // Helper function to close dropdown menu
        const closeDropdown = () => {
            if (dropdownMenu) {
                dropdownMenu.classList.add('hidden');
                row.classList.remove('session-menu-open');
            }
            const hasOpenMenu = Array.from(document.querySelectorAll('.session-dropdown-menu'))
                .some(menu => !menu.classList.contains('hidden'));
            if (!hasOpenMenu) {
                document.getElementById('menu-overlay')?.classList.add('hidden');
            }
        };

        // Rename button
        const renameBtn = row.querySelector('.rename-session-btn');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDropdown();
                eventBus.emit(EVENTS.RENAME_SESSION, { session });
            });
        }

        // Delete button
        const deleteBtn = row.querySelector('.delete-session-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                const displayName = session.name || session.id;
                const confirmed = await showConfirm(
                    `セッション「${displayName}」を削除しますか？`,
                    { title: '削除確認', okText: '削除', cancelText: 'キャンセル', danger: true }
                );
                if (!confirmed) return;
                await this.sessionService.deleteSession(session.id);
            });
        }

        // Archive button
        const archiveBtn = row.querySelector('.archive-session-btn');
        if (archiveBtn) {
            archiveBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                const displayName = session.name || session.id;

                try {
                    if (session.intendedState === 'archived') {
                        await this.sessionService.unarchiveSession(session.id);
                        showSuccess(`セッション「${displayName}」を復元しました`);
                        return;
                    }

                    const result = await this.sessionService.archiveSession(session.id);
                    const archiveStatus = result?.archive?.status;
                    showSuccess(
                        archiveStatus === 'queued'
                            ? `セッション「${displayName}」のアーカイブ処理を開始しました`
                            : `セッション「${displayName}」をアーカイブしました`
                    );
                } catch (error) {
                    console.error('Failed to archive session:', error);
                    showError('アーカイブに失敗しました');
                }
            });
        }

        // Legacy pause buttons are no longer rendered in the session list.
        const pauseBtn = row.querySelector('.pause-session-btn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                await this.sessionService.pauseSession(session.id);
            });
        }

        // Resume button (for paused sessions)
        const resumeBtn = row.querySelector('.resume-session-btn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                await this.sessionService.resumeSession(session.id);
            });
        }

        const hibernateBtns = row.querySelectorAll('.hibernate-session-btn');
        hibernateBtns.forEach((hibernateBtn) => {
            hibernateBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                hibernateBtns.forEach(button => {
                    button.disabled = true;
                    button.setAttribute('aria-busy', 'true');
                });
                const pendingToast = showInfo('スリープ判定中...');
                try {
                    await this.sessionService.hibernateSession(session.id);
                    dismissToast(pendingToast);
                    showSuccess('セッションをスリープしました。次に開くと再開します');
                } catch (error) {
                    dismissToast(pendingToast);
                    const blockers = formatHibernationBlockers(error?.blockers);
                    const detail = blockers
                        || error?.detail
                        || error?.message
                        || String(error || '');
                    showError(buildHibernationFailureMessage(detail));
                } finally {
                    hibernateBtns.forEach(button => {
                        button.disabled = false;
                        button.removeAttribute('aria-busy');
                    });
                }
            });
        });

        const resumeRuntimeBtns = row.querySelectorAll('.resume-runtime-btn');
        resumeRuntimeBtns.forEach((resumeRuntimeBtn) => {
            resumeRuntimeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                closeDropdown();
                try {
                    await this.sessionService.resumeRuntime(session.id);
                    showSuccess('セッションを再開しました');
                } catch (error) {
                    showError(`再開に失敗しました: ${error?.message || error}`);
                }
            });
        });

        const favoriteBtn = row.querySelector('.favorite-session-btn');
        if (favoriteBtn) {
            favoriteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDropdown();
                this._toggleSessionFavorite(session.id, {
                    afterRender: options.afterRender || options.onFavoriteToggled
                });
            });
        }

        if (enableDrag) {
            // Drag and Drop handlers
            const project = row.dataset.project;
            const dragHandle = row.querySelector('.drag-handle');
            if (!dragHandle) return;

            dragHandle.addEventListener('dragstart', (e) => {
                this.draggedSessionId = session.id;
                this.draggedSessionProject = project;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', session.id);
                e.dataTransfer.setDragImage(row, 0, 0);
            });

            dragHandle.addEventListener('dragend', () => {
                this.draggedSessionId = null;
                this.draggedSessionProject = null;
                row.classList.remove('dragging');
                // Remove drag-over class from all rows
                document.querySelectorAll('.session-child-row.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                });
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Only allow drop within the same project
                if (this.draggedSessionId &&
                    this.draggedSessionProject === project &&
                    this.draggedSessionId !== session.id) {
                    e.dataTransfer.dropEffect = 'move';
                    row.classList.add('drag-over');
                }
            });

            row.addEventListener('dragleave', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over');
            });

            row.addEventListener('drop', async (e) => {
                // Capture values immediately before async operations
                const droppedSessionId = this.draggedSessionId;
                const droppedSessionProject = this.draggedSessionProject;

                e.preventDefault();
                e.stopPropagation();
                row.classList.remove('drag-over');

                if (!droppedSessionId ||
                    droppedSessionProject !== project ||
                    droppedSessionId === session.id) {
                    return;
                }

                try {
                    // Get current sessions from store
                    const { sessions } = appStore.getState();

                    // Find indices
                    const draggedIndex = sessions.findIndex(s => s.id === droppedSessionId);
                    const targetIndex = sessions.findIndex(s => s.id === session.id);

                    if (draggedIndex === -1 || targetIndex === -1) {
                        console.error('Session not found for reordering');
                        return;
                    }

                    // Reorder sessions array
                    const reorderedSessions = [...sessions];
                    const [draggedSession] = reorderedSessions.splice(draggedIndex, 1);

                    // Calculate new target index after removal
                    const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;

                    // Insert at the adjusted target position
                    reorderedSessions.splice(adjustedTargetIndex, 0, draggedSession);

                    // Update store and save to backend
                    appStore.setState({ sessions: reorderedSessions });
                    await this.sessionService.saveSessionOrder(reorderedSessions);

                    // Re-render to reflect new order
                    this.render();
                } catch (err) {
                    console.error('Failed to reorder sessions:', err);
                }
            });
        }
    }

    /**
     * Attach action handlers to an existing container (e.g. mobile cloned list)
     * @param {HTMLElement} container
     * @param {Object} options
     */
    attachActionHandlersToContainer(container, options = { enableDrag: false }) {
        if (!container) return;
        const sessions = appStore.getState().sessions || [];
        container.querySelectorAll('.session-child-row').forEach(row => {
            const sessionId = row.dataset.id;
            if (!sessionId) return;
            const session = sessions.find(s => s.id === sessionId);
            if (!session) return;
            this._attachSessionActionHandlers(row, session, options);
        });
    }

    /**
     * クリーンアップ
     */
    unmount() {
        if (this._renderRafId) {
            cancelAnimationFrame(this._renderRafId);
            this._renderRafId = null;
        }
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        // 外側クリックハンドラーを削除
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
            this._outsideClickHandler = null;
        }
        if (this._sessionMenuCaptureHandler) {
            document.removeEventListener('pointerdown', this._sessionMenuCaptureHandler, true);
            document.removeEventListener('click', this._sessionMenuCaptureHandler, true);
            this._sessionMenuCaptureHandler = null;
        }

        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }

}
