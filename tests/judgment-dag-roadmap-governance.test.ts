import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('OSS Judgment DAG component roadmap governance', () => {
  it('remains subordinate to the cross-repository Program Master Roadmap', async () => {
    const roadmap = await readFile(
      path.join(root, 'docs/management/judgment-dag-milestones.md'),
      'utf8',
    );

    expect(roadmap).toContain('governed_by_repository: Unson-LLC/brainbase-unson');
    expect(roadmap).toContain('governed_by_path: docs/management/milestones/brainbase-program-master-roadmap.md');
    expect(roadmap).toContain('governed_by_machine_path: docs/management/milestones/brainbase-program-master-roadmap.json');
    expect(roadmap).toContain('governed_by_commit: 18544f58a2a0298d97eab45de2f05544bed48a43');
    expect(roadmap).toContain('governed_by_markdown_sha256: 167afb6d3fc57198c9f5ffca06fbafea968a5435af04f44b55017199b6d859fe');
    expect(roadmap).toContain('governed_by_json_sha256: f3e6e023060ef3976f367ed7efa62ac57f7091f517ea1ca1d13824d9e6ca429f');
    expect(roadmap).toContain('R0 / J0 / G0 / R1 / D0 / P0 / C0');
    for (const [milestone, programPackage] of [
      ['M0 Architecture lock', 'R0 + J0'],
      ['M1 Local DAG kernel', 'J0'],
      ['M2 Human + Agent judgment runners', 'G0'],
      ['M3 Replay and evaluation', 'R1'],
      ['M4 Brainbase Deployment dogfood', 'D0'],
      ['M5 Scope promotion', 'P0'],
      ['M6 Organization-ready primitives', 'G0 + C0'],
    ]) {
      expect(roadmap).toContain(`| ${milestone} | ${programPackage} |`);
    }
    expect(roadmap).toContain('`planned` / `contract_ready` / `implementing` / `verified` / `production_proven` / `done`');
    expect(roadmap).toContain('hard dependencyを満たさないmilestoneを`done`にしない');
    expect(roadmap).toMatch(/文書のmergeだけを実装完了または`done`と扱わ(?:ない|ず)/u);
  });

  it('keeps the human roadmap governance metadata aligned with the machine source lock', async () => {
    const roadmap = await readFile(
      path.join(root, 'docs/management/judgment-dag-milestones.md'),
      'utf8',
    );
    const sourceLock = JSON.parse(await readFile(
      path.join(root, 'contracts/judgment-dag/source-lock.json'),
      'utf8',
    ));
    const governance = sourceLock.program_governance;

    const scalar = (key: string) => roadmap.match(new RegExp(`^${key}: (.+)$`, 'm'))?.[1];
    const programPackages = roadmap
      .match(/^program_packages:\n((?:  - .+\n?)+)/m)?.[1]
      ?.trim()
      .split('\n')
      .map((line) => line.replace(/^\s*-\s+/, ''));

    expect({
      repository: scalar('governed_by_repository'),
      markdownPath: scalar('governed_by_path'),
      machinePath: scalar('governed_by_machine_path'),
      commit: scalar('governed_by_commit'),
      markdownSha256: scalar('governed_by_markdown_sha256'),
      jsonSha256: scalar('governed_by_json_sha256'),
      workPackages: programPackages,
    }).toEqual({
      repository: governance.repository.replace('https://github.com/', ''),
      markdownPath: governance.markdown.path,
      machinePath: governance.machine_contract.path,
      commit: governance.commit,
      markdownSha256: governance.markdown.sha256,
      jsonSha256: governance.machine_contract.sha256,
      workPackages: governance.work_packages,
    });
    expect(roadmap).toContain(
      governance.status_vocabulary.map((status: string) => `\`${status}\``).join(' / '),
    );
  });

  it('locks the accepted Program governance revision without requiring runtime network access', async () => {
    const sourceLock = JSON.parse(await readFile(
      path.join(root, 'contracts/judgment-dag/source-lock.json'),
      'utf8',
    ));
    const governance = sourceLock.program_governance;

    expect(governance.repository).toBe('https://github.com/Unson-LLC/brainbase-unson');
    expect(governance.commit).toBe('18544f58a2a0298d97eab45de2f05544bed48a43');
    expect(governance.markdown).toEqual({
      path: 'docs/management/milestones/brainbase-program-master-roadmap.md',
      sha256: '167afb6d3fc57198c9f5ffca06fbafea968a5435af04f44b55017199b6d859fe',
    });
    expect(governance.machine_contract).toEqual({
      path: 'docs/management/milestones/brainbase-program-master-roadmap.json',
      sha256: 'f3e6e023060ef3976f367ed7efa62ac57f7091f517ea1ca1d13824d9e6ca429f',
    });
    expect(governance.work_packages).toEqual(['R0', 'J0', 'G0', 'R1', 'D0', 'P0', 'C0']);
    expect(governance.status_vocabulary).toEqual([
      'planned', 'contract_ready', 'implementing', 'verified', 'production_proven', 'done',
    ]);
    expect(governance.verification_boundary).toContain('Public tests do not fetch');
  });

  it('fails closed when the accepted snapshot update policy is incomplete', async () => {
    const [roadmap, story, architecture, humanSpec, humanTask, acceptedSpec, boundTasks, sourceLock] =
      await Promise.all([
        'docs/management/judgment-dag-milestones.md',
        'docs/management/stories/active/story-r0-master-roadmap-governance.md',
        'docs/architecture/story-r0-master-roadmap-governance.md',
        'docs/specs/r0-master-roadmap-governance.md',
        'docs/management/tasks/r0-master-roadmap-governance.json',
        '.vibepro/spec/story-r0-master-roadmap-governance/spec.json',
        '.vibepro/stories/story-r0-master-roadmap-governance/tasks/tasks.json',
        'contracts/judgment-dag/source-lock.json',
      ].map(async (relativePath) => readFile(path.join(root, relativePath), 'utf8')));

    for (const surface of [roadmap, story, architecture, humanSpec, humanTask, acceptedSpec, boundTasks]) {
      expect(surface).toMatch(/(?:新しい|新).*commit.*両.*hash.*検証.*独立(?:review|レビュー)/su);
    }

    const governance = JSON.parse(sourceLock).program_governance;
    expect(governance.snapshot_update_policy).toEqual({
      requires_new_commit: true,
      required_artifact_hashes: ['markdown.sha256', 'machine_contract.sha256'],
      requires_verification_evidence: true,
      requires_independent_review: true,
    });
  });
});
