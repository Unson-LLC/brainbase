import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

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

  test('retires browser session selectors and keeps Workspace Setup ownership separate', async () => {
    const sessionCapability = yaml.load(await read('docs/brainbase-capabilities/capabilities/session.create.yml')) as {
      lifecycle: string;
      surfaces: Record<string, string[]>;
    };
    const projectCapability = await read('docs/brainbase-capabilities/capabilities/project.selector.yml');
    expect(sessionCapability.lifecycle).toBe('retired');
    expect(sessionCapability.surfaces).toEqual({ ui: [], api: [], code: [], data: [] });
    expect(projectCapability).not.toContain('#session-launch-picker');
    expect(projectCapability).not.toContain('#session-launch-project-select');
    expect(projectCapability).toContain('#session-project-select');
    expect(projectCapability).not.toContain('#create-session-modal');
  });
});
