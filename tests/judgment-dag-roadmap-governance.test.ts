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
    expect(roadmap).toContain('governed_by_commit: 18544f58a2a0298d97eab45de2f05544bed48a43');
    expect(roadmap).toContain('governed_by_markdown_sha256: 167afb6d3fc57198c9f5ffca06fbafea968a5435af04f44b55017199b6d859fe');
    expect(roadmap).toContain('governed_by_json_sha256: f3e6e023060ef3976f367ed7efa62ac57f7091f517ea1ca1d13824d9e6ca429f');
    expect(roadmap).toContain('R0 / J0 / G0 / R1 / D0 / P0 / C0');
    expect(roadmap).toContain('`planned` / `contract_ready` / `implementing` / `verified` / `production_proven` / `done`');
    expect(roadmap).toContain('hard dependencyを満たさないmilestoneを`done`にしない');
    expect(roadmap).toMatch(/文書のmergeだけを実装完了または`done`と扱わ(?:ない|ず)/u);
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
});
