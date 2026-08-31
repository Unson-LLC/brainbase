import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn()
    }
}));

vi.mock('../../public/modules/project-mapping.js', () => ({
    projectMappingReady: Promise.resolve(),
    getSessionSelectableProjects: vi.fn(() => ['brainbase', 'aitle', 'no-repo']),
    getProjectsRequiringWorkspaceSetup: vi.fn(() => []),
    getRuntimeProjectCatalogSource: vi.fn(() => ({ status: 'loaded' })),
    getRuntimeProjectCatalogStatusMessage: vi.fn((source) => (
        source.status === 'loaded'
            ? '権限のあるプロジェクト一覧を読み込みました。'
            : 'プロジェクト一覧を取得できません。generalのみ選択できます。'
    )),
    hasGitRepository: vi.fn((project) => project !== 'no-repo')
}));

import { httpClient } from '../../public/modules/core/http-client.js';
import { appStore } from '../../public/modules/core/store.js';
import { applySessionCreationMixin } from '../../public/modules/app/session-creation-mixin.js';
import {
    getSessionSelectableProjects,
    getProjectsRequiringWorkspaceSetup,
    getRuntimeProjectCatalogSource,
    getRuntimeProjectCatalogStatusMessage
} from '../../public/modules/project-mapping.js';

function installMemoryLocalStorage() {
    const values = new Map();
    const storage = {
        clear: () => values.clear(),
        getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(String(key)),
        setItem: (key, value) => values.set(String(key), String(value)),
        get length() { return values.size; }
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}

describe('applySessionCreationMixin', () => {
    beforeEach(() => {
        if (!window.localStorage?.clear) installMemoryLocalStorage();
        document.body.innerHTML = `
            <span id="app-version"></span>
            <span id="mobile-app-version"></span>
        `;
        window.localStorage.clear();
        vi.clearAllMocks();
        getSessionSelectableProjects.mockReturnValue(['brainbase', 'aitle', 'no-repo']);
        getProjectsRequiringWorkspaceSetup.mockReturnValue([]);
        getRuntimeProjectCatalogSource.mockReturnValue({ status: 'loaded' });
        getRuntimeProjectCatalogStatusMessage.mockImplementation((source) => (
            source.status === 'loaded'
                ? '権限のあるプロジェクト一覧を読み込みました。'
                : 'プロジェクト一覧を取得できません。generalのみ選択できます。'
        ));
    });

    it('updateAppVersionDisplay呼び出し時_表示は短いversionだけにして詳細はtitleへ退避する', async () => {
        httpClient.get.mockResolvedValue({
            version: 'v0.3.18',
            runtime: {
                git: { sha: 'bc8e3c37', branch: 'develop' },
                cwd: '/workspace/brainbase',
                pid: 13610
            }
        });
        class App {}
        applySessionCreationMixin(App);

        await new App().updateAppVersionDisplay();

        const desktop = document.getElementById('app-version');
        const mobile = document.getElementById('mobile-app-version');
        expect(desktop.textContent).toBe('v0.3.18');
        expect(mobile.textContent).toBe('v0.3.18');
        expect(desktop.textContent).not.toContain('bc8e3c37');
        expect(desktop.dataset.gitSha).toBe('bc8e3c37');
        expect(desktop.title).toContain('commit: bc8e3c37');
        expect(desktop.title).toContain('branch: develop');
    });

    it('openSessionLaunchPicker呼び出し時_create-session-modalを開かず起動設定だけ表示する', async () => {
        document.body.innerHTML = `
            <div class="console-area"></div>
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden"></div>
            <div id="create-session-modal" class="modal"></div>
            <div id="session-launch-picker" class="session-launch-picker hidden">
                <select id="session-launch-project-select"></select>
                <input type="checkbox" id="session-launch-use-worktree-checkbox">
                <label id="session-launch-worktree-label"></label>
                <p id="session-launch-worktree-hint"></p>
                <input type="radio" name="session-launch-engine" value="claude" checked>
                <input type="radio" name="session-launch-engine" value="codex">
                <button id="session-launch-start" type="button"></button>
                <button id="session-launch-cancel" type="button"></button>
                <button id="session-launch-discard" type="button"></button>
            </div>
        `;
        const createSession = vi.fn();
        class App {
            constructor() {
                this.createSession = createSession;
            }
            closeMobileSessionsSheet() {}
        }
        applySessionCreationMixin(App);

        await new App().openSessionLaunchPicker('brainbase');

        expect(document.getElementById('create-session-modal').classList.contains('active')).toBe(false);
        expect(document.getElementById('session-launch-picker').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('session-launch-project-select').value).toBe('brainbase');
        expect(document.getElementById('session-launch-use-worktree-checkbox').checked).toBe(true);
        expect(createSession).not.toHaveBeenCalled();
    });

    it('local.path未設定projectはdisabled optionとしてワークスペース設定が必要と表示する', async () => {
        document.body.innerHTML = '<select id="session-launch-project-select"></select>';
        getProjectsRequiringWorkspaceSetup.mockReturnValue(['registry-same-id']);

        class App {}
        applySessionCreationMixin(App);

        const projectSelect = document.getElementById('session-launch-project-select');
        await new App()._populateSessionProjectSelect(projectSelect, 'registry-same-id');

        const blockedOption = [...projectSelect.options].find((option) => option.value === '' && option.textContent.includes('registry-same-id'));
        expect(blockedOption).toBeDefined();
        expect(blockedOption.disabled).toBe(true);
        expect(blockedOption.textContent).toBe('registry-same-id（ワークスペース設定が必要）');
        expect(projectSelect.value).toBe('general');
        expect(document.getElementById('session-launch-project-catalog-status').textContent)
            .toBe('権限のあるプロジェクト一覧を読み込みました。');
    });

    it('runtime catalog取得失敗時は状態を表示し、抑止されたprojectをstart payloadへ渡さない', async () => {
        document.body.innerHTML = `
            <div id="session-launch-picker" class="session-launch-picker hidden">
                <select id="session-launch-project-select"></select>
                <input type="checkbox" id="session-launch-use-worktree-checkbox">
                <label id="session-launch-worktree-label"></label>
                <p id="session-launch-worktree-hint"></p>
                <button id="session-launch-start" type="button"></button>
            </div>
        `;
        getSessionSelectableProjects.mockReturnValue([]);
        getProjectsRequiringWorkspaceSetup.mockReturnValue([]);
        getRuntimeProjectCatalogSource.mockReturnValue({ status: 'request_failed', http_status: 503 });
        getRuntimeProjectCatalogStatusMessage.mockImplementation((source) => (
            `プロジェクト一覧を取得できません（HTTP ${source.http_status}）。generalのみ選択できます。`
        ));
        const createSession = vi.fn();
        class App {
            constructor() {
                this.createSession = createSession;
            }
            closeMobileSessionsSheet() {}
        }
        applySessionCreationMixin(App);

        const app = new App();
        await app.openSessionLaunchPicker('suppressed-project');

        const status = document.getElementById('session-launch-project-catalog-status');
        expect(status.hidden).toBe(false);
        expect(status.getAttribute('role')).toBe('alert');
        expect(status.dataset.status).toBe('request_failed');
        expect(status.textContent).toContain('HTTP 503');
        expect(document.getElementById('session-launch-project-select').value).toBe('general');

        const suppressedOption = document.createElement('option');
        suppressedOption.value = 'suppressed-project';
        suppressedOption.textContent = 'suppressed-project';
        suppressedOption.disabled = true;
        document.getElementById('session-launch-project-select').appendChild(suppressedOption);
        document.getElementById('session-launch-project-select').value = 'suppressed-project';
        document.getElementById('session-launch-start').click();
        await Promise.resolve();

        expect(createSession).not.toHaveBeenCalled();
    });

    it('Session Launch Picker cancel時_セッション作成や状態永続化を実行しない', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden"></div>
            <div id="create-session-modal" class="modal"></div>
            <div id="session-launch-picker" class="session-launch-picker hidden">
                <select id="session-launch-project-select"></select>
                <input type="checkbox" id="session-launch-use-worktree-checkbox">
                <label id="session-launch-worktree-label"></label>
                <p id="session-launch-worktree-hint"></p>
                <input type="radio" name="session-launch-engine" value="claude" checked>
                <button id="session-launch-start" type="button"></button>
                <button id="session-launch-cancel" type="button"></button>
                <button id="session-launch-discard" type="button"></button>
            </div>
        `;
        const existingSessions = [{ id: 'existing-session', name: 'Existing Session' }];
        appStore.setState({ currentSessionId: 'existing-session', sessions: existingSessions });
        const createSession = vi.fn();
        class App {
            constructor() {
                this.createSession = createSession;
            }
            closeMobileSessionsSheet() {}
        }
        applySessionCreationMixin(App);

        await new App().openSessionLaunchPicker('brainbase');
        document.getElementById('session-launch-cancel').click();

        expect(document.getElementById('session-launch-picker').classList.contains('hidden')).toBe(true);
        expect(createSession).not.toHaveBeenCalled();
        expect(appStore.getState().currentSessionId).toBe('existing-session');
        expect(appStore.getState().sessions).toEqual(existingSessions);
        expect(window.localStorage.length).toBe(0);
    });

    it('Session Launch Pickerでworkspaceを外して開始時_通常セッション作成経路へ渡す', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden"></div>
            <div id="create-session-modal" class="modal"></div>
            <div id="session-launch-picker" class="session-launch-picker hidden">
                <select id="session-launch-project-select"></select>
                <input type="checkbox" id="session-launch-use-worktree-checkbox">
                <label id="session-launch-worktree-label"></label>
                <p id="session-launch-worktree-hint"></p>
                <input type="radio" name="session-launch-engine" value="claude" checked>
                <input type="radio" name="session-launch-engine" value="codex">
                <button id="session-launch-start" type="button"></button>
                <button id="session-launch-cancel" type="button"></button>
                <button id="session-launch-discard" type="button"></button>
            </div>
        `;
        const createSession = vi.fn(async () => ({ sessionId: 'regular-session' }));
        class App {
            constructor() {
                this.createSession = createSession;
            }
            closeMobileSessionsSheet() {}
        }
        applySessionCreationMixin(App);

        await new App().openSessionLaunchPicker('brainbase');
        document.getElementById('session-launch-use-worktree-checkbox').checked = false;
        document.getElementById('session-launch-start').click();

        await vi.waitFor(() => {
            expect(createSession).toHaveBeenCalledWith(
                'brainbase',
                'New brainbase Session',
                '',
                false,
                'claude'
            );
        });
    });

    it('Session Launch Picker開始時_起動設定だけを既存createSession経路へ渡す', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden"></div>
            <div id="create-session-modal" class="modal active"></div>
            <div id="session-launch-picker" class="session-launch-picker hidden">
                <select id="session-launch-project-select"></select>
                <input type="checkbox" id="session-launch-use-worktree-checkbox">
                <label id="session-launch-worktree-label"></label>
                <p id="session-launch-worktree-hint"></p>
                <input type="radio" name="session-launch-engine" value="claude">
                <input type="radio" name="session-launch-engine" value="codex" checked>
                <button id="session-launch-start" type="button"></button>
                <button id="session-launch-cancel" type="button"></button>
                <button id="session-launch-discard" type="button"></button>
            </div>
        `;
        const createSession = vi.fn(async () => ({ sessionId: 'session-created' }));
        class App {
            constructor() {
                this.createSession = createSession;
            }
            closeMobileSessionsSheet() {}
        }
        applySessionCreationMixin(App);

        await new App().openSessionLaunchPicker('aitle');
        document.getElementById('session-launch-start').click();

        await vi.waitFor(() => {
            expect(createSession).toHaveBeenCalledWith('aitle', 'New aitle Session', '', true, 'codex');
        });
        expect(document.getElementById('session-launch-picker').classList.contains('hidden')).toBe(true);
        expect(document.getElementById('create-session-modal').classList.contains('active')).toBe(false);
    });

    it('Session Launch Pickerでリポジトリなしproject選択時_workspaceを無効化して理由を表示する', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden"></div>
            <div id="create-session-modal" class="modal"></div>
            <div id="session-launch-picker" class="session-launch-picker hidden">
                <select id="session-launch-project-select"></select>
                <input type="checkbox" id="session-launch-use-worktree-checkbox">
                <label id="session-launch-worktree-label"></label>
                <p id="session-launch-worktree-hint"></p>
                <input type="radio" name="session-launch-engine" value="claude" checked>
                <button id="session-launch-start" type="button"></button>
                <button id="session-launch-cancel" type="button"></button>
                <button id="session-launch-discard" type="button"></button>
            </div>
        `;
        class App {
            closeMobileSessionsSheet() {}
            createSession() {}
        }
        applySessionCreationMixin(App);

        await new App().openSessionLaunchPicker('no-repo');

        const checkbox = document.getElementById('session-launch-use-worktree-checkbox');
        expect(checkbox.disabled).toBe(true);
        expect(checkbox.checked).toBe(false);
        expect(document.getElementById('session-launch-worktree-hint').textContent).toContain('Gitリポジトリがない');
    });

    it('worktree session creation shows a pending shell before startup completes', async () => {
        document.body.innerHTML = `
            <div class="console-area">
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
            </div>
        `;
        appStore.setState({ currentSessionId: 'previous-session', sessions: [] });
        let resolveStartup;
        const startupPromise = new Promise((resolve) => {
            resolveStartup = resolve;
        });
        const sessionService = {
            createPendingSessionShell: vi.fn(async () => ({
                sessionId: 'session-shell',
                session: { id: 'session-shell', name: 'Shell Session', startupStatus: 'pending' }
            })),
            createSession: vi.fn(() => startupPromise),
            getProgress: vi.fn(async () => ({ phase: 'done', percent: 100, message: '完了' })),
            markSessionStartupFailed: vi.fn()
        };
        const terminalInteractionService = { sendInput: vi.fn(async () => {}) };
        let createdSessionId;
        sessionService.createPendingSessionShell.mockImplementation(async ({ sessionId }) => {
            createdSessionId = sessionId;
            return {
                sessionId,
                session: { id: sessionId, name: 'Shell Session', startupStatus: 'pending' }
            };
        });
        class App {
            constructor() {
                this.sessionService = sessionService;
                this.terminalInteractionService = terminalInteractionService;
            }
            closeMobileSessionsSheet() {}
            showError() {}
        }
        applySessionCreationMixin(App);

        const app = new App();
        const result = await app.createSession('brainbase', 'Shell Session', 'first prompt', true, 'codex');

        expect(result).toEqual({ sessionId: createdSessionId, pending: true });
        expect(sessionService.createPendingSessionShell).toHaveBeenCalledWith(expect.objectContaining({
            project: 'brainbase',
            name: 'Shell Session',
            engine: 'codex'
        }));
        expect(sessionService.createSession).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: createdSessionId,
            initialCommand: 'first prompt',
            useWorktree: true,
            allowRegularFallback: false
        }));
        expect(document.getElementById('terminal-loading-overlay').classList.contains('hidden')).toBe(false);
        expect(document.querySelector('.console-area').classList.contains('terminal-startup-active')).toBe(true);
        expect(document.getElementById('session-startup-composer').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('session-startup-prompt-input').value).toBe('first prompt');
        expect(terminalInteractionService.sendInput).not.toHaveBeenCalled();

        resolveStartup({ sessionId: createdSessionId, proxyPath: '/console/session-shell' });
        await vi.waitFor(() => {
            expect(sessionService.createSession).toHaveBeenCalledTimes(1);
        });
        expect(terminalInteractionService.sendInput).not.toHaveBeenCalled();
    });

    it('startup composer draft typed during pending startup stays visible until send', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        appStore.setState({ currentSessionId: 'previous-session', sessions: [] });
        let resolveStartup;
        const startupPromise = new Promise((resolve) => {
            resolveStartup = resolve;
        });
        const sessionService = {
            createPendingSessionShell: vi.fn(async ({ sessionId }) => {
                appStore.setState({
                    currentSessionId: sessionId,
                    sessions: [{
                        id: sessionId,
                        name: 'Draft Shell',
                        project: 'brainbase',
                        engine: 'codex',
                        startupStatus: 'pending'
                    }]
                });
                return {
                    sessionId,
                    session: { id: sessionId, name: 'Draft Shell', startupStatus: 'pending' }
                };
            }),
            createSession: vi.fn(async ({ sessionId }) => {
                const result = await startupPromise;
                appStore.setState({
                    currentSessionId: sessionId,
                    sessions: [{
                        id: sessionId,
                        name: 'Draft Shell',
                        project: 'brainbase',
                        engine: 'codex',
                        startupStatus: 'ready'
                    }]
                });
                return result;
            }),
            getProgress: vi.fn(async () => ({ phase: 'worktree', percent: 50, message: '起動中' })),
            markSessionStartupFailed: vi.fn()
        };
        const terminalInteractionService = { sendInput: vi.fn(async () => {}) };
        class App {
            constructor() {
                this.sessionService = sessionService;
                this.terminalInteractionService = terminalInteractionService;
            }
            closeMobileSessionsSheet() {}
            showError() {}
        }
        applySessionCreationMixin(App);

        const app = new App();
        const result = await app.createSession('brainbase', 'Draft Shell', '', true, 'codex');
        const input = document.getElementById('session-startup-prompt-input');
        input.value = 'draft only';
        input.dispatchEvent(new Event('input'));
        expect(app._sessionStartupPromptDrafts.get(result.sessionId)).toBe('draft only');
        expect(app._sessionStartupPromptQueue.has(result.sessionId)).toBe(false);
        expect(document.getElementById('terminal-loading-overlay').classList.contains('startup-composer-ready')).toBe(false);

        resolveStartup({ sessionId: result.sessionId, proxyPath: `/console/${result.sessionId}` });
        await vi.waitFor(() => expect(app._sessionStartupInFlight.has(result.sessionId)).toBe(false));
        expect(terminalInteractionService.sendInput).not.toHaveBeenCalled();
        expect(document.getElementById('session-startup-composer').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('session-startup-prompt-status').textContent).toContain('準備できました');
        expect(document.getElementById('terminal-loading-overlay').classList.contains('startup-composer-ready')).toBe(true);

        document.getElementById('session-startup-prompt-send').click();
        await vi.waitFor(() => {
            expect(terminalInteractionService.sendInput).toHaveBeenCalledWith(result.sessionId, 'draft only');
        });
    });

    it('startup composer submit sends immediately when session is already ready', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        appStore.setState({
            currentSessionId: 'session-ready',
            sessions: [{
                id: 'session-ready',
                name: 'Ready Shell',
                project: 'brainbase',
                engine: 'codex',
                startupStatus: 'ready'
            }]
        });
        const terminalInteractionService = { sendInput: vi.fn(async () => {}) };
        class App {
            constructor() {
                this.terminalInteractionService = terminalInteractionService;
            }
        }
        applySessionCreationMixin(App);

        const app = new App();
        app.showSessionStartupComposer('session-ready');
        const input = document.getElementById('session-startup-prompt-input');
        input.value = 'send now';
        input.dispatchEvent(new Event('input'));
        document.getElementById('session-startup-prompt-send').click();

        await vi.waitFor(() => {
            expect(terminalInteractionService.sendInput).toHaveBeenCalledWith('session-ready', 'send now');
        });
        expect(app._sessionStartupPromptQueue.has('session-ready')).toBe(false);
    });

    it('startup composer flush sends a queued prompt only once when called concurrently', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        let releaseSend;
        const sendStarted = new Promise((resolve) => {
            const sendReleased = new Promise((release) => {
                releaseSend = release;
            });
            resolve(sendReleased);
        });
        const terminalInteractionService = {
            sendInput: vi.fn(async () => await sendStarted)
        };
        class App {
            constructor() {
                this.terminalInteractionService = terminalInteractionService;
            }
        }
        applySessionCreationMixin(App);

        const app = new App();
        app._sessionStartupPromptDrafts = new Map([['session-ready', 'send once']]);
        app._sessionStartupPromptQueue = new Map([['session-ready', 'send once']]);
        const firstFlush = app._flushSessionStartupPrompt('session-ready');
        const secondFlush = app._flushSessionStartupPrompt('session-ready');
        releaseSend();
        await Promise.all([firstFlush, secondFlush]);

        expect(terminalInteractionService.sendInput).toHaveBeenCalledTimes(1);
        expect(terminalInteractionService.sendInput).toHaveBeenCalledWith('session-ready', 'send once');
    });

    it('startup failure keeps the prompt retryable and restarts startup on send', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        appStore.setState({ currentSessionId: 'previous-session', sessions: [] });
        let createAttempts = 0;
        const sessionService = {
            createPendingSessionShell: vi.fn(async ({ sessionId }) => ({
                sessionId,
                session: { id: sessionId, name: 'Failed Shell', startupStatus: 'pending' }
            })),
            createSession: vi.fn(async ({ sessionId }) => {
                createAttempts += 1;
                if (createAttempts === 1) {
                    throw new Error('startup failed');
                }
                return { sessionId, proxyPath: `/console/${sessionId}` };
            }),
            getProgress: vi.fn(async () => ({ phase: 'error', percent: 0, message: '失敗' })),
            markSessionStartupFailed: vi.fn(async (sessionId, message) => {
                const sessions = appStore.getState().sessions || [];
                appStore.setState({
                    sessions: sessions.map((session) =>
                        session.id === sessionId
                            ? { ...session, startupStatus: 'failed', startupMessage: message }
                            : session
                    )
                });
            })
        };
        class App {
            constructor() {
                this.sessionService = sessionService;
                this.terminalInteractionService = { sendInput: vi.fn(async () => {}) };
            }
            closeMobileSessionsSheet() {}
            showError() {}
        }
        applySessionCreationMixin(App);

        const app = new App();
        const result = await app.createSession('brainbase', 'Failed Shell', 'retry prompt', true, 'codex');

        await vi.waitFor(() => {
            expect(sessionService.markSessionStartupFailed).toHaveBeenCalledWith(result.sessionId, 'startup failed');
        });
        const input = document.getElementById('session-startup-prompt-input');
        const sendBtn = document.getElementById('session-startup-prompt-send');
        expect(input.value).toBe('retry prompt');
        expect(sendBtn.disabled).toBe(false);

        input.value = 'updated retry prompt';
        sendBtn.click();
        expect(app._sessionStartupPromptQueue.get(result.sessionId)).toBe('updated retry prompt');
        input.value = 'latest visible retry prompt';
        await vi.waitFor(() => {
            expect(sessionService.createSession).toHaveBeenCalledTimes(2);
        });
        await vi.waitFor(() => {
            expect(app.terminalInteractionService.sendInput).toHaveBeenCalledWith(result.sessionId, 'latest visible retry prompt');
        });
    });

    it('queues retry clicks that happen before the failed startup request settles', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        appStore.setState({ currentSessionId: 'previous-session', sessions: [] });
        let rejectFirstStartup;
        const firstStartup = new Promise((_, reject) => {
            rejectFirstStartup = reject;
        });
        const sessionService = {
            createPendingSessionShell: vi.fn(async ({ sessionId }) => ({
                sessionId,
                session: {
                    id: sessionId,
                    name: 'Racy Failed Shell',
                    project: 'brainbase',
                    engine: 'codex',
                    startupStatus: 'pending'
                }
            })),
            createSession: vi
                .fn()
                .mockImplementationOnce(() => firstStartup)
                .mockImplementationOnce(async ({ sessionId }) => ({ sessionId, proxyPath: `/console/${sessionId}` })),
            getProgress: vi.fn(async () => ({ phase: 'error', percent: 0, message: '失敗' })),
            markSessionStartupFailed: vi.fn(async (sessionId, message) => {
                const sessions = appStore.getState().sessions || [];
                appStore.setState({
                    sessions: sessions.map((session) =>
                        session.id === sessionId
                            ? { ...session, startupStatus: 'failed', startupMessage: message }
                            : session
                    )
                });
            })
        };
        class App {
            constructor() {
                this.sessionService = sessionService;
                this.terminalInteractionService = { sendInput: vi.fn(async () => {}) };
            }
            closeMobileSessionsSheet() {}
            showError() {}
        }
        applySessionCreationMixin(App);

        const app = new App();
        const result = await app.createSession('brainbase', 'Racy Failed Shell', 'retry prompt', true, 'codex');
        appStore.setState({
            sessions: [{
                id: result.sessionId,
                name: 'Racy Failed Shell',
                project: 'brainbase',
                engine: 'codex',
                startupStatus: 'failed',
                startupMessage: 'startup failed'
            }]
        });

        const input = document.getElementById('session-startup-prompt-input');
        input.value = 'retry while settling';
        document.getElementById('session-startup-prompt-send').click();
        expect(sessionService.createSession).toHaveBeenCalledTimes(1);

        rejectFirstStartup(new Error('startup failed'));

        await vi.waitFor(() => {
            expect(sessionService.createSession).toHaveBeenCalledTimes(2);
        });
        await vi.waitFor(() => {
            expect(app.terminalInteractionService.sendInput).toHaveBeenCalledWith(result.sessionId, 'retry while settling');
        });
    });

    it('startup failure can be retried even when prompt is empty', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        appStore.setState({ currentSessionId: 'previous-session', sessions: [] });
        let createAttempts = 0;
        const sessionService = {
            createPendingSessionShell: vi.fn(async ({ sessionId }) => ({
                sessionId,
                session: { id: sessionId, name: 'Empty Retry Shell', startupStatus: 'pending' }
            })),
            createSession: vi.fn(async ({ sessionId }) => {
                createAttempts += 1;
                if (createAttempts === 1) {
                    throw new Error('startup failed');
                }
                return { sessionId, proxyPath: `/console/${sessionId}` };
            }),
            getProgress: vi.fn(async () => ({ phase: 'error', percent: 0, message: '失敗' })),
            markSessionStartupFailed: vi.fn(async (sessionId, message) => {
                const sessions = appStore.getState().sessions || [];
                appStore.setState({
                    sessions: sessions.map((session) =>
                        session.id === sessionId
                            ? { ...session, startupStatus: 'failed', startupMessage: message }
                            : session
                    )
                });
            })
        };
        class App {
            constructor() {
                this.sessionService = sessionService;
                this.terminalInteractionService = { sendInput: vi.fn(async () => {}) };
            }
            closeMobileSessionsSheet() {}
            showError() {}
        }
        applySessionCreationMixin(App);

        const app = new App();
        const result = await app.createSession('brainbase', 'Empty Retry Shell', '', true, 'codex');

        await vi.waitFor(() => {
            expect(sessionService.markSessionStartupFailed).toHaveBeenCalledWith(result.sessionId, 'startup failed');
        });
        document.getElementById('session-startup-prompt-send').click();

        await vi.waitFor(() => {
            expect(sessionService.createSession).toHaveBeenCalledTimes(2);
        });
        expect(app.terminalInteractionService.sendInput).not.toHaveBeenCalled();
    });

    it('background startup completion does not steal the current session after the user switches away', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        appStore.setState({ currentSessionId: 'previous-session', sessions: [] });
        let resolveStartup;
        const startupPromise = new Promise((resolve) => {
            resolveStartup = resolve;
        });
        const sessionService = {
            createPendingSessionShell: vi.fn(async ({ sessionId }) => ({
                sessionId,
                session: { id: sessionId, name: 'Background Shell', startupStatus: 'pending' }
            })),
            createSession: vi.fn(() => startupPromise),
            getProgress: vi.fn(async () => ({ phase: 'worktree', percent: 50, message: '起動中' })),
            markSessionStartupFailed: vi.fn()
        };
        const terminalInteractionService = { sendInput: vi.fn(async () => {}) };
        class App {
            constructor() {
                this.sessionService = sessionService;
                this.terminalInteractionService = terminalInteractionService;
            }
            closeMobileSessionsSheet() {}
            showError() {}
        }
        applySessionCreationMixin(App);

        const app = new App();
        const result = await app.createSession('brainbase', 'Background Shell', 'queued prompt', true, 'codex');
        appStore.setState({
            currentSessionId: 'other-session',
            sessions: [
                { id: result.sessionId, name: 'Background Shell', startupStatus: 'pending' },
                { id: 'other-session', name: 'Other Session' }
            ]
        });

        resolveStartup({ sessionId: result.sessionId, proxyPath: `/console/${result.sessionId}` });
        await vi.waitFor(() => {
            expect(sessionService.createSession).toHaveBeenCalledWith(expect.objectContaining({
                sessionId: result.sessionId,
                initialCommand: 'queued prompt'
            }));
        });
        expect(terminalInteractionService.sendInput).not.toHaveBeenCalled();
        expect(appStore.getState().currentSessionId).toBe('other-session');
    });

    it('resuming a persisted pending startup shell does not create the worktree again', () => {
        window.localStorage.setItem('brainbase:session-startup-prompt:session-pending', JSON.stringify({
            draft: 'persisted draft',
            prompt: 'persisted draft',
            queued: true
        }));
        const sessionService = {
            createSession: vi.fn(),
            getProgress: vi.fn()
        };
        class App {
            constructor() {
                this.sessionService = sessionService;
            }
        }
        applySessionCreationMixin(App);

        const app = new App();
        app._pollProgress = vi.fn();
        const resumed = app._resumePendingSessionStartup({
            id: 'session-pending',
            name: 'Pending Shell',
            project: 'brainbase',
            engine: 'codex',
            startupStatus: 'pending'
        });

        expect(resumed).toBe(true);
        expect(sessionService.createSession).not.toHaveBeenCalled();
        expect(app._pollProgress).toHaveBeenCalledWith('session-pending');
        expect(app._sessionStartupPromptDrafts.get('session-pending')).toBe('persisted draft');
        expect(app._sessionStartupPromptQueue.get('session-pending')).toBe('persisted draft');
    });

    it('resumed pending startup marks the shell failed when no startup job finishes', async () => {
        appStore.setState({
            currentSessionId: 'other-session',
            sessions: [{
                id: 'session-abandoned',
                name: 'Abandoned Shell',
                project: 'brainbase',
                startupStatus: 'pending'
            }]
        });
        const sessionService = {
            createSession: vi.fn(),
            getProgress: vi.fn(),
            loadSessions: vi.fn(async () => appStore.getState().sessions),
            markSessionStartupFailed: vi.fn()
        };
        class App {
            constructor() {
                this.sessionService = sessionService;
            }
        }
        applySessionCreationMixin(App);

        const app = new App();
        app._pollProgress = vi.fn();
        app._sessionStartupResumeTimeoutMs = -1;
        app._sessionStartupResumePollIntervalMs = 0;
        const resumed = app._resumePendingSessionStartup({
            id: 'session-abandoned',
            name: 'Abandoned Shell',
            project: 'brainbase',
            engine: 'codex',
            startupStatus: 'pending'
        });

        expect(resumed).toBe(true);
        await vi.waitFor(() => {
            expect(sessionService.markSessionStartupFailed).toHaveBeenCalledWith(
                'session-abandoned',
                'セッション起動が中断されました。再試行してください。'
            );
        });
        expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('resumed pending startup flushes a restored queued prompt when the session becomes ready', async () => {
        document.body.innerHTML = `
            <div id="terminal-loading-overlay" class="terminal-loading-overlay hidden">
                <div class="loading-content">
                    <div class="loading-message"></div>
                    <div class="loading-hint"></div>
                    <div id="session-startup-composer" class="session-startup-composer hidden">
                        <textarea id="session-startup-prompt-input"></textarea>
                        <span id="session-startup-prompt-status"></span>
                        <button id="session-startup-prompt-send" type="button"></button>
                    </div>
                </div>
            </div>
        `;
        window.localStorage.setItem('brainbase:session-startup-prompt:session-resumed', JSON.stringify({
            draft: 'restored queued prompt',
            prompt: 'restored queued prompt',
            queued: true
        }));
        appStore.setState({
            currentSessionId: 'session-resumed',
            sessions: [{
                id: 'session-resumed',
                name: 'Resumed Shell',
                project: 'brainbase',
                startupStatus: 'pending'
            }]
        });
        const readySession = {
            id: 'session-resumed',
            name: 'Resumed Shell',
            project: 'brainbase',
            startupStatus: 'ready',
            startupPhase: 'done'
        };
        const sessionService = {
            createSession: vi.fn(),
            getProgress: vi.fn(),
            loadSessions: vi.fn(async () => {
                appStore.setState({ sessions: [readySession] });
                return [readySession];
            })
        };
        const terminalInteractionService = { sendInput: vi.fn(async () => {}) };
        class App {
            constructor() {
                this.sessionService = sessionService;
                this.terminalInteractionService = terminalInteractionService;
            }
        }
        applySessionCreationMixin(App);

        const app = new App();
        app._pollProgress = vi.fn();
        const resumed = app._resumePendingSessionStartup({
            id: 'session-resumed',
            name: 'Resumed Shell',
            project: 'brainbase',
            engine: 'codex',
            startupStatus: 'pending'
        });

        expect(resumed).toBe(true);
        expect(sessionService.createSession).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(terminalInteractionService.sendInput).toHaveBeenCalledWith('session-resumed', 'restored queued prompt');
        });
        expect(window.localStorage.getItem('brainbase:session-startup-prompt:session-resumed')).toBeNull();
    });

    it('startup composer persists queued prompt across a browser refresh', () => {
        const renderComposer = () => {
            document.body.innerHTML = `
                <div id="session-startup-composer" class="session-startup-composer hidden">
                    <textarea id="session-startup-prompt-input"></textarea>
                    <span id="session-startup-prompt-status"></span>
                    <button id="session-startup-prompt-send" type="button"></button>
                </div>
            `;
        };
        class App {}
        applySessionCreationMixin(App);

        renderComposer();
        appStore.setState({ currentSessionId: 'session-persisted', sessions: [] });
        const firstApp = new App();
        firstApp.showSessionStartupComposer('session-persisted');
        const firstInput = document.getElementById('session-startup-prompt-input');
        firstInput.value = 'queued after refresh';
        firstInput.dispatchEvent(new Event('input'));
        document.getElementById('session-startup-prompt-send').click();

        const stored = JSON.parse(window.localStorage.getItem('brainbase:session-startup-prompt:session-persisted'));
        expect(stored).toMatchObject({
            draft: 'queued after refresh',
            prompt: 'queued after refresh',
            queued: true
        });

        renderComposer();
        const refreshedApp = new App();
        refreshedApp.showSessionStartupComposer('session-persisted');

        expect(document.getElementById('session-startup-prompt-input').value).toBe('queued after refresh');
        expect(document.getElementById('session-startup-prompt-send').textContent).toBe('送信予約中');
        expect(document.getElementById('session-startup-prompt-status').dataset.state).toBe('queued');
    });
});
