import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectMapping = vi.hoisted(() => ({
    projectMappingReady: Promise.resolve(),
    getSessionSelectableProjects: vi.fn(),
    getProjectsRequiringWorkspaceSetup: vi.fn(),
    getRuntimeProjectCatalogSource: vi.fn(),
    getRuntimeProjectCatalogStatusMessage: vi.fn()
}));

vi.mock('../../public/modules/project-mapping.js', () => projectMapping);

import { applyUiSetupMixin } from '../../public/modules/app/ui-setup-mixin.js';

describe('ui setup mixin Workspace Setup selector', () => {
    class TestApp {}

    beforeEach(() => {
        document.body.innerHTML = '<select id="session-project-select"></select>';
        projectMapping.getSessionSelectableProjects.mockReset();
        projectMapping.getProjectsRequiringWorkspaceSetup.mockReset();
        projectMapping.getRuntimeProjectCatalogSource.mockReset();
        projectMapping.getRuntimeProjectCatalogStatusMessage.mockReset();
        projectMapping.getSessionSelectableProjects.mockReturnValue(['configured-project']);
        projectMapping.getProjectsRequiringWorkspaceSetup.mockReturnValue(['registry-only']);
        projectMapping.getRuntimeProjectCatalogSource.mockReturnValue({ status: 'loaded' });
        projectMapping.getRuntimeProjectCatalogStatusMessage.mockReturnValue(
            '権限のあるプロジェクト一覧を読み込みました。'
        );
        applyUiSetupMixin(TestApp);
    });

    it('Workspace Setupが必要なRegistry projectをdisabled optionとして表示する', async () => {
        const app = new TestApp();
        app.authManager = { access: { projectCodes: [] } };

        await app.refreshProjectSelect('registry-only');

        const select = document.getElementById('session-project-select');
        const setupOption = [...select.options].find((option) => (
            option.textContent === 'registry-only（ワークスペース設定が必要）'
        ));

        expect(setupOption).toBeDefined();
        expect(setupOption.value).toBe('');
        expect(setupOption.disabled).toBe(true);
        expect(select.value).toBe('general');
        expect(document.getElementById('session-project-catalog-status').textContent)
            .toBe('権限のあるプロジェクト一覧を読み込みました。');
    });

    it.each([
        [{ status: 'authentication_required', http_status: 401 }, '認証が必要です'],
        [{ status: 'request_failed', http_status: 503 }, 'HTTP 503'],
        [{ status: 'unavailable' }, 'プロジェクト一覧を取得できません']
    ])('Workspace SetupはCatalog %s を可視化する', async (source, expectedText) => {
        projectMapping.getSessionSelectableProjects.mockReturnValue([]);
        projectMapping.getProjectsRequiringWorkspaceSetup.mockReturnValue([]);
        projectMapping.getRuntimeProjectCatalogSource.mockReturnValue(source);
        projectMapping.getRuntimeProjectCatalogStatusMessage.mockImplementation((currentSource) => (
            currentSource.status === 'authentication_required'
                ? 'プロジェクト一覧を取得できません。認証が必要です。generalのみ選択できます。'
                : currentSource.status === 'request_failed'
                    ? `プロジェクト一覧を取得できません（HTTP ${currentSource.http_status}）。generalのみ選択できます。`
                    : 'プロジェクト一覧を取得できません。generalのみ選択できます。'
        ));

        const app = new TestApp();
        app.authManager = { access: { projectCodes: ['suppressed-project'] } };

        await app.refreshProjectSelect('suppressed-project');

        const status = document.getElementById('session-project-catalog-status');
        expect(status.hidden).toBe(false);
        expect(status.getAttribute('role')).toBe('alert');
        expect(status.dataset.status).toBe(source.status);
        expect(status.textContent).toContain(expectedText);
        expect(document.getElementById('session-project-select').value).toBe('general');
        expect([...document.getElementById('session-project-select').options]
            .some((option) => option.value === 'suppressed-project')).toBe(false);
    });

    it('Workspace Setupは確認済み0件を成功読込と区別して表示する', async () => {
        projectMapping.getSessionSelectableProjects.mockReturnValue([]);
        projectMapping.getProjectsRequiringWorkspaceSetup.mockReturnValue([]);
        projectMapping.getRuntimeProjectCatalogSource.mockReturnValue({
            status: 'confirmed_empty', upstream_status: 'loaded'
        });
        projectMapping.getRuntimeProjectCatalogStatusMessage.mockReturnValue(
            'プロジェクト一覧の取得は完了しましたが、権限のあるプロジェクトは0件です。generalのみ選択できます。'
        );

        const app = new TestApp();
        app.authManager = { access: { projectCodes: [] } };
        await app.refreshProjectSelect('general');

        const status = document.getElementById('session-project-catalog-status');
        expect(status.dataset.status).toBe('confirmed_empty');
        expect(status.dataset.severity).toBe('info');
        expect(status.getAttribute('role')).toBe('status');
        expect(status.textContent).toContain('権限のあるプロジェクトは0件です');
        expect([...document.getElementById('session-project-select').options].map((option) => option.value))
            .toEqual(['general']);
    });
});
