import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.describe('retired Brainbase worktree launch UI', () => {
    test('legacy entry cannot reach the worktree creation API', async () => {
        const listeners = await readFile('public/modules/app/event-listeners-mixin.js', 'utf8');
        const createHandler = listeners.slice(
            listeners.indexOf('const unsub4 = eventBus.on(EVENTS.CREATE_SESSION'),
            listeners.indexOf('// Worktree fallback:')
        );
        expect(createHandler).toContain('新しいタスクはCodexアプリから作成してください');
        expect(createHandler).not.toContain('create-with-worktree');
    });
});
