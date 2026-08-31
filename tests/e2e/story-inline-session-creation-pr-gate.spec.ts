import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const storyPath = 'docs/user_stories/retired/story-session-launch-picker-startup-composer.md';
const specPath = 'docs/specs/story-session-launch-picker-startup-composer-spec.md';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

test.describe('story-session-launch-picker-startup-composer PR gate evidence', () => {
  test('documents the retired launch picker ownership boundary', async () => {
    const story = await read(storyPath);
    const spec = await read(specPath);
    expect(story).toContain('Session Launch Picker');
    expect(story).toContain('Startup Composer');
    expect(story).toContain('status: retired');
    expect(spec).toContain('status: retired');
    expect(spec).toContain('Codex app/CLI owns task and');
  });

  test('fails closed instead of opening the retired picker', async () => {
    const eventListeners = await read('public/modules/app/event-listeners-mixin.js');
    expect(eventListeners).not.toContain('this.openSessionLaunchPicker(project)');
    expect(eventListeners).toContain('新しいタスクはCodexアプリから作成してください');
  });

  test('assigns picker ownership to the retired session capability', async () => {
    const sessionCapability = await read('docs/brainbase-capabilities/capabilities/session.create.yml');
    const projectCapability = await read('docs/brainbase-capabilities/capabilities/project.selector.yml');
    expect(sessionCapability).toContain('lifecycle: retired');
    expect(sessionCapability).toContain('#session-launch-picker');
    expect(sessionCapability).not.toContain('#session-startup-composer');
    expect(sessionCapability).not.toContain('#create-session-modal');
    expect(projectCapability).not.toContain('#session-launch-picker');
    expect(projectCapability).not.toContain('#session-launch-project-select');
    expect(projectCapability).toContain('#session-project-select');
    expect(projectCapability).not.toContain('#create-session-modal');
  });
});
