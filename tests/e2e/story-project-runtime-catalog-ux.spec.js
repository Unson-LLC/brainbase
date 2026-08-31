import { expect, test } from '@playwright/test';

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

async function installWorkspaceSetupFixture(page) {
    await page.evaluate(() => {
        document.body.insertAdjacentHTML('beforeend', `
            <section id="workspace-setup">
                <label for="session-project-select">Workspace Setup</label>
                <select id="session-project-select"></select>
            </section>
        `);
    });
}

async function loadWorkspaceSetup(page) {
    await page.evaluate(async () => {
        const { applyUiSetupMixin } = await import('/modules/app/ui-setup-mixin.js?project-catalog-e2e');
        class BrowserCatalogApp {
            constructor() {
                this.authManager = {
                    access: {
                        projectCodes: ['granted-project', 'workspace-missing', 'suppressed-project']
                    }
                };
            }
        }
        applyUiSetupMixin(BrowserCatalogApp);
        window.__projectCatalogApp = new BrowserCatalogApp();
        await window.__projectCatalogApp.refreshProjectSelect('workspace-missing');
    });
}

async function openCatalogFixture(page, response = { body: loadedCatalog }) {
    await stubCatalogRoutes(page, response);
    await page.goto('/device');
    await page.waitForLoadState('domcontentloaded');
    await installWorkspaceSetupFixture(page);
    await loadWorkspaceSetup(page);
}

test.describe('runtime project catalog selector UX', () => {
    test('loaded grant-scoped catalog renders selectable, workspace-missing, and workspace setup states', async ({ page }) => {
        await openCatalogFixture(page);

        await expect(page.locator('#session-project-catalog-status'))
            .toHaveText('権限のあるプロジェクト一覧を読み込みました。');
        await expect(page.locator('#session-project-select option[value="granted-project"]')).toHaveCount(1);
        await expect(page.locator('#session-project-select option[value="suppressed-project"]')).toHaveCount(0);
        await expect(page.locator('#session-project-select option')
            .filter({ hasText: 'workspace-missing（ワークスペース設定が必要）' }))
            .toBeDisabled();
        await expect(page.locator('#session-project-select')).toHaveValue('general');
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

            await expect(page.locator('#session-project-catalog-status')).toContainText(failureCase.message);
            await expect(page.locator('#session-project-catalog-status')).toHaveAttribute('role', 'alert');
            await expect(page.locator('#session-project-select option')).toHaveCount(1);
            await expect(page.locator('#session-project-select')).toHaveValue('general');
        });
    }
});
