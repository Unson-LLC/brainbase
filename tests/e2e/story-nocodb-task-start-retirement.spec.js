import { expect, test } from '@playwright/test';

const migrationNotice = '新しいタスクはCodexアプリから作成してください。Brainbaseのセッション作成は廃止されました。';

async function fulfillJson(route, body) {
    await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(body)
    });
}

async function mountNocoDbTaskStartFixture(page, { withFocusEngineModal = true } = {}) {
    await page.route((url) => new URL(url).pathname === '/api/config', (route) => fulfillJson(route, {
        projects: {
            root: '/workspace',
            projects: [{
                id: 'growin',
                local: { path: 'projects/growin' },
                session_select: true
            }]
        }
    }));
    await page.route((url) => new URL(url).pathname === '/api/config/projects', (route) => fulfillJson(route, {
        source: { status: 'loaded', mode: 'registry_scoped' },
        projects: [{ id: 'growin', session_select: true }]
    }));
    await page.route('**/nocodb-task-start-retirement-test', (route) => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
            <html lang="ja">
              <body>
                <main id="nocodb-task-container"></main>
                ${withFocusEngineModal ? `<section id="focus-engine-modal" class="modal">
                  <div class="modal-content">
                    <h2>セッションの起動先</h2>
                    <label>
                      <input type="radio" name="focus-engine" value="claude" checked>
                      Claude Code
                    </label>
                    <label>
                      <input type="radio" name="focus-engine" value="codex">
                      OpenAI Codex
                    </label>
                    <button class="close-modal-btn" type="button">キャンセル</button>
                    <button id="focus-engine-start-btn" type="button">開始</button>
                  </div>
                </section>` : ''}
              </body>
            </html>`
    }));

    await page.goto('/nocodb-task-start-retirement-test');
    await page.evaluate(async () => {
        const [
            { NocoDBTasksView },
            { FocusEngineModal },
            { applyEventListenersMixin },
            { appStore },
            { projectMappingReady }
        ] = await Promise.all([
            import('/modules/ui/views/nocodb-tasks-view.js?nocodb-start-task-retirement'),
            import('/modules/ui/modals/focus-engine-modal.js?nocodb-start-task-retirement'),
            import('/modules/app/event-listeners-mixin.js?nocodb-start-task-retirement'),
            import('/modules/core/store.js'),
            import('/modules/project-mapping.js')
        ]);

        await projectMappingReady;

        const task = {
            id: 'nocodb:growin:retirement',
            title: '旧タスク開始の移行確認',
            project: 'growin',
            status: 'pending',
            assignee: 'e2e-user',
            priority: 'normal'
        };
        const probe = {
            sessionCreateCalls: 0,
            taskStatusUpdateCalls: 0
        };
        window.__nocodbTaskStartRetirementProbe = probe;

        const nocodbTaskService = {
            tasks: [task],
            isLoading: () => false,
            getFilteredTasks: () => [task],
            updateStatus: async () => {
                probe.taskStatusUpdateCalls += 1;
            }
        };

        class NocoDbStartApp {
            constructor() {
                this.unsubscribers = [];
                this._sessionSwitchToken = 0;
                this.sessionService = {
                    createSession: async () => {
                        probe.sessionCreateCalls += 1;
                        return { id: 'unexpected-session' };
                    }
                };
                this.nocodbTaskService = nocodbTaskService;
                this.modals = {
                    focusEngineModal: document.getElementById('focus-engine-modal')
                        ? new FocusEngineModal()
                        : null
                };
            }

            async setupGlobalButtons() {}
            setupTestModeBanner() {}
            setupLearningHealthBanner() {}
        }

        appStore.setState({ preferences: { user: { assignee: 'e2e-user' } } });
        applyEventListenersMixin(NocoDbStartApp);

        const app = new NocoDbStartApp();
        app.modals.focusEngineModal?.mount();
        await app.setupEventListeners();

        const view = new NocoDBTasksView({ nocodbTaskService });
        view.currentFilter.assignee = '';
        view.mount(document.getElementById('nocodb-task-container'));
    });
}

test('FocusEngineModalがないNocoDBタスク開始は即時にCodex移行案内へfail-closedする', async ({ page }) => {
    const sessionRequests = [];
    page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/sessions')) {
            sessionRequests.push(request.url());
        }
    });

    await mountNocoDbTaskStartFixture(page, { withFocusEngineModal: false });

    const startButton = page.locator('.nocodb-task-start-btn');
    await expect(startButton).toHaveCount(1);
    await startButton.click();

    await expect(page.locator('.toast-info').filter({ hasText: migrationNotice })).toBeVisible();
    await expect(page.locator('#focus-engine-modal')).toHaveCount(0);
    expect(sessionRequests).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.__nocodbTaskStartRetirementProbe)).toEqual({
        sessionCreateCalls: 0,
        taskStatusUpdateCalls: 0
    });
});

async function assertEngineSelectionFailsClosed(page, engine) {
        const sessionRequests = [];
        page.on('request', (request) => {
            if (new URL(request.url()).pathname.startsWith('/api/sessions')) {
                sessionRequests.push(request.url());
            }
        });

        await mountNocoDbTaskStartFixture(page);

        const startButton = page.locator('.nocodb-task-start-btn');
        await expect(startButton).toHaveCount(1);
        await startButton.click();

        const picker = page.locator('#focus-engine-modal');
        await expect(picker).toHaveClass(/active/);
        const engineInput = page.locator(`input[name="focus-engine"][value="${engine}"]`);
        await engineInput.check();
        await expect(engineInput).toBeChecked();
        await page.locator('#focus-engine-start-btn').click();

        await expect(page.locator('.toast-info').filter({ hasText: migrationNotice })).toBeVisible();
        await expect(picker).not.toHaveClass(/active/);
        expect(sessionRequests).toEqual([]);
        await expect.poll(() => page.evaluate(() => window.__nocodbTaskStartRetirementProbe)).toEqual({
            sessionCreateCalls: 0,
            taskStatusUpdateCalls: 0
        });
}

test('NocoDB開始ボタンからエンジン選択後に移行案内へfail-closedし、session APIを呼ばない', async ({ page }) => {
    await assertEngineSelectionFailsClosed(page, 'claude');
});

test('NocoDBタスク開始からcodex選択後はCodex移行案内へfail-closedする', async ({ page }) => {
    await assertEngineSelectionFailsClosed(page, 'codex');
});
