import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WikiView } from '../../../public/modules/ui/views/wiki-view.js';

vi.mock('../../../public/modules/ui-helpers.js', () => ({
    escapeHtml: vi.fn((s) => s),
    refreshIcons: vi.fn(),
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
            { path: 'projects/brainbase/setup', title: 'Setup Guide', updated_at: '2026-05-07T11:12:00.000Z', role_min: 'public', sensitivity: 'public' },
            { path: 'projects/brainbase/api', title: 'API Reference', role_min: 'member', sensitivity: 'internal' },
            { path: '_archived/old-doc', title: 'Old Doc', role_min: 'admin', sensitivity: 'restricted' },
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

    it('索引行にパス・更新日時・アクセス表示が含まれる', () => {
        view._collapsed = { projects: false, 'projects/brainbase': false };
        view._render();

        expect(container.querySelector('.wiki-idx-search-wrap')).toBeTruthy();
        expect(container.querySelector('.wiki-idx-table-head')?.textContent).toContain('アクセス');
        const setupRow = container.querySelector('.wiki-idx-item[data-path="projects/brainbase/setup"]');
        expect(setupRow?.querySelector('.wiki-idx-item-path')?.textContent).toContain('/projects/brainbase');
        expect(setupRow?.querySelector('.wiki-idx-item-updated')?.textContent).toContain('05/07');
        expect(setupRow?.querySelector('.wiki-idx-item-access')?.textContent).toBe('全員');
        expect(container.querySelector('.wiki-idx-preview')).toBeTruthy();
    });
});
