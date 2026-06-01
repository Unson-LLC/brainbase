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
const capabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';

test('story-codex-appserver-display-route-consumer acceptance contract', async () => {
  const story = read(storyPath);
  const architecture = read(architecturePath);
  const spec = read(specPath);
  const displayMixin = read(displayMixinPath);
  const sessionManagement = read(sessionManagementPath);
  const html = read(htmlPath);
  const tests = read(testPath);
  const capability = read(capabilityPath);

  const acceptanceCriteria = [
    ['ac:1', 'may open the native App Server transcript panel by default'],
    ['ac:2', '`public/app.js` registers the display mixin'],
    ['ac:3', 'do not call `_resolveSessionRuntime()`'],
    ['ac:4', 'Brainbase session id and Codex App Server thread id'],
    ['ac:5', 'legacy terminal input must not send terminal input unless the user explicitly switches to xterm/ttyd fallback'],
    ['ac:6', 'terminal fallback remains available'],
    ['ac:7', 'Claude Code sessions still use the existing xterm/ttyd terminal path'],
    ['ac:8', 'Codex sessions without usable App Server thread metadata still use the existing xterm/ttyd terminal path'],
    ['ac:9', 'Mobile snapshot behavior remains unchanged in this slice'],
    ['ac:10', 'Graphify Impact Review is recorded']
  ];

  for (const [id, snippet] of acceptanceCriteria) {
    expect(`${id}: ${story}`).toContain(snippet);
  }

  expect(story).toContain('xterm/ttyd remains available through explicit terminal transport fallback');
  expect(architecture).toContain('may route to the transcript panel by default');
  expect(architecture).toContain('preserve xterm/ttyd fallback');
  expect(spec).toContain('display-route-consumer.codex-app-server');
  expect(spec).toContain('display-route-consumer.codex-app-server-fallback');
  expect(spec).toContain('display-route-consumer.read-only-controls');
  expect(spec).toContain('Graphify Impact Review');
  expect(capability).toContain('story-codex-appserver-transcript-ui');
  expect(displayMixin).toContain('_shouldUseCodexAppServerDisplay');
  expect(displayMixin).toContain('data-codex-app-server-thread-id');
  expect(sessionManagement).toContain("mode: 'codex_app_server'");
  expect(html).toContain('codex-app-server-display-panel');
  expect(tests).toContain('Codex App Server sessions default to the transcript panel without starting terminal runtime');
  expect(tests).toContain('Codex App Server display route remains read-only for legacy terminal controls when enabled');
  expect(tests).toContain('not.toHaveBeenCalled');
  expect(tests).toContain('Claude Code sessions with stray App Server metadata still use the xterm fallback path');
  expect(tests).toContain('Codex sessions with missing App Server metadata stay on the xterm fallback path');
  expect(tests).toContain('Codex sessions with stale App Server metadata stay on the xterm fallback path');
  expect(tests).toContain('mobile localhostではswitchSessionはsnapshot displayを使う');
});
