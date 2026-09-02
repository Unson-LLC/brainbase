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
    expect(roadmap).toContain('R0 / J0 / G0 / R1 / D0 / P0 / C0');
    expect(roadmap).toContain('`planned` / `contract_ready` / `implementing` / `verified` / `production_proven` / `done`');
    expect(roadmap).toContain('hard dependencyを満たさないmilestoneを`done`にしない');
    expect(roadmap).toMatch(/文書のmergeだけを実装完了または`done`と扱わ(?:ない|ず)/u);
  });
});
