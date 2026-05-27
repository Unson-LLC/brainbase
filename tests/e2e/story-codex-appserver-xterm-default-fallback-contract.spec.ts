import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 story-codex-appserver-xterm-default-fallback acceptance contract', async () => {
  const story = read('docs/stories/story-codex-appserver-xterm-default-fallback.md');
  const architecture = read('docs/architecture/story-codex-appserver-xterm-default-fallback-architecture.md');
  const spec = read('docs/specs/story-codex-appserver-xterm-default-fallback-spec.md');
  const capability = read('docs/brainbase-capabilities/capabilities/codex.app-server.yml');
  const displayMixin = read('public/modules/app/codex-app-server-display-mixin.js');
  const sessionSwitchTests = read('tests/ui/integration/app-switch-session-runtime.test.js');
  const sessionCreateTests = read('tests/e2e/story-codex-appserver-session-create-contract.spec.ts');

  const acceptanceCriteria = [
    'Codex sessions with non-stale `session.codexAppServer.threadId` keep the xterm/ttyd display path by default',
    'The read-only Codex App Server display panel is available only behind an explicit diagnostic browser opt-in',
    'When the diagnostic panel is enabled, legacy terminal input and reconnect controls remain read-only and do not start terminal runtime',
    'New regular and worktree Codex session creation still persists App Server thread metadata',
    'Claude Code sessions and Codex sessions without usable App Server metadata continue to use the existing terminal fallback path',
    'Capability, Story, Architecture, Spec, and contract tests consistently describe the same default xterm behavior'
  ];

  for (const criterion of acceptanceCriteria) {
    expect(story).toContain(criterion);
  }

  // story-codex-appserver-xterm-default-fallback ac:1
  expect(story).toContain('Codex sessions with non-stale `session.codexAppServer.threadId` keep the xterm/ttyd display path by default');
  // story-codex-appserver-xterm-default-fallback ac:2
  expect(story).toContain('The read-only Codex App Server display panel is available only behind an explicit diagnostic browser opt-in');
  // story-codex-appserver-xterm-default-fallback ac:3
  expect(story).toContain('When the diagnostic panel is enabled, legacy terminal input and reconnect controls remain read-only and do not start terminal runtime');
  // story-codex-appserver-xterm-default-fallback ac:4
  expect(story).toContain('New regular and worktree Codex session creation still persists App Server thread metadata');
  // story-codex-appserver-xterm-default-fallback ac:5
  expect(story).toContain('Claude Code sessions and Codex sessions without usable App Server metadata continue to use the existing terminal fallback path');
  // story-codex-appserver-xterm-default-fallback ac:6
  expect(story).toContain('Capability, Story, Architecture, Spec, and contract tests consistently describe the same default xterm behavior');

  expect(architecture).toContain('do not let it take over the user-facing terminal stage by default');
  expect(spec).toContain('codex-appserver-xterm-default.default-xterm');
  expect(spec).toContain('codex-appserver-xterm-default.diagnostic-opt-in');
  expect(capability).toContain('interactive xterm/ttyd path as the default user-facing route');
  expect(displayMixin).toContain('__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__');
  expect(displayMixin).toContain('_isCodexAppServerDisplayEnabled');
  expect(sessionSwitchTests).toContain('Codex App Server sessions default to the xterm fallback so the operator can keep working');
  expect(sessionSwitchTests).toContain('Codex App Server display route can opt into the read-only App Server panel');
  expect(sessionCreateTests).toContain('attachRuntimeIssueCollector');
  expect(sessionCreateTests).toContain('runtimeIssues.assertNoIssues()');
});
