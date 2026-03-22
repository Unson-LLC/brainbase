import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WikiView } from '../../../public/modules/ui/views/wiki-view.js';

vi.mock('../../../public/modules/ui-helpers.js', () => ({
    escapeHtml: vi.fn((s) => s),
}));

describe('WikiView', () => {
    let view;
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        view = new WikiView({
            wikiService: { fetchPages: vi.fn(async () => []) },
            eventBus: { on: vi.fn(), onAsync: vi.fn(), emit: vi.fn() },
            container,
        });
        view._pages = [
            { path: 'projects/brainbase/setup', title: 'Setup Guide' },
            { path: 'projects/brainbase/api', title: 'API Reference' },
            { path: '_archived/old-doc', title: 'Old Doc' },
        ];
    });

    it('collapsed状態のフォルダにcollapsedクラスが付与される', () => {
        view._collapsed = { 'projects/brainbase': true };
        view._render();

        const headers = container.querySelectorAll('.wiki-idx-folder-header');
        const brainbaseHeader = [...headers].find(
            (el) => el.dataset.folder === 'projects/brainbase',
        );
        expect(brainbaseHeader).toBeTruthy();
        expect(brainbaseHeader.classList.contains('collapsed')).toBe(true);
    });

    it('collapsed状態でないフォルダにcollapsedクラスが付与されない', () => {
        view._collapsed = {};
        view._render();

        const headers = container.querySelectorAll('.wiki-idx-folder-header');
        const projectsHeader = [...headers].find(
            (el) => el.dataset.folder === 'projects',
        );
        expect(projectsHeader).toBeTruthy();
        expect(projectsHeader.classList.contains('collapsed')).toBe(false);
    });
});
