import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectMapping = vi.hoisted(() => ({
    projectMappingReady: Promise.resolve(),
    getSessionSelectableProjects: vi.fn(),
    getProjectsRequiringWorkspaceSetup: vi.fn()
}));

vi.mock('../../public/modules/project-mapping.js', () => projectMapping);

import { applyUiSetupMixin } from '../../public/modules/app/ui-setup-mixin.js';

describe('ui setup mixin Workspace Setup selector', () => {
    class TestApp {}

    beforeEach(() => {
        document.body.innerHTML = '<select id="session-project-select"></select>';
        projectMapping.getSessionSelectableProjects.mockReset();
        projectMapping.getProjectsRequiringWorkspaceSetup.mockReset();
        projectMapping.getSessionSelectableProjects.mockReturnValue(['configured-project']);
        projectMapping.getProjectsRequiringWorkspaceSetup.mockReturnValue(['registry-only']);
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
    });
});
