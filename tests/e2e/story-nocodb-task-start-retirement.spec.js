import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

test('NocoDB task-start selectors are outside the retired Brainbase session surface', async () => {
    const sessionCapability = yaml.load(await readFile('docs/brainbase-capabilities/capabilities/session.create.yml', 'utf8'));
    const projectCapability = await readFile('docs/brainbase-capabilities/capabilities/project.selector.yml', 'utf8');

    expect(sessionCapability).toMatchObject({
        lifecycle: 'retired',
        surfaces: { ui: [], api: [], code: [], data: [] }
    });
    expect(projectCapability).not.toContain('#focus-engine-modal');
    expect(projectCapability).not.toContain('#session-launch-picker');
    expect(projectCapability).not.toContain('#session-launch-project-select');
});
