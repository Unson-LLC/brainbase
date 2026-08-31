import { expect, test } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const defaultPort = isWorktree ? 31014 : 31013;
const e2ePort = process.env.BRAINBASE_E2E_PORT || (isWorktree
    ? String(defaultPort)
    : (process.env.BRAINBASE_PORT || process.env.PORT || String(defaultPort)));
const baseUrl = process.env.BRAINBASE_BASE_URL || `http://localhost:${e2ePort}`;

const projectConfig = {
    projects: {
        root: '/workspace',
        projects: [
            { id: 'granted-project', local: { path: 'projects/granted-project' } },
            { id: 'workspace-missing' },
            { id: 'suppressed-project', local: { path: 'projects/suppressed-project' } }
        ]
    }
};

const loadedCatalog = {
    source: { status: 'loaded', mode: 'registry_scoped' },
    projects: [
        { id: 'granted-project', session_select: true },
        { id: 'workspace-missing', session_select: true },
        { id: 'suppressed-project', session_select: false }
    ]
};

async function fulfillJson(route, body, status = 200) {
    await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body)
    });
}

async function stubCatalogRoutes(page, response) {
    await page.route((url) => new URL(url).pathname === '/api/config', (route) => fulfillJson(route, projectConfig));
    await page.route((url) => new URL(url).pathname === '/api/config/projects', async (route) => {
        if (response.type === 'fetch_exception') {
            await route.abort('failed');
            return;
        }
        await fulfillJson(route, response.body || {}, response.status || 200);
    });
}

async function installPickerFixture(page) {
    await page.evaluate(() => {
        document.body.insertAdjacentHTML('beforeend', `
            <section id="session-launch-picker" class="session-launch-picker hidden">
                <label for="session-launch-project-select">Session Launch Picker</label>
                <select id="session-launch-project-select"></select>
                <input type="checkbox" id="session-launch-use-worktree-checkbox">
                <label id="session-launch-worktree-label"></label>
                <p id="session-launch-worktree-hint"></p>
                <input type="radio" name="session-launch-engine" value="claude" checked>
                <button id="session-launch-start" type="button">開始</button>
                <button id="session-launch-cancel" type="button">キャンセル</button>
            </section>
            <section id="workspace-setup">
                <label for="session-project-select">Workspace Setup</label>
                <select id="session-project-select"></select>
            </section>
        `);
    });
}

async function loadSessionPicker(page) {
    await page.evaluate(async () => {
        const { applySessionCreationMixin } = await import('/modules/app/session-creation-mixin.js?project-catalog-e2e');

        class BrowserCatalogApp {
            constructor() {
                this.authManager = {
                    access: {
                        projectCodes: ['granted-project', 'workspace-missing', 'suppressed-project']
                    }
                };
                this.startPayload = null;
                this.createSession = (...args) => {
                    this.startPayload = args;
                    window.__projectCatalogStartPayload = args;
                };
            }

            closeMobileSessionsSheet() {}
        }

        applySessionCreationMixin(BrowserCatalogApp);
        window.__projectCatalogApp = new BrowserCatalogApp();
        await window.__projectCatalogApp.openSessionLaunchPicker('general');
    });
}

async function loadWorkspaceSetup(page) {
    await page.evaluate(async () => {
        const { applyUiSetupMixin } = await import('/modules/app/ui-setup-mixin.js?project-catalog-e2e');
        applyUiSetupMixin(window.__projectCatalogApp.constructor);
        await window.__projectCatalogApp.refreshProjectSelect('workspace-missing');
    });
}

async function openCatalogFixture(page, response = { body: loadedCatalog }) {
    await stubCatalogRoutes(page, response);
    await page.goto(`${baseUrl}/device`);
    await page.waitForLoadState('domcontentloaded');
    await installPickerFixture(page);
    await loadSessionPicker(page);
}

test.describe('runtime project catalog selector UX', () => {
    test('loaded grant-scoped catalog renders selectable, workspace-missing, and workspace setup states', async ({ page }) => {
        await openCatalogFixture(page);

        const pickerOptions = page.locator('#session-launch-project-select option');
        await expect(pickerOptions).toHaveCount(3);
        await expect(pickerOptions.nth(0)).toHaveAttribute('value', 'general');
        await expect(pickerOptions.nth(1)).toHaveAttribute('value', 'granted-project');
        await expect(pickerOptions.nth(2)).toHaveText('workspace-missing（ワークスペース設定が必要）');
        await expect(pickerOptions.nth(2)).toBeDisabled();
        await expect(page.locator('#session-launch-project-catalog-status'))
            .toHaveText('権限のあるプロジェクト一覧を読み込みました。');
        await expect(page.locator('#session-launch-project-select option[value="suppressed-project"]')).toHaveCount(0);

        await loadWorkspaceSetup(page);
        await expect(page.locator('#session-project-catalog-status'))
            .toHaveText('権限のあるプロジェクト一覧を読み込みました。');
        await expect(page.locator('#session-project-select option')
            .filter({ hasText: 'workspace-missing（ワークスペース設定が必要）' }))
            .toBeDisabled();

        await page.evaluate(() => window.__projectCatalogApp.openSessionLaunchPicker('suppressed-project'));
        await expect(page.locator('#session-launch-project-select')).toHaveValue('general');
        await page.locator('#session-launch-start').click();
        await expect.poll(() => page.evaluate(() => window.__projectCatalogStartPayload?.[0])).toBe('general');
        expect(await page.evaluate(() => window.__projectCatalogStartPayload)).not.toContain('suppressed-project');
    });
});

test.describe('runtime project catalog failure UX', () => {
    const failureCases = [
        {
            name: '401 authentication required',
            response: { status: 401, body: { error: 'authentication_required' } },
            message: '認証が必要です'
        },
        {
            name: '503 request failed',
            response: { status: 503, body: { error: 'registry_unavailable' } },
            message: 'HTTP 503'
        },
        {
            name: 'fetch exception unavailable',
            response: { type: 'fetch_exception' },
            message: 'プロジェクト一覧を取得できません'
        },
        {
            name: 'source unavailable',
            response: {
                body: {
                    source: { status: 'unavailable', code: 'registry_unavailable' },
                    projects: [{ id: 'suppressed-project', session_select: true }]
                }
            },
            message: 'プロジェクト一覧を取得できません'
        }
    ];

    for (const failureCase of failureCases) {
        test(`${failureCase.name} is visible and remains fail-closed`, async ({ page }) => {
            await openCatalogFixture(page, failureCase.response);

            await expect(page.locator('#session-launch-project-catalog-status')).toContainText(failureCase.message);
            await expect(page.locator('#session-launch-project-catalog-status')).toHaveAttribute('role', 'alert');
            await expect(page.locator('#session-launch-project-select option')).toHaveCount(1);
            await expect(page.locator('#session-launch-project-select')).toHaveValue('general');
            await expect(page.locator('#session-launch-project-select option[value="suppressed-project"]')).toHaveCount(0);

            await loadWorkspaceSetup(page);
            await expect(page.locator('#session-project-catalog-status')).toContainText(failureCase.message);
            await expect(page.locator('#session-project-catalog-status')).toHaveAttribute('role', 'alert');
            await expect(page.locator('#session-project-select option')).toHaveCount(1);
            await expect(page.locator('#session-project-select')).toHaveValue('general');
        });
    }
});
