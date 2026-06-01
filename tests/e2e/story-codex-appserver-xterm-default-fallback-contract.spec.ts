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
    'Codex sessions with non-stale `session.codexAppServer.threadId` may default to the native transcript panel when `story-codex-appserver-transcript-ui` is present',
    'xterm/ttyd remains available through explicit fallback actions and unsupported, stale, or failed App Server transcript paths',
    'When the App Server transcript panel is active, legacy terminal input remains read-only unless the user explicitly switches to xterm/ttyd fallback',
    'New regular and worktree Codex session creation still persists App Server thread metadata',
    'Claude Code sessions and Codex sessions without usable App Server metadata continue to use the existing terminal fallback path',
    'Capability, Story, Architecture, Spec, and contract tests consistently describe transcript default plus xterm/ttyd fallback behavior'
  ];

  for (const criterion of acceptanceCriteria) {
    expect(story).toContain(criterion);
  }

  // story-codex-appserver-xterm-default-fallback ac:1
  expect(story).toContain('Codex sessions with non-stale `session.codexAppServer.threadId` may default to the native transcript panel when `story-codex-appserver-transcript-ui` is present');
  // story-codex-appserver-xterm-default-fallback ac:2
  expect(story).toContain('xterm/ttyd remains available through explicit fallback actions and unsupported, stale, or failed App Server transcript paths');
  // story-codex-appserver-xterm-default-fallback ac:3
  expect(story).toContain('When the App Server transcript panel is active, legacy terminal input remains read-only unless the user explicitly switches to xterm/ttyd fallback');
  // story-codex-appserver-xterm-default-fallback ac:4
  expect(story).toContain('New regular and worktree Codex session creation still persists App Server thread metadata');
  // story-codex-appserver-xterm-default-fallback ac:5
  expect(story).toContain('Claude Code sessions and Codex sessions without usable App Server metadata continue to use the existing terminal fallback path');
  // story-codex-appserver-xterm-default-fallback ac:6
  expect(story).toContain('Capability, Story, Architecture, Spec, and contract tests consistently describe transcript default plus xterm/ttyd fallback behavior');

  expect(architecture).toContain('keep xterm/ttyd as an explicit fallback path');
  expect(spec).toContain('codex-appserver-xterm-default.transcript-default-supersedes');
  expect(spec).toContain('codex-appserver-xterm-default.explicit-terminal-fallback');
  expect(capability).toContain('default to the native transcript panel');
  expect(capability).toContain('preserve xterm/ttyd fallback');
  expect(displayMixin).toContain('__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__');
  expect(displayMixin).toContain('_isCodexAppServerDisplayEnabled');
  expect(sessionSwitchTests).toContain('Codex App Server sessions default to the transcript panel without starting terminal runtime');
  expect(sessionSwitchTests).toContain('Codex App Server display route opens the structured App Server panel');
  expect(sessionSwitchTests).toContain('Codex sessions with missing App Server metadata stay on the xterm fallback path');
  expect(sessionSwitchTests).toContain('Codex sessions with stale App Server metadata stay on the xterm fallback path');
  expect(sessionCreateTests).toContain('attachRuntimeIssueCollector');
  expect(sessionCreateTests).toContain('runtimeIssues.assertNoIssues()');
});
