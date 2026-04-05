import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { createSessionId } from '../session-manager.js';

export function applySessionCreationMixin(AppClass) {
    Object.assign(AppClass.prototype, {
        /**
         * Register active UI port for hook routing
         */
        async registerActivePort() {
            try {
                await fetch('/api/active-port', { cache: 'no-store' });
            } catch (error) {
                console.warn('Failed to register active port:', error);
            }
        },

        /**
         * Update app version display from server
         */
        async updateAppVersionDisplay() {
            const versionElements = [
                document.getElementById('app-version'),
                document.getElementById('mobile-app-version')
            ].filter(Boolean);

            if (versionElements.length === 0) return;

            try {
                const { version, runtime } = await httpClient.get('/api/version');
                if (!version) return;

                const gitSha = runtime?.git?.sha ? String(runtime.git.sha) : null;
                const branch = runtime?.git?.branch ? String(runtime.git.branch) : null;
                const cwd = runtime?.cwd ? String(runtime.cwd) : null;
                const pid = Number.isFinite(runtime?.pid) ? String(runtime.pid) : null;

                const display = gitSha ? `${version} (${gitSha})` : version;
                const details = [
                    branch ? `branch: ${branch}` : null,
                    cwd ? `cwd: ${cwd}` : null,
                    pid ? `pid: ${pid}` : null
                ].filter(Boolean).join(' | ');

                versionElements.forEach((element) => {
                    element.textContent = display;
                    if (details) {
                        element.title = details;
                    }
                });
            } catch (error) {
                console.warn('Failed to load app version:', error?.message || error);
            }
        },

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
            const projectSelect = document.getElementById('session-project-select');
            const worktreeLabel = worktreeCheckbox?.parentElement;

            if (!modal || !nameInput) {
                console.error('Create session modal elements not found');
                return;
            }

            // Helper function to update worktree checkbox state
            const updateWorktreeAvailability = async (selectedProject) => {
                if (!worktreeCheckbox) return;

                // general は常にworktree可能（workspace全体を使用）
                if (selectedProject === 'general') {
                    worktreeCheckbox.disabled = false;
                    worktreeCheckbox.checked = true;
                    if (worktreeLabel) {
                        worktreeLabel.title = '';
                        worktreeLabel.style.opacity = '1';
                    }
                    return;
                }

                try {
                    const { hasGitRepository } = await import('../project-mapping.js');
                    const hasGit = hasGitRepository(selectedProject);

                    worktreeCheckbox.disabled = !hasGit;
                    worktreeCheckbox.checked = hasGit;

                    if (worktreeLabel) {
                        if (!hasGit) {
                            worktreeLabel.title = 'このプロジェクトにはGitリポジトリがないため、worktreeを作成できません';
                            worktreeLabel.style.opacity = '0.5';
                        } else {
                            worktreeLabel.title = '';
                            worktreeLabel.style.opacity = '1';
                        }
                    }

                    console.log(`[CreateSession] Project ${selectedProject} hasGitRepository: ${hasGit}`);
                } catch (err) {
                    console.warn('[CreateSession] Failed to check git repository:', err);
                    // エラー時はデフォルト動作（worktree有効）
                    worktreeCheckbox.disabled = false;
                    worktreeCheckbox.checked = true;
                }
            };

            // Set defaults
            nameInput.value = `New ${project} Session`;
            if (commandInput) commandInput.value = '';

            // Refresh project options (filters archived) and set selection
            if (projectSelect) {
                this.refreshProjectSelect(project);
            }

            // Update worktree checkbox based on initial project
            updateWorktreeAvailability(project);

            // Add change listener for project select
            const handleProjectChange = (e) => {
                updateWorktreeAvailability(e.target.value);
            };
            projectSelect?.addEventListener('change', handleProjectChange);

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
                const selectedProject = projectSelect?.value || project;

                // Close modal
                modal.classList.remove('active');
                this.closeMobileSessionsSheet();

                // Create session
                await this.createSession(selectedProject, name, initialCommand, useWorktree, engine);

                // Remove this event listener
                createBtn?.removeEventListener('click', handleCreate);
            };

            createBtn?.addEventListener('click', handleCreate);

            // Setup close handlers
            const closeHandlers = () => {
                modal.classList.remove('active');
                createBtn?.removeEventListener('click', handleCreate);
                projectSelect?.removeEventListener('change', handleProjectChange);
            };

            modal.querySelectorAll('.close-modal-btn').forEach(btn => {
                btn.addEventListener('click', closeHandlers, { once: true });
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeHandlers();
            }, { once: true });
        },

        /**
         * Create a new session
         */
        async createSession(project, name, initialCommand, useWorktree, engine) {
            console.log('Creating session:', { project, name, useWorktree, engine });

            // useWorktreeの場合、sessionIdを事前に生成してプログレスポーリングを開始
            let sessionId;
            if (useWorktree) {
                sessionId = createSessionId('session');
                this.showProgressModal();
                this._pollProgress(sessionId);
            }

            try {
                const result = await this.sessionService.createSession({
                    project,
                    name,
                    initialCommand,
                    useWorktree,
                    engine,
                    sessionId
                });

                console.log('Session created successfully:', result);

                if (useWorktree) {
                    this.hideProgressModal();
                }

                // Switch to the newly created session
                if (result.sessionId) {
                    const previousSessionId = appStore.getState().currentSessionId || null;
                    appStore.setState({ currentSessionId: result.sessionId });
                    eventBus.emit(EVENTS.SESSION_CHANGED, {
                        sessionId: result.sessionId,
                        previousSessionId,
                        proxyPath: result.proxyPath || null
                    });

                    if (useWorktree) {
                        this.showTerminalLoadingOverlay();
                        this._waitForClaudeInitialization(result.sessionId);
                    }
                }

                this.closeMobileSessionsSheet();

                // If worktree session, handle proxy path for terminal
                if (result.proxyPath) {
                    console.log('Worktree session created with proxy path:', result.proxyPath);
                }

            } catch (error) {
                console.error('Failed to create session:', error);
                if (useWorktree) {
                    this.hideProgressModal();
                }
                this.showError('セッションの作成に失敗しました');
            }
        },

        /**
         * プログレスモーダル表示
         */
        showProgressModal() {
            const modal = document.getElementById('session-progress-modal');
            if (!modal) return;
            modal.classList.add('active');
        },

        /**
         * プログレスモーダル非表示
         */
        hideProgressModal() {
            const modal = document.getElementById('session-progress-modal');
            if (!modal) return;
            modal.classList.remove('active');
            this._stopProgressPolling();
        },

        /**
         * プログレスポーリング
         * @param {string} sessionId - セッションID
         */
        _pollProgress(sessionId) {
            this._progressSessionId = sessionId;
            this._progressPollingActive = true;
            this._currentPercent = 0;

            const poll = async () => {
                if (!this._progressPollingActive) return;

                try {
                    const progress = await this.sessionService.getProgress(this._progressSessionId, this._currentPercent || 0);

                    if (progress) {
                        this._currentPercent = progress.percent;
                        this._updateProgressUI(progress);

                        if (progress.percent >= 100 || progress.phase === 'error') {
                            this._stopProgressPolling();
                            return;
                        }
                    }

                    setTimeout(poll, 500);
                } catch (error) {
                    console.error('[Progress Poll] Error:', error);
                    setTimeout(poll, 1000);
                }
            };

            poll();
        },

        /**
         * プログレスポーリング停止
         */
        _stopProgressPolling() {
            this._progressPollingActive = false;
        },

        /**
         * プログレスUI更新
         * @param {Object} progress - プログレス情報
         */
        _updateProgressUI(progress) {
            const fill = document.getElementById('progress-fill');
            const message = document.getElementById('progress-message');
            const percent = document.getElementById('progress-percent');

            if (fill) fill.style.width = `${progress.percent}%`;
            if (message) message.textContent = progress.message;
            if (percent) percent.textContent = `${progress.percent}%`;
        },

        /**
         * ターミナルローディングオーバーレイ表示
         */
        showTerminalLoadingOverlay() {
            const overlay = document.getElementById('terminal-loading-overlay');
            if (!overlay) return;
            overlay.classList.remove('hidden');
        },

        /**
         * ターミナルローディングオーバーレイ非表示
         */
        hideTerminalLoadingOverlay() {
            const overlay = document.getElementById('terminal-loading-overlay');
            if (!overlay) return;
            overlay.classList.add('hidden');
        },

        _isXtermSessionReady(sessionId) {
            if (!sessionId || appStore.getState().currentSessionId !== sessionId) {
                return false;
            }
            if (!this._isXtermTransportActive()) {
                return false;
            }
            const status = this._terminalTransportStatus || this.terminalTransportClient?.getStatus?.() || null;
            const mode = status?.mode || null;
            return mode === 'live' || mode === 'snapshot';
        },

        /**
         * Claude初期化待機
         * @param {string} sessionId - セッションID
         */
        async _waitForClaudeInitialization(sessionId) {
            const maxWaitTime = 30000;
            const pollInterval = 200;
            const startTime = Date.now();

            const checkInitialization = () => {
                if (this._isXtermSessionReady(sessionId)) {
                    console.log(`[Claude Init] Xterm transport ready for ${sessionId}`);
                    this.hideTerminalLoadingOverlay();
                    return;
                }

                const iframe = document.getElementById('terminal-frame');
                if (iframe && iframe.src && iframe.src !== 'about:blank') {
                    console.log(`[Claude Init] Terminal iframe loaded for ${sessionId}`);
                    this.hideTerminalLoadingOverlay();
                    return;
                }

                if (Date.now() - startTime > maxWaitTime) {
                    console.warn(`[Claude Init] Timeout for session ${sessionId}, removing overlay`);
                    this.hideTerminalLoadingOverlay();
                    return;
                }

                setTimeout(checkInitialization, pollInterval);
            };

            checkInitialization();
        },

        startSessionUiSummaryRefresh() {
            if (this.sessionUiSummaryIntervalId) {
                clearInterval(this.sessionUiSummaryIntervalId);
            }

            this.sessionUiSummaryIntervalId = setInterval(() => {
                if (document.hidden) return;
                const state = appStore.getState();
                if (state.ui?.sidebarPrimaryView !== 'sessions') return;
                const refreshIds = this._getSessionUiSummaryRefreshIds();
                if (refreshIds.length === 0) return;
                void this.refreshSessionUiSummaries(refreshIds);
            }, 30_000);
        },

        _syncSidebarToOpenedFile(sessionId, relativePath, treeNavigable = true, treeRootPath = null) {
            if (!sessionId) return;
            const state = appStore.getState();
            const folderTree = state.folderTree || {};
            const activeFileBySessionId = {
                ...(folderTree.activeFileBySessionId || {})
            };
            const rootOverrideBySessionId = {
                ...(folderTree.rootOverrideBySessionId || {})
            };
            const bySessionId = {
                ...(folderTree.bySessionId || {})
            };
            const previousRootOverride = rootOverrideBySessionId[sessionId] || null;
            if (treeNavigable && relativePath) {
                activeFileBySessionId[sessionId] = relativePath;
                if (treeRootPath) {
                    rootOverrideBySessionId[sessionId] = treeRootPath;
                } else {
                    delete rootOverrideBySessionId[sessionId];
                }
            } else {
                delete activeFileBySessionId[sessionId];
                delete rootOverrideBySessionId[sessionId];
            }
            const nextRootOverride = rootOverrideBySessionId[sessionId] || null;
            if (previousRootOverride !== nextRootOverride) {
                delete bySessionId[sessionId];
            }

            appStore.setState({
                ui: {
                    ...(state.ui || {}),
                    sidebarPrimaryView: treeNavigable ? 'folders' : (state.ui?.sidebarPrimaryView || 'sessions')
                },
                folderTree: {
                    ...folderTree,
                    bySessionId,
                    activeFileBySessionId,
                    rootOverrideBySessionId
                }
            });
        },

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
                    await this.refreshLearningHealthBanner();
                    console.log('Periodic refresh completed');
                } catch (error) {
                    console.error('Periodic refresh failed:', error);
                }
            }, 5 * 60 * 1000); // 5 minutes
        }
    });
}
