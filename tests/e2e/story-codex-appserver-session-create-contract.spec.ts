import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

const retiredDocumentPaths = {
  story: 'docs/stories/story-codex-appserver-session-create.md',
  architecture: 'docs/architecture/codex-appserver-session-create-architecture.md',
  spec: 'docs/specs/codex-appserver-session-create-spec.md',
};
const projectProvisioningPath = 'docs/brainbase-capabilities/capabilities/project.provisioning.yml';
const projectSelectorPath = 'docs/brainbase-capabilities/capabilities/project.selector.yml';
const projectArchitecturePath = 'docs/architecture/story-project-provisioning-v1.md';
const codexAppServerCapabilityPath = 'docs/brainbase-capabilities/capabilities/codex.app-server.yml';
const retirementRunbookPath = 'docs/brainbase-capabilities/runbooks/missing-project-in-session-selector.md';

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
    const codexAppServerCapability = yaml.load(await read(codexAppServerCapabilityPath)) as {
      lifecycle: string;
      surfaces: Record<string, string[]>;
      depends_on: string[];
      history: { documents: string[] };
      architecture_decision: string;
      current_evidence_capability: string;
    };

    expect(projectProvisioning).toContain('The retired session.create capability is not a Project Provisioning entry point');
    expect(projectProvisioning).toContain('Codex app/CLI owns task and worktree creation');

    expect(codexAppServerCapability.lifecycle).toBe('retired');
    expect(codexAppServerCapability.surfaces).toEqual({ ui: [], api: [], code: [], data: [] });
    expect(codexAppServerCapability.depends_on).toEqual([]);
    expect(codexAppServerCapability.history.documents).toEqual(expect.arrayContaining(Object.values(retiredDocumentPaths)));
    expect(codexAppServerCapability.architecture_decision).toBe('docs/architecture/ADR-019-codex-owns-development-runtime.md');
    expect(codexAppServerCapability.current_evidence_capability).toBe('docs/brainbase-capabilities/capabilities/run-receipt.inbox.yml');

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

  test('does not retain a browser compatibility implementation as an operational requirement', async () => {
    const runbook = await read(retirementRunbookPath);
    const selector = yaml.load(await read(projectSelectorPath)) as { lifecycle: string };
    expect(selector.lifecycle).toBe('retired');
    expect(runbook).not.toContain('FocusEngineModalが表示');
    expect(runbook).not.toContain('Modal不在時は直ちに');
    expect(runbook).toContain('/api/config/projects');
  });

  test('does not present the retained Workspace Setup module as a production browser UI', async () => {
    const [provisioning, selector, architecture] = await Promise.all([
      read(projectProvisioningPath),
      read(projectSelectorPath),
      read(projectArchitecturePath),
    ]);

    expect(yaml.load(provisioning)).toMatchObject({ surfaces: { ui: [] } });
    expect(yaml.load(selector)).toMatchObject({ lifecycle: 'retired', surfaces: { ui: [], api: [], code: [], data: [] } });
    expect(architecture).toContain('synthetic hostへ載せるブラウザ試験は契約E2E');
    expect(architecture).toContain('production browser E2Eの証拠ではありません');
  });
});
