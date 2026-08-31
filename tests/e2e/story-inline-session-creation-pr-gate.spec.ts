import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/user_stories/active/story-session-launch-picker-startup-composer.md';
const specPath = 'docs/specs/story-session-launch-picker-startup-composer-spec.md';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('story-session-launch-picker-startup-composer PR gate evidence', () => {
  test('documents the launch picker and startup composer contract', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    expect(story).toContain('Session Launch Picker');
    expect(story).toContain('Startup Composer');
    expect(spec).toContain('Session Launch Picker owns only immutable startup settings');
    expect(spec).toContain('Session name and initial prompt must not block background startup');
  });

  test('implements the new session entrypoint and keeps modal suppressed', async () => {
    const sessionCreation = await read('public/modules/app/session-creation-mixin.js');
    const eventListeners = await read('public/modules/app/event-listeners-mixin.js');
    expect(sessionCreation).toContain('openSessionLaunchPicker');
    expect(sessionCreation).toContain('openInlineSessionDraft');
    expect(sessionCreation).toContain('return this.openSessionLaunchPicker(project)');
    expect(eventListeners).toContain('this.openSessionLaunchPicker(project)');
  });

  test('keeps the retired session capability separate from the residual picker contract', async () => {
    const sessionCapability = await read('docs/brainbase-capabilities/capabilities/session.create.yml');
    const projectCapability = await read('docs/brainbase-capabilities/capabilities/project.selector.yml');
    expect(sessionCapability).toContain('lifecycle: retired');
    expect(sessionCapability).not.toContain('#session-launch-picker');
    expect(sessionCapability).not.toContain('#session-startup-composer');
    expect(sessionCapability).not.toContain('#create-session-modal');
    expect(projectCapability).toContain('#session-launch-picker');
    expect(projectCapability).toContain('#session-launch-project-select');
    expect(projectCapability).not.toContain('#create-session-modal');
  });
});
