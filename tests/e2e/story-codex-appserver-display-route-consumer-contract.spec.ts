import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

const storyPath = 'docs/stories/story-codex-appserver-display-route-consumer.md';
const architecturePath = 'docs/architecture/codex-appserver-display-route-consumer-architecture.md';
const specPath = 'docs/specs/codex-appserver-display-route-consumer-spec.md';
const displayMixinPath = 'public/modules/app/codex-app-server-display-mixin.js';
const sessionManagementPath = 'public/modules/app/session-management-mixin.js';
const htmlPath = 'public/index.html';
const testPath = 'tests/ui/integration/app-switch-session-runtime.test.js';

test('story-codex-appserver-display-route-consumer acceptance contract', async () => {
  const story = read(storyPath);
  const architecture = read(architecturePath);
  const spec = read(specPath);
  const displayMixin = read(displayMixinPath);
  const sessionManagement = read(sessionManagementPath);
  const html = read(htmlPath);
  const tests = read(testPath);

  const acceptanceCriteria = [
    ['ac:1', 'show a dedicated Codex App Server display panel'],
    ['ac:2', '`public/app.js` registers the display mixin'],
    ['ac:3', '_resolveSessionRuntime()'],
    ['ac:4', 'Brainbase session id and Codex App Server thread id'],
    ['ac:5', 'legacy terminal input, reconnect, and fallback controls must not send terminal input'],
    ['ac:6', 'terminal fallback remains available'],
    ['ac:7', 'Claude Code sessions still use the existing xterm/ttyd terminal path'],
    ['ac:8', 'Codex sessions without usable App Server thread metadata still use the existing xterm/ttyd terminal path'],
    ['ac:9', 'Mobile snapshot behavior remains unchanged in this slice'],
    ['ac:10', 'Graphify Impact Review is recorded']
  ];

  for (const [id, snippet] of acceptanceCriteria) {
    expect(`${id}: ${story}`).toContain(snippet);
  }

  expect(story).toContain('show a dedicated Codex App Server display panel');
  expect(architecture).toContain('route Codex sessions with non-stale App Server thread metadata');
  expect(architecture).toContain('legacy terminal input, reconnect, click-to-focus, and type-to-focus handlers read-only');
  expect(spec).toContain('display-route-consumer.codex-app-server');
  expect(spec).toContain('display-route-consumer.read-only-controls');
  expect(spec).toContain('Graphify Impact Review');
  expect(displayMixin).toContain('_shouldUseCodexAppServerDisplay');
  expect(displayMixin).toContain('data-codex-app-server-thread-id');
  expect(sessionManagement).toContain("mode: 'codex_app_server'");
  expect(html).toContain('codex-app-server-display-panel');
  expect(tests).toContain('Codex App Server display route switches to the App Server panel');
  expect(tests).toContain('Codex App Server display route remains read-only for legacy terminal controls');
  expect(tests).toContain('not.toHaveBeenCalled');
  expect(tests).toContain('Claude Code sessions with stray App Server metadata still use the xterm fallback path');
  expect(tests).toContain('Codex sessions with missing App Server metadata stay on the xterm fallback path');
  expect(tests).toContain('Codex sessions with stale App Server metadata stay on the xterm fallback path');
  expect(tests).toContain('mobile localhostではswitchSessionはsnapshot displayを使う');
});
