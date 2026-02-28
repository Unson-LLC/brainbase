import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupTaskTabs } from '../../public/modules/ui/task-tabs.js';

describe('setupTaskTabs', () => {
    let eventBus;
    let lucide;
    let onTabActivated;

    beforeEach(() => {
        document.body.innerHTML = `
            <div class="task-tabs">
                <button class="task-tab active" data-tab="local">local</button>
                <button class="task-tab" data-tab="nocodb">nocodb</button>
            </div>
            <div class="task-tab-content active" id="local-tasks-panel"></div>
            <div class="task-tab-content" id="nocodb-tasks-panel"></div>
        `;

        eventBus = { emit: vi.fn() };
        lucide = { createIcons: vi.fn() };
        onTabActivated = vi.fn();
    });

    it('タブ切替時_アクティブ状態とイベントが更新される', () => {
        setupTaskTabs({
            eventBus,
            events: { TASK_TAB_CHANGED: 'task:tab-changed' },
            onTabActivated,
            lucide
        });

        const nocodbTab = document.querySelector('[data-tab="nocodb"]');
        nocodbTab.click();

        expect(nocodbTab.classList.contains('active')).toBe(true);
        expect(document.querySelector('[data-tab="local"]').classList.contains('active')).toBe(false);
        expect(document.getElementById('nocodb-tasks-panel').classList.contains('active')).toBe(true);
        expect(document.getElementById('local-tasks-panel').classList.contains('active')).toBe(false);
        expect(eventBus.emit).toHaveBeenCalledWith('task:tab-changed', { tab: 'nocodb' });
        expect(onTabActivated).toHaveBeenCalledWith('nocodb');
        expect(lucide.createIcons).toHaveBeenCalled();
    });

    it('cleanup呼び出し後_クリックしても反応しない', () => {
        const cleanup = setupTaskTabs({
            eventBus,
            events: { TASK_TAB_CHANGED: 'task:tab-changed' }
        });

        cleanup();

        const nocodbTab = document.querySelector('[data-tab="nocodb"]');
        nocodbTab.click();

        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});
