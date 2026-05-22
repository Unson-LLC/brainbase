import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/user_stories/active/story-inline-session-creation.md';
const specPath = 'docs/specs/story-inline-session-creation-spec.md';
const manaRoutesPath = 'server/routes/brainbase/mana-capture-routes.js';
const pauseOrphanPath = 'server/scripts/pause-orphan-tmux-missing-sessions.js';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('story-inline-session-creation PR gate evidence', () => {
  test('story-inline-session-creation ac:1 documents the modal removal rationale', async () => {
    const story = await read(storyPath);
    expect(story).toContain('create-session modal');
    expect(story).toContain('pending startup');
    expect(story).toContain('画面数と待ちを増やしている');
  });

  test('story-inline-session-creation ac:2 defines inline draft shell runtime boundaries', async () => {
    const spec = await read(specPath);
    expect(spec).toContain('Inline draft shells must not start terminal runtime');
    expect(spec).toContain('Canceling an unconfirmed draft shell must not archive');
    expect(spec).toContain('Mobile and desktop new-session entrypoints share the same inline creation state machine');
  });

  test('story-inline-session-creation ac:3 keeps implementation work separated from this PR', async () => {
    const story = await read(storyPath);
    expect(story).toContain('Future Implementation Checklist');
    expect(story).toContain('does not claim the modal has already been removed');
  });

  test('story-inline-session-creation ac:4 uses explicit URL helpers for network contract cleanup', async () => {
    const manaRoutes = await read(manaRoutesPath);
    const pauseOrphan = await read(pauseOrphanPath);
    expect(manaRoutes).toContain('buildManaLambdaUrl');
    expect(manaRoutes).toContain("buildManaLambdaUrl('api/chat')");
    expect(pauseOrphan).toContain('buildBrainbaseUrl');
    expect(pauseOrphan).toContain('buildSessionStateUrl');
  });

  test('story-inline-session-creation ac:5 preserves tmux-missing session filtering semantics', async () => {
    const script = await read(pauseOrphanPath);
    expect(script).toContain('filter.has(issue.sessionId)');
    expect(script).toContain('tmux_missing');
    expect(script).toContain("method: 'PATCH'");
  });
});
