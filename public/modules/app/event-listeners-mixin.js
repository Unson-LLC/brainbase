import { appStore } from '../core/store.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { markDoneAsRead } from '../session-indicators.js';
import { showSuccess, showError, showInfo } from '../toast.js';
import { scheduleAfterNextPaint } from './schedule-after-next-paint.js';
import { recordRecentFileOpen } from '../session-ui-state.js';

export function applyEventListenersMixin(AppClass) {
    AppClass.prototype.setupEventListeners = async function() {
        this._cacheTerminalUiElements?.();

        // Terminal copy modal
        const copyTerminalBtn = document.getElementById('copy-terminal-btn');
        const copyTerminalModal = document.getElementById('copy-terminal-modal');
        const terminalContentDisplay = document.getElementById('terminal-content-display');
        const copyContentBtn = document.getElementById('copy-content-btn');

        if (copyTerminalBtn && copyTerminalModal && terminalContentDisplay) {
            copyTerminalBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    alert('セッションを選択してください');
                    return;
                }

                try {
                    const res = await fetch(`/api/sessions/${currentSessionId}/content?lines=500`);
                    if (!res.ok) throw new Error('Failed to fetch content');

                    const { content } = await res.json();
                    terminalContentDisplay.textContent = content;
                    copyTerminalModal.classList.add('active');

                    // Scroll to bottom
                    setTimeout(() => {
                        terminalContentDisplay.scrollTop = terminalContentDisplay.scrollHeight;
                    }, 50);
                } catch (error) {
                    console.error('Failed to get terminal content:', error);
                    alert('ターミナル内容の取得に失敗しました');
                }
            };
        }

        if (copyContentBtn && terminalContentDisplay) {
            copyContentBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(terminalContentDisplay.textContent);
                    alert('コピーしました！');
                } catch (error) {
                    console.error('Failed to copy:', error);
                    alert('コピーに失敗しました');
                }
            };
        }

        // Close modal buttons
        const closeModalBtns = document.querySelectorAll('.close-modal-btn');
        closeModalBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    modal.classList.remove('active');
                });
            });
        });

        // Close modal on background click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // Session change: reload related data and switch terminal
        const unsub1 = eventBus.onAsync(EVENTS.SESSION_CHANGED, async (event) => {
            const { sessionId, proxyPath = null } = event.detail;
            console.log('[SessionSwitch] Starting for:', sessionId);
            const previousSessionId = event.detail?.previousSessionId ?? appStore.getState().currentSessionId;
            const switchToken = ++this._sessionSwitchToken;

            // Mark previous session's green indicator as read when leaving it
            if (previousSessionId && previousSessionId !== sessionId) {
                void markDoneAsRead(previousSessionId, sessionId);
                void this.releaseTerminalOwnership(previousSessionId);
            }

            const startTime = performance.now();
            await this.switchSession(sessionId, { proxyPath, switchToken, previousSessionId });
            const duration = performance.now() - startTime;
            console.log(`[SessionSwitch] Terminal ready in ${duration.toFixed(2)}ms`);

            if (switchToken !== this._sessionSwitchToken || appStore.getState().currentSessionId !== sessionId) {
                return;
            }

            // Auto-return to console view
            if (this.showConsole) {
                this.showConsole();
            } else {
                // Fallback: showConsole未初期化時（ダッシュボード未訪問）でもconsole viewに戻す
                const consoleArea = document.getElementById('console-area');
                const dashboardPanel = document.getElementById('dashboard-panel');
                const fileViewerPanel = document.getElementById('file-viewer-panel');
                if (consoleArea) consoleArea.style.display = 'flex';
                if (dashboardPanel) dashboardPanel.style.display = 'none';
                if (fileViewerPanel) fileViewerPanel.style.display = 'none';
            }

            if (this._shouldAutoFocusTerminalSurface()) {
                this._triggerTerminalAutoFocus('session-changed');
            }

            scheduleAfterNextPaint(() => {
                this._runDeferredSessionSwitchWork(sessionId, switchToken);
                void this.refreshSessionUiSummaries([sessionId]);
                const rowUpdateIds = previousSessionId && previousSessionId !== sessionId
                    ? [previousSessionId, sessionId]
                    : [sessionId];
                void eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: rowUpdateIds });
            });

        });

        const unsub1b = eventBus.onAsync(EVENTS.FOLDER_TREE_FILE_OPENED, async (event) => {
            const { sessionId, relativePath } = event.detail || {};
            if (!sessionId || !relativePath) return;
            recordRecentFileOpen(sessionId, relativePath);
            await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: [sessionId] });
        });

        const refreshUiSummaries = () => {
            const sessions = appStore.getState().sessions || [];
            const activeIds = sessions
                .filter((session) => session.intendedState !== 'archived')
                .map((session) => session.id);
            if (activeIds.length === 0) return;
            void this.refreshSessionUiSummaries(activeIds);
        };

        const unsub1d = eventBus.on(EVENTS.SESSION_CREATED, refreshUiSummaries);
        const unsub1e = eventBus.on(EVENTS.SESSION_ARCHIVED, refreshUiSummaries);
        const unsub1f = eventBus.on(EVENTS.SESSION_PAUSED, refreshUiSummaries);
        const unsub1g = eventBus.on(EVENTS.SESSION_RESUMED, refreshUiSummaries);

        // Start task: create session and switch to it
        const unsub2 = eventBus.onAsync(EVENTS.START_TASK, async (event) => {
            const { task: taskObj, taskId, engine } = event.detail;

            try {
                // Step 1: Task objectを取得
                let task = taskObj;
                if (!task && taskId) {
                    // taskIdのみの場合はTaskServiceから取得
                    const tasks = this.taskService.getFilteredTasks();
                    task = tasks.find(t => t.id === taskId);

                    if (!task) {
                        console.error('Task not found:', taskId);
                        showError('Task not found');
                        return;
                    }
                }

                if (!task) {
                    console.error('No task provided to START_TASK event');
                    showError('No task provided');
                    return;
                }

                // Step 2: エンジン未指定なら選択モーダルを開く
                if (!engine) {
                    if (this.modals?.focusEngineModal) {
                        this.modals.focusEngineModal.open(task);
                        return;
                    }
                    console.warn('FocusEngineModal not available, falling back to Claude engine.');
                }

                const resolvedEngine = engine || 'claude';

                // Step 3: セッション名を生成
                const sessionName = task.title || task.name || `Task: ${task.id}`;

                // Step 4: プロジェクト名を取得
                const project = task.project;
                if (!project) {
                    console.error('Task has no project:', task);
                    showError('Task has no project');
                    return;
                }

                // Step 5: セッション作成
                console.log('Creating session for task:', task.id, 'project:', project);

                // タスクコンテキストを構築（議事録から登録されたタスクの場合）
                const taskTitle = task.title || task.name || 'Untitled';
                const deadline = task.deadline || task.due;
                const taskLines = [
                    '以下のタスクを対応してください。',
                    `ID: ${task.id}`,
                    `プロジェクト: ${project}`,
                    `タイトル: ${taskTitle}`,
                    deadline ? `期限: ${deadline}` : '',
                    task.assignee ? `担当者: ${task.assignee}` : '',
                    task.description ? `説明: ${task.description}` : ''
                ].filter(Boolean);
                let initialCommand = taskLines.join('\n');
                if (task.context || task.meetingTitle) {
                    const contextParts = [];
                    if (task.context) {
                        contextParts.push(`## 背景\n${task.context}`);
                    }
                    if (task.meetingTitle || task.meetingDate) {
                        const meetingInfo = task.meetingTitle || '';
                        const dateInfo = task.meetingDate ? `(${task.meetingDate})` : '';
                        contextParts.push(`会議: ${meetingInfo} ${dateInfo}`.trim());
                    }
                    if (contextParts.length > 0) {
                        initialCommand += '\n\n' + contextParts.join('\n\n');
                    }
                }

                const newSession = await this.sessionService.createSession({
                    project: project,
                    name: sessionName,
                    initialCommand: initialCommand,  // タスクコンテキストを自動読み込み
                    engine: resolvedEngine,
                    useWorktree: true  // デフォルトでworktree使用
                });

                console.log('Session created for task:', task.id, '→', newSession.id);
                showSuccess(`Session "${sessionName}" created`);

                // Step 6: タスクステータスを「進行中」に更新
                try {
                    if (task.source === 'nocodb') {
                        // NocoDBタスクの場合
                        await this.nocodbTaskService.updateStatus(task.id, 'in_progress');
                    } else {
                        // ローカルタスクの場合
                        await this.taskService.updateTask(task.id, { status: 'in_progress' });
                    }
                    console.log('Task status updated to in_progress:', task.id);
                } catch (statusError) {
                    // ステータス更新失敗はログのみ（セッション作成は成功しているため）
                    console.warn('Failed to update task status:', statusError);
                }

                // Step 7: セッション切り替え
                eventBus.emit(EVENTS.SESSION_CHANGED, {
                    sessionId: newSession.id
                });

            } catch (error) {
                console.error('Failed to start task:', error);
                showError(`Failed to start task: ${error.message}`);
            }
        });

        // Edit task: open task edit modal
        const unsub3 = eventBus.on(EVENTS.EDIT_TASK, (event) => {
            const { task } = event.detail;
            console.log('Edit task requested:', task);
            this.modals.taskEditModal.open(task);
        });

        // Create session: open modal
        const unsub4 = eventBus.on(EVENTS.CREATE_SESSION, (event) => {
            const { project } = event.detail;
            console.log('Create session requested for project:', project);
            this.openCreateSessionModal(project);
        });

        // Worktree fallback: warn user when session falls back to main workspace
        const unsubWorktreeFallback = eventBus.on(EVENTS.SESSION_WORKTREE_FALLBACK, (event) => {
            const { project, reason } = event.detail || {};
            const projectLabel = project ? `「${project}」` : 'このプロジェクト';
            showInfo(`Worktree作成に失敗したため、${projectLabel}は本体フォルダで開始しました。`);
            console.warn('[Session] Worktree fallback:', reason || 'unknown');
        });

        // Rename session: open rename modal
        const unsub5 = eventBus.on(EVENTS.RENAME_SESSION, (event) => {
            const { session } = event.detail;
            console.log('Rename session requested:', session);
            this.modals.renameModal.open(session);
        });

        this.unsubscribers.push(
            unsub1,
            unsub1b,
            unsub1d,
            unsub1e,
            unsub1f,
            unsub1g,
            unsub2,
            unsub3,
            unsub4,
            unsubWorktreeFallback,
            unsub5
        );

        // Setup global UI button handlers
        await this.setupGlobalButtons();

        // Setup settings-related UI extensions
        this.settingsExtensions?.setupSettingsExtensions();

        // Setup test mode banner
        this.setupTestModeBanner();
        this.setupLearningHealthBanner();
    };
}
