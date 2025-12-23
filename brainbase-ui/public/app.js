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

        // Mobile copy terminal button
        const mobileCopyTerminalBtn = document.getElementById('mobile-copy-terminal-btn');
        if (mobileCopyTerminalBtn) {
            mobileCopyTerminalBtn.onclick = async () => {
                const mobileFabContainer = document.getElementById('mobile-fab-container');
                mobileFabContainer?.classList.remove('active');

                const currentSessionId = appStore.getState().currentSessionId;
                if (!currentSessionId) {
                    showInfo('セッションを選択してください');
                    return;
                }

                try {
                    const res = await fetch(`/api/sessions/${currentSessionId}/content?lines=500`);
                    if (!res.ok) throw new Error('Failed to fetch content');

                    const { content } = await res.json();
                    terminalContentDisplay.textContent = content;
                    copyTerminalModal.classList.add('active');
                    if (window.lucide) window.lucide.createIcons();

                    // Scroll to bottom
                    setTimeout(() => {
                        terminalContentDisplay.scrollTop = terminalContentDisplay.scrollHeight;
                    }, 50);
                } catch (error) {
                    console.error('Failed to get terminal content:', error);
                    showError('ターミナル内容の取得に失敗しました');
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

        // Create session: open modal
        const unsub3 = eventBus.on(EVENTS.CREATE_SESSION, (event) => {
            const { project } = event.detail;
            console.log('Create session requested for project:', project);
            this.openCreateSessionModal(project);
        });

        this.unsubscribers.push(unsub1, unsub2, unsub3);

        // Setup global UI button handlers
        this.setupGlobalButtons();
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
