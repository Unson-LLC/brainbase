import { appStore } from '../core/store.js';
import { httpClient } from '../core/http-client.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { createSessionId } from '../session-manager.js';
import { showError } from '../toast.js';

function fallbackProjectCatalogStatusMessage(source = {}) {
    if (source.status === 'authentication_required') {
        return 'プロジェクト一覧を取得できません。認証が必要です。generalのみ選択できます。';
    }
    if (source.status === 'request_failed') {
        const httpStatus = Number.isInteger(source.http_status) ? `（HTTP ${source.http_status}）` : '';
        return `プロジェクト一覧を取得できません${httpStatus}。generalのみ選択できます。`;
    }
    if (source.status === 'loaded') return '権限のあるプロジェクト一覧を読み込みました。';
    return 'プロジェクト一覧を取得できません。generalのみ選択できます。';
}

function renderProjectCatalogStatus(projectSelect, source, getStatusMessage) {
    if (!projectSelect) return;

    let statusElement = document.getElementById('session-launch-project-catalog-status');
    if (!statusElement) {
        statusElement = document.createElement('p');
        statusElement.id = 'session-launch-project-catalog-status';
        statusElement.className = 'project-catalog-status';
        projectSelect.insertAdjacentElement('afterend', statusElement);
    }

    const normalizedSource = source && typeof source === 'object'
        ? source
        : { status: 'unknown' };
    const isLoaded = normalizedSource.status === 'loaded';
    statusElement.textContent = typeof getStatusMessage === 'function'
        ? getStatusMessage(normalizedSource)
        : fallbackProjectCatalogStatusMessage(normalizedSource);
    statusElement.dataset.status = normalizedSource.status || 'unknown';
    statusElement.dataset.severity = isLoaded ? 'success' : 'error';
    statusElement.hidden = false;
    statusElement.setAttribute('role', isLoaded ? 'status' : 'alert');
    statusElement.setAttribute('aria-live', isLoaded ? 'polite' : 'assertive');
}

function resetProjectSelectToGeneral(projectSelect) {
    projectSelect.innerHTML = '';
    const generalOption = document.createElement('option');
    generalOption.value = 'general';
    generalOption.textContent = 'general';
    projectSelect.appendChild(generalOption);
    projectSelect.value = 'general';
}

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

        async _populateSessionProjectSelect(projectSelect, selectedProject = 'general') {
            if (!projectSelect) return;

            try {
                const {
                    getSessionSelectableProjects,
                    getProjectsRequiringWorkspaceSetup,
                    getRuntimeProjectCatalogSource,
                    getRuntimeProjectCatalogStatusMessage,
                    projectMappingReady
                } = await import('../project-mapping.js');
                await projectMappingReady;
                const projects = getSessionSelectableProjects(this.authManager?.access?.projectCodes);

                projectSelect.innerHTML = '';

                const generalOption = document.createElement('option');
                generalOption.value = 'general';
                generalOption.textContent = 'general';
                projectSelect.appendChild(generalOption);

                projects.forEach((proj) => {
                    const option = document.createElement('option');
                    option.value = proj;
                    option.textContent = proj;
                    projectSelect.appendChild(option);
                });

                getProjectsRequiringWorkspaceSetup().forEach((proj) => {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = `${proj}（ワークスペース設定が必要）`;
                    option.disabled = true;
                    projectSelect.appendChild(option);
                });

                if (![...projectSelect.options].some((option) => option.value === selectedProject)) {
                    selectedProject = 'general';
                }
                projectSelect.value = selectedProject;
                renderProjectCatalogStatus(
                    projectSelect,
                    typeof getRuntimeProjectCatalogSource === 'function'
                        ? getRuntimeProjectCatalogSource()
                        : { status: 'unknown' },
                    getRuntimeProjectCatalogStatusMessage
                );
            } catch (error) {
                console.warn('[CreateSession] Failed to refresh inline project select:', error);
                // Do not preserve a stale or suppressed project when catalog
                // loading failed.  The only safe fallback is general.
                resetProjectSelectToGeneral(projectSelect);
                renderProjectCatalogStatus(projectSelect, { status: 'unavailable' });
            }
        },

        async _updateSessionDraftWorktreeAvailability(selectedProject, worktreeCheckbox, worktreeHint, worktreeLabel) {
            if (!worktreeCheckbox) return;

            if (selectedProject === 'general') {
                worktreeCheckbox.disabled = false;
                worktreeCheckbox.checked = true;
                if (worktreeHint) worktreeHint.textContent = 'ブランチを分離して安全に作業できます';
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

                if (worktreeHint) {
                    worktreeHint.textContent = hasGit
                        ? 'ブランチを分離して安全に作業できます'
                        : 'このプロジェクトにはGitリポジトリがないため、git worktreeを作成できません';
                }
                if (worktreeLabel) {
                    if (!hasGit) {
                        worktreeLabel.title = 'このプロジェクトにはGitリポジトリがないため、git worktreeを作成できません';
                        worktreeLabel.style.opacity = '0.5';
                    } else {
                        worktreeLabel.title = '';
                        worktreeLabel.style.opacity = '1';
                    }
                }

                console.log(`[CreateSession] Project ${selectedProject} hasGitRepository: ${hasGit}`);
            } catch (err) {
                console.warn('[CreateSession] Failed to check git repository:', err);
                worktreeCheckbox.disabled = false;
                worktreeCheckbox.checked = true;
                if (worktreeHint) worktreeHint.textContent = 'ブランチを分離して安全に作業できます';
            }
        },

        async openSessionLaunchPicker(project = 'general') {
            console.log('Opening session launch picker for project:', project);

            const picker = document.getElementById('session-launch-picker') || document.getElementById('inline-session-draft');
            const modal = document.getElementById('create-session-modal');
            const projectSelect = document.getElementById('session-launch-project-select') || document.getElementById('inline-session-project-select');
            const worktreeCheckbox = document.getElementById('session-launch-use-worktree-checkbox') || document.getElementById('inline-use-worktree-checkbox');
            const worktreeHint = document.getElementById('session-launch-worktree-hint') || document.getElementById('inline-worktree-hint');
            const worktreeLabel = document.getElementById('session-launch-worktree-label') || document.getElementById('inline-worktree-label');
            const startBtn = document.getElementById('session-launch-start') || document.getElementById('inline-session-create');
            const cancelButtons = [
                document.getElementById('session-launch-cancel'),
                document.getElementById('session-launch-discard'),
                document.getElementById('inline-session-cancel'),
                document.getElementById('inline-session-discard')
            ].filter(Boolean);

            if (!picker || !projectSelect || !startBtn) {
                console.error('Session launch picker elements not found');
                return;
            }

            modal?.classList.remove('active');
            this.hideTerminalLoadingOverlay?.();
            this.closeMobileSessionsSheet?.();
            this._teardownInlineSessionDraft?.();

            await this._populateSessionProjectSelect(projectSelect, project);
            await this._updateSessionDraftWorktreeAvailability(projectSelect.value || project, worktreeCheckbox, worktreeHint, worktreeLabel);

            const handleProjectChange = (e) => {
                this._updateSessionDraftWorktreeAvailability(e.target.value, worktreeCheckbox, worktreeHint, worktreeLabel);
            };
            projectSelect?.addEventListener('change', handleProjectChange);

            const closePicker = () => {
                picker.classList.add('hidden');
                this._teardownInlineSessionDraft?.();
            };

            const handleStart = async () => {
                const selectedProject = projectSelect?.value;
                const selectedOption = [...(projectSelect?.options || [])].find((option) => (
                    option.value === selectedProject && !option.disabled
                ));
                if (!selectedOption) {
                    renderProjectCatalogStatus(projectSelect, { status: 'unavailable' });
                    return;
                }
                const engine = document.querySelector('input[name="session-launch-engine"]:checked')?.value
                    || document.querySelector('input[name="inline-session-engine"]:checked')?.value
                    || 'claude';
                const useWorktree = worktreeCheckbox?.checked && !worktreeCheckbox.disabled;
                const name = `New ${selectedProject} Session`;

                closePicker();
                await this.createSession(selectedProject, name, '', useWorktree, engine);
            };

            startBtn.addEventListener('click', handleStart);
            cancelButtons.forEach((button) => button.addEventListener('click', closePicker));
            this._teardownInlineSessionDraft = () => {
                startBtn.removeEventListener('click', handleStart);
                projectSelect?.removeEventListener('change', handleProjectChange);
                cancelButtons.forEach((button) => button.removeEventListener('click', closePicker));
                this._teardownInlineSessionDraft = null;
            };

            picker.classList.remove('hidden');
            window.lucide?.createIcons?.();
            projectSelect.focus();
        },

        async openInlineSessionDraft(project = 'general') {
            return this.openSessionLaunchPicker(project);
        },

        /**
         * Backward-compatible entrypoint. The primary flow is the launch picker, not modal.
         * @param {string} project - Project name
         */
        openCreateSessionModal(project = 'general') {
            return this.openSessionLaunchPicker(project);
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
                    await eventBus.emit(EVENTS.SESSION_CHANGED, {
                        sessionId: result.sessionId,
                        previousSessionId,
                        proxyPath: result.proxyPath || null
                    });

                    if (useWorktree && !result.session?.codexAppServer?.threadId) {
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
                const detail = error?.message || '';
                const appServerMetadataFailed = engine === 'codex'
                    && /Codex App Server metadata was not persisted/i.test(detail);
                showError(appServerMetadataFailed
                    ? 'Codex App Serverの起動情報を確認できませんでした。セッションを作り直してください。'
                    : 'セッションの作成に失敗しました');
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
                    const hadQueuedPrompt = this._sessionStartupPromptQueue?.has(result.sessionId) === true;
                    if (hadQueuedPrompt) {
                        await this._flushSessionStartupPrompt(result.sessionId);
                    } else if (this._isSessionStartupComposerForSession(result.sessionId)) {
                        this._setSessionStartupPromptStatus('準備できました。送信すると実行します。', 'ready');
                    }
                    if (shouldPresentSession) {
                        await eventBus.emit(EVENTS.SESSION_CHANGED, {
                            sessionId: result.sessionId,
                            previousSessionId,
                            proxyPath: result.proxyPath || null
                        });
                    }
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
                    showError(/Codex App Server metadata was not persisted/i.test(message)
                        ? 'Codex App Serverの起動情報を確認できませんでした。設定を確認して再試行してください。'
                        : 'セッションの起動に失敗しました');
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
                        const hadQueuedPrompt = this._sessionStartupPromptQueue?.has(sessionId) === true;
                        if (hadQueuedPrompt) {
                            await this._flushSessionStartupPrompt(sessionId);
                        } else if (this._isSessionStartupComposerForSession(sessionId)) {
                            this._setSessionStartupPromptStatus('準備できました。送信すると実行します。', 'ready');
                        }
                        if (previousSessionId === sessionId) {
                            await eventBus.emit(EVENTS.SESSION_CHANGED, {
                                sessionId,
                                previousSessionId,
                                resumedStartup: true
                            });
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
            document.querySelector('.console-area')?.classList.toggle('terminal-startup-active', options.startup === true);
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
            document.querySelector('.console-area')?.classList.remove('terminal-startup-active');
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

            const queueCurrentPrompt = async () => {
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
                if (this._retryFailedSessionStartup?.(sessionId)) {
                    return;
                }
                if (this._isSessionStartupPromptReadyToSend(sessionId)) {
                    await this._flushSessionStartupPrompt(sessionId);
                    if (appStore.getState().currentSessionId === sessionId) {
                        await eventBus.emit(EVENTS.SESSION_CHANGED, {
                            sessionId,
                            previousSessionId: sessionId,
                            startupComposerSubmitted: true
                        });
                    }
                }
            };
            this._queueCurrentSessionStartupPrompt = queueCurrentPrompt;

            if (!this._sessionStartupComposerClickDelegated) {
                this._sessionStartupComposerClickDelegated = true;
                document.addEventListener('click', (event) => {
                    if (!event.target?.closest?.('#session-startup-prompt-send')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void this._queueCurrentSessionStartupPrompt?.();
                }, true);
            }

            input.oninput = () => {
                const sessionId = input.dataset.sessionId || appStore.getState().currentSessionId;
                if (!sessionId) return;
                this._sessionStartupPromptDrafts.set(sessionId, input.value);
                if (this._isSessionStartupPromptWaitingForStartup(sessionId)) {
                    if (!input.value.trim()) this._sessionStartupPromptQueue.delete(sessionId);
                    this._setSessionStartupPromptStatus(
                        input.value.trim()
                            ? '入力内容は保持されています。送信すると実行します。'
                            : '入力待ち',
                        'idle'
                    );
                    this._persistSessionStartupPromptState(sessionId);
                    return;
                }
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
                void queueCurrentPrompt();
            };
            sendBtn.onclick = (event) => {
                event?.preventDefault?.();
                void queueCurrentPrompt();
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
            this._updateSessionStartupComposerMeta(sessionId);
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
                    : (this._sessionStartupPromptQueue?.has(sessionId) ? '送信予約済み。準備完了後に実行します。' : '起動中。送信すると準備完了後に実行します。'),
                failed ? 'failed' : (this._sessionStartupPromptQueue?.has(sessionId) ? 'queued' : 'idle')
            );
            window.setTimeout(() => input.focus(), 0);
        },

        _updateSessionStartupComposerMeta(sessionId) {
            const projectChip = document.getElementById('session-startup-project-chip');
            const engineChip = document.getElementById('session-startup-engine-chip');
            const workspaceChip = document.getElementById('session-startup-workspace-chip');
            if (!projectChip && !engineChip && !workspaceChip) return;

            const session = this._getSessionStartupPromptSession?.(sessionId);
            const project = session?.project || 'general';
            const engine = session?.engine === 'codex' ? 'OpenAI Codex' : 'Claude Code';
            const workspace = session?.worktree || session?.startupStatus === 'pending' || session?.startupStatus === 'failed'
                ? 'git worktree'
                : 'main workspace';

            if (projectChip) projectChip.textContent = project;
            if (engineChip) engineChip.textContent = engine;
            if (workspaceChip) workspaceChip.textContent = workspace;
        },

        hideSessionStartupComposer() {
            const composer = document.getElementById('session-startup-composer');
            if (composer) composer.classList.add('hidden');
        },

        _setSessionStartupPromptStatus(text, state = 'idle') {
            const status = document.getElementById('session-startup-prompt-status');
            const sendBtn = document.getElementById('session-startup-prompt-send');
            const overlay = document.getElementById('terminal-loading-overlay');
            overlay?.classList.toggle('startup-composer-ready', state === 'ready');
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
            this._sessionStartupPromptFlushing = this._sessionStartupPromptFlushing || new Set();
            if (this._sessionStartupPromptFlushing.has(sessionId)) {
                return;
            }
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

            this._sessionStartupPromptFlushing.add(sessionId);
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
            } finally {
                this._sessionStartupPromptFlushing.delete(sessionId);
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

        _getSessionStartupPromptSession(sessionId) {
            if (!sessionId) return null;
            return (appStore.getState().sessions || []).find((entry) => entry.id === sessionId) || null;
        },

        _isSessionStartupPromptWaitingForStartup(sessionId) {
            const session = this._getSessionStartupPromptSession(sessionId);
            return session?.startupStatus === 'pending'
                || this._sessionStartupInFlight?.has(sessionId) === true;
        },

        _isSessionStartupPromptReadyToSend(sessionId) {
            const session = this._getSessionStartupPromptSession(sessionId);
            return Boolean(session)
                && this._sessionStartupInFlight?.has(sessionId) !== true
                && session.startupStatus !== 'pending'
                && session.startupStatus !== 'failed';
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
