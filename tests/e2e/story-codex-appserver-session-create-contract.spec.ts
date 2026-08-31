import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const retiredDocumentPaths = {
  story: 'docs/stories/story-codex-appserver-session-create.md',
  architecture: 'docs/architecture/codex-appserver-session-create-architecture.md',
  spec: 'docs/specs/codex-appserver-session-create-spec.md',
};
const projectProvisioningPath = 'docs/brainbase-capabilities/capabilities/project.provisioning.yml';
const retirementRunbookPath = 'docs/brainbase-capabilities/runbooks/missing-project-in-session-selector.md';
const workspaceSetupContractPath = 'tests/ui/project-mapping-runtime-catalog.test.js';

async function read(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

function section(document: string, headingPattern: RegExp): string {
  const match = document.match(headingPattern);
  if (!match || match.index === undefined) throw new Error(`Missing section: ${headingPattern}`);
  const rest = document.slice(match.index + match[0].length);
  return rest.split(/^##\s/m, 2)[0];
}

test.describe('story-codex-appserver-session-create retirement contract', () => {
  test('marks the Story, Architecture, and Spec as one retired historical lineage', async () => {
    const documents = await Promise.all(Object.values(retiredDocumentPaths).map(read));

    for (const document of documents) {
      expect(document).toMatch(/^---[\s\S]*^status: retired$[\s\S]*^---/m);
      expect(document).toContain('historical_lineage:');
      expect(document).toContain('capability: codex.app-server');
      expect(document).toContain('current_boundary: project.provisioning');
      expect(document).toContain('successor_owner: Codex app/CLI');
      expect(document).toContain('Session Launch Picker');
      expect(document).toContain('retired and unreachable');
      expect(document).toContain('Project Provisioning');
      expect(document).toContain('Codex app/CLI owns task and worktree creation');
    }
  });

  test('keeps former production paths and MUST requirements under historical headings', async () => {
    const story = await read(retiredDocumentPaths.story);
    const architecture = await read(retiredDocumentPaths.architecture);
    const spec = await read(retiredDocumentPaths.spec);

    expect(story).toContain('## Historical acceptance criteria (retired)');
    expect(story).toContain('## Historical production-path record (retired)');
    expect(story).toContain('`/api/sessions/start`');
    expect(section(story, /^## Historical production-path record \(retired\)$/m)).toContain('Former regular Codex creation');

    expect(architecture).toContain('## Historical decision (retired)');
    expect(section(architecture, /^## Historical decision \(retired\)$/m)).toContain('former design');

    expect(spec).toContain('## Historical requirements (retired)');
    expect(spec).toContain('## Historical workflow scenarios (retired)');
    expect(section(spec, /^## Historical requirements \(retired\)$/m)).toContain('MUST');
    expect(section(spec, /^## Historical workflow scenarios \(retired\)$/m)).toContain('/api/sessions/start');

    for (const document of [story, architecture, spec]) {
      expect(document).not.toMatch(/^## (Acceptance Criteria|Production Path Matrix|Decision|Requirements|Workflow Scenarios)$/m);
    }
  });

  test('states the current ownership boundary without reintroducing retired session creation', async () => {
    const story = await read(retiredDocumentPaths.story);
    const architecture = await read(retiredDocumentPaths.architecture);
    const spec = await read(retiredDocumentPaths.spec);
    const projectProvisioning = await read(projectProvisioningPath);

    expect(projectProvisioning).toContain('The server-side `session.create`/static endpoint and browser Session Launch Picker are retired and unreachable');
    expect(projectProvisioning).toContain('Codex app/CLI owns task and worktree creation and ownership');

    const currentSections = [
      section(story, /^## Current ownership boundary$/m),
      section(architecture, /^## Current ownership boundary$/m),
      section(spec, /^## Current contract$/m),
    ];

    for (const current of currentSections) {
      expect(current).toContain('Project Provisioning');
      expect(current).toMatch(/retired\s+and\s+unreachable/);
      expect(current).toContain('Codex app/CLI owns task and worktree creation');
      expect(current).not.toMatch(/\/api\/sessions\/(?:start|create-with-worktree)/);
      expect(current).not.toContain('MUST');
    }
  });

  test('keeps Session Launch Picker, FocusEngineModal, and Workspace Setup names distinct', async () => {
    const runbook = await read(retirementRunbookPath);
    const workspaceSetupContract = await read(workspaceSetupContractPath);

    expect(runbook).toContain('## 4. 旧セッション作成導線とFocusEngineModal互換導線を確認する');
    expect(runbook).toContain('Session Launch Pickerはretiredかつ到達不能');
    expect(runbook).toContain('FocusEngineModalが表示');
    expect(workspaceSetupContract).toContain('Workspace Setupはruntime catalogとWorkspace pathが揃ったprojectだけを選択可能にする');
    expect(workspaceSetupContract).not.toContain('Session Launch Pickerはruntime catalog');
  });
});
