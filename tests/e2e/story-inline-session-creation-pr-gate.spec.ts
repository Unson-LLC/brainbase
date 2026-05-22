import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/user_stories/active/story-inline-session-creation.md';
const specPath = 'docs/specs/story-inline-session-creation-spec.md';
const manaRoutesPath = 'server/routes/brainbase/mana-capture-routes.js';
const pauseOrphanPath = 'server/scripts/pause-orphan-tmux-missing-sessions.js';
const prBodyPath = '.vibepro/pr/story-inline-session-creation/pr-body.md';
const gateDagPath = '.vibepro/pr/story-inline-session-creation/gate-dag.json';

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
    expect(spec).toContain('future inline draft shell must be client-owned before confirmation');
    expect(spec).toContain('Future inline draft shells must not start terminal runtime');
    expect(spec).toContain('Future mobile and desktop new-session entrypoints share the same inline state machine');
  });

  test('story-inline-session-creation ac:3 keeps implementation work separated from this PR', async () => {
    const story = await read(storyPath);
    expect(story).toContain('Follow-up Implementation Notes');
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

  test('story-inline-session-creation ac:6 classifies current UI journeys as non-applicable for this PR', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    expect(story).toContain('Current UI journeys are explicitly non-applicable');
    expect(spec).toContain('browser UI journeys are non-applicable in this PR because no public UI source is changed');
    expect(spec).toContain('docs/brainbase-capabilities/capabilities/session.create.yml');
    expect(spec).toContain('docs/brainbase-capabilities/capabilities/project.selector.yml');
  });

  test('story-inline-session-creation gate artifacts use the current planning/network acceptance surface', async () => {
    const prBody = await read(prBodyPath);
    const gateDag = JSON.parse(await read(gateDagPath));
    const serializedGateDag = JSON.stringify(gateDag);
    expect(prBody).toContain('Current UI journeys are explicitly non-applicable');
    expect(serializedGateDag).toContain('Current UI journeys are explicitly non-applicable');
    expect(serializedGateDag).not.toContain('Desktop `#add-session-btn` does not activate `#create-session-modal`');
  });
});
