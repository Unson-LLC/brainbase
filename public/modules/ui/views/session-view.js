import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { groupSessionsByProject } from '../../session-manager.js';
import { getProjectFromSession } from '../../project-mapping.js';
import { renderSessionGroupHeaderHTML, renderSessionRowHTML } from '../../session-list-renderer.js';
import { deriveSessionUiState } from '../../session-ui-state.js';
import { FolderTreeView } from './folder-tree-view.js';
import { showConfirm, showConfirmWithAction } from '../../confirm-modal.js';
import { showError, showInfo, showSuccess } from '../../toast.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';

/**
 * セッション表示のUIコンポーネント
 * 現行版と同じ構造でプロジェクトグループ表示
 */
export class SessionView {
    constructor({ sessionService, fileViewerService }) {
        this.sessionService = sessionService;
        this.folderTreeView = new FolderTreeView({ sessionService, fileViewerService });
        this.container = null;
        this._unsubscribers = [];
        this._renderRafId = null;
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
            summary.changesNotPushed || 0,
            summary.prStatus || '',
            convSummary.totalConversations || 0,
        ].join('\t');
    }

    _buildSessionRowElement(session, currentSessionId, options = {}) {
        const { project, showProjectEmoji = false, isDraggable = true, enableDrag = true } = options;
        const sessionUiState = deriveSessionUiState(session.id);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = renderSessionRowHTML(session, {
            isActive: currentSessionId === session.id,
            project,
            showProjectEmoji,
            isDraggable,
            sessionUiState
        });
        const childRow = wrapper.firstElementChild;
        childRow.dataset.fingerprint = this._computeRowFingerprint(session, currentSessionId, { project });

        childRow.addEventListener('click', async (e) => {
            if (!e.target.closest('button') && !e.target.closest('.drag-handle')) {
                const sessionId = childRow.dataset.id;
                if (sessionId) {
                    this._closeAllMenus();
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
            const newFingerprint = this._computeRowFingerprint(session, currentSessionId, { project });
            if (currentRow.dataset.fingerprint === newFingerprint) continue;

            const nextRow = this._buildSessionRowElement(session, currentSessionId, {
                project,
                showProjectEmoji,
                isDraggable,
                enableDrag
            });
            currentRow.replaceWith(nextRow);
            refreshIcons({ root: nextRow });
        }
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

            if (sessionListView === 'timeline') {
                // 差分更新 → 必要なら並び替え（フルrenderしない）
                if (Array.isArray(sessionIds) && sessionIds.length > 0) {
                    this._refreshSessionRows(sessionIds);
                }
                this._reorderTimelineRows();
                return;
            }

            if (Array.isArray(sessionIds) && sessionIds.length > 0) {
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

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6, unsub6b, unsub7, unsub8, unsub9);

        // ドロップダウンメニューの外側クリックで閉じる処理（document全体で1回のみ）
        this._outsideClickHandler = (e) => {
            // クリックされた要素がメニュートグルまたはドロップダウン内かチェック
            const isMenuToggle = e.target.closest('.session-menu-toggle');
            const isDropdownMenu = e.target.closest('.session-dropdown-menu');

            // どちらでもない場合、すべてのメニューを閉じる
            if (!isMenuToggle && !isDropdownMenu) {
                this._closeAllMenus();
            }
        };
        document.addEventListener('click', this._outsideClickHandler);

        // iframe上のオーバーレイクリックでメニューを閉じる
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay) {
            menuOverlay.addEventListener('click', () => {
                this._closeAllMenus();
            });
        }
    }

    /**
     * すべてのドロップダウンメニューを閉じる
     */
    _closeAllMenus() {
        document.querySelectorAll('.session-dropdown-menu').forEach(menu => {
            menu.classList.add('hidden');
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

        if (sessionListView === 'timeline') {
            const timelineList = this._renderTimelineList(sessions, currentSessionId);
            this.container.appendChild(timelineList);
        } else {
            // 状態別にセッションを分類（アーカイブを除く）
            const activeSessions = sessions.filter(s =>
                s.intendedState !== 'archived' &&
                s.intendedState !== 'paused' &&
                (!s.intendedState || s.intendedState === 'active')
            );
            const pausedSessions = sessions.filter(s => s.intendedState === 'paused');

            // 作業中セクション
            if (activeSessions.length > 0) {
                const workingSection = this._renderSection('作業中', activeSessions, currentSessionId, true);
                this.container.appendChild(workingSection);
            }

            // 一時停止セクション
            if (pausedSessions.length > 0) {
                const pausedSection = this._renderSection('一時停止', pausedSessions, currentSessionId, false);
                this.container.appendChild(pausedSection);
            }
        }

        // Lucideアイコンを初期化
        refreshIcons({ root: this.container });
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
     * 1. 緑インジケータセッション（未読更新あり）を最上部に配置
     *    - 条件: activity === 'done-unread'
     * 2. 残りのセッションは時系列順（最新が上）
     *
     * @param {Array} sessions - セッション一覧
     * @returns {Array} ソート済みセッション一覧（アーカイブ済み除外）
     * @private
     */
    _getTimelineSessions(sessions) {
        const filtered = (sessions || []).filter(s => s.intendedState !== 'archived');

        const sorted = [...filtered].sort((a, b) => {
            const uiStateA = deriveSessionUiState(a.id);
            const uiStateB = deriveSessionUiState(b.id);
            const isGreenA = uiStateA.activity === 'done-unread';
            const isGreenB = uiStateB.activity === 'done-unread';

            // 優先度1: 緑セッションを最上部に配置
            if (isGreenA && !isGreenB) return -1;
            if (!isGreenA && isGreenB) return 1;

            // 優先度2: 緑セッション同士 or 通常セッション同士は時系列順（最新が上）
            return this._getSessionSortTimestamp(b) - this._getSessionSortTimestamp(a);
        });

        return sorted;
    }

    /**
     * タイムラインのDOM要素を正しい順序に並び替え（要素の移動のみ、再作成しない）
     * @private
     */
    _reorderTimelineRows() {
        const listDiv = this.container?.querySelector('.session-timeline-list');
        if (!listDiv) return;
        const { sessions } = appStore.getState();
        const expected = this._getTimelineSessions(sessions);
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
    _getSessionSortTimestamp(session) {
        const pickTimestamp = (value) => {
            if (!value) return null;
            if (typeof value === 'number') return value;
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
        };

        const liveStatus = session?.id ? deriveSessionUiState(session.id).hookStatus : null;
        const statusTimestamp = Math.max(
            liveStatus?.lastWorkingAt || 0,
            liveStatus?.lastDoneAt || 0,
            liveStatus?.timestamp || 0
        );
        if (statusTimestamp > 0) {
            return statusTimestamp;
        }

        const candidates = [
            session.updatedAt,
            session.pausedAt,
            session.created,
            session.createdAt,
            session.createdDate
        ];

        for (const candidate of candidates) {
            const picked = pickTimestamp(candidate);
            if (picked) return picked;
        }

        if (session.id) {
            const match = session.id.match(/session-(\d{13})/);
            if (match) {
                return parseInt(match[1], 10);
            }
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
            menuToggle.addEventListener('click', (e) => {
                e.stopPropagation();

                // Close all other open menus
                document.querySelectorAll('.session-dropdown-menu').forEach(menu => {
                    if (menu !== dropdownMenu) {
                        menu.classList.add('hidden');
                    }
                });

                // Toggle this menu
                const isOpening = dropdownMenu.classList.contains('hidden');
                dropdownMenu.classList.toggle('hidden');

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
            });
        }

        // Helper function to close dropdown menu
        const closeDropdown = () => {
            if (dropdownMenu) {
                dropdownMenu.classList.add('hidden');
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
                    if (result?.needsConfirmation) {
                        const status = result.status || {};
                        const criticalDetails = [];
                        const infoDetails = [];

                        // Jujutsu概念でステータス表示（重要な警告のみ）
                        if (status.changesNotPushed > 0) {
                            criticalDetails.push(`${status.changesNotPushed}件のchangeがremoteにpushされてません`);
                        }
                        if (status.hasWorkingCopyChanges) {
                            criticalDetails.push('working copyに未完了のchangeがあります');
                        }
                        if (status.needsMerge) {
                            const baseBranch = status.mainBranch || 'base branch';
                            const mergeCount = status.commitsAheadOfBase || 0;
                            criticalDetails.push(
                                mergeCount > 0
                                    ? `${baseBranch} に未マージのcommitが${mergeCount}件あります`
                                    : `${baseBranch} に未マージのchangeがあります`
                            );
                        }

                        // 補足情報（bookmarkのみ、needsIntegrationがtrueの場合のみ表示）
                        if (!status.bookmarkPushed && status.bookmarkName && (status.changesNotPushed > 0 || status.hasWorkingCopyChanges || status.needsMerge)) {
                            infoDetails.push(`bookmark '${status.bookmarkName}' はローカルのみに存在します`);
                        }

                        const criticalText = criticalDetails.length ? `\n\n${criticalDetails.map((detail) => `・${detail}`).join('\n')}` : '';
                        const infoText = infoDetails.length ? `\n\n補足:\n${infoDetails.map((detail) => `  ${detail}`).join('\n')}` : '';
                        const detailText = criticalText + infoText;
                        const investigationPrompt = this._generateInvestigationPrompt(status, session.id);
                        const confirmResult = await showConfirmWithAction(
                            `統合が必要な変更があります。そのままアーカイブしますか？${detailText}`,
                            {
                                title: 'アーカイブ確認',
                                okText: 'そのままアーカイブ',
                                cancelText: 'キャンセル',
                                actionText: 'pushして統合',
                                aiActionText: '🤖 AIに確認して対処',
                                aiClipboardText: investigationPrompt,
                                danger: true
                            }
                        );
                        const selectedAction = typeof confirmResult === 'object' && confirmResult !== null
                            ? confirmResult.action
                            : (confirmResult ? 'ok' : 'cancel');

                        if (selectedAction === 'ai') {
                            console.info('[ArchiveAI] SessionView received AI action for session:', session.id, 'delivery:', confirmResult?.delivery?.mode || 'none');
                            const aiActionResult = await this._handleArchiveAiAction(
                                session.id,
                                status,
                                typeof confirmResult === 'object' && confirmResult !== null ? confirmResult.delivery || null : null
                            );
                            console.info('[ArchiveAI] SessionView AI action result:', {
                                sessionId: session.id,
                                deliveryMode: aiActionResult.delivery?.mode,
                                aiSuccess: Boolean(aiActionResult.aiResult?.success)
                            });
                            if (aiActionResult.aiResult?.success) {
                                showSuccess(aiActionResult.aiResult.message || 'AI向けの調査プロンプトを準備しました');
                            } else if (aiActionResult.delivery.mode === 'clipboard') {
                                showInfo('AI依頼は失敗しましたが、調査プロンプトをクリップボードにコピーしました');
                            } else if (aiActionResult.delivery.mode === 'manual') {
                                showInfo('自動コピーに失敗したため、調査プロンプトを画面上に表示しています');
                            } else if (aiActionResult.delivery.mode === 'inserted') {
                                showInfo('AI依頼は失敗しましたが、調査プロンプトを入力欄に挿入しました');
                            } else {
                                showError(aiActionResult.aiResult?.error || 'AI依頼に失敗しました');
                            }
                            return;
                        }

                        if (selectedAction === 'action') {
                            // pushして統合
                            try {
                                const mergeResult = await this.sessionService.mergeSession(session.id);
                                if (mergeResult?.success) {
                                    showSuccess(`セッション「${displayName}」をpushしてアーカイブしました`);
                                } else {
                                    showError(mergeResult?.error || 'pushに失敗しました');
                                }
                            } catch (mergeErr) {
                                console.error('Failed to push session:', mergeErr);
                                showError('pushに失敗しました');
                            }
                            return;
                        }

                        if (selectedAction !== 'ok') {
                            showInfo('アーカイブをキャンセルしました');
                            return;
                        }
                        await this.sessionService.archiveSession(session.id, { skipMergeCheck: true });
                        showSuccess(`セッション「${displayName}」をアーカイブしました`);
                        return;
                    }

                    showSuccess(`セッション「${displayName}」をアーカイブしました`);
                } catch (error) {
                    console.error('Failed to archive session:', error);
                    showError('アーカイブに失敗しました');
                }
            });
        }

        // Pause button (for active sessions)
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

        // Merge button
        const mergeBtn = row.querySelector('.merge-session-btn');
        if (mergeBtn) {
            mergeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDropdown();
                eventBus.emit(EVENTS.MERGE_SESSION, { sessionId: session.id });
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
     * 調査プロンプトを利用可能な入力先に配信
     * @param {string} prompt
     * @returns {Promise<{mode: 'inserted'|'clipboard'|'console'}>}
     */
    async _deliverInvestigationPrompt(prompt) {
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(prompt);
                return { mode: 'clipboard' };
            }
        } catch (error) {
            console.warn('Failed to copy investigation prompt to clipboard:', error);
        }

        const controller = window.mobileInputController || window.brainbaseApp?.mobileInputController;
        if (controller && typeof controller.insertTextAtCursor === 'function') {
            const inserted = controller.insertTextAtCursor(prompt);
            if (inserted !== false) {
                return { mode: 'inserted' };
            }
        }

        if (this._insertTextIntoActiveEditable(prompt)) {
            return { mode: 'inserted' };
        }

        console.log('[Archive Investigation Prompt]');
        console.log(prompt);
        return { mode: 'console' };
    }

    /**
     * アーカイブ前の統合調査プロンプトを配信し、可能ならAI依頼も実行
     * localhostサーバーのpbcopy成功を最優先し、失敗時のみブラウザ側へフォールバックする
     * @param {string} sessionId
     * @param {Object} status
     * @param {{mode: 'inserted'|'clipboard'|'console'|'manual'|'server-clipboard', prompt?: string}|null} initialDelivery
     * @returns {Promise<{delivery: {mode: 'inserted'|'clipboard'|'console'|'manual'|'server-clipboard'}, aiResult: Object|null}>}
     */
    async _handleArchiveAiAction(sessionId, status, initialDelivery = null) {
        const prompt = this._generateInvestigationPrompt(status, sessionId);

        try {
            const aiResult = await this.sessionService.askAiToResolveIntegration(sessionId, status);
            if (aiResult?.copiedByServer) {
                console.info('[ArchiveAI] Server-side pbcopy succeeded for session:', sessionId);
                return {
                    delivery: { mode: 'server-clipboard' },
                    aiResult
                };
            }

            const fallbackPrompt = aiResult?.clipboardContent || prompt;
            const delivery = initialDelivery || await this._deliverInvestigationPrompt(fallbackPrompt);
            console.info('[ArchiveAI] Server-side pbcopy unavailable; used browser fallback:', delivery.mode);
            return { delivery, aiResult };
        } catch (error) {
            console.error('Failed to ask AI:', error);
            const delivery = initialDelivery || await this._deliverInvestigationPrompt(prompt);
            return {
                delivery,
                aiResult: {
                    success: false,
                    error: 'AI依頼に失敗しました'
                }
            };
        }
    }

    /**
     * 現在フォーカス中の入力欄にテキスト挿入
     * @param {string} text
     * @returns {boolean}
     */
    _insertTextIntoActiveEditable(text) {
        const active = document.activeElement;
        const isTextarea = active instanceof HTMLTextAreaElement;
        const isTextInput = active instanceof HTMLInputElement
            && ['text', 'search', 'url', 'email', 'tel'].includes((active.type || 'text').toLowerCase());

        if (!isTextarea && !isTextInput) {
            return false;
        }

        const inputEl = active;
        const start = inputEl.selectionStart ?? inputEl.value.length;
        const end = inputEl.selectionEnd ?? inputEl.value.length;
        inputEl.value = inputEl.value.slice(0, start) + text + inputEl.value.slice(end);
        const nextPos = start + text.length;
        if (typeof inputEl.setSelectionRange === 'function') {
            inputEl.setSelectionRange(nextPos, nextPos);
        }
        inputEl.focus();
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
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

        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }

    /**
     * 診断プロンプトを生成（Jujutsu概念）
     * @param {Object} status - { changesNotPushed, hasWorkingCopyChanges, bookmarkPushed, bookmarkName }
     * @param {string} sessionId
     * @returns {string} - フォーマット済みプロンプト
     */
    _generateInvestigationPrompt(status, sessionId = null) {
        const issues = [];

        if (status.changesNotPushed > 0) {
            issues.push(`- remoteにpushされてないchange: ${status.changesNotPushed}件`);
        }
        if (status.needsMerge) {
            issues.push(`- ${status.mainBranch || 'base branch'} に未マージのcommit: ${status.commitsAheadOfBase || 0}件`);
        }
        if (!status.bookmarkPushed && status.bookmarkName) {
            issues.push(`- bookmark '${status.bookmarkName}' がremoteにない`);
        }
        if (status.hasWorkingCopyChanges) {
            issues.push('- working copyに未完了のchangeあり');
        }

        const issueList = issues.length > 0 ? issues.join('\n') : '- 不明な問題';

        return `このセッションをアーカイブしようとしたところ、以下の問題が検出されました：

${issueList}

これらの問題を解決してアーカイブ可能な状態にする方法を教えてください。
Jujutsuコマンド（jj）を使用してください。

セッションID: ${sessionId || window.location.hash.slice(1) || '不明'}`;
    }
}
