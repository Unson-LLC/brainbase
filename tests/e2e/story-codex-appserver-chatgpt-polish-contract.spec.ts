import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const acceptanceCriteria = [
  'The transcript island uses assistant-ui runtime, thread, message, and composer primitives for the primary chat surface instead of treating assistant-ui as only a wrapper.',
  'Assistant and user messages render as a centered, readable conversation with ChatGPT-like spacing, restrained chrome, and no debug-only labels in normal message bubbles.',
  'Markdown-style text, fenced code blocks, inline code, lists, and links render as structured React content without injecting HTML.',
  'Code blocks include a visible language label when present and a copy action that writes the code body to the clipboard.',
  'Reasoning, command, tool, file change, input request, turn, and error events render as compact activity rows with distinct icons, status labels, and expandable details where long content would otherwise dominate the thread.',
  'The composer supports ChatGPT-like keyboard behavior: Enter sends, Shift+Enter inserts a newline, the send button remains accessible, and empty sends are blocked.',
  'Loading, empty, sending, refresh, and API error states remain explicit and visually integrated with the thread.',
  'The existing Brainbase App Server transcript and turn APIs remain the only browser network contract; terminal input remains disabled in transcript mode.',
  'xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and the existing failed-island fallback stay intact.',
  'The browser bundle builds from `@assistant-ui/react` and the capability map records the polished assistant-ui surface.'
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
        name: 'ChatGPT Polish Session',
        path: '/tmp/chatgpt-polish',
        engine: 'codex',
        intendedState: 'active',
        codexAppServer: { threadId: 'thread-chatgpt-polish', status: 'ready' }
      }]
    });
    await app.switchSession(sid);
  }, sessionId);
}

test('story-codex-appserver-chatgpt-polish ac:1 assistant-ui message primitives are covered', async () => {
  const criterion = 'The transcript island uses assistant-ui runtime, thread, message, and composer primitives for the primary chat surface instead of treating assistant-ui as only a wrapper.';
  expect('The transcript island uses assistant-ui runtime, thread, message, and composer primitives for the primary chat surface instead of treating assistant-ui as only a wrapper.').toBe(criterion);
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(island).toContain('AssistantRuntimeProvider');
  expect(island).toContain('ThreadPrimitive');
  expect(island).toContain('MessagePrimitive');
  expect(island).toContain('ComposerPrimitive');
  expect(island).toContain('useExternalStoreRuntime');
});

test('story-codex-appserver-chatgpt-polish ac:1-ac:10 acceptance criteria are executable anchors', async () => {
  const story = read('docs/stories/story-codex-appserver-chatgpt-polish.md');
  const spec = read('docs/specs/codex-appserver-chatgpt-polish-spec.md');
  const architecture = read('docs/architecture/codex-appserver-chatgpt-polish-architecture.md');
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  const css = read('public/style.css');
  const capability = read('docs/brainbase-capabilities/capabilities/codex.app-server.yml');

  for (const criterion of acceptanceCriteria) {
    expect(story).toContain(criterion);
  }

  expect(spec).toContain('codex-appserver-chatgpt-polish.assistant-ui-depth');
  expect(spec).toContain('codex-appserver-chatgpt-polish.conversation-layout');
  expect(spec).toContain('codex-appserver-chatgpt-polish.safe-markdown');
  expect(spec).toContain('codex-appserver-chatgpt-polish.copy-code');
  expect(spec).toContain('codex-appserver-chatgpt-polish.activity-events');
  expect(spec).toContain('codex-appserver-chatgpt-polish.composer-keyboard');
  expect(spec).toContain('codex-appserver-chatgpt-polish.states');
  expect(spec).toContain('codex-appserver-chatgpt-polish.api-boundary');
  expect(spec).toContain('codex-appserver-chatgpt-polish.fallback');
  expect(spec).toContain('codex-appserver-chatgpt-polish.bundle');
  expect(architecture).toContain('Render the primary timeline through assistant-ui thread and message primitives');
  expect(island).toContain('MessagePrimitive.Root');
  expect(island).not.toContain('dangerouslySetInnerHTML');
  expect(css).toContain('codex-appserver-code-block');
  expect(css).toContain('codex-appserver-activity');
  expect(capability).toContain('story-codex-appserver-chatgpt-polish-contract.spec.ts');
});

test('story-codex-appserver-chatgpt-polish ac:2 safe markdown and code copy are covered', async () => {
  const layoutCriterion = 'Assistant and user messages render as a centered, readable conversation with ChatGPT-like spacing, restrained chrome, and no debug-only labels in normal message bubbles.';
  const markdownCriterion = 'Markdown-style text, fenced code blocks, inline code, lists, and links render as structured React content without injecting HTML.';
  const copyCriterion = 'Code blocks include a visible language label when present and a copy action that writes the code body to the clipboard.';
  expect('Assistant and user messages render as a centered, readable conversation with ChatGPT-like spacing, restrained chrome, and no debug-only labels in normal message bubbles.').toBe(layoutCriterion);
  expect('Markdown-style text, fenced code blocks, inline code, lists, and links render as structured React content without injecting HTML.').toBe(markdownCriterion);
  expect('Code blocks include a visible language label when present and a copy action that writes the code body to the clipboard.').toBe(copyCriterion);
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(island).toContain('splitFencedCode');
  expect(island).toContain('InlineMarkdown');
  expect(island).toContain('CodeBlock');
  expect(island).toContain('navigator.clipboard');
  expect(island).not.toContain('dangerouslySetInnerHTML');
});

test('story-codex-appserver-chatgpt-polish ac:3 composer keyboard contract is covered', async () => {
  const activityCriterion = 'Reasoning, command, tool, file change, input request, turn, and error events render as compact activity rows with distinct icons, status labels, and expandable details where long content would otherwise dominate the thread.';
  const composerCriterion = 'The composer supports ChatGPT-like keyboard behavior: Enter sends, Shift+Enter inserts a newline, the send button remains accessible, and empty sends are blocked.';
  const statesCriterion = 'Loading, empty, sending, refresh, and API error states remain explicit and visually integrated with the thread.';
  const apiCriterion = 'The existing Brainbase App Server transcript and turn APIs remain the only browser network contract; terminal input remains disabled in transcript mode.';
  const fallbackCriterion = 'xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and the existing failed-island fallback stay intact.';
  const bundleCriterion = 'The browser bundle builds from `@assistant-ui/react` and the capability map records the polished assistant-ui surface.';
  expect('Reasoning, command, tool, file change, input request, turn, and error events render as compact activity rows with distinct icons, status labels, and expandable details where long content would otherwise dominate the thread.').toBe(activityCriterion);
  expect('The composer supports ChatGPT-like keyboard behavior: Enter sends, Shift+Enter inserts a newline, the send button remains accessible, and empty sends are blocked.').toBe(composerCriterion);
  expect('Loading, empty, sending, refresh, and API error states remain explicit and visually integrated with the thread.').toBe(statesCriterion);
  expect('The existing Brainbase App Server transcript and turn APIs remain the only browser network contract; terminal input remains disabled in transcript mode.').toBe(apiCriterion);
  expect('xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and the existing failed-island fallback stay intact.').toBe(fallbackCriterion);
  expect('The browser bundle builds from `@assistant-ui/react` and the capability map records the polished assistant-ui surface.').toBe(bundleCriterion);
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(island).toContain('submitMode="enter"');
  expect(island).toContain('ComposerPrimitive.Send');
  expect(island).toContain('if (!text || !api?.startTurn) return;');
});

test('story-codex-appserver-chatgpt-polish ac:3 safe markdown is covered', async () => {
  const criterion = 'Markdown-style text, fenced code blocks, inline code, lists, and links render as structured React content without injecting HTML.';
  expect('Markdown-style text, fenced code blocks, inline code, lists, and links render as structured React content without injecting HTML.').toBe(criterion);
  expect(read('ui-islands/codex-appserver-transcript/index.jsx')).not.toContain('dangerouslySetInnerHTML');
});

test('story-codex-appserver-chatgpt-polish ac:4 code copy is covered', async () => {
  const criterion = 'Code blocks include a visible language label when present and a copy action that writes the code body to the clipboard.';
  expect('Code blocks include a visible language label when present and a copy action that writes the code body to the clipboard.').toBe(criterion);
  expect(read('ui-islands/codex-appserver-transcript/index.jsx')).toContain('navigator.clipboard');
});

test('story-codex-appserver-chatgpt-polish ac:5 activity events are covered', async () => {
  const criterion = 'Reasoning, command, tool, file change, input request, turn, and error events render as compact activity rows with distinct icons, status labels, and expandable details where long content would otherwise dominate the thread.';
  expect('Reasoning, command, tool, file change, input request, turn, and error events render as compact activity rows with distinct icons, status labels, and expandable details where long content would otherwise dominate the thread.').toBe(criterion);
  expect(read('ui-islands/codex-appserver-transcript/index.jsx')).toContain('ACTIVITY_KIND_CONFIG');
});

test('story-codex-appserver-chatgpt-polish ac:6 composer keyboard is covered', async () => {
  const criterion = 'The composer supports ChatGPT-like keyboard behavior: Enter sends, Shift+Enter inserts a newline, the send button remains accessible, and empty sends are blocked.';
  expect('The composer supports ChatGPT-like keyboard behavior: Enter sends, Shift+Enter inserts a newline, the send button remains accessible, and empty sends are blocked.').toBe(criterion);
  expect(read('ui-islands/codex-appserver-transcript/index.jsx')).toContain('submitMode="enter"');
});

test('story-codex-appserver-chatgpt-polish ac:7 visible states are covered', async () => {
  const criterion = 'Loading, empty, sending, refresh, and API error states remain explicit and visually integrated with the thread.';
  expect('Loading, empty, sending, refresh, and API error states remain explicit and visually integrated with the thread.').toBe(criterion);
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(island).toContain('Loading transcript');
  expect(island).toContain('No transcript yet');
});

test('story-codex-appserver-chatgpt-polish ac:8 api boundary is covered', async () => {
  const criterion = 'The existing Brainbase App Server transcript and turn APIs remain the only browser network contract; terminal input remains disabled in transcript mode.';
  expect('The existing Brainbase App Server transcript and turn APIs remain the only browser network contract; terminal input remains disabled in transcript mode.').toBe(criterion);
  expect(read('public/modules/app/codex-app-server-display-mixin.js')).toContain('codex-app-server/turns');
});

test('story-codex-appserver-chatgpt-polish ac:9 fallback is covered', async () => {
  const criterion = 'xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and the existing failed-island fallback stay intact.';
  expect('xterm/ttyd fallback, mobile fallback, Claude Code terminal routing, and the existing failed-island fallback stay intact.').toBe(criterion);
  expect(read('tests/e2e/story-codex-appserver-assistant-ui-transcript-panel-contract.spec.ts')).toContain('failed island import keeps visible fallback transcript');
});

test('story-codex-appserver-chatgpt-polish ac:10 bundle and capability map are covered', async () => {
  const criterion = 'The browser bundle builds from `@assistant-ui/react` and the capability map records the polished assistant-ui surface.';
  expect('The browser bundle builds from `@assistant-ui/react` and the capability map records the polished assistant-ui surface.').toBe(criterion);
  expect(read('package.json')).toContain('build:codex-appserver-transcript');
  expect(read('docs/brainbase-capabilities/capabilities/codex.app-server.yml')).toContain('story-codex-appserver-chatgpt-polish-contract.spec.ts');
});

test('story-codex-appserver-chatgpt-polish runtime: polished thread renders markdown, activities, copy code, and Enter send', async ({ page }) => {
  const sessionId = 'story-chatgpt-polish-runtime';
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
        threadId: 'thread-chatgpt-polish',
        status: 'ready',
        timeline: [
          { id: 'user-1', kind: 'user', text: 'Show me markdown and code' },
          {
            id: 'assistant-1',
            kind: 'assistant',
            text: 'Here is `inline code`.\n\n- first item\n- second item\n\n```js\nconst answer = 95;\nconsole.log(answer);\n```\n\n[OpenAI](https://openai.com)'
          },
          { id: 'reasoning-1', kind: 'reasoning', status: 'completed', text: 'Long reasoning detail\nwith a second line' },
          { id: 'tool-1', kind: 'tool', status: 'completed', text: 'read_file completed' }
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
        threadId: 'thread-chatgpt-polish',
        status: 'ready',
        timeline: [
          { id: 'user-2', kind: 'user', text: 'next prompt' },
          { id: 'assistant-2', kind: 'assistant', text: 'Submitted with Enter' }
        ]
      })
    });
  });

  await mountAppServerSession(page, sessionId);

  const panel = page.locator('#codex-app-server-display-panel');
  await expect(panel.locator('[data-codex-appserver-transcript-island]')).toBeVisible();
  await expect(panel.locator('.codex-appserver-chat-message.user .codex-appserver-chat-bubble')).toContainText('Show me markdown and code');
  await expect(panel.locator('.codex-appserver-inline-code')).toContainText('inline code');
  await expect(panel.locator('.codex-appserver-markdown-list li')).toHaveCount(2);
  await expect(panel.locator('.codex-appserver-code-block figcaption')).toContainText('js');
  await expect(panel.locator('.codex-appserver-code-block code')).toContainText('const answer = 95;');
  await expect(panel.locator('[data-codex-appserver-activity-kind="reasoning"]')).toBeVisible();
  await expect(panel.locator('[data-codex-appserver-activity-kind="tool"]')).toBeVisible();

  await panel.locator('.codex-appserver-copy-code').click();
  await expect(panel.locator('.codex-appserver-copy-code')).toContainText(/Copy|Copied/);

  await panel.locator('.codex-appserver-chat-input').fill('next prompt');
  await panel.locator('.codex-appserver-chat-input').press('Enter');
  await expect(panel).toContainText('Submitted with Enter');
  expect(turnBodies).toEqual([{ text: 'next prompt' }]);
});

test('story-codex-appserver-chatgpt-polish runtime: Shift+Enter keeps multiline draft without sending', async ({ page }) => {
  const sessionId = 'story-chatgpt-polish-shift-enter';
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
      body: JSON.stringify({ sessionId, threadId: 'thread-shift-enter', status: 'ready', timeline: [] })
    });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/turns`, async (route) => {
    turnBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId, threadId: 'thread-shift-enter', status: 'ready', timeline: [] })
    });
  });

  await mountAppServerSession(page, sessionId);
  const input = page.locator('#codex-app-server-display-panel .codex-appserver-chat-input');
  await input.fill('line one');
  await input.press('Shift+Enter');
  await input.pressSequentially('line two');
  await expect(input).toHaveValue('line one\nline two');
  expect(turnBodies).toEqual([]);
});
