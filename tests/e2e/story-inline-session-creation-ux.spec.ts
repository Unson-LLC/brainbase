import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.describe('retired Brainbase session creation UX', () => {
  test('desktop and mobile actions route only to the fail-closed event', async () => {
    const navigation = await readFile('public/modules/app/mobile-navigation-mixin.js', 'utf8');
    const listeners = await readFile('public/modules/app/event-listeners-mixin.js', 'utf8');
    expect(navigation).toContain("document.getElementById('add-session-btn')");
    expect(navigation).toContain("document.getElementById('mobile-new-session-btn')");
    expect(navigation).toContain('eventBus.emit(EVENTS.CREATE_SESSION');
    expect(listeners).toContain('Brainbaseのセッション作成は廃止されました');
    expect(listeners).not.toContain('this.openSessionLaunchPicker(project)');
  });
});
