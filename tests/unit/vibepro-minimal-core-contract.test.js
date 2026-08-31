import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const activeSurfaces = [
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/skills/vibepro-workflow/SKILL.md',
  '.claude/skills/vibepro-human-review/SKILL.md',
  '.claude/skills/vibepro-story-refactor/SKILL.md',
];

describe('VibePro Minimal Core distribution contract', () => {
  it('keeps the always-loaded agent instructions identical and bounded', () => {
    const agents = read('AGENTS.md');
    const claude = read('CLAUDE.md');
    expect(agents).toBe(claude);
    expect(agents.split('\n').length).toBeLessThanOrEqual(200);
    expect(agents).toContain('Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge');
    expect(agents).toContain('Brainbase is the authority for organization judgment, knowledge, development conventions, infrastructure/secret locations, and reusable learning.');
    expect(agents).toContain('VibePro is not a workflow engine, merge authority, safety decision engine');
  });

  it('routes every implement receipt through VibePro without requiring an explicit product mention', () => {
    const agents = read('AGENTS.md');
    const workflow = read('.claude/skills/vibepro-workflow/SKILL.md');
    expect(agents).toContain(
      'When the Judgment Resolver fixes `classification.intent=implement`, use `vibepro-workflow` before changing code even if the user did not mention VibePro.'
    );
    expect(agents).toContain('Debugging, TDD, and Git Skills run inside this loop; they do not replace it.');
    expect(workflow).toContain(
      'Use this Skill for every Brainbase-managed repository turn whose immutable Judgment receipt has `classification.intent=implement`, even if the user did not mention VibePro.'
    );
  });

  it('removes retired authority language from active instructions and Skills', () => {
    const retiredImperatives = [
      'Use VibePro as the Story / Architecture / Spec / Graphify / Gate control plane',
      'Treat `review-cockpit.html` as the human control plane',
      'Do not call raw `gh pr create`',
      'Do not treat Agent Review Gate as optional',
      'gate_status.ready_for_pr_create=true',
    ];
    for (const surface of activeSurfaces) {
      const content = read(surface);
      for (const retired of retiredImperatives) expect(content).not.toContain(retired);
    }
  });

  it('keeps Architecture, Graphify, review, and PR authority conditional', () => {
    const agents = read('AGENTS.md');
    const workflow = read('.claude/skills/vibepro-workflow/SKILL.md');
    const review = read('.claude/skills/vibepro-human-review/SKILL.md');
    const refactor = read('.claude/skills/vibepro-story-refactor/SKILL.md');
    expect(agents).toContain('Architecture is not a mandatory ceremony for every Story.');
    expect(agents).toContain('Graphify is optional.');
    expect(agents).toContain('including `gh pr create` where that is the repository convention');
    expect(workflow).toContain('Legacy Gate, readiness, lifecycle, and stale-review projections are informational and cannot block the PR.');
    expect(review).toContain('VibePro does not replace human or policy authority.');
    expect(refactor).toContain('Architecture, Graphify, Task artifacts, Gates, and special PR creation are conditional rather than mandatory ceremonies.');
  });

  it('runs this contract test whenever distributed VibePro instructions change', () => {
    const workflow = yaml.load(read('.github/workflows/vibepro-score-run.yml'));
    for (const eventName of ['pull_request', 'push']) {
      const paths = workflow.on[eventName].paths;
      expect(paths).toContain('AGENTS.md');
      expect(paths).toContain('CLAUDE.md');
      expect(paths).toContain('.claude/skills/vibepro-*/**');
      expect(paths).toContain('tests/unit/vibepro-minimal-core-contract.test.js');
    }
    const commands = workflow.jobs['score-evidence'].steps.map((step) => step.run).filter(Boolean).join('\n');
    expect(commands).toContain('tests/unit/vibepro-minimal-core-contract.test.js');
  });
});
