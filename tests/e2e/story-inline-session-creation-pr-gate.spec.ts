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
    expect(spec).toContain('The inline draft shell must be client-owned before confirmation');
    expect(spec).toContain('Inline draft shells must not start terminal runtime');
    expect(spec).toContain('Mobile and desktop new-session entrypoints share the same inline state machine');
  });

  test('story-inline-session-creation ac:3 implements modal suppression in public UI code', async () => {
    const story = await read(storyPath);
    const sessionCreation = await read('public/modules/app/session-creation-mixin.js');
    const eventListeners = await read('public/modules/app/event-listeners-mixin.js');
    expect(story).toContain('Remove `#create-session-modal` from the primary desktop and mobile new-session path');
    expect(sessionCreation).toContain('openInlineSessionDraft');
    expect(sessionCreation).toContain('return this.openInlineSessionDraft(project)');
    expect(eventListeners).toContain('this.openInlineSessionDraft(project)');
  });

  test('story-inline-session-creation ac:4 keeps draft client-owned until confirmation', async () => {
    const sessionCreation = await read('public/modules/app/session-creation-mixin.js');
    expect(sessionCreation).toContain('draft.classList.remove');
    expect(sessionCreation).toContain('await this.createSession(selectedProject, name, initialCommand, useWorktree, engine)');
    const handleCreateBlock = sessionCreation.slice(
      sessionCreation.indexOf('const handleCreate = async () =>'),
      sessionCreation.indexOf('createBtn.addEventListener')
    );
    expect(handleCreateBlock).toContain('closeDraft();');
    expect(handleCreateBlock.indexOf('closeDraft();')).toBeLessThan(
      handleCreateBlock.indexOf('await this.createSession(selectedProject, name, initialCommand, useWorktree, engine)')
    );
  });

  test('story-inline-session-creation ac:5 updates capability artifacts away from create-session modal', async () => {
    const sessionCapability = await read('docs/brainbase-capabilities/capabilities/session.create.yml');
    const projectCapability = await read('docs/brainbase-capabilities/capabilities/project.selector.yml');
    expect(sessionCapability).toContain('#inline-session-draft');
    expect(sessionCapability).not.toContain('#create-session-modal');
    expect(projectCapability).toContain('#inline-session-project-select');
    expect(projectCapability).not.toContain('#create-session-modal');
  });

  test('story-inline-session-creation ac:6 keeps earlier network cleanup evidence intact', async () => {
    const manaRoutes = await read(manaRoutesPath);
    const pauseOrphan = await read(pauseOrphanPath);
    expect(manaRoutes).toContain('buildManaLambdaUrl');
    expect(manaRoutes).toContain("buildManaLambdaUrl('api/chat')");
    expect(pauseOrphan).toContain('buildBrainbaseUrl');
    expect(pauseOrphan).toContain('buildSessionStateUrl');
  });

  test('story-inline-session-creation gate surface is inline implementation, not planning-only evidence', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    expect(story).toContain('Desktop `#add-session-btn` and mobile new-session entrypoints open the inline draft shell');
    expect(spec).toContain('`#add-session-btn` creates/selects a client-owned inline draft shell');
    expect(story).not.toContain('Current UI journeys are explicitly non-applicable');
    expect(spec).not.toContain('browser UI journeys are non-applicable in this PR because no public UI source is changed');
  });
});
