/**
 * FilesystemSource Test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FilesystemSource } from '../../src/sources/filesystem-source.js';

describe('FilesystemSource', () => {
  describe('getProjects', () => {
    it('should include nested subproject project.md files', async () => {
      const codexRoot = await mkdtemp(join(tmpdir(), 'brainbase-fs-'));

      try {
        const topProjectDir = join(codexRoot, 'projects', 'baao');
        const nestedProjectDir = join(codexRoot, 'projects', 'baao', 'training');

        await mkdir(topProjectDir, { recursive: true });
        await mkdir(nestedProjectDir, { recursive: true });

        await writeFile(
          join(topProjectDir, 'project.md'),
          [
            '---',
            'project_id: baao',
            'name: BAAO',
            'status: active',
            '---',
            '# BAAO',
          ].join('\n'),
          'utf-8'
        );

        await writeFile(
          join(nestedProjectDir, 'project.md'),
          [
            '---',
            'project_id: baao_training',
            'name: BAAO研修事業',
            'status: validation',
            '---',
            '# BAAO研修事業',
          ].join('\n'),
          'utf-8'
        );

        const source = new FilesystemSource(codexRoot);
        const projects = await source.getProjects();
        const ids = projects.map((p) => p.id).sort();

        assert.deepStrictEqual(ids, ['baao', 'baao_training']);
      } finally {
        await rm(codexRoot, { recursive: true, force: true });
      }
    });
  });
});

