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
        // Session change: reload related data
        const unsub1 = eventBus.on(EVENTS.SESSION_CHANGED, async ({ sessionId }) => {
            console.log('Session changed:', sessionId);
            await this.loadSessionData(sessionId);
        });

        // Start task: emit for terminal integration
        const unsub2 = eventBus.on(EVENTS.START_TASK, ({ task, taskId, engine }) => {
            console.log('Start task requested:', task || taskId, 'engine:', engine);
            // TODO: Terminal integration
        });

        this.unsubscribers.push(unsub1, unsub2);

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

        console.log('brainbase-ui started successfully');
    }

    /**
     * Cleanup
     */
    destroy() {
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
