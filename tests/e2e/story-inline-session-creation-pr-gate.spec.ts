import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/user_stories/retired/story-session-launch-picker-startup-composer.md';
const specPath = 'docs/specs/story-session-launch-picker-startup-composer-spec.md';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function mountRetiredSessionEntrypoints(page) {
  await page.route('**/retired-session-entrypoints-test', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
        <html lang="ja"><body>
          <button id="add-session-btn">デスクトップの新規タスク</button>
          <button id="mobile-new-session-btn">モバイルの新規タスク</button>
          <section id="session-launch-picker" class="hidden"></section>
          <section id="create-session-modal" class="modal"></section>
        </body></html>`,
    });
  });
  await page.goto('/retired-session-entrypoints-test');
  await page.evaluate(async () => {
    const [{ applyEventListenersMixin }, { applyMobileNavigationMixin }] = await Promise.all([
      import('/modules/app/event-listeners-mixin.js?retired-entrypoint-e2e'),
      import('/modules/app/mobile-navigation-mixin.js?retired-entrypoint-e2e'),
    ]);
    class RetiredEntrypointApp {
      unsubscribers = [];
      _sessionSwitchToken = 0;
      async setupGlobalButtons() {}
      setupTestModeBanner() {}
      setupLearningHealthBanner() {}
    }
    applyEventListenersMixin(RetiredEntrypointApp);
    applyMobileNavigationMixin(RetiredEntrypointApp);
    const app = new RetiredEntrypointApp();
    await app.setupEventListeners();
    app.setupMobileNavigation();
    window.__retiredEntrypointApp = app;
  });
}

test.describe('story-session-launch-picker-startup-composer PR gate evidence', () => {
  test('documents the retired launch picker ownership boundary', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    expect(story).toContain('Session Launch Picker');
    expect(story).toContain('Startup Composer');
    expect(story).toContain('status: retired');
    expect(spec).toContain('status: retired');
    expect(spec).toContain('Codex app/CLI owns task and');
  });

  test('fails closed instead of opening the retired picker', async () => {
    const eventListeners = await read('public/modules/app/event-listeners-mixin.js');
    expect(eventListeners).not.toContain('this.openSessionLaunchPicker(project)');
    expect(eventListeners).toContain('新しいタスクはCodexアプリから作成してください');
  });

  test('assigns picker ownership to the retired session capability', async () => {
    const sessionCapability = await read('docs/brainbase-capabilities/capabilities/session.create.yml');
    const projectCapability = await read('docs/brainbase-capabilities/capabilities/project.selector.yml');
    expect(sessionCapability).toContain('lifecycle: retired');
    expect(sessionCapability).toContain('#session-launch-picker');
    expect(sessionCapability).not.toContain('#session-startup-composer');
    expect(sessionCapability).not.toContain('#create-session-modal');
    expect(projectCapability).not.toContain('#session-launch-picker');
    expect(projectCapability).not.toContain('#session-launch-project-select');
    expect(projectCapability).toContain('#session-project-select');
    expect(projectCapability).not.toContain('#create-session-modal');
  });

  for (const entrypoint of [
    { name: 'desktop', selector: '#add-session-btn', viewport: { width: 1280, height: 800 } },
    { name: 'mobile', selector: '#mobile-new-session-btn', viewport: { width: 390, height: 844 } },
  ]) {
    test(`${entrypoint.name} legacy entrypoint shows the Codex notice without session API calls`, async ({ page }) => {
      const sessionRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/sessions')) sessionRequests.push(request.url());
      });

      await page.setViewportSize(entrypoint.viewport);
      await mountRetiredSessionEntrypoints(page);
      await page.locator(entrypoint.selector).click();

      await expect(page.locator('.toast-info').filter({ hasText: '新しいタスクはCodexアプリから作成してください' }).last()).toBeVisible();
      await expect(page.locator('#session-launch-picker')).toHaveClass(/hidden/);
      const modal = page.locator('#create-session-modal');
      if (await modal.count()) await expect(modal).not.toHaveClass(/active/);
      expect(sessionRequests).toEqual([]);
    });
  }
});
