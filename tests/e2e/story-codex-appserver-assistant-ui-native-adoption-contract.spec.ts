import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const acceptanceCriteria = [
  'The transcript island imports and renders the pre-styled OSS `@assistant-ui/react-ui` `Thread` as the primary chat surface.',
  'Brainbase-specific code is limited to the Codex App Server transcript/turn adapter, outer shell metadata, visible status/error state, and mount/fallback integration.',
  'The island removes custom primary message renderers such as `MessageBubble`, `RichMessageContent`, `MarkdownText`, and `ActivityEvent`.',
  'Markdown rendering uses assistant-ui OSS markdown integration, not a Brainbase handwritten parser.',
  'The assistant-ui distributed CSS is bundled into the island and injected for the `aui-*` component classes.',
  'Browser input still posts only to `POST /api/sessions/:id/codex-app-server/turns`; terminal input remains disabled in transcript mode.',
  'xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and failed-island fallback remain unchanged.',
  '`@assistant-ui/react-ui` and `@assistant-ui/react-markdown` remain development dependencies for the browser bundle and do not expand production Node dependency audit scope.'
];

async function mountAppServerSession(page: import('@playwright/test').Page, sessionId: string) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());
  await page.evaluate(async (sid) => {
    const [{ createApp }, { appStore }] = await Promise.all([
      import('/app.js'),
      import('/modules/core/store.js')
    ]);
    const app = createApp();
    (window as any).brainbaseApp = app;
    app.reconnectManager = { setCurrentSession() {} };
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalFrame = document.getElementById('terminal-frame');
    app.terminalTransportClient = {
      disconnect() {},
      hide() {},
      show() {},
      destroy() {},
      isActiveForSession() { return false; }
    };
    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: sid,
        name: 'assistant-ui native adoption',
        path: '/tmp/assistant-ui-native',
        engine: 'codex',
        intendedState: 'active',
        codexAppServer: { threadId: 'thread-assistant-ui-native', status: 'ready' }
      }]
    });
    await app.switchSession(sid);
  }, sessionId);
}

test('story-codex-appserver-assistant-ui-native-adoption contract anchors are covered', async () => {
  const story = read('docs/stories/story-codex-appserver-assistant-ui-native-adoption.md');
  const architecture = read('docs/architecture/codex-appserver-assistant-ui-native-adoption-architecture.md');
  const spec = read('docs/specs/codex-appserver-assistant-ui-native-adoption-spec.md');
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  const pkg = JSON.parse(read('package.json'));
  const capability = read('docs/brainbase-capabilities/capabilities/codex.app-server.yml');

  expect(story).toContain('pre-styled OSS `@assistant-ui/react-ui` `Thread`');
  expect(architecture).toContain('Use `@assistant-ui/react-ui` as the transcript');
  expect(spec).toContain('codex-appserver-assistant-ui-native-adoption.oss-thread');
  expect(island).toContain("from '@assistant-ui/react-ui'");
  expect(island).toContain('<Thread {...threadConfig} />');
  expect(island).toContain('makeMarkdownText');
  expect(island).toContain("@assistant-ui/react-ui/styles/index.css");
  expect(island).toContain("@assistant-ui/react-ui/styles/markdown.css");
  expect(island).not.toContain('function MessageBubble');
  expect(island).not.toContain('function RichMessageContent');
  expect(island).not.toContain('function ActivityEvent');
  expect(island).not.toContain('function MarkdownText');
  expect(island).not.toContain('dangerouslySetInnerHTML');
  expect(pkg.dependencies['@assistant-ui/react-ui']).toBeUndefined();
  expect(pkg.dependencies['@assistant-ui/react-markdown']).toBeUndefined();
  expect(pkg.devDependencies['@assistant-ui/react-ui']).toBeDefined();
  expect(pkg.devDependencies['@assistant-ui/react-markdown']).toBeDefined();
  expect(pkg.scripts['build:codex-appserver-transcript']).toContain('--loader:.css=text');
  expect(capability).toContain('story-codex-appserver-assistant-ui-native-adoption-contract.spec.ts');
});

test('story-codex-appserver-assistant-ui-native-adoption ac:1 OSS Thread is primary chat surface', async () => {
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(acceptanceCriteria[0]).toBe('The transcript island imports and renders the pre-styled OSS `@assistant-ui/react-ui` `Thread` as the primary chat surface.');
  expect(island).toContain("import { Thread, makeMarkdownText } from '@assistant-ui/react-ui';");
  expect(island).toContain('<Thread {...threadConfig} />');
});

test('story-codex-appserver-assistant-ui-native-adoption ac:2 Brainbase code stays adapter and shell scoped', async () => {
  const architecture = read('docs/architecture/codex-appserver-assistant-ui-native-adoption-architecture.md');
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(acceptanceCriteria[1]).toBe('Brainbase-specific code is limited to the Codex App Server transcript/turn adapter, outer shell metadata, visible status/error state, and mount/fallback integration.');
  expect(architecture).toContain('Brainbase keeps only the outer header/context/status/error shell, App Server API functions, polling, mount lifecycle, and fallback behavior.');
  expect(island).toContain('api.startTurn(text)');
  expect(island).toContain('data-codex-appserver-transcript-island');
});

test('story-codex-appserver-assistant-ui-native-adoption ac:3 custom primary renderers are removed', async () => {
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(acceptanceCriteria[2]).toBe('The island removes custom primary message renderers such as `MessageBubble`, `RichMessageContent`, `MarkdownText`, and `ActivityEvent`.');
  for (const removed of ['function MessageBubble', 'function RichMessageContent', 'function ActivityEvent', 'function MarkdownText']) {
    expect(island).not.toContain(removed);
  }
});

test('story-codex-appserver-assistant-ui-native-adoption ac:4 assistant-ui markdown integration is used', async () => {
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(acceptanceCriteria[3]).toBe('Markdown rendering uses assistant-ui OSS markdown integration, not a Brainbase handwritten parser.');
  expect(island).toContain('makeMarkdownText');
  expect(island).not.toContain('splitFencedCode');
  expect(island).not.toContain('InlineMarkdown');
  expect(island).not.toContain('dangerouslySetInnerHTML');
});

test('story-codex-appserver-assistant-ui-native-adoption ac:5 assistant-ui distributed CSS is bundled and injected', async () => {
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  const pkg = JSON.parse(read('package.json'));
  expect(acceptanceCriteria[4]).toBe('The assistant-ui distributed CSS is bundled into the island and injected for the `aui-*` component classes.');
  expect(island).toContain("@assistant-ui/react-ui/styles/index.css");
  expect(island).toContain("@assistant-ui/react-ui/styles/markdown.css");
  expect(island).toContain('brainbase-assistant-ui-native-styles');
  expect(pkg.scripts['build:codex-appserver-transcript']).toContain('--loader:.css=text');
});

test('story-codex-appserver-assistant-ui-native-adoption ac:6 browser input keeps App Server turn API boundary', async () => {
  const mixin = read('public/modules/app/codex-app-server-display-mixin.js');
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(acceptanceCriteria[5]).toBe('Browser input still posts only to `POST /api/sessions/:id/codex-app-server/turns`; terminal input remains disabled in transcript mode.');
  expect(mixin).toContain('codex-app-server/turns');
  expect(island).toContain('api.startTurn(text)');
  expect(read('tests/e2e/story-codex-appserver-transcript-ui-contract.spec.ts')).toContain('terminal input must not be called');
});

test('story-codex-appserver-assistant-ui-native-adoption ac:7 terminal and failed-island fallbacks stay covered', async () => {
  expect(acceptanceCriteria[6]).toBe('xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and failed-island fallback remain unchanged.');
  expect(read('tests/e2e/story-codex-appserver-transcript-ui-contract.spec.ts')).toContain('fallback paths stay terminal-based');
  expect(read('tests/e2e/story-codex-appserver-transcript-ui-contract.spec.ts')).toContain('mobile App Server sessions use visible snapshot fallback');
  expect(read('tests/e2e/story-codex-appserver-assistant-ui-transcript-panel-contract.spec.ts')).toContain('failed island import keeps visible fallback transcript');
});

test('story-codex-appserver-assistant-ui-native-adoption ac:8 assistant-ui UI packages remain devDependencies', async () => {
  const pkg = JSON.parse(read('package.json'));
  expect(acceptanceCriteria[7]).toBe('`@assistant-ui/react-ui` and `@assistant-ui/react-markdown` remain development dependencies for the browser bundle and do not expand production Node dependency audit scope.');
  expect(pkg.dependencies['@assistant-ui/react-ui']).toBeUndefined();
  expect(pkg.dependencies['@assistant-ui/react-markdown']).toBeUndefined();
  expect(pkg.devDependencies['@assistant-ui/react-ui']).toBeDefined();
  expect(pkg.devDependencies['@assistant-ui/react-markdown']).toBeDefined();
});

test('story-codex-appserver-assistant-ui-native-adoption runtime renders OSS thread and submits App Server turn', async ({ page }) => {
  const sessionId = 'story-assistant-ui-native-runtime';
  const turnBodies: unknown[] = [];

  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
  });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], currentSessionId: null, preferences: {} })
    });
  });
  await page.route(`**/api/state/sessions/${sessionId}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-assistant-ui-native',
        status: 'ready',
        timeline: [
          { id: 'user-1', kind: 'user', text: 'Use assistant-ui native thread' },
          { id: 'assistant-1', kind: 'assistant', text: 'Here is `inline code`.\n\n```js\nconst nativeThread = true;\n```' },
          { id: 'tool-1', kind: 'tool', status: 'completed', text: 'Tool events are adapted as assistant text first.' }
        ]
      })
    });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/turns`, async (route) => {
    turnBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-assistant-ui-native',
        status: 'ready',
        timeline: [
          { id: 'user-2', kind: 'user', text: 'next native prompt' },
          { id: 'assistant-2', kind: 'assistant', text: 'Submitted through the App Server turn API.' }
        ]
      })
    });
  });

  await mountAppServerSession(page, sessionId);

  const panel = page.locator('#codex-app-server-display-panel');
  await expect(panel.locator('[data-codex-appserver-transcript-island]')).toBeVisible();
  await expect(panel.locator('.aui-thread-root')).toBeVisible();
  await expect(panel.locator('.aui-user-message-root')).toContainText('Use assistant-ui native thread');
  await expect(panel.locator('.aui-assistant-message-root').filter({ hasText: 'inline code' })).toBeVisible();
  await expect(panel.locator('.aui-md-inline-code').first()).toHaveText('inline code');
  await expect(page.locator('style#brainbase-assistant-ui-native-styles')).toHaveCount(1);

  const input = panel.locator('.aui-composer-input');
  await input.fill('next native prompt');
  await input.press('Enter');
  await expect.poll(() => turnBodies.length).toBe(1);
  expect(turnBodies[0]).toEqual({ text: 'next native prompt' });
  await expect(panel.locator('.aui-assistant-message-root').filter({ hasText: 'Submitted through the App Server turn API.' })).toBeVisible();
});
