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

                const details = [
                    `version: ${version}`,
                    gitSha ? `commit: ${gitSha}` : null,
                    branch ? `branch: ${branch}` : null,
                    cwd ? `cwd: ${cwd}` : null,
                    pid ? `pid: ${pid}` : null
                ].filter(Boolean).join(' | ');

                versionElements.forEach((element) => {
                    element.textContent = version;
                    if (gitSha) {
                        element.dataset.gitSha = gitSha;
                    } else {
                        delete element.dataset.gitSha;
                    }
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
                            worktreeLabel.title = 'このプロジェクトにはGitリポジトリがないため、jj workspaceを作成できません';
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

            let sessionId;
            if (useWorktree) {
                sessionId = createSessionId('session');
                const previousSessionId = appStore.getState().currentSessionId || null;
                const shell = await this.sessionService.createPendingSessionShell({
                    project,
                    name,
                    sessionId,
                    engine
                });

                this._rememberSessionStartupParams({
                    project,
                    name: shell.session?.name || name,
                    useWorktree,
                    engine,
                    sessionId
                });
                this._primeSessionStartupPrompt(sessionId, initialCommand);
                this.closeMobileSessionsSheet();
                this.showTerminalLoadingOverlay({
                    startup: true,
                    sessionId,
                    message: 'ワークスペースを準備中...',
                    hint: '入力できます。送信すると起動完了後に実行します。'
                });
                this._pollProgress(sessionId);
                appStore.setState({ currentSessionId: sessionId });
                await eventBus.emit(EVENTS.SESSION_CHANGED, {
                    sessionId,
                    previousSessionId,
                    pendingStartup: true
                });

                this._continueSessionStartup({
                    project,
                    name: shell.session?.name || name,
                    initialCommand,
                    useWorktree,
                    engine,
                    sessionId
                });
                return { sessionId, pending: true };
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

        async _continueSessionStartup({ project, name, initialCommand = '', useWorktree, engine, sessionId }) {
            this._rememberSessionStartupParams({ project, name, initialCommand, useWorktree, engine, sessionId });
            this._sessionStartupInFlight = this._sessionStartupInFlight || new Set();
            if (this._sessionStartupInFlight.has(sessionId)) {
                return;
            }
            this._sessionStartupInFlight.add(sessionId);
            this._sessionStartupFailed?.delete(sessionId);
            try {
                const result = await this.sessionService.createSession({
                    project,
                    name,
                    initialCommand,
                    useWorktree,
                    engine,
                    sessionId,
                    allowRegularFallback: false
                });

                console.log('Session startup completed:', result);
                this._stopProgressPolling();

                if (result.sessionId) {
                    this._sessionStartupResumeWatchers?.delete(result.sessionId);
                    const previousSessionId = appStore.getState().currentSessionId || null;
                    const shouldPresentSession = previousSessionId === result.sessionId;
                    if (initialCommand.trim()
                        && this._sessionStartupPromptQueue?.get(result.sessionId) === initialCommand) {
                        this._clearSessionStartupPromptState(result.sessionId);
                    }
                    await this._flushSessionStartupPrompt(result.sessionId);
                    if (shouldPresentSession) {
                        await eventBus.emit(EVENTS.SESSION_CHANGED, {
                            sessionId: result.sessionId,
                            previousSessionId,
                            proxyPath: result.proxyPath || null
                        });
                    }
                }

                if (!this._sessionStartupPromptQueue?.has(result.sessionId)
                    && this._isSessionStartupComposerForSession(result.sessionId)) {
                    this.hideSessionStartupComposer();
                }
                this._sessionStartupParams?.delete(result.sessionId);
                this._sessionStartupFailed?.delete(result.sessionId);
                this._sessionStartupRetryRequested?.delete(result.sessionId);

                if (result.proxyPath) {
                    console.log('Worktree session created with proxy path:', result.proxyPath);
                }
            } catch (error) {
                console.error('Failed to start session runtime:', error);
                this._stopProgressPolling();
                this._sessionStartupResumeWatchers?.delete(sessionId);
                const message = error?.message || 'セッション起動に失敗しました';
                await this.sessionService?.markSessionStartupFailed?.(sessionId, message);
                this._sessionStartupFailed = this._sessionStartupFailed || new Set();
                this._sessionStartupFailed.add(sessionId);
                if (appStore.getState().currentSessionId === sessionId) {
                    this.showTerminalLoadingOverlay({
                        startup: true,
                        sessionId,
                        message: 'セッション起動に失敗しました',
                        hint: '入力内容は残っています。設定を確認して再試行してください。',
                        failed: true
                    });
                    this.showError('セッションの起動に失敗しました');
                }
            } finally {
                this._sessionStartupInFlight?.delete(sessionId);
                if (this._sessionStartupRetryRequested?.has(sessionId)) {
                    this._sessionStartupRetryRequested.delete(sessionId);
                    this._retryFailedSessionStartup(sessionId);
                }
            }
        },

        _rememberSessionStartupParams(params) {
            if (!params?.sessionId) return;
            this._sessionStartupParams = this._sessionStartupParams || new Map();
            this._sessionStartupParams.set(params.sessionId, {
                project: params.project,
                name: params.name,
                useWorktree: params.useWorktree !== false,
                engine: params.engine,
                sessionId: params.sessionId
            });
        },

        _resumePendingSessionStartup(session) {
            if (!session?.id || session.startupStatus !== 'pending') return false;
            this._hydrateSessionStartupPromptState?.(session.id);
            if (!this._sessionStartupInFlight?.has(session.id) && this.sessionService?.getProgress) {
                this._pollProgress?.(session.id);
            }
            this._watchResumedSessionStartup?.(session.id);
            return true;
        },

        _watchResumedSessionStartup(sessionId) {
            if (!sessionId || !this.sessionService?.loadSessions) return;
            this._sessionStartupResumeWatchers = this._sessionStartupResumeWatchers || new Set();
            if (this._sessionStartupResumeWatchers.has(sessionId)) return;
            this._sessionStartupResumeWatchers.add(sessionId);

            const startedAt = Date.now();
            const timeoutMs = Number.isFinite(this._sessionStartupResumeTimeoutMs)
                ? this._sessionStartupResumeTimeoutMs
                : 5 * 60 * 1000;
            const pollIntervalMs = Number.isFinite(this._sessionStartupResumePollIntervalMs)
                ? this._sessionStartupResumePollIntervalMs
                : 1000;
            const poll = async () => {
                if (!this._sessionStartupResumeWatchers?.has(sessionId)) return;
                try {
                    const sessions = await this.sessionService.loadSessions({ silent: true });
                    const session = (sessions || []).find((entry) => entry.id === sessionId);
                    if (!session) {
                        this._sessionStartupResumeWatchers.delete(sessionId);
                        return;
                    }

                    if (!this._isSessionStartupShell(session)) {
                        this._sessionStartupResumeWatchers.delete(sessionId);
                        const previousSessionId = appStore.getState().currentSessionId || null;
                        await this._flushSessionStartupPrompt(sessionId);
                        if (previousSessionId === sessionId) {
                            await eventBus.emit(EVENTS.SESSION_CHANGED, {
                                sessionId,
                                previousSessionId,
                                resumedStartup: true
                            });
                        }
                        if (!this._sessionStartupPromptQueue?.has(sessionId)
                            && this._isSessionStartupComposerForSession(sessionId)) {
                            this.hideSessionStartupComposer();
                        }
                        return;
                    }

                    if (session.startupStatus === 'failed') {
                        this._sessionStartupResumeWatchers.delete(sessionId);
                        this._sessionStartupFailed = this._sessionStartupFailed || new Set();
                        this._sessionStartupFailed.add(sessionId);
                        if (appStore.getState().currentSessionId === sessionId) {
                            this.showTerminalLoadingOverlay({
                                startup: true,
                                sessionId,
                                message: 'セッション起動に失敗しました',
                                hint: '入力内容は残っています。設定を確認して再試行してください。',
                                failed: true
                            });
                        }
                        return;
                    }
                } catch (error) {
                    console.warn('Failed to watch resumed session startup:', error);
                }

                if (Date.now() - startedAt > timeoutMs) {
                    this._sessionStartupResumeWatchers?.delete(sessionId);
                    const message = 'セッション起動が中断されました。再試行してください。';
                    await this.sessionService?.markSessionStartupFailed?.(sessionId, message);
                    this._sessionStartupFailed = this._sessionStartupFailed || new Set();
                    this._sessionStartupFailed.add(sessionId);
                    if (appStore.getState().currentSessionId === sessionId) {
                        this.showTerminalLoadingOverlay?.({
                            startup: true,
                            sessionId,
                            message: 'セッション起動に失敗しました',
                            hint: '入力内容は残っています。再試行してください。',
                            failed: true
                        });
                    }
                    return;
                }
                window.setTimeout(poll, pollIntervalMs);
            };

            void poll();
        },

        _retryFailedSessionStartup(sessionId) {
            if (!sessionId) return false;
            if (!this.sessionService?.createSession) return false;
            const sessions = appStore.getState().sessions || [];
            const session = sessions.find((entry) => entry.id === sessionId);
            const wasFailed = session?.startupStatus === 'failed' || this._sessionStartupFailed?.has(sessionId);
            if (!wasFailed) return false;
            this._captureSessionStartupPromptFromComposer(sessionId, { queue: true });
            if (this._sessionStartupInFlight?.has(sessionId)) {
                this._sessionStartupRetryRequested = this._sessionStartupRetryRequested || new Set();
                this._sessionStartupRetryRequested.add(sessionId);
                this._setSessionStartupPromptStatus('再試行を予約しました', 'queued');
                return true;
            }

            const params = this._sessionStartupParams?.get(sessionId) || (session ? {
                project: session.project,
                name: session.name,
                useWorktree: true,
                engine: session.engine || 'claude',
                sessionId
            } : null);
            if (!params?.project) return false;

            this._sessionStartupFailed?.delete(sessionId);
            this.showTerminalLoadingOverlay({
                startup: true,
                sessionId,
                message: 'ワークスペースを再準備中...',
                hint: '入力内容は保持したまま再試行しています。'
            });
            this._setSessionStartupPromptStatus('再試行しています...', 'queued');
            this._pollProgress(sessionId);
            this._continueSessionStartup(params);
            return true;
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

            const overlay = document.getElementById('terminal-loading-overlay');
            if (overlay && !overlay.classList.contains('hidden')) {
                const loadingMessage = overlay.querySelector('.loading-message');
                const loadingHint = overlay.querySelector('.loading-hint');
                if (loadingMessage && progress.message) loadingMessage.textContent = progress.message;
                if (loadingHint && Number.isFinite(progress.percent)) {
                    loadingHint.textContent = `${progress.percent}%`;
                }
            }
        },

        /**
         * ターミナルローディングオーバーレイ表示
         */
        showTerminalLoadingOverlay(options = {}) {
            const overlay = document.getElementById('terminal-loading-overlay');
            if (!overlay) return;
            overlay.classList.remove('hidden');
            const message = overlay.querySelector('.loading-message');
            const hint = overlay.querySelector('.loading-hint');
            if (message && options.message) message.textContent = options.message;
            if (hint && options.hint) hint.textContent = options.hint;
            if (options.startup && options.sessionId) {
                this.showSessionStartupComposer(options.sessionId, {
                    failed: options.failed === true
                });
            } else {
                this.hideSessionStartupComposer();
            }
        },

        /**
         * ターミナルローディングオーバーレイ非表示
         */
        hideTerminalLoadingOverlay() {
            const overlay = document.getElementById('terminal-loading-overlay');
            if (!overlay) return;
            overlay.classList.add('hidden');
            this.hideSessionStartupComposer();
        },

        _ensureSessionStartupComposerBound() {
            this._sessionStartupPromptDrafts = this._sessionStartupPromptDrafts || new Map();
            this._sessionStartupPromptQueue = this._sessionStartupPromptQueue || new Map();

            const input = document.getElementById('session-startup-prompt-input');
            const sendBtn = document.getElementById('session-startup-prompt-send');
            if (!input || !sendBtn) return;
            this._sessionStartupComposerBound = true;

            const queueCurrentPrompt = () => {
                const currentInput = document.getElementById('session-startup-prompt-input') || input;
                const sessionId = currentInput.dataset.sessionId || appStore.getState().currentSessionId;
                if (!sessionId) return;
                const prompt = currentInput.value.trim();
                if (!prompt) {
                    if (this._retryFailedSessionStartup?.(sessionId)) {
                        this._setSessionStartupPromptStatus('再試行しています...', 'queued');
                    } else {
                        currentInput.focus();
                    }
                    return;
                }
                this._sessionStartupPromptDrafts.set(sessionId, currentInput.value);
                this._sessionStartupPromptQueue.set(sessionId, currentInput.value);
                this._persistSessionStartupPromptState(sessionId);
                this._setSessionStartupPromptStatus('起動完了後に送信します', 'queued');
                this._retryFailedSessionStartup?.(sessionId);
            };
            this._queueCurrentSessionStartupPrompt = queueCurrentPrompt;

            if (!this._sessionStartupComposerClickDelegated) {
                this._sessionStartupComposerClickDelegated = true;
                document.addEventListener('click', (event) => {
                    if (!event.target?.closest?.('#session-startup-prompt-send')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    this._queueCurrentSessionStartupPrompt?.();
                }, true);
            }

            input.oninput = () => {
                const sessionId = input.dataset.sessionId || appStore.getState().currentSessionId;
                if (!sessionId) return;
                this._sessionStartupPromptDrafts.set(sessionId, input.value);
                if (!this._sessionStartupPromptQueue?.has(sessionId)) {
                    this._persistSessionStartupPromptState(sessionId);
                    return;
                }
                if (input.value.trim()) {
                    this._sessionStartupPromptQueue.set(sessionId, input.value);
                    this._setSessionStartupPromptStatus('送信予約を更新しました', 'queued');
                } else {
                    this._sessionStartupPromptQueue.delete(sessionId);
                    this._setSessionStartupPromptStatus('送信予約を解除しました', 'idle');
                }
                this._persistSessionStartupPromptState(sessionId);
            };
            input.onkeydown = (event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
                event.preventDefault();
                queueCurrentPrompt();
            };
            sendBtn.onclick = (event) => {
                event?.preventDefault?.();
                queueCurrentPrompt();
            };
        },

        _primeSessionStartupPrompt(sessionId, prompt) {
            this._sessionStartupPromptDrafts = this._sessionStartupPromptDrafts || new Map();
            this._sessionStartupPromptQueue = this._sessionStartupPromptQueue || new Map();
            const text = typeof prompt === 'string' ? prompt : '';
            this._sessionStartupPromptDrafts.set(sessionId, text);
            if (text.trim()) {
                this._sessionStartupPromptQueue.set(sessionId, text);
            }
            this._persistSessionStartupPromptState(sessionId);
        },

        showSessionStartupComposer(sessionId, { failed = false } = {}) {
            this._ensureSessionStartupComposerBound();
            this._hydrateSessionStartupPromptState(sessionId);
            const composer = document.getElementById('session-startup-composer');
            const input = document.getElementById('session-startup-prompt-input');
            const sendBtn = document.getElementById('session-startup-prompt-send');
            if (!composer || !input || !sendBtn) return;

            const draft = this._sessionStartupPromptDrafts?.get(sessionId) || '';
            if (input.dataset.sessionId !== sessionId) {
                input.value = draft;
                input.dataset.sessionId = sessionId;
            }
            composer.classList.remove('hidden');
            sendBtn.disabled = false;
            sendBtn.textContent = this._sessionStartupPromptQueue?.has(sessionId) ? '送信予約中' : '送信予約';
            this._setSessionStartupPromptStatus(
                failed
                    ? '起動に失敗しました。入力内容は保持されています。'
                    : (this._sessionStartupPromptQueue?.has(sessionId) ? '起動完了後に送信します' : '起動中も入力できます'),
                failed ? 'failed' : (this._sessionStartupPromptQueue?.has(sessionId) ? 'queued' : 'idle')
            );
            window.setTimeout(() => input.focus(), 0);
        },

        hideSessionStartupComposer() {
            const composer = document.getElementById('session-startup-composer');
            if (composer) composer.classList.add('hidden');
        },

        _setSessionStartupPromptStatus(text, state = 'idle') {
            const status = document.getElementById('session-startup-prompt-status');
            const sendBtn = document.getElementById('session-startup-prompt-send');
            if (status) {
                status.textContent = text || '';
                status.dataset.state = state;
            }
            if (sendBtn) {
                sendBtn.textContent = state === 'queued' ? '送信予約中' : '送信予約';
            }
        },

        _getSessionStartupPromptStorageKey(sessionId) {
            return sessionId ? `brainbase:session-startup-prompt:${sessionId}` : null;
        },

        _readSessionStartupPromptState(sessionId) {
            const key = this._getSessionStartupPromptStorageKey(sessionId);
            if (!key || typeof window === 'undefined' || !window.localStorage) return null;
            try {
                const raw = window.localStorage.getItem(key);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch (error) {
                console.warn('Failed to read startup prompt state:', error);
                return null;
            }
        },

        _persistSessionStartupPromptState(sessionId) {
            const key = this._getSessionStartupPromptStorageKey(sessionId);
            if (!key || typeof window === 'undefined' || !window.localStorage) return;
            const draft = this._sessionStartupPromptDrafts?.get(sessionId) || '';
            const queued = this._sessionStartupPromptQueue?.has(sessionId) === true;
            const prompt = queued ? (this._sessionStartupPromptQueue?.get(sessionId) || draft) : draft;
            if (!draft && !queued) {
                window.localStorage.removeItem(key);
                return;
            }
            try {
                window.localStorage.setItem(key, JSON.stringify({
                    draft,
                    prompt,
                    queued,
                    updatedAt: new Date().toISOString()
                }));
            } catch (error) {
                console.warn('Failed to persist startup prompt state:', error);
            }
        },

        _hydrateSessionStartupPromptState(sessionId) {
            if (!sessionId) return;
            this._sessionStartupPromptDrafts = this._sessionStartupPromptDrafts || new Map();
            this._sessionStartupPromptQueue = this._sessionStartupPromptQueue || new Map();
            if (this._sessionStartupPromptDrafts.has(sessionId) || this._sessionStartupPromptQueue.has(sessionId)) {
                return;
            }
            const state = this._readSessionStartupPromptState(sessionId);
            if (!state) return;
            const draft = typeof state.draft === 'string'
                ? state.draft
                : (typeof state.prompt === 'string' ? state.prompt : '');
            const prompt = typeof state.prompt === 'string' ? state.prompt : draft;
            this._sessionStartupPromptDrafts.set(sessionId, draft);
            if (state.queued === true && prompt.trim()) {
                this._sessionStartupPromptQueue.set(sessionId, prompt);
            }
        },

        _captureSessionStartupPromptFromComposer(sessionId, { queue = false } = {}) {
            if (!sessionId) return;
            const input = document.getElementById('session-startup-prompt-input');
            if (!input) return;
            const inputSessionId = input.dataset.sessionId || appStore.getState().currentSessionId;
            if (inputSessionId !== sessionId) return;

            this._sessionStartupPromptDrafts = this._sessionStartupPromptDrafts || new Map();
            this._sessionStartupPromptQueue = this._sessionStartupPromptQueue || new Map();
            this._sessionStartupPromptDrafts.set(sessionId, input.value);
            if (queue) {
                if (input.value.trim()) {
                    this._sessionStartupPromptQueue.set(sessionId, input.value);
                } else if (!this._sessionStartupPromptQueue.has(sessionId)) {
                    this._sessionStartupPromptQueue.delete(sessionId);
                }
            }
            this._persistSessionStartupPromptState(sessionId);
        },

        _clearSessionStartupPromptState(sessionId) {
            if (!sessionId) return;
            this._sessionStartupPromptQueue?.delete(sessionId);
            this._sessionStartupPromptDrafts?.delete(sessionId);
            const key = this._getSessionStartupPromptStorageKey(sessionId);
            if (!key || typeof window === 'undefined' || !window.localStorage) return;
            try {
                window.localStorage.removeItem(key);
            } catch (error) {
                console.warn('Failed to clear startup prompt state:', error);
            }
        },

        async _flushSessionStartupPrompt(sessionId) {
            this._hydrateSessionStartupPromptState(sessionId);
            this._captureSessionStartupPromptFromComposer(sessionId, {
                queue: this._sessionStartupPromptQueue?.has(sessionId) === true
            });
            const input = document.getElementById('session-startup-prompt-input');
            const prompt = this._sessionStartupPromptQueue?.get(sessionId);
            if (!prompt || !prompt.trim()) {
                this._clearSessionStartupPromptState(sessionId);
                return;
            }

            this._setSessionStartupPromptStatus('送信中...', 'sending');
            try {
                if (!this.terminalInteractionService?.sendInput) {
                    throw new Error('Terminal input service is unavailable');
                }
                await this.terminalInteractionService?.sendInput(sessionId, prompt);
                this._clearSessionStartupPromptState(sessionId);
                if (input?.dataset.sessionId === sessionId) {
                    input.value = '';
                }
                this._setSessionStartupPromptStatus('送信しました', 'sent');
            } catch (error) {
                console.error('Failed to flush startup prompt:', error);
                this._sessionStartupPromptQueue.set(sessionId, prompt);
                this._persistSessionStartupPromptState(sessionId);
                this._setSessionStartupPromptStatus('送信に失敗しました。再接続後にもう一度送信してください。', 'failed');
            }
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

        _isSessionStartupShell(session) {
            return session?.startupStatus === 'pending' || session?.startupStatus === 'failed';
        },

        _isSessionStartupComposerForSession(sessionId) {
            if (!sessionId) return false;
            const input = document.getElementById('session-startup-prompt-input');
            return appStore.getState().currentSessionId === sessionId || input?.dataset?.sessionId === sessionId;
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
