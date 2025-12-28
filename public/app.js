/**
 * brainbase-ui Application Entry Point
 * 新アーキテクチャ: サービス層とビュー層の分離
 */

// Core
import { DIContainer } from './modules/core/di-container.js';
import { appStore } from './modules/core/store.js';
import { httpClient } from './modules/core/http-client.js';
import { eventBus, EVENTS } from './modules/core/event-bus.js';
import { initSettings, openSettings } from './modules/settings.js';
import { pollSessionStatus, updateSessionIndicators, clearDone, startPolling } from './modules/session-indicators.js';
import { initFileUpload } from './modules/file-upload.js';
import { showSuccess, showError, showInfo } from './modules/toast.js';
import { setupFileOpenerShortcuts } from './modules/file-opener.js';
import { setupTerminalContextMenuListener } from './modules/iframe-contextmenu-handler.js';
import { attachSectionHeaderHandlers, attachGroupHeaderHandlers, attachMenuToggleHandlers, attachSessionActionHandlers, attachSessionRowClickHandlers, attachAddProjectSessionHandlers } from './modules/session-handlers.js';
import { initMobileKeyboard } from './modules/mobile-keyboard.js';

// Services
import { TaskService } from './modules/domain/task/task-service.js';
import { SessionService } from './modules/domain/session/session-service.js';
import { ScheduleService } from './modules/domain/schedule/schedule-service.js';

// Views
import { TaskView } from './modules/ui/views/task-view.js';
import { TimelineView } from './modules/ui/views/timeline-view.js';
import { NextTasksView } from './modules/ui/views/next-tasks-view.js';
import { SessionView } from './modules/ui/views/session-view.js';
import { InboxView } from './modules/ui/views/inbox-view.js';

// Modals
import { TaskEditModal } from './modules/ui/modals/task-edit-modal.js';
import { ArchiveModal } from './modules/ui/modals/archive-modal.js';
import { FocusEngineModal } from './modules/ui/modals/focus-engine-modal.js';

/**
 * Application initialization
 */
class App {
    constructor() {
        this.container = new DIContainer();
        this.views = {};
        this.modals = {};
        this.unsubscribers = [];
        this.pollingIntervalId = null;
        this.refreshIntervalId = null;
        this.choiceCheckInterval = null;
        this.lastChoiceHash = null;
    }

    /**
     * Initialize services
     */
    initServices() {
        // Register services in DI container
        this.container.register('taskService', () => new TaskService());
        this.container.register('sessionService', () => new SessionService());
        this.container.register('scheduleService', () => new ScheduleService());

        // Get service instances
        this.taskService = this.container.get('taskService');
        this.sessionService = this.container.get('sessionService');
        this.scheduleService = this.container.get('scheduleService');
    }

    /**
     * Initialize views
     */
    initViews() {
        // Focus task (left panel top)
        const taskContainer = document.getElementById('focus-task');
        if (taskContainer) {
            this.views.taskView = new TaskView({ taskService: this.taskService });
            this.views.taskView.mount(taskContainer);
        }

        // Timeline (right panel)
        const timelineContainer = document.getElementById('timeline-list');
        if (timelineContainer) {
            this.views.timelineView = new TimelineView({ scheduleService: this.scheduleService });
            this.views.timelineView.mount(timelineContainer);
        }

        // Next Tasks (right panel)
        const nextTasksContainer = document.getElementById('next-tasks-list');
        if (nextTasksContainer) {
            this.views.nextTasksView = new NextTasksView({ taskService: this.taskService });
            this.views.nextTasksView.mount(nextTasksContainer);
        }

        // Sessions (left sidebar)
        const sessionContainer = document.getElementById('session-list');
        if (sessionContainer) {
            this.views.sessionView = new SessionView({ sessionService: this.sessionService });
            this.views.sessionView.mount(sessionContainer);
        }

        // Inbox (notifications)
        this.views.inboxView = new InboxView();
        this.views.inboxView.mount();
    }

    /**
     * Initialize modals
     */
    initModals() {
        // Task edit modal
        this.modals.taskEditModal = new TaskEditModal({ taskService: this.taskService });
        this.modals.taskEditModal.mount();

        // Archive modal
        this.modals.archiveModal = new ArchiveModal({ sessionService: this.sessionService });
        this.modals.archiveModal.mount();

        // Focus engine modal
        this.modals.focusEngineModal = new FocusEngineModal();
        this.modals.focusEngineModal.mount();
    }

    /**
     * Setup global event listeners
     */
    setupEventListeners() {
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

        // Note: Mobile copy terminal button is handled in setupMobileFAB()

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
        const unsub1 = eventBus.on(EVENTS.SESSION_CHANGED, async (event) => {
            const { sessionId } = event.detail;
            console.log('Session changed:', sessionId);

            // Update currentSessionId in store
            appStore.setState({ currentSessionId: sessionId });

            // Switch terminal frame
            await this.switchSession(sessionId);

            // Load session-specific data
            await this.loadSessionData(sessionId);
        });

        // Start task: emit for terminal integration
        const unsub2 = eventBus.on(EVENTS.START_TASK, (event) => {
            const { task, taskId, engine } = event.detail;
            console.log('Start task requested:', task || taskId, 'engine:', engine);
            // TODO: Terminal integration
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

        this.unsubscribers.push(unsub1, unsub2, unsub3, unsub4);

        // Setup global UI button handlers
        this.setupGlobalButtons();

        // Setup terminal toolbar buttons
        this.setupTerminalToolbar();
    }

    /**
     * Setup global UI button handlers
     */
    setupGlobalButtons() {
        // Initialize settings module
        initSettings();

        // Archive toggle button
        const toggleArchivedBtn = document.getElementById('toggle-archived-btn');
        if (toggleArchivedBtn) {
            toggleArchivedBtn.onclick = () => {
                this.modals.archiveModal.open();
            };
        }

        // Settings button - openSettings is already set up by initSettings()
        // But we can also add a direct handler here
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.onclick = async () => {
                await openSettings();
            };
        }

        // Focus button (footer)
        const focusBtn = document.getElementById('focus-btn');
        if (focusBtn) {
            focusBtn.onclick = () => {
                const focusTask = this.taskService.getFocusTask();
                if (!focusTask) {
                    showInfo('フォーカスタスクがありません');
                    return;
                }
                // Open focus engine modal to select which engine to use
                this.modals.focusEngineModal.open(focusTask);
            };
        }

        // Mobile bottom navigation
        this.setupMobileNavigation();
    }

    /**
     * Setup terminal toolbar button handlers
     */
    setupTerminalToolbar() {
        // Paste from clipboard button
        const pasteTerminalBtn = document.getElementById('paste-terminal-btn');
        if (pasteTerminalBtn) {
            pasteTerminalBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    // Read clipboard
                    const text = await navigator.clipboard.readText();
                    if (!text) {
                        showInfo('クリップボードが空です');
                        return;
                    }

                    // Show paste confirm modal
                    const modal = document.getElementById('paste-confirm-modal');
                    const preview = document.getElementById('paste-preview-text');
                    const confirmBtn = document.getElementById('paste-confirm-btn');
                    const cancelBtn = document.getElementById('paste-cancel-btn');

                    if (!modal || !preview || !confirmBtn || !cancelBtn) {
                        // Fallback: paste directly without modal
                        await this.pasteTextToTerminal(currentSessionId, text);
                        return;
                    }

                    // Show preview
                    const displayText = text.length > 500 ? text.substring(0, 500) + '\n...(省略)...' : text;
                    preview.textContent = displayText;
                    modal.classList.add('active');

                    // Wait for user action
                    const confirmed = await new Promise((resolve) => {
                        const confirm = () => {
                            cleanup();
                            resolve(true);
                        };
                        const cancel = () => {
                            cleanup();
                            resolve(false);
                        };
                        const cleanup = () => {
                            confirmBtn.removeEventListener('click', confirm);
                            cancelBtn.removeEventListener('click', cancel);
                        };

                        confirmBtn.addEventListener('click', confirm);
                        cancelBtn.addEventListener('click', cancel);
                    });

                    modal.classList.remove('active');

                    // Paste if confirmed
                    if (confirmed) {
                        await this.pasteTextToTerminal(currentSessionId, text);
                    }
                } catch (error) {
                    console.error('Failed to read clipboard:', error);
                    showError('クリップボードの読み取りに失敗しました');
                }
            };
        }

        // Upload image button
        const uploadImageBtn = document.getElementById('upload-image-btn');
        const imageFileInput = document.getElementById('image-file-input');
        if (uploadImageBtn && imageFileInput) {
            uploadImageBtn.onclick = () => {
                imageFileInput.click();
            };

            // Handle file selection
            imageFileInput.onchange = async (e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                    await this.handleFileUpload(files);
                }
                // Reset input so same file can be selected again
                imageFileInput.value = '';
            };
        }

        // Send Escape button
        const sendEscapeBtn = document.getElementById('send-escape-btn');
        if (sendEscapeBtn) {
            sendEscapeBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                        input: 'Escape',
                        type: 'key'
                    });
                } catch (error) {
                    console.error('Failed to send Escape:', error);
                    showError('Escapeキーの送信に失敗しました');
                }
            };
        }

        // Send Clear button (Ctrl+L)
        const sendClearBtn = document.getElementById('send-clear-btn');
        if (sendClearBtn) {
            sendClearBtn.onclick = async () => {
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                        input: 'C-l',
                        type: 'key'
                    });
                } catch (error) {
                    console.error('Failed to send Clear:', error);
                    showError('クリアコマンドの送信に失敗しました');
                }
            };
        }
    }

    /**
     * Paste text to terminal
     */
    async pasteTextToTerminal(sessionId, text) {
        try {
            await httpClient.post(`/api/sessions/${sessionId}/input`, {
                input: text,
                type: 'text'
            });
            showSuccess('貼り付けました');
        } catch (error) {
            console.error('Failed to paste text:', error);
            showError('テキストの貼り付けに失敗しました');
        }
    }

    /**
     * Handle file upload
     */
    async handleFileUpload(files) {
        const currentSessionId = appStore.getState().currentSessionId;
        if (!currentSessionId) {
            showInfo('セッションを選択してください');
            return;
        }

        const file = files[0];
        const formData = new FormData();
        formData.append('file', file);

        try {
            // Upload file
            const uploadRes = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!uploadRes.ok) throw new Error('Upload failed');

            const { path } = await uploadRes.json();

            // Paste path into terminal
            await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: path,
                type: 'text'
            });

            showSuccess('ファイルをアップロードしました');
        } catch (error) {
            console.error('File upload failed:', error);
            showError('ファイルアップロードに失敗しました');
        }
    }

    /**
     * Setup mobile bottom navigation handlers
     */
    setupMobileNavigation() {
        const mobileSessionsBtn = document.getElementById('mobile-sessions-btn');
        const mobileTasksBtn = document.getElementById('mobile-tasks-btn');
        const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
        const sessionsSheetOverlay = document.getElementById('sessions-sheet-overlay');
        const tasksSheetOverlay = document.getElementById('tasks-sheet-overlay');
        const sessionsBottomSheet = document.getElementById('sessions-bottom-sheet');
        const tasksBottomSheet = document.getElementById('tasks-bottom-sheet');
        const closeSessionsSheetBtn = document.getElementById('close-sessions-sheet');
        const closeTasksSheetBtn = document.getElementById('close-tasks-sheet');
        const mobileAddSessionBtn = document.getElementById('mobile-add-session-btn');
        const mobileSessionList = document.getElementById('mobile-session-list');
        const mobileTasksContent = document.getElementById('mobile-tasks-content');

        // Open Sessions bottom sheet
        const openSessionsSheet = () => {
            const sessionList = document.getElementById('session-list');
            const sessionListContent = sessionList?.innerHTML || '';

            if (mobileSessionList) {
                mobileSessionList.innerHTML = sessionListContent;

                // Re-attach all handlers using dedicated functions
                try {
                    // セッション行クリックハンドラ
                    attachSessionRowClickHandlers(mobileSessionList, (sessionId) => {
                        eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId });
                        closeSessionsSheet();
                    });

                    // プロジェクト追加ボタンハンドラ
                    attachAddProjectSessionHandlers(mobileSessionList, (project) => {
                        eventBus.emit(EVENTS.CREATE_SESSION, { project });
                        closeSessionsSheet();
                    });

                    // セクション・グループヘッダー展開ハンドラ
                    attachSectionHeaderHandlers(mobileSessionList);
                    attachGroupHeaderHandlers(mobileSessionList);

                    // 3点メニューハンドラ
                    attachMenuToggleHandlers(mobileSessionList);

                    // セッションアクションハンドラ（リネーム、削除、アーカイブ等）
                    attachSessionActionHandlers(mobileSessionList, this.sessionService, appStore);
                } catch (error) {
                    console.error('Error attaching handlers:', error);
                }
            }

            sessionsSheetOverlay?.classList.add('active');
            sessionsBottomSheet?.classList.add('active');
            lucide.createIcons();
        };

        // Close Sessions bottom sheet
        const closeSessionsSheet = () => {
            sessionsSheetOverlay?.classList.remove('active');
            sessionsBottomSheet?.classList.remove('active');
        };

        // Open Tasks bottom sheet
        const openTasksSheet = () => {
            const contextSidebar = document.getElementById('context-sidebar');
            if (mobileTasksContent && contextSidebar) {
                mobileTasksContent.innerHTML = contextSidebar.innerHTML;
            }
            tasksSheetOverlay?.classList.add('active');
            tasksBottomSheet?.classList.add('active');
            lucide.createIcons();
        };

        // Close Tasks bottom sheet
        const closeTasksSheet = () => {
            tasksSheetOverlay?.classList.remove('active');
            tasksBottomSheet?.classList.remove('active');
        };

        // Event listeners for mobile navigation
        mobileSessionsBtn?.addEventListener('click', () => {
            // トグル動作：開いていれば閉じる、閉じていれば開く
            if (sessionsBottomSheet?.classList.contains('active')) {
                closeSessionsSheet();
            } else {
                openSessionsSheet();
            }
        });
        mobileTasksBtn?.addEventListener('click', openTasksSheet);
        mobileSettingsBtn?.addEventListener('click', async () => {
            await openSettings();
        });
        mobileAddSessionBtn?.addEventListener('click', () => {
            eventBus.emit(EVENTS.CREATE_SESSION, { project: 'general' });
        });
        closeSessionsSheetBtn?.addEventListener('click', closeSessionsSheet);
        closeTasksSheetBtn?.addEventListener('click', closeTasksSheet);
        sessionsSheetOverlay?.addEventListener('click', closeSessionsSheet);
        tasksSheetOverlay?.addEventListener('click', closeTasksSheet);

        // Mobile archive toggle button
        const mobileToggleArchivedBtn = document.getElementById('mobile-toggle-archived-btn');
        if (mobileToggleArchivedBtn) {
            mobileToggleArchivedBtn.addEventListener('click', () => {
                this.modals.archiveModal.open();
                closeSessionsSheet();
            });
        }

        // Close sheets on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (sessionsBottomSheet?.classList.contains('active')) closeSessionsSheet();
                if (tasksBottomSheet?.classList.contains('active')) closeTasksSheet();
            }
        });

        // Swipe down to close bottom sheets (only when at top of scroll)
        let sheetTouchStartY = 0;
        [sessionsBottomSheet, tasksBottomSheet].forEach(sheet => {
            sheet?.addEventListener('touchstart', (e) => {
                sheetTouchStartY = e.touches[0].clientY;
            }, { passive: true });

            sheet?.addEventListener('touchmove', (e) => {
                const touchY = e.touches[0].clientY;
                const diff = touchY - sheetTouchStartY;

                // スクロール可能な要素を取得
                const scrollableContent = sheet.querySelector('.session-list, .task-content');
                const isAtTop = !scrollableContent || scrollableContent.scrollTop === 0;

                // スクロール位置が一番上 かつ 下方向に100px以上スワイプした場合のみ閉じる
                if (isAtTop && diff > 100) {
                    if (sheet === sessionsBottomSheet) closeSessionsSheet();
                    if (sheet === tasksBottomSheet) closeTasksSheet();
                }
            }, { passive: true });
        });

        // Mobile FAB (Speed Dial) functionality
        this.setupMobileFAB();
    }

    /**
     * Setup mobile FAB (Floating Action Button) handlers
     */
    setupMobileFAB() {
        console.log('[DEBUG] setupMobileFAB called');

        const mobileFab = document.getElementById('mobile-fab');
        const mobileFabContainer = document.getElementById('mobile-fab-container');
        const mobileFabOverlay = document.getElementById('mobile-fab-overlay');
        const mobilePasteBtn = document.getElementById('mobile-paste-btn');
        const mobileUploadImageBtn = document.getElementById('mobile-upload-image-btn');
        const mobileSendEscapeBtn = document.getElementById('mobile-send-escape-btn');
        const mobileSendClearBtn = document.getElementById('mobile-send-clear-btn');
        const mobileCopyTerminalBtn = document.getElementById('mobile-copy-terminal-btn');
        const mobileToggleKeyboardBtn = document.getElementById('mobile-toggle-keyboard-btn');
        const mobileSendShiftTabBtn = document.getElementById('mobile-send-shift-tab-btn');

        // Toggle FAB menu
        mobileFab?.addEventListener('click', () => {
            console.log('[DEBUG] FAB toggle clicked');
            mobileFabContainer?.classList.toggle('active');
        });

        // Close FAB menu when clicking overlay
        mobileFabOverlay?.addEventListener('click', () => {
            mobileFabContainer?.classList.remove('active');
        });

        // Paste button
        if (mobilePasteBtn) {
            mobilePasteBtn.onclick = async () => {
                console.log('[FAB] Paste button clicked');

                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    // Read clipboard
                    const text = await navigator.clipboard.readText();
                    if (!text) {
                        showInfo('クリップボードが空です');
                        return;
                    }

                    // Paste directly (skip modal on mobile for better UX)
                    await this.pasteTextToTerminal(currentSessionId, text);
                } catch (error) {
                    console.error('Failed to read clipboard:', error);
                    showError('クリップボードの読み取りに失敗しました');
                }
            };
        }

        // Upload image button
        if (mobileUploadImageBtn) {
            mobileUploadImageBtn.onclick = () => {
                console.log('[FAB] Upload button clicked');
                const imageFileInput = document.getElementById('image-file-input');
                imageFileInput?.click();
            };
        }

        // Send Escape button
        if (mobileSendEscapeBtn) {
            mobileSendEscapeBtn.onclick = async () => {
                console.log('[FAB] Escape button clicked');
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                        input: 'Escape',
                        type: 'key'
                    });
                } catch (error) {
                    console.error('Failed to send Escape:', error);
                    showError('Escapeキーの送信に失敗しました');
                }
            };
        }

        // Send Clear button
        if (mobileSendClearBtn) {
            mobileSendClearBtn.onclick = async () => {
                console.log('[FAB] Clear button clicked');
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                        input: 'C-l',
                        type: 'key'
                    });
                } catch (error) {
                    console.error('Failed to send Clear:', error);
                    showError('クリアコマンドの送信に失敗しました');
                }
            };
        }

        // Copy terminal content button
        if (mobileCopyTerminalBtn) {
            mobileCopyTerminalBtn.onclick = async () => {
                console.log('[FAB] Copy button clicked');

                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    const res = await fetch(`/api/sessions/${currentSessionId}/content?lines=500`);
                    if (!res.ok) throw new Error('Failed to fetch content');

                    const { content } = await res.json();

                    const copyTerminalModal = document.getElementById('copy-terminal-modal');
                    const terminalContentDisplay = document.getElementById('terminal-content-display');

                    if (terminalContentDisplay && copyTerminalModal) {
                        terminalContentDisplay.textContent = content;
                        copyTerminalModal.classList.add('active');
                        if (window.lucide) window.lucide.createIcons();

                        // Scroll to bottom
                        setTimeout(() => {
                            terminalContentDisplay.scrollTop = terminalContentDisplay.scrollHeight;
                        }, 50);
                    }
                } catch (error) {
                    console.error('Failed to get terminal content:', error);
                    showError('ターミナル内容の取得に失敗しました');
                }
            };
        }

        // Send Shift+Tab button (for plan mode)
        if (mobileSendShiftTabBtn) {
            mobileSendShiftTabBtn.onclick = async () => {
                console.log('[FAB] Shift+Tab button clicked');
                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    // Try BTab format (tmux standard for Shift+Tab)
                    await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                        input: 'BTab',
                        type: 'key'
                    });
                    showSuccess('Shift+Tabを送信しました');
                } catch (error) {
                    console.error('Failed to send Shift+Tab:', error);
                    showError('Shift+Tabの送信に失敗しました');
                }
            };
        }

        // Toggle mobile keyboard button
        if (mobileToggleKeyboardBtn) {
            mobileToggleKeyboardBtn.onclick = () => {
                console.log('[FAB] Toggle keyboard button clicked');
                const mobileKeyboard = document.getElementById('mobile-keyboard');
                if (mobileKeyboard) {
                    mobileKeyboard.classList.toggle('visible');
                    console.log('[FAB] Mobile keyboard visibility toggled');
                }
            };
        }
    }

    /**
     * Switch to a session and update terminal frame
     */
    async switchSession(sessionId) {
        const terminalFrame = document.getElementById('terminal-frame');
        if (!terminalFrame) {
            console.warn('Terminal frame not found');
            return;
        }

        try {
            // Get session info from store
            const { sessions } = appStore.getState();
            const session = sessions.find(s => s.id === sessionId);

            if (!session) {
                console.error('Session not found:', sessionId);
                terminalFrame.src = 'about:blank';
                return;
            }

            // Get session status to check if it's already running and get proxyPath
            const status = await httpClient.get('/api/sessions/status');
            const sessionStatus = status[sessionId];

            let proxyPath = null;

            if (sessionStatus && sessionStatus.running && sessionStatus.proxyPath) {
                // Session is already running, use existing proxyPath
                proxyPath = sessionStatus.proxyPath;
                console.log('Session already running, using existing proxyPath:', proxyPath);
            } else {
                // Session not running, start it
                const res = await httpClient.post('/api/sessions/start', {
                    sessionId: session.id,
                    initialCommand: session.initialCommand || '',
                    cwd: session.path,
                    engine: session.engine || 'claude'
                });

                if (res && res.proxyPath) {
                    proxyPath = res.proxyPath;
                    console.log('Started session, got proxyPath:', proxyPath);
                }
            }

            if (proxyPath) {
                terminalFrame.src = proxyPath;
                console.log('Terminal switched to:', proxyPath);
            } else {
                console.error('No proxyPath available for session:', sessionId);
                terminalFrame.src = 'about:blank';
            }

            // Update active state in UI (handled by SessionView re-render, but keep for now)
            document.querySelectorAll('.session-child-row').forEach(row => {
                row.classList.remove('active');
                if (row.dataset.id === sessionId) {
                    row.classList.add('active');
                }
            });

            // Clear done indicator and update session indicators
            clearDone(sessionId);
            updateSessionIndicators(appStore.getState().currentSessionId);

        } catch (error) {
            console.error('Failed to switch session:', error);
            terminalFrame.src = 'about:blank';
        }
    }

    /**
     * Load session-specific data
     */
    async loadSessionData(sessionId) {
        try {
            // Load tasks for the session
            await this.taskService.loadTasks();

            // Load schedule for the session
            await this.scheduleService.loadSchedule();

            console.log('Session data loaded for:', sessionId);
        } catch (error) {
            console.error('Failed to load session data:', error);
        }
    }

    /**
     * Initial data load
     */
    async loadInitialData() {
        try {
            // Load all sessions (404エラーは許容)
            try {
                await this.sessionService.loadSessions();
            } catch (error) {
                console.warn('Sessions not available, using empty state:', error.message);
            }

            // Get current session from store
            const { currentSessionId } = appStore.getState();

            if (currentSessionId) {
                await this.loadSessionData(currentSessionId);
            } else {
                // Load default data (404エラーは許容)
                try {
                    await this.taskService.loadTasks();
                } catch (error) {
                    console.warn('Tasks not available, using empty state:', error.message);
                }

                try {
                    await this.scheduleService.loadSchedule();
                } catch (error) {
                    console.warn('Schedule not available, using empty state:', error.message);
                }
            }

            console.log('Initial data loaded successfully');
        } catch (error) {
            console.error('Failed to load initial data:', error);
            // エラーダイアログは表示しない（空の状態で表示）
            console.warn('App started with empty data due to errors');
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        // TODO: Better error UI
        alert(message);
    }

    /**
     * Start application
     */
    async start() {
        console.log('Starting brainbase-ui...');

        // 1. Initialize services
        this.initServices();

        // 2. Initialize views
        this.initViews();

        // 3. Initialize modals
        this.initModals();

        // 4. Setup event listeners
        this.setupEventListeners();

        // 5. Load initial data
        await this.loadInitialData();

        // 6. Initialize file upload (Drag & Drop, Clipboard)
        initFileUpload(() => appStore.getState().currentSessionId);

        // 7. Start session status polling (every 3 seconds)
        this.pollingIntervalId = startPolling(() => appStore.getState().currentSessionId, 3000);

        // 8. Start periodic refresh (every 5 minutes)
        this.startPeriodicRefresh();

        // 9. Setup choice detection (mobile only)
        this.setupResponsiveChoiceDetection();

        // 10. Setup file opener shortcuts
        setupFileOpenerShortcuts();

        // 11. Setup terminal contextmenu listener
        setupTerminalContextMenuListener();

        // 12. Setup mobile keyboard handling
        initMobileKeyboard();

        console.log('brainbase-ui started successfully');
    }

    /**
     * Open create session modal
     * @param {string} project - Project name
     */
    openCreateSessionModal(project = 'general') {
        console.log('Opening create session modal for project:', project);

        const modal = document.getElementById('create-session-modal');
        const nameInput = document.getElementById('session-name-input');
        const commandInput = document.getElementById('session-command-input');
        const worktreeCheckbox = document.getElementById('use-worktree-checkbox');

        if (!modal || !nameInput) {
            console.error('Create session modal elements not found');
            return;
        }

        // Set defaults
        nameInput.value = `New ${project} Session`;
        if (commandInput) commandInput.value = '';
        if (worktreeCheckbox) worktreeCheckbox.checked = true;

        // Show modal
        modal.classList.add('active');
        nameInput.focus();
        nameInput.select();

        // Setup one-time submit handler
        const createBtn = document.getElementById('create-session-btn');
        const handleCreate = async () => {
            const name = nameInput.value.trim();
            if (!name) {
                nameInput.focus();
                return;
            }

            const engine = document.querySelector('input[name="session-engine"]:checked')?.value || 'claude';
            const initialCommand = commandInput?.value || '';
            const useWorktree = worktreeCheckbox?.checked || false;

            // Close modal
            modal.classList.remove('active');

            // Create session
            await this.createSession(project, name, initialCommand, useWorktree, engine);

            // Remove this event listener
            createBtn?.removeEventListener('click', handleCreate);
        };

        createBtn?.addEventListener('click', handleCreate);

        // Setup close handlers
        const closeHandlers = () => {
            modal.classList.remove('active');
            createBtn?.removeEventListener('click', handleCreate);
        };

        modal.querySelectorAll('.close-modal-btn').forEach(btn => {
            btn.addEventListener('click', closeHandlers, { once: true });
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeHandlers();
        }, { once: true });
    }

    /**
     * Create a new session
     */
    async createSession(project, name, initialCommand, useWorktree, engine) {
        console.log('Creating session:', { project, name, useWorktree, engine });

        try {
            const result = await this.sessionService.createSession({
                project,
                name,
                initialCommand,
                useWorktree,
                engine
            });

            console.log('Session created successfully:', result);

            // Switch to the newly created session
            if (result.sessionId) {
                appStore.setState({ currentSessionId: result.sessionId });
                eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: result.sessionId });
            }

            // If worktree session, handle proxy path for terminal
            if (result.proxyPath) {
                console.log('Worktree session created with proxy path:', result.proxyPath);
                // TODO: Update terminal frame src if needed
            }

        } catch (error) {
            console.error('Failed to create session:', error);
            this.showError('セッションの作成に失敗しました');
        }
    }

    /**
     * Start periodic refresh (every 5 minutes)
     */
    startPeriodicRefresh() {
        this.refreshIntervalId = setInterval(async () => {
            try {
                await this.scheduleService.loadSchedule();
                await this.taskService.loadTasks();
                if (this.views.inboxView && this.views.inboxView.loadInbox) {
                    await this.views.inboxView.loadInbox();
                }
                console.log('Periodic refresh completed');
            } catch (error) {
                console.error('Periodic refresh failed:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Check if device is mobile
     */
    isMobile() {
        return window.innerWidth <= 768;
    }

    /**
     * Start choice detection (mobile only)
     */
    startChoiceDetection() {
        this.stopChoiceDetection();

        this.choiceCheckInterval = setInterval(async () => {
            const currentSessionId = appStore.getState().currentSessionId;
            if (!currentSessionId) return;

            try {
                const res = await httpClient.get(`/api/sessions/${currentSessionId}/output`);
                const data = res;

                if (data.hasChoices && data.choices.length > 0) {
                    const choiceHash = JSON.stringify(data.choices);
                    if (choiceHash !== this.lastChoiceHash) {
                        this.lastChoiceHash = choiceHash;
                        this.showChoiceOverlay(data.choices);
                        this.stopChoiceDetection();
                    }
                }
            } catch (error) {
                console.error('Failed to check for choices:', error);
            }
        }, 2000); // Check every 2 seconds
    }

    /**
     * Stop choice detection
     */
    stopChoiceDetection() {
        if (this.choiceCheckInterval) {
            clearInterval(this.choiceCheckInterval);
            this.choiceCheckInterval = null;
        }
    }

    /**
     * Show choice overlay
     */
    showChoiceOverlay(choices) {
        const overlay = document.getElementById('choice-overlay');
        const container = document.getElementById('choice-buttons');
        const closeBtn = document.getElementById('close-choice-overlay');

        if (!overlay || !container) return;

        container.innerHTML = '';
        choices.forEach((choice) => {
            const btn = document.createElement('button');
            btn.className = 'choice-btn';
            btn.textContent = choice.originalText || `${choice.number}) ${choice.text}`;
            btn.onclick = () => this.selectChoice(choice.number);
            container.appendChild(btn);
        });

        overlay.classList.add('active');
        lucide.createIcons();

        closeBtn.onclick = () => this.closeChoiceOverlay();
    }

    /**
     * Close choice overlay
     */
    closeChoiceOverlay() {
        const overlay = document.getElementById('choice-overlay');
        overlay?.classList.remove('active');
        this.lastChoiceHash = null;
        if (this.isMobile()) {
            this.startChoiceDetection();
        }
    }

    /**
     * Send choice selection
     */
    async selectChoice(number) {
        const currentSessionId = appStore.getState().currentSessionId;
        if (!currentSessionId) return;

        try {
            await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: number,
                type: 'text'
            });

            await new Promise(resolve => setTimeout(resolve, 100));
            await httpClient.post(`/api/sessions/${currentSessionId}/input`, {
                input: 'Enter',
                type: 'key'
            });

            this.closeChoiceOverlay();
        } catch (error) {
            console.error('Failed to send choice:', error);
            this.showError('選択の送信に失敗しました');
        }
    }

    /**
     * Setup responsive choice detection
     */
    setupResponsiveChoiceDetection() {
        // Start on mobile
        if (this.isMobile()) {
            this.startChoiceDetection();
        }

        // Handle resize
        window.addEventListener('resize', () => {
            if (this.isMobile() && !this.choiceCheckInterval) {
                this.startChoiceDetection();
            } else if (!this.isMobile() && this.choiceCheckInterval) {
                this.stopChoiceDetection();
                this.closeChoiceOverlay();
            }
        });
    }

    /**
     * Cleanup
     */
    destroy() {
        // Stop polling
        if (this.pollingIntervalId) {
            clearInterval(this.pollingIntervalId);
            this.pollingIntervalId = null;
        }

        // Stop refresh
        if (this.refreshIntervalId) {
            clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = null;
        }

        // Stop choice detection
        this.stopChoiceDetection();

        // Unsubscribe from events
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];

        // Unmount views
        Object.values(this.views).forEach(view => {
            if (view.unmount) view.unmount();
        });

        // Unmount modals
        Object.values(this.modals).forEach(modal => {
            if (modal.unmount) modal.unmount();
        });

        console.log('brainbase-ui destroyed');
    }
}

// Initialize and start application
const app = new App();

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.start());
} else {
    app.start();
}

// Expose for debugging
window.brainbaseApp = app;
