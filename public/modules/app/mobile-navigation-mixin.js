import { appStore } from '../core/store.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { refreshIcons } from '../ui-helpers.js';
import {
    attachSectionHeaderHandlers,
    attachGroupHeaderHandlers,
    attachSessionRowClickHandlers,
    attachAddProjectSessionHandlers
} from '../session-handlers.js';
import { setupTaskTabs } from '../ui/task-tabs.js';
import { MobileInputController } from '../ui/mobile-input-controller.js';

export function applyMobileNavigationMixin(AppClass) {
    AppClass.prototype.initMobileInput = function() {
        this.mobileInputController = new MobileInputController({
            terminalInput: this.terminalInteractionService,
            isMobile: () => this.isMobile(),
            onViewportChange: (layout) => this._handleMobileViewportChange(layout)
        });
        this.mobileInputController.init();
    };

    AppClass.prototype.setupMobileNavigation = function() {
        const mobileSessionsBtn = document.getElementById('mobile-sessions-btn');
        const mobileTasksBtn = document.getElementById('mobile-tasks-btn');
        const mobileDashboardBtn = document.getElementById('mobile-dashboard-btn');
        const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
        const sessionsSheetOverlay = document.getElementById('sessions-sheet-overlay');
        const tasksSheetOverlay = document.getElementById('tasks-sheet-overlay');
        const sessionsBottomSheet = document.getElementById('sessions-bottom-sheet');
        const tasksBottomSheet = document.getElementById('tasks-bottom-sheet');
        const closeSessionsSheetBtn = document.getElementById('close-sessions-sheet');
        const closeTasksSheetBtn = document.getElementById('close-tasks-sheet');
        const mobileAddSessionBtn = document.getElementById('mobile-add-session-btn') || document.getElementById('mobile-new-session-btn');
        const mobileSessionList = document.getElementById('mobile-session-list');
        const mobileTasksContent = document.getElementById('mobile-tasks-content');
        const settingsUI = this.settingsCore?.ui;

        // Close Sessions bottom sheet
        const closeSessionsSheet = () => {
            sessionsSheetOverlay?.classList.remove('active');
            sessionsBottomSheet?.classList.remove('active');
        };

        const closeSettingsPanel = () => {
            if (settingsUI?.isOpen?.()) {
                settingsUI.closeModal();
            }
        };

        const renderMobileSessionList = () => {
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

                    // セッションアクションハンドラ（リネーム、削除、アーカイブ等）
                    this.views.sessionView?.attachActionHandlersToContainer(mobileSessionList);
                } catch (error) {
                    console.error('Error attaching handlers:', error);
                }
            }
        };

        // Open Sessions bottom sheet
        const openSessionsSheet = () => {
            closeTasksSheet();
            closeSettingsPanel();
            // Non-terminalタブ表示中はTerminalに戻す（シートを閉じた後にタブが残る問題の防止）
            if (this.mobileTabController && this.mobileTabController._activeTab !== 'terminal') {
                this.mobileTabController.switchTab('terminal');
            }
            renderMobileSessionList();
            sessionsSheetOverlay?.classList.add('active');
            sessionsBottomSheet?.classList.add('active');
            refreshIcons();
        };

        const refreshMobileSessionListIfOpen = () => {
            if (sessionsBottomSheet?.classList.contains('active')) {
                requestAnimationFrame(() => {
                    renderMobileSessionList();
                });
            }
        };

        const unsubscribeMobileSessionView = appStore.subscribeToSelector(
            state => state.ui?.sessionListView,
            () => refreshMobileSessionListIfOpen()
        );
        this.unsubscribers.push(unsubscribeMobileSessionView);

        const renderMobileTasksContent = ({ activeTab } = {}) => {
            const tasksTabContent = document.getElementById('tasks-tab-content');
            if (!mobileTasksContent || !tasksTabContent) return;

            mobileTasksContent.innerHTML = tasksTabContent.innerHTML;

            if (activeTab) {
                const tabButtons = mobileTasksContent.querySelectorAll('.task-tab');
                tabButtons.forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.tab === activeTab);
                });

                const tabContents = mobileTasksContent.querySelectorAll('.task-tab-content');
                tabContents.forEach(content => {
                    content.classList.toggle('active', content.id === `${activeTab}-tasks-panel`);
                });
            }

            setupTaskTabs({
                root: mobileTasksContent,
                eventBus,
                events: EVENTS,
                onTabActivated: async (tab) => {
                    await this.views.nocodbTasksView?.onTabActivated?.();
                    if (tab === 'nocodb') {
                        renderMobileTasksContent({ activeTab: tab });
                    }
                }
            });

            refreshIcons();
        };

        // Open Tasks bottom sheet
        const openTasksSheet = () => {
            closeSessionsSheet();
            closeSettingsPanel();
            renderMobileTasksContent();
            tasksSheetOverlay?.classList.add('active');
            tasksBottomSheet?.classList.add('active');
            refreshIcons();
        };

        // Close Tasks bottom sheet
        const closeTasksSheet = () => {
            tasksSheetOverlay?.classList.remove('active');
            tasksBottomSheet?.classList.remove('active');
        };

        const openSettingsPanel = async () => {
            closeSessionsSheet();
            closeTasksSheet();
            if (settingsUI?.openModal) {
                await settingsUI.openModal();
            }
        };

        // Event listeners for mobile navigation
        mobileSessionsBtn?.addEventListener('click', () => {
            openSessionsSheet();
        });
        mobileTasksBtn?.addEventListener('click', openTasksSheet);
        mobileDashboardBtn?.addEventListener('click', () => {
            closeSessionsSheet();
            closeTasksSheet();
            closeSettingsPanel();

            const abDashBtn = document.getElementById('ab-dashboard-btn');
            const isDashboardActive = abDashBtn?.classList.contains('active');
            if (isDashboardActive) {
                this.showConsole?.();
                return;
            }

            if (typeof this.showDashboard === 'function') {
                this.showDashboard();
                return;
            }

            abDashBtn?.click();
        });
        mobileSettingsBtn?.addEventListener('click', async () => {
            await openSettingsPanel();
        });
        mobileAddSessionBtn?.addEventListener('click', () => {
            closeSessionsSheet();
            eventBus.emit(EVENTS.CREATE_SESSION, { project: 'general' });
        });
        // Bottom nav +New button
        document.getElementById('mobile-new-session-btn')?.addEventListener('click', () => {
            eventBus.emit(EVENTS.CREATE_SESSION, { project: 'general' });
        });
        // Desktop New Session button
        const addSessionBtn = document.getElementById('add-session-btn');
        addSessionBtn?.addEventListener('click', () => {
            eventBus.emit(EVENTS.CREATE_SESSION, { project: 'general' });
        });
        closeSessionsSheetBtn?.addEventListener('click', closeSessionsSheet);
        closeTasksSheetBtn?.addEventListener('click', closeTasksSheet);
        sessionsSheetOverlay?.addEventListener('click', closeSessionsSheet);
        tasksSheetOverlay?.addEventListener('click', closeTasksSheet);

        // Mobile archive toggle button
        const mobileToggleArchivedBtn = document.getElementById('mobile-toggle-archived-btn');
        if (mobileToggleArchivedBtn) {
            mobileToggleArchivedBtn.addEventListener('click', async () => {
                await this.modals.archiveModal.open();
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

                // スクロール可能な要素を取得（モバイルボトムシート用の正しいセレクタ）
                const scrollableContent = sheet.querySelector('.bottom-sheet-content');
                const isAtTop = !scrollableContent || scrollableContent.scrollTop === 0;

                // スクロール位置が一番上 かつ 下方向に100px以上スワイプした場合のみ閉じる
                if (isAtTop && diff > 100) {
                    if (sheet === sessionsBottomSheet) closeSessionsSheet();
                    if (sheet === tasksBottomSheet) closeTasksSheet();
                }
            }, { passive: true });
        });

        // Prevent pinch-to-zoom on mobile
        // Cache multi-touch state at touchstart to allow passive touchmove
        let isMultiTouching = false;
        document.addEventListener('touchstart', (e) => {
            isMultiTouching = e.touches.length > 1;
            if (isMultiTouching) e.preventDefault();
        }, { passive: false });

        document.addEventListener('touchmove', (e) => {
            if (isMultiTouching) e.preventDefault();
        }, { passive: false });
    };

    AppClass.prototype.closeMobileSessionsSheet = function() {
        const sessionsSheetOverlay = document.getElementById('sessions-sheet-overlay');
        const sessionsBottomSheet = document.getElementById('sessions-bottom-sheet');
        sessionsSheetOverlay?.classList.remove('active');
        sessionsBottomSheet?.classList.remove('active');
    };
}
