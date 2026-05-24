import { test, expect } from '@playwright/test';

import { buildHibernationEligibility, buildRuntimeInventory } from '../../server/services/session-runtime/runtime-query-methods.js';
import { renderSessionRowHTML } from '../../public/modules/session-list-renderer.js';

// story-session-hibernation-mvp ac:1
// story-session-hibernation-mvp ac:2
// story-session-hibernation-mvp ac:3
// story-session-hibernation-mvp ac:4
// story-session-hibernation-mvp ac:5
// story-session-hibernation-mvp ac:6
// story-session-hibernation-mvp ac:7
// story-session-hibernation-mvp ac:8
// story-session-hibernation-mvp ac:9
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

test('story-session-hibernation-mvp phase 2 hibernate/resume UI contract', async () => {
  const codexEligibility = buildHibernationEligibility({
    session: {
      id: 'story-session-codex',
      engine: 'codex',
      codexThreadId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
    },
    inventorySession: {
      runtimePresence: 'hot',
      rssKb: 2048,
      processCount: 1,
      processesByCategory: { codex: 1, unknown_child: 0 },
      processes: [{ pid: 501, category: 'codex', ownershipStrength: 'strong' }]
    }
  });
  expect(codexEligibility).toMatchObject({
    eligible: true,
    blockers: [],
    restoreMetadata: {
      restoreStrategy: 'codex_resume',
      codexResumeId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
    }
  });
  expect(codexEligibility.ownedProcesses).toEqual([
    expect.objectContaining({ pid: 501, category: 'codex' })
  ]);

  const claudeEligibility = buildHibernationEligibility({
    session: {
      id: 'story-session-claude',
      engine: 'claude'
    },
    inventorySession: {
      runtimePresence: 'hot',
      rssKb: 2048,
      processCount: 1,
      processesByCategory: { claude: 1, unknown_child: 0 },
      processes: [{ pid: 601, category: 'claude' }]
    }
  });
  expect(claudeEligibility.eligible).toBe(false);
  expect(claudeEligibility.blockers).toContain('unsupported_engine');

  const activeCodexHtml = renderSessionRowHTML({
    id: 'story-session-codex',
    name: 'Story Codex',
    engine: 'codex',
    intendedState: 'active'
  }, { project: 'brainbase' });
  expect(activeCodexHtml).toContain('hibernate-session-btn');

  const activeClaudeHtml = renderSessionRowHTML({
    id: 'story-session-claude',
    name: 'Story Claude',
    engine: 'claude',
    intendedState: 'active'
  }, { project: 'brainbase' });
  expect(activeClaudeHtml).not.toContain('hibernate-session-btn');

  const hibernatedHtml = renderSessionRowHTML({
    id: 'story-session-hibernated',
    name: 'Story Hibernated',
    engine: 'codex',
    intendedState: 'hibernated',
    hibernatedAt: '2026-05-23T00:00:00.000Z'
  }, { project: 'brainbase' });
  expect(hibernatedHtml).toContain('session-child-row hibernated');
  expect(hibernatedHtml).toContain('resume-runtime-btn');
  expect(hibernatedHtml).toContain('hibernated');
});
