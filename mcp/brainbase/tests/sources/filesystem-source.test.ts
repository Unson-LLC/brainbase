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

  describe('getCustomers', () => {
    it('SPEC-brainbase-mcp-core-ontology INV-13 S-6: skips legacy customer rows without customer_id', async () => {
      const codexRoot = await mkdtemp(join(tmpdir(), 'brainbase-fs-'));

      try {
        const metaDir = join(codexRoot, 'common', 'meta');
        await mkdir(metaDir, { recursive: true });

        await writeFile(
          join(metaDir, 'customers.md'),
          [
            '| 顧客 | customer_id | 営業組織タグ | 実装組織タグ | プロジェクト | 契約形態メモ | 前受け | ステータス | 備考 |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
            '| BAAO顧客 | cus_baao | unson | unson | baao | monthly | yes | active | ok |',
            '| IDなし顧客 |  | unson | unson | baao | monthly | no | draft | skip |',
          ].join('\n'),
          'utf-8'
        );

        const source = new FilesystemSource(codexRoot);
        const customers = await source.getCustomers();

        assert.deepStrictEqual(customers.map((customer) => customer.id), ['cus_baao']);
      } finally {
        await rm(codexRoot, { recursive: true, force: true });
      }
    });
  });
});
