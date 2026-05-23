import { test, expect } from '@playwright/test';

import { buildRuntimeInventory } from '../../server/services/session-runtime/runtime-query-methods.js';

// story-session-hibernation-mvp ac:1
// story-session-hibernation-mvp ac:2
// story-session-hibernation-mvp ac:3
// story-session-hibernation-mvp ac:4
// story-session-hibernation-mvp ac:5
// story-session-hibernation-mvp ac:6 - deferred to Phase2 PR
// story-session-hibernation-mvp ac:7 - deferred to Phase2 PR
// story-session-hibernation-mvp ac:8 - deferred to Phase2 PR
// story-session-hibernation-mvp ac:9 - deferred to Phase2 PR
// story-session-hibernation-mvp ac:10 - deferred to Phase3 PR
// story-session-hibernation-mvp ac:11 - deferred to Phase4 PR
// story-session-hibernation-mvp ac:12 - deferred to Phase4 PR

test('story-session-hibernation-mvp phase 1 runtime inventory contract', async () => {
  const session = {
    id: 'story-session-hot',
    name: 'Story Session Hot',
    intendedState: 'active',
    path: '/tmp/story-session-hot',
  };

  const inventory = buildRuntimeInventory({
    sessions: [session],
    activeSessions: new Map(),
    psOutput: [
      '501 1 4096 codex resume story-session-hot',
      '502 501 2048 node /tmp/story-session-hot/.claude/mcp/server.js',
      '503 1 1024 node /tmp/shared/.claude/mcp/server.js',
    ].join('\n'),
  });

  expect(inventory.sessions).toHaveLength(1);
  expect(inventory.sessions[0]).toMatchObject({
    sessionId: 'story-session-hot',
    runtimePresence: 'hot',
    rssKb: 6144,
    processCount: 2,
    processesByCategory: {
      codex: 1,
      mcp: 1,
    },
  });
  expect(inventory.unattributed).toEqual([
    expect.objectContaining({
      category: 'mcp',
      reason: 'no_session_match',
    }),
  ]);
});
