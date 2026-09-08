import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.describe('retired Brainbase session startup UX', () => {
    test('legacy startup surfaces remain retired', async () => {
        const story = await readFile('docs/user_stories/retired/story-session-launch-picker-startup-composer.md', 'utf8');
        const spec = await readFile('docs/specs/story-session-launch-picker-startup-composer-spec.md', 'utf8');
        expect(story).toContain('status: retired');
        expect(spec).toContain('status: retired');
        expect(spec).toContain('Codex app/CLI owns task and');
    });
});
