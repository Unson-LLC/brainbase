import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.describe('session list actions', () => {
    test('new-task action has no session mutation handler', async () => {
        const listeners = await readFile('public/modules/app/event-listeners-mixin.js', 'utf8');
        const createHandler = listeners.slice(
            listeners.indexOf('const unsub4 = eventBus.on(EVENTS.CREATE_SESSION'),
            listeners.indexOf('// Worktree fallback:')
        );
        expect(createHandler).toContain('Brainbaseのセッション作成は廃止されました');
        expect(createHandler).not.toContain('sessionService');
        expect(createHandler).not.toContain('/api/sessions');
    });
});
